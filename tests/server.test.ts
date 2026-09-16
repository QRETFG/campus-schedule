import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'

/**
 * 服务端接口测试。
 * 配置在模块加载时读取环境变量，所以每个场景都重置模块后重新导入。
 * 全部用受控输入，不依赖真实识别服务。
 */

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64')

let server: Server | undefined
let base = ''

async function startWith(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
  const { createApp } = await import('../server/index')
  const { resetRateLimit } = await import('../server/rateLimit')
  resetRateLimit()
  const app = createApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve())
  })
  const address = server!.address()
  const port = typeof address === 'object' && address ? address.port : 0
  base = `http://127.0.0.1:${port}`
}

function ocrBody(overrides: Record<string, unknown> = {}) {
  return { imageBase64: PNG_BASE64, mediaType: 'image/png', periodCount: 12, ...overrides }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const BASE_ENV = {
  ANTHROPIC_API_KEY: undefined,
  ANTHROPIC_BASE_URL: undefined,
  OPENAI_API_KEY: undefined,
  OPENAI_BASE_URL: undefined,
  SCHEDULE_API_FORMAT: undefined,
  SCHEDULE_MODEL: undefined,
  SCHEDULE_MODE: undefined,
  SCHEDULE_RATE_LIMIT_PER_MINUTE: undefined,
  SCHEDULE_MAX_NOTICE_CHARS: undefined,
}

function customHeaders(format: 'openai-responses' | 'openai-chat-completions') {
  return {
    'x-schedule-ai-format': format,
    'x-schedule-ai-base-url': 'https://gateway.example/v1',
    'x-schedule-ai-key': 'sk-browser-secret',
    'x-schedule-ai-model': 'vision-model-id',
  }
}

const OPENAI_ENTRY = {
  courseName: '大学英语',
  teacher: '李老师',
  room: 'A101',
  weekday: 2,
  startPeriod: 3,
  endPeriod: 4,
  weeksText: '1-16周',
  uncertainFields: [],
  sourceText: '大学英语 李老师 A101',
}

beforeEach(() => {
  server = undefined
})

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  vi.restoreAllMocks()
})

describe('未配置状态', () => {
  it('health 报告 unconfigured，且不泄露任何凭证信息', async () => {
    await startWith(BASE_ENV)
    const body = await (await fetch(`${base}/api/health`)).json()
    expect(body.mode).toBe('unconfigured')
    expect(body.model).toBeNull()
    expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i)
  })

  it('识别接口明确拒绝，不返回任何样例课程', async () => {
    await startWith(BASE_ENV)
    const response = await post('/api/ocr/timetable', ocrBody())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.code).toBe('unconfigured')
    expect(JSON.stringify(body)).not.toContain('高等数学')
  })

  it('通知解析接口同样拒绝', async () => {
    await startWith(BASE_ENV)
    const response = await post('/api/notice/parse', {
      text: '本周四高数停课',
      noticeDate: '2026-09-16',
      courses: [],
      periodCount: 12,
    })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('unconfigured')
  })

  it('设成 live 但没有密钥时，仍然报未配置而不是降级到样例', async () => {
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'live' })
    const body = await (await fetch(`${base}/api/health`)).json()
    expect(body.mode).toBe('unconfigured')
    expect((await post('/api/ocr/timetable', ocrBody())).status).toBe(503)
  })
})

describe('演示模式', () => {
  it('health 标明 demo，识别返回固定样例并带上模式', async () => {
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'demo' })
    const health = await (await fetch(`${base}/api/health`)).json()
    expect(health.mode).toBe('demo')
    expect(health.model).toBeNull()

    const body = await (await post('/api/ocr/timetable', ocrBody())).json()
    expect(body.mode).toBe('demo')
    expect(body.entries.length).toBeGreaterThan(0)
  })

  it('演示样例里缺周次的条目保持 null，不预先填成全学期', async () => {
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'demo' })
    const body = await (await post('/api/ocr/timetable', ocrBody())).json()
    const missing = body.entries.find((e: { courseName: string }) => e.courseName === '线性代数')
    expect(missing.weeksText).toBeNull()
    const missingRoom = body.entries.find((e: { courseName: string }) => e.courseName === '大学物理')
    expect(missingRoom.room).toBeNull()
  })

  it('有密钥时 demo 仍然优先，不会误用真实服务', async () => {
    await startWith({ ...BASE_ENV, ANTHROPIC_API_KEY: 'sk-test-not-real', SCHEDULE_MODE: 'demo' })
    const health = await (await fetch(`${base}/api/health`)).json()
    expect(health.mode).toBe('demo')
  })
})

describe('OpenAI 兼容格式与前端自定义配置', () => {
  it('Responses API 使用 /responses、input 和 text.format，并解析 typed output', async () => {
    await startWith(BASE_ENV)
    const nativeFetch = globalThis.fetch.bind(globalThis)
    let upstreamUrl = ''
    let upstreamInit: RequestInit | undefined
    let upstreamWasAborted = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.startsWith('https://gateway.example/')) return nativeFetch(input, init)
      upstreamUrl = url
      upstreamInit = init
      // 模拟真实网络等待，确保请求体正常读取完成不会被误判为客户端取消。
      await new Promise((resolve) => setTimeout(resolve, 25))
      upstreamWasAborted = Boolean(init?.signal?.aborted)
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ entries: [OPENAI_ENTRY] }) }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const response = await post('/api/ocr/timetable', ocrBody(), customHeaders('openai-responses'))
    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody.entries[0].courseName).toBe('大学英语')
    expect(responseBody.execution).toEqual({
      source: 'client',
      apiFormat: 'openai-responses',
      model: 'vision-model-id',
    })
    expect(upstreamUrl).toBe('https://gateway.example/v1/responses')
    const request = JSON.parse(String(upstreamInit?.body))
    expect(request.model).toBe('vision-model-id')
    expect(request.input[0].content[0].type).toBe('input_image')
    expect(request.text.format.type).toBe('json_schema')
    expect(request.store).toBe(false)
    expect(upstreamWasAborted).toBe(false)
    expect((upstreamInit?.headers as Record<string, string>).authorization).toBe('Bearer sk-browser-secret')
  })

  it('Chat Completions API 使用 /chat/completions、messages 和 response_format，并解析 choices', async () => {
    await startWith(BASE_ENV)
    const nativeFetch = globalThis.fetch.bind(globalThis)
    let upstreamUrl = ''
    let upstreamBody: Record<string, unknown> | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.startsWith('https://gateway.example/')) return nativeFetch(input, init)
      upstreamUrl = url
      upstreamBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ entries: [OPENAI_ENTRY] }) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const response = await post('/api/ocr/timetable', ocrBody(), customHeaders('openai-chat-completions'))
    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody.entries).toHaveLength(1)
    expect(responseBody.execution.source).toBe('client')
    expect(upstreamUrl).toBe('https://gateway.example/v1/chat/completions')
    expect((upstreamBody?.messages as Array<{ role: string }>).map((message) => message.role)).toEqual(['system', 'user'])
    expect((upstreamBody?.response_format as { type: string }).type).toBe('json_schema')
  })

  it('自定义配置缺任一字段都会被拒绝，也不会回落到服务端默认配置', async () => {
    await startWith({ ...BASE_ENV, ANTHROPIC_API_KEY: 'server-key' })
    const headers = customHeaders('openai-responses')
    delete (headers as Partial<typeof headers>)['x-schedule-ai-key']
    const response = await post('/api/ocr/timetable', ocrBody(), headers)
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('invalid-request')
  })

  it('health 只报告服务端默认格式，不返回 API Key 或自定义配置', async () => {
    await startWith({
      ...BASE_ENV,
      SCHEDULE_API_FORMAT: 'openai-responses',
      OPENAI_API_KEY: 'sk-server-secret',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      SCHEDULE_MODEL: 'server-model',
    })
    const body = await (await fetch(`${base}/api/health`)).json()
    expect(body.mode).toBe('live')
    expect(body.apiFormat).toBe('openai-responses')
    expect(body.provider).toBe('OpenAI Responses API')
    expect(body.model).toBe('server-model')
    expect(JSON.stringify(body)).not.toContain('sk-server-secret')
  })
})

describe('请求校验', () => {
  beforeEach(async () => {
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'demo' })
  })

  it('参数缺失或类型不对返回 400', async () => {
    expect((await post('/api/ocr/timetable', {})).status).toBe(400)
    expect((await post('/api/ocr/timetable', ocrBody({ periodCount: 99 }))).status).toBe(400)
    expect((await post('/api/ocr/timetable', ocrBody({ mediaType: 'image/gif' }))).status).toBe(400)
  })

  it('图片超过上限返回 413', async () => {
    const huge = 'A'.repeat(15 * 1024 * 1024)
    const response = await post('/api/ocr/timetable', ocrBody({ imageBase64: huge }))
    expect(response.status).toBe(413)
    expect((await response.json()).error.code).toBe('too-large')
  })

  it('base64 内容与声明格式不符时返回 415', async () => {
    const response = await post('/api/ocr/timetable', ocrBody({ imageBase64: JPEG_BASE64 }))
    expect(response.status).toBe(415)
    expect((await response.json()).error.code).toBe('unsupported-format')
  })

  it('声明 JPEG 且内容确实是 JPEG 时通过校验', async () => {
    const response = await post('/api/ocr/timetable', ocrBody({ imageBase64: JPEG_BASE64, mediaType: 'image/jpeg' }))
    expect(response.status).toBe(200)
  })

  it('非 base64 字符被拒绝', async () => {
    expect((await post('/api/ocr/timetable', ocrBody({ imageBase64: '<<<not base64>>>' }))).status).toBe(400)
  })

  it('通知文本超长返回 413', async () => {
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'demo', SCHEDULE_MAX_NOTICE_CHARS: '50' })
    const response = await post('/api/notice/parse', {
      text: '停课'.repeat(100),
      noticeDate: '2026-09-16',
      courses: [],
      periodCount: 12,
    })
    expect(response.status).toBe(413)
  })

  it('通知日期格式不合法返回 400', async () => {
    const response = await post('/api/notice/parse', {
      text: '本周四高数停课',
      noticeDate: '2026/09/16',
      courses: [],
      periodCount: 12,
    })
    expect(response.status).toBe(400)
  })
})

describe('频率限制', () => {
  it('超过每分钟上限后返回 429 并带 Retry-After', async () => {
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'demo', SCHEDULE_RATE_LIMIT_PER_MINUTE: '3' })
    for (let i = 0; i < 3; i++) {
      expect((await post('/api/ocr/timetable', ocrBody())).status).toBe(200)
    }
    const limited = await post('/api/ocr/timetable', ocrBody())
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect((await limited.json()).error.code).toBe('rate-limited')
  })

  it('识别与通知解析共用同一个配额', async () => {
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'demo', SCHEDULE_RATE_LIMIT_PER_MINUTE: '2' })
    expect((await post('/api/ocr/timetable', ocrBody())).status).toBe(200)
    expect(
      (
        await post('/api/notice/parse', { text: '本周四高数停课', noticeDate: '2026-09-16', courses: [], periodCount: 12 })
      ).status,
    ).toBe(200)
    expect((await post('/api/ocr/timetable', ocrBody())).status).toBe(429)
  })
})

describe('日志脱敏', () => {
  it('不记录原图、通知原文和课表内容', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })
    await startWith({ ...BASE_ENV, SCHEDULE_MODE: 'demo' })
    await post('/api/ocr/timetable', ocrBody())
    await post('/api/notice/parse', {
      text: '本周四高数停课，补到下周二第 5-6 节',
      noticeDate: '2026-09-16',
      courses: [{ name: '高等数学 A', teacher: '王敏' }],
      periodCount: 12,
    })

    const joined = lines.join('\n')
    expect(joined).toContain('ocr.demo')
    expect(joined).toContain('notice.demo')
    expect(joined).not.toContain(PNG_BASE64)
    expect(joined).not.toContain('本周四高数停课')
    expect(joined).not.toContain('高等数学')
  })
})
