// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimetableEntry } from '../src/shared/contract'
import {
  OcrError,
  RECOGNIZE_TIMEOUT_MS,
  mapApiErrorCode,
  mapTimetableEntry,
  recognizeWithTimeout,
  setPeriodCount,
} from '../src/ocr'
import { entriesToDraft, applyBatchWeeks, previewBatchWeeks, requiredIssueCount, validateDraft, sortEntriesForReview } from '../src/core/draft'
import { emptyData, TOTAL_WEEKS } from './fixtures'

function wire(partial: Partial<TimetableEntry>): TimetableEntry {
  return {
    courseName: null,
    teacher: null,
    room: null,
    weekday: null,
    startPeriod: null,
    endPeriod: null,
    weeksText: null,
    uncertainFields: [],
    sourceText: null,
    ...partial,
  }
}

function pngFile(name = 'timetable.png'): File {
  // PNG 魔数开头即可，内容不会被前端解析。
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  return new File([bytes], name, { type: 'image/png' })
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(handler)
  vi.stubGlobal('fetch', spy as unknown as typeof fetch)
  return spy
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

/* ---------------- 适配器的数据映射 ---------------- */
describe('真实适配器的数据映射', () => {
  it('完整字段按原样映射，并保留原文片段', () => {
    const mapped = mapTimetableEntry(
      wire({
        courseName: ' 高等数学 A ',
        teacher: '王敏',
        room: 'A101',
        weekday: 1,
        startPeriod: 1,
        endPeriod: 2,
        weeksText: '1-16周',
        uncertainFields: ['room'],
        sourceText: '高等数学A 王敏 A101',
      }),
    )
    expect(mapped).toEqual({
      courseName: '高等数学 A',
      teacher: '王敏',
      room: 'A101',
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      weeksText: '1-16周',
      uncertainFields: ['room'],
      sourceText: '高等数学A 王敏 A101',
    })
  })

  it('null 一律映射成缺失，不补默认值', () => {
    const mapped = mapTimetableEntry(wire({ courseName: '线性代数', weekday: 3 }))
    expect(mapped.room).toBeUndefined()
    expect(mapped.teacher).toBeUndefined()
    expect(mapped.weeksText).toBeUndefined()
    expect(mapped.startPeriod).toBeUndefined()
    expect(mapped.sourceText).toBeUndefined()
  })

  it('越界的星期和节次视为无法确定', () => {
    const mapped = mapTimetableEntry(wire({ weekday: 9, startPeriod: 0 }))
    expect(mapped.weekday).toBeUndefined()
    expect(mapped.startPeriod).toBeUndefined()
  })

  it('缺失的周次不会被自动补成全学期', () => {
    const data = emptyData()
    const draft = entriesToDraft([mapTimetableEntry(wire({ courseName: '线性代数', weekday: 3, startPeriod: 1, endPeriod: 2 }))], TOTAL_WEEKS)
    expect(draft[0].weeksConfirmed).toBe(false)
    const issues = validateDraft(draft, data)
    expect(issues.some((i) => i.field === 'weeks' && i.severity === 'required' && i.category === 'missing')).toBe(true)
  })
})

/* ---------------- 请求与异常 ---------------- */
describe('识别请求的异常处理', () => {
  it('成功时返回条目与运行模式', async () => {
    setPeriodCount(12)
    const spy = stubFetch(() =>
      jsonResponse({
        mode: 'live',
        execution: { source: 'server', apiFormat: 'anthropic', model: 'server-model' },
        entries: [wire({ courseName: '大学英语', weekday: 2, startPeriod: 3, endPeriod: 4, weeksText: '1-16周' })],
      }),
    )
    const result = await recognizeWithTimeout(pngFile())
    expect(result.mode).toBe('live')
    expect(result.entries[0].courseName).toBe('大学英语')

    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(body.mediaType).toBe('image/png')
    expect(body.periodCount).toBe(12)
    // 前端只访问自家接口
    expect(String(spy.mock.calls[0][0])).toBe('/api/ocr/timetable')
  })

  it('启用前端自定义配置后随请求发送两种格式所需配置，密钥不进入业务请求体', async () => {
    window.localStorage.setItem(
      'smart-schedule:ai-preferences:v1',
      JSON.stringify({
        source: 'custom',
        format: 'openai-chat-completions',
        baseUrl: 'https://gateway.example/v1',
        model: 'custom-model',
      }),
    )
    window.sessionStorage.setItem('smart-schedule:ai-api-key:v1', 'sk-session-only')
    const spy = stubFetch(() =>
      jsonResponse({
        mode: 'live',
        execution: { source: 'client', apiFormat: 'openai-chat-completions', model: 'custom-model' },
        entries: [wire({ courseName: '大学英语', weekday: 2, startPeriod: 3, endPeriod: 4, weeksText: '1-16周' })],
      }),
    )

    await recognizeWithTimeout(pngFile())
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({
      'x-schedule-ai-format': 'openai-chat-completions',
      'x-schedule-ai-base-url': 'https://gateway.example/v1',
      'x-schedule-ai-key': 'sk-session-only',
      'x-schedule-ai-model': 'custom-model',
    })
    expect(String(init.body)).not.toContain('sk-session-only')
  })

  it('自定义配置启用时拒绝旧服务端返回的 demo 样例，避免误写入课表', async () => {
    window.localStorage.setItem(
      'smart-schedule:ai-preferences:v1',
      JSON.stringify({
        source: 'custom',
        format: 'openai-chat-completions',
        baseUrl: 'https://gateway.example/v1',
        model: 'custom-model',
      }),
    )
    window.sessionStorage.setItem('smart-schedule:ai-api-key:v1', 'sk-session-only')
    stubFetch(() =>
      jsonResponse({
        mode: 'demo',
        entries: [wire({ courseName: '高等数学 A', weekday: 1, startPeriod: 1, endPeriod: 2 })],
      }),
    )

    await expect(recognizeWithTimeout(pngFile())).rejects.toMatchObject({ code: 'configuration-not-applied' })
  })

  it('服务端未配置时给出专门的错误码，不回落到样例数据', async () => {
    stubFetch(() => jsonResponse({ error: { code: 'unconfigured', message: '识别服务未配置' } }, 503))
    await expect(recognizeWithTimeout(pngFile())).rejects.toMatchObject({ code: 'unconfigured' })
  })

  it('限流、上游不可用、超时分别映射成不同错误码', () => {
    expect(mapApiErrorCode('rate-limited')).toBe('rate-limited')
    expect(mapApiErrorCode('upstream-unavailable')).toBe('network')
    expect(mapApiErrorCode('upstream-timeout')).toBe('timeout')
    expect(mapApiErrorCode('upstream-invalid')).toBe('invalid-upstream')
    expect(mapApiErrorCode('empty-result')).toBe('empty')
  })

  it('返回结构非法时报为无法解析', async () => {
    stubFetch(() => jsonResponse({ mode: 'live', entries: 'not-an-array' }))
    await expect(recognizeWithTimeout(pngFile())).rejects.toMatchObject({ code: 'unparsable' })
  })

  it('没有课程时报为空结果', async () => {
    stubFetch(() => jsonResponse({ mode: 'live', entries: [] }))
    await expect(recognizeWithTimeout(pngFile())).rejects.toMatchObject({ code: 'empty' })
  })

  it('超过等待上限后结束等待并报超时', async () => {
    vi.useFakeTimers()
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const promise = recognizeWithTimeout(pngFile())
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(RECOGNIZE_TIMEOUT_MS + 1_000)
    await assertion
  })

  it('取消后不再发出请求', async () => {
    const controller = new AbortController()
    const spy = stubFetch(() => jsonResponse({ mode: 'live', entries: [wire({ courseName: '不该出现' })] }))
    const promise = recognizeWithTimeout(pngFile(), controller.signal)
    controller.abort() // 读取图片期间就取消
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('请求在途时取消，迟到的成功响应不会被当成结果', async () => {
    const controller = new AbortController()
    let deliverLate: (() => void) | undefined
    stubFetch(
      (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          // 让出一拍，确保 fetch 已经在途时才允许取消生效。
          deliverLate = () => resolve(jsonResponse({ mode: 'live', entries: [wire({ courseName: '迟到的结果' })] }))
          init?.signal?.addEventListener('abort', () => {
            // 真实 fetch 在 abort 后会拒绝；这里同时验证即便上游稍后返回也不影响结论。
            setTimeout(() => deliverLate?.(), 0)
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    const promise = recognizeWithTimeout(pngFile(), controller.signal)
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('网络中断时不改变已有课表状态，只抛出网络错误', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(recognizeWithTimeout(pngFile())).rejects.toBeInstanceOf(OcrError)
  })
})

/* ---------------- 批量设置周次 ---------------- */
describe('批量设置周次', () => {
  function threeEntries() {
    return entriesToDraft(
      [
        { courseName: 'A 课', weekday: 1, startPeriod: 1, endPeriod: 2, weeksText: '1-16周' },
        { courseName: 'B 课', weekday: 2, startPeriod: 1, endPeriod: 2 },
        { courseName: 'C 课', weekday: 3, startPeriod: 1, endPeriod: 2, weeksText: '单周 1-15周' },
      ],
      TOTAL_WEEKS,
    )
  }

  it('预览列出受影响条目，且只包含选中的', () => {
    const entries = threeEntries()
    const selected = new Set([entries[1].id, entries[2].id])
    const preview = previewBatchWeeks(entries, selected, { kind: 'range', from: 2, to: 10 }, TOTAL_WEEKS)
    expect(preview.errors).toHaveLength(0)
    expect(preview.rows.map((r) => r.courseName)).toEqual(['B 课', 'C 课'])
    expect(preview.rows[0].before).toBe('周次待确认')
    expect(preview.rows[0].after).toBe('第 2-10 周')
    expect(preview.rows.every((r) => r.changed)).toBe(true)
  })

  it('应用只改动选中条目，其他条目原样保留', () => {
    const entries = threeEntries()
    const selected = new Set([entries[1].id])
    const next = applyBatchWeeks(entries, selected, { kind: 'range', from: 2, to: 10 })

    expect(next[1].weeksConfirmed).toBe(true)
    expect(next[1].rule).toEqual({ kind: 'range', from: 2, to: 10 })
    expect(next[0]).toBe(entries[0]) // 未选中的对象引用都没变
    expect(next[2]).toBe(entries[2])
  })

  it('规则本身非法时预览给出错误，不允许应用', () => {
    const entries = threeEntries()
    const selected = new Set(entries.map((e) => e.id))
    const preview = previewBatchWeeks(entries, selected, { kind: 'range', from: 1, to: 99 }, TOTAL_WEEKS)
    expect(preview.errors[0]).toContain('超出学期范围')
  })

  it('批量确认周次后必填问题清零', () => {
    const data = emptyData()
    const entries = threeEntries()
    expect(requiredIssueCount(validateDraft(entries, data))).toBeGreaterThan(0)
    const next = applyBatchWeeks(entries, new Set([entries[1].id]), { kind: 'all' })
    expect(requiredIssueCount(validateDraft(next, data))).toBe(0)
  })
})

/* ---------------- 核对页排序与分类 ---------------- */
describe('核对页的问题分类与排序', () => {
  it('有必填错误的条目排在最前，无问题的排最后', () => {
    const entries = entriesToDraft(
      [
        { courseName: '正常课', weekday: 1, startPeriod: 1, endPeriod: 2, room: 'A1', weeksText: '1-16周' },
        { courseName: '缺周次', weekday: 2, startPeriod: 1, endPeriod: 2, room: 'A2' },
        { courseName: '缺教室', weekday: 5, startPeriod: 1, endPeriod: 2, weeksText: '1-16周' },
      ],
      TOTAL_WEEKS,
    )
    const data = emptyData()
    const sorted = sortEntriesForReview(entries, validateDraft(entries, data))
    expect(sorted.map((e) => e.courseName)).toEqual(['缺周次', '缺教室', '正常课'])
  })

  it('格式错误、信息缺失、不确定和冲突分属不同类别', () => {
    const data = emptyData()
    const entries = entriesToDraft(
      [
        { courseName: '甲', weekday: 1, startPeriod: 4, endPeriod: 2, weeksText: '1-16周', room: 'A1' },
        { courseName: '乙', weekday: 2, startPeriod: 1, endPeriod: 2, weeksText: '1-16周', uncertainFields: ['courseName'] },
        { courseName: '丙', weekday: 3, startPeriod: 1, endPeriod: 2, weeksText: '1-16周', room: 'B1' },
        { courseName: '丁', weekday: 3, startPeriod: 2, endPeriod: 3, weeksText: '1-16周', room: 'B2' },
      ],
      TOTAL_WEEKS,
    )
    const issues = validateDraft(entries, data)
    const categories = new Set(issues.map((i) => i.category))
    expect(categories.has('format')).toBe(true)
    expect(categories.has('missing')).toBe(true)
    expect(categories.has('uncertain')).toBe(true)
    expect(categories.has('conflict')).toBe(true)
  })
})
