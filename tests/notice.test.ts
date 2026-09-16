import { describe, expect, it } from 'vitest'
import type { AppData } from '../src/types'
import type { NoticeCandidate } from '../src/shared/contract'
import { FIRST_MONDAY, TOTAL_WEEKS, course, emptyData, slot } from './fixtures'
import { parseChineseNumber, parsePeriodRange, resolveNoticeDate } from '../src/core/noticeDates'
import {
  applyNoticeBatch,
  buildNoticeViews,
  candidatesToDrafts,
  matchCourses,
  undoNoticeBatch,
} from '../src/core/notice'
import { activeOnly, resolveDate } from '../src/core/resolve'
import { addDays } from '../src/core/datetime'

/** 2026-09-16 是第 2 教学周的周三。 */
const NOTICE_DATE = '2026-09-16'
const WEEK2_THU = '2026-09-17'
const WEEK3_TUE = '2026-09-22'

function sample(): AppData {
  const data = emptyData()
  data.courses.push(
    course('c1', '高等数学 A', '王敏'),
    course('c2', '大学英语', '李文静'),
    course('c3', '大学物理', '陈立'),
  )
  data.slots.push(
    slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101'), // 周一 1-2
    slot('s2', 'c1', 4, 3, 4, { kind: 'all' }, 'B203'), // 周四 3-4
    slot('s3', 'c2', 2, 3, 4, { kind: 'all' }, 'C305'), // 周二 3-4
    slot('s4', 'c3', 2, 5, 6, { kind: 'all' }, 'D112'), // 周二 5-6
  )
  return data
}

function candidate(partial: Partial<NoticeCandidate>): NoticeCandidate {
  return {
    kind: 'unknown',
    courseHint: null,
    originalDateText: null,
    originalDate: null,
    originalPeriodStart: null,
    originalPeriodEnd: null,
    targetDateText: null,
    targetDate: null,
    targetPeriodStart: null,
    targetPeriodEnd: null,
    room: null,
    sourceText: '测试',
    notes: null,
    ...partial,
  }
}

const names = (data: AppData, date: string) => activeOnly(resolveDate(data, date)).map((i) => i.courseName)

/* ---------------------------------------------------------- 相对日期 */
describe('相对日期以通知发布日期为基准', () => {
  const semester = sample().semester

  it('本周 / 下周 / 上周按发布日所在周计算', () => {
    expect(resolveNoticeDate('本周四', NOTICE_DATE, semester).date).toBe('2026-09-17')
    expect(resolveNoticeDate('下周二', NOTICE_DATE, semester).date).toBe('2026-09-22')
    expect(resolveNoticeDate('上周一', NOTICE_DATE, semester).date).toBe('2026-09-07')
    expect(resolveNoticeDate('下下周三', NOTICE_DATE, semester).date).toBe('2026-09-30')
  })

  it('今天 / 明天 / 后天以发布日为原点', () => {
    expect(resolveNoticeDate('今天', NOTICE_DATE, semester).date).toBe('2026-09-16')
    expect(resolveNoticeDate('明天', NOTICE_DATE, semester).date).toBe('2026-09-17')
    expect(resolveNoticeDate('后天', NOTICE_DATE, semester).date).toBe('2026-09-18')
  })

  it('换一个发布日期，同样的措辞解析出不同日期', () => {
    expect(resolveNoticeDate('本周四', '2026-09-23', semester).date).toBe('2026-09-24')
    expect(resolveNoticeDate('下周二', '2026-09-23', semester).date).toBe('2026-09-29')
  })

  it('周日属于本周，周一进入下一周', () => {
    // 2026-09-20 是第 2 周周日
    expect(resolveNoticeDate('本周一', '2026-09-20', semester).date).toBe('2026-09-14')
    expect(resolveNoticeDate('本周一', '2026-09-21', semester).date).toBe('2026-09-21')
  })

  it('裸「周四」按发布日所在周解析，但标记为需要确认', () => {
    const resolved = resolveNoticeDate('周四', NOTICE_DATE, semester)
    expect(resolved.date).toBe('2026-09-17')
    expect(resolved.assumed).toBe(true)
  })

  it('支持教学周编号、绝对日期和月日', () => {
    expect(resolveNoticeDate('第3周周三', NOTICE_DATE, semester).date).toBe('2026-09-23')
    // 第 12 周周一 = 2026-09-07 + 11 周
    expect(resolveNoticeDate('第十二周周一', NOTICE_DATE, semester).date).toBe('2026-11-23')
    expect(resolveNoticeDate('2026-10-08', NOTICE_DATE, semester).date).toBe('2026-10-08')
    expect(resolveNoticeDate('10月8日', NOTICE_DATE, semester).date).toBe('2026-10-08')
  })

  it('超出学期的教学周和无法识别的表达都给出原因', () => {
    expect(resolveNoticeDate('第30周周一', NOTICE_DATE, semester).reason).toContain('超出本学期范围')
    expect(resolveNoticeDate('等通知', NOTICE_DATE, semester).reason).toContain('无法')
    expect(resolveNoticeDate(undefined, NOTICE_DATE, semester).reason).toContain('没有写明日期')
  })

  it('节次与中文数字解析', () => {
    expect(parsePeriodRange('补到下周二第 5-6 节')).toEqual({ start: 5, end: 6 })
    expect(parsePeriodRange('第五节')).toEqual({ start: 5, end: 5 })
    expect(parseChineseNumber('十二')).toBe(12)
    expect(parseChineseNumber('十')).toBe(10)
  })
})

/* ---------------------------------------------------------- 课程匹配 */
describe('课程匹配与歧义', () => {
  it('简称按字序匹配到唯一课程', () => {
    const data = sample()
    expect(matchCourses('高数', data.courses).map((c) => c.name)).toEqual(['高等数学 A'])
    expect(matchCourses('英语', data.courses).map((c) => c.name)).toEqual(['大学英语'])
  })

  it('匹配到多门课程时不自动确定，要求用户选择', () => {
    const data = sample()
    data.courses.push(course('c4', '高等数学 B', '赵明'))
    const matched = matchCourses('高数', data.courses)
    expect(matched).toHaveLength(2)

    const drafts = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' })], data, NOTICE_DATE)
    expect(drafts[0].courseId).toBeUndefined()
    const views = buildNoticeViews(drafts, data)
    expect(views[0].issues.some((i) => i.field === 'course' && i.severity === 'required')).toBe(true)
    expect(views[0].courseCandidates).toHaveLength(2)
  })

  it('课表里没有对应课程时明确报错', () => {
    const data = sample()
    const drafts = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '马原', originalDateText: '本周四' })], data, NOTICE_DATE)
    const views = buildNoticeViews(drafts, data)
    expect(views[0].issues.find((i) => i.field === 'course')?.message).toContain('找不到')
  })

  it('同一天有多节课时要求用户选择具体哪一节', () => {
    const data = sample()
    data.slots.push(slot('s5', 'c1', 4, 7, 8, { kind: 'all' }, 'B204')) // 周四再加一节高数
    const drafts = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' })], data, NOTICE_DATE)
    expect(drafts[0].slotId).toBeUndefined()
    const views = buildNoticeViews(drafts, data)
    expect(views[0].issues.find((i) => i.field === 'slot')?.message).toContain('请选择要调整的那一节')
    expect(views[0].slotCandidates).toHaveLength(2)
  })

  it('通知写了原节次时可以自动缩小到唯一一节', () => {
    const data = sample()
    data.slots.push(slot('s5', 'c1', 4, 7, 8, { kind: 'all' }, 'B204'))
    const drafts = candidatesToDrafts(
      [candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四', originalPeriodStart: 7, originalPeriodEnd: 8 })],
      data,
      NOTICE_DATE,
    )
    expect(drafts[0].slotId).toBe('s5')
  })

  it('原日期这天没有这门课时明确报错', () => {
    const data = sample()
    // 周三没有高数
    const drafts = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '今天' })], data, NOTICE_DATE)
    const views = buildNoticeViews(drafts, data)
    expect(views[0].issues.find((i) => i.field === 'slot')?.message).toContain('没有课')
  })

  it('缺少日期或节次时不放行', () => {
    const data = sample()
    const noDate = buildNoticeViews(candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数' })], data, NOTICE_DATE), data)
    expect(noDate[0].issues.some((i) => i.field === 'originalDate' && i.severity === 'required')).toBe(true)

    const noPeriod = buildNoticeViews(
      candidatesToDrafts([candidate({ kind: 'makeup', courseHint: '高数', targetDateText: '下周二' })], data, NOTICE_DATE),
      data,
    )
    expect(noPeriod[0].issues.some((i) => i.field === 'period' && i.severity === 'required')).toBe(true)
  })

  it('无法判断类型时要求用户选择', () => {
    const data = sample()
    const views = buildNoticeViews(candidatesToDrafts([candidate({ kind: 'unknown', courseHint: '高数' })], data, NOTICE_DATE), data)
    expect(views[0].issues.some((i) => i.field === 'kind' && i.severity === 'required')).toBe(true)
  })
})

/* ---------------------------------------------------------- 四类变更 */
describe('停课、换教室、跨周调课与补课', () => {
  it('停课只影响那一次', () => {
    const data = sample()
    const drafts = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' })], data, NOTICE_DATE)
    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(true)
    expect(names(result.data!, WEEK2_THU)).toEqual([])
    expect(names(result.data!, addDays(WEEK2_THU, 7))).toEqual(['高等数学 A'])
  })

  it('换教室只影响那一次', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [candidate({ kind: 'room', courseHint: '高数', originalDateText: '本周四', room: 'B999' })],
      data,
      NOTICE_DATE,
    )
    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(true)
    expect(resolveDate(result.data!, WEEK2_THU)[0].room).toBe('B999')
    expect(resolveDate(result.data!, addDays(WEEK2_THU, 7))[0].room).toBe('B203')
  })

  it('跨周改期：原时段消失，目标时段出现一次', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({
          kind: 'move',
          courseHint: '高数',
          originalDateText: '本周四',
          targetDateText: '下周二',
          targetPeriodStart: 7,
          targetPeriodEnd: 8,
          room: 'B203',
          sourceText: '本周四高数停课，补到下周二第 7-8 节',
        }),
      ],
      data,
      NOTICE_DATE,
    )
    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(true)

    expect(names(result.data!, WEEK2_THU)).toEqual([])
    const moved = activeOnly(resolveDate(result.data!, WEEK3_TUE)).find((i) => i.courseName === '高等数学 A')
    expect(moved?.origin).toBe('moved-in')
    expect(moved?.startPeriod).toBe(7)
    expect(moved?.movedFrom).toBe(WEEK2_THU)
  })

  it('补课只在指定日期生效，且不需要原安排', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({
          kind: 'makeup',
          courseHint: '大学物理',
          targetDateText: '下周二',
          targetPeriodStart: 9,
          targetPeriodEnd: 10,
          room: 'D999',
        }),
      ],
      data,
      NOTICE_DATE,
    )
    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(true)

    // 大学物理本来每周二都有常规课，所以要按补课自身的节次来判断。
    const makeupOn = (date: string) =>
      activeOnly(resolveDate(result.data!, date)).filter((i) => i.origin === 'oneoff')
    expect(makeupOn(WEEK3_TUE).map((i) => `${i.courseName} 第${i.startPeriod}-${i.endPeriod}节`)).toEqual([
      '大学物理 第9-10节',
    ])
    expect(makeupOn(addDays(WEEK3_TUE, 7))).toHaveLength(0)
    // 常规课不受影响
    expect(names(result.data!, addDays(WEEK3_TUE, 7))).toContain('大学物理')
  })

  it('一条通知里的多项变更一次应用', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四', sourceText: '本周四高数停课' }),
        candidate({ kind: 'room', courseHint: '英语', originalDateText: '下周二', room: 'C999', sourceText: '下周二英语改到 C999' }),
      ],
      data,
      NOTICE_DATE,
    )
    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(true)
    expect(result.batch!.entries).toHaveLength(2)
    expect(names(result.data!, WEEK2_THU)).toEqual([])
    expect(resolveDate(result.data!, WEEK3_TUE).find((i) => i.courseName === '大学英语')?.room).toBe('C999')
  })

  it('取消其中一项后只应用剩下的', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' }),
        candidate({ kind: 'cancel', courseHint: '英语', originalDateText: '下周二' }),
      ],
      data,
      NOTICE_DATE,
    )
    drafts[1].excluded = true
    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(true)
    expect(result.batch!.entries).toHaveLength(1)
    expect(names(result.data!, WEEK3_TUE)).toContain('大学英语')
  })
})

/* ---------------------------------------------------------- 校验与冲突 */
describe('冲突、矛盾与批量写入的原子性', () => {
  it('目标时间与其他课程重叠时给出提示，但允许应用', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({
          kind: 'move',
          courseHint: '高数',
          originalDateText: '本周四',
          targetDateText: '下周二',
          targetPeriodStart: 3,
          targetPeriodEnd: 4, // 与周二的大学英语重叠
        }),
      ],
      data,
      NOTICE_DATE,
    )
    const views = buildNoticeViews(drafts, data)
    const conflict = views[0].issues.find((i) => i.message.includes('重叠'))
    expect(conflict?.severity).toBe('warning')
    expect(applyNoticeBatch(data, drafts).ok).toBe(true)
  })

  it('目标日期超出学期时必须先处理', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [candidate({ kind: 'makeup', courseHint: '高数', targetDate: '2027-06-01', targetPeriodStart: 1, targetPeriodEnd: 2 })],
      data,
      NOTICE_DATE,
    )
    const views = buildNoticeViews(drafts, data)
    expect(views[0].issues.some((i) => i.field === 'targetDate' && i.severity === 'required')).toBe(true)
    expect(applyNoticeBatch(data, drafts).ok).toBe(false)
  })

  it('同一批里两项调整同一次课属于矛盾，必须先处理', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' }),
        candidate({ kind: 'room', courseHint: '高数', originalDateText: '本周四', room: 'B999' }),
      ],
      data,
      NOTICE_DATE,
    )
    const views = buildNoticeViews(drafts, data)
    expect(views[1].issues.some((i) => i.severity === 'required' && i.message.includes('同一次课'))).toBe(true)
    expect(applyNoticeBatch(data, drafts).ok).toBe(false)
  })

  it('覆盖已有调整时给出提示', () => {
    const data = sample()
    data.changes.push({ id: 'ch0', slotId: 's2', originalDate: WEEK2_THU, type: 'cancel' })
    const drafts = candidatesToDrafts(
      [candidate({ kind: 'room', courseHint: '高数', originalDateText: '本周四', room: 'B999' })],
      data,
      NOTICE_DATE,
    )
    const views = buildNoticeViews(drafts, data)
    expect(views[0].issues.some((i) => i.severity === 'warning' && i.message.includes('会被替换'))).toBe(true)

    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(true)
    // 同一原课程实例只保留一份有效变更
    expect(result.data!.changes.filter((c) => c.slotId === 's2' && c.originalDate === WEEK2_THU)).toHaveLength(1)
    expect(result.batch!.entries[0].replaced?.id).toBe('ch0')
  })

  it('任意一项有必填问题时整批都不写入', () => {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' }),
        candidate({ kind: 'cancel', courseHint: '不存在的课', originalDateText: '本周四' }),
      ],
      data,
      NOTICE_DATE,
    )
    const result = applyNoticeBatch(data, drafts)
    expect(result.ok).toBe(false)
    expect(result.blocking!.length).toBeGreaterThan(0)
    expect(result.data).toBeUndefined()
    // 原数据完全没动
    expect(data.changes).toHaveLength(0)
    expect(names(data, WEEK2_THU)).toEqual(['高等数学 A'])
  })

  it('保存前基于最新课表重新校验，草稿过期会被拦下', () => {
    const data = sample()
    const drafts = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' })], data, NOTICE_DATE)
    expect(drafts[0].slotId).toBe('s2')

    // 期间用户把这组安排删掉了
    const changed: AppData = { ...data, slots: data.slots.filter((s) => s.id !== 's2') }
    const result = applyNoticeBatch(changed, drafts)
    expect(result.ok).toBe(false)
    expect(changed.changes).toHaveLength(0)
  })

  it('重复应用同一份草稿不会写入两遍', () => {
    const data = sample()
    const drafts = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' })], data, NOTICE_DATE)
    const first = applyNoticeBatch(data, drafts)
    expect(first.ok).toBe(true)

    // 模拟重复点击：对已经应用过的数据再来一次
    const second = applyNoticeBatch(first.data!, drafts)
    expect(second.ok).toBe(true)
    expect(second.data!.changes).toHaveLength(1)
  })
})

/* ---------------------------------------------------------- 撤销 */
describe('撤销本批变更', () => {
  function applied() {
    const data = sample()
    const drafts = candidatesToDrafts(
      [
        candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' }),
        candidate({ kind: 'makeup', courseHint: '大学物理', targetDateText: '下周二', targetPeriodStart: 9, targetPeriodEnd: 10 }),
      ],
      data,
      NOTICE_DATE,
    )
    const result = applyNoticeBatch(data, drafts)
    return { before: data, after: result.data!, batch: result.batch! }
  }

  it('撤销后恢复到应用前的状态', () => {
    const { after, batch } = applied()
    const undo = undoNoticeBatch(after, batch)
    expect(undo.undone).toBe(2)
    expect(undo.skipped).toHaveLength(0)
    expect(undo.data.changes).toHaveLength(0)
    expect(undo.data.oneOffs).toHaveLength(0)
    expect(undo.data.lastBatch).toBeUndefined()
    expect(names(undo.data, WEEK2_THU)).toEqual(['高等数学 A'])
  })

  it('撤销不会碰这批之外的修改', () => {
    const { after, batch } = applied()
    // 用户另外加了一条与本批无关的停课
    const withExtra: AppData = {
      ...after,
      changes: [...after.changes, { id: 'other', slotId: 's1', originalDate: '2026-09-14', type: 'cancel' }],
    }
    const undo = undoNoticeBatch(withExtra, batch)
    expect(undo.data.changes.map((c) => c.id)).toEqual(['other'])
  })

  it('本批记录被后续编辑改过时，撤销跳过它并说明原因', () => {
    const { after, batch } = applied()
    const changeId = (batch.entries[0].written as { id: string }).id
    const edited: AppData = {
      ...after,
      changes: after.changes.map((c) => (c.id === changeId ? { ...c, type: 'room' as const, roomOverride: 'X1' } : c)),
    }
    const undo = undoNoticeBatch(edited, batch)
    expect(undo.undone).toBe(1) // 补课仍然撤销了
    expect(undo.skipped).toHaveLength(1)
    expect(undo.skipped[0].reason).toContain('被修改过')
    // 用户的修改原样保留，没有被静默覆盖
    expect(undo.data.changes.find((c) => c.id === changeId)?.roomOverride).toBe('X1')
  })

  it('本批记录已被删除时，撤销不会把它加回来', () => {
    const { after, batch } = applied()
    const removed: AppData = { ...after, oneOffs: [] }
    const undo = undoNoticeBatch(removed, batch)
    expect(undo.data.oneOffs).toHaveLength(0)
    expect(undo.skipped.some((s) => s.reason.includes('已经被删除'))).toBe(true)
  })

  it('撤销覆盖型变更时恢复被替换的原记录', () => {
    const data = sample()
    data.changes.push({ id: 'ch0', slotId: 's2', originalDate: WEEK2_THU, type: 'cancel' })
    const drafts = candidatesToDrafts(
      [candidate({ kind: 'room', courseHint: '高数', originalDateText: '本周四', room: 'B999' })],
      data,
      NOTICE_DATE,
    )
    const result = applyNoticeBatch(data, drafts)
    const undo = undoNoticeBatch(result.data!, result.batch!)
    expect(undo.data.changes).toHaveLength(1)
    expect(undo.data.changes[0].id).toBe('ch0')
    expect(undo.data.changes[0].type).toBe('cancel')
  })
})

/* ---------------------------------------------------------- 上下文最小化 */
describe('发送给解析服务的上下文', () => {
  it('候选转草稿只依赖课程名，不需要上传上课安排', () => {
    const data = sample()
    // 用同一份候选，但课表里多了历史变更和补课，草稿结果不受影响
    const noisy: AppData = {
      ...data,
      changes: [{ id: 'x', slotId: 's1', originalDate: FIRST_MONDAY, type: 'cancel' }],
      oneOffs: [{ id: 'y', courseId: 'c1', date: FIRST_MONDAY, startPeriod: 5, endPeriod: 6 }],
    }
    const a = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' })], data, NOTICE_DATE)
    const b = candidatesToDrafts([candidate({ kind: 'cancel', courseHint: '高数', originalDateText: '本周四' })], noisy, NOTICE_DATE)
    expect(a[0].slotId).toBe(b[0].slotId)
    expect(a[0].originalDate).toBe(b[0].originalDate)
    expect(TOTAL_WEEKS).toBe(16)
  })
})
