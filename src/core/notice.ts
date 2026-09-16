import type {
  AppData,
  AppliedBatch,
  AppliedBatchEntry,
  Course,
  DateStr,
  OneOffClass,
  RecurringSlot,
  SingleChange,
} from '../types'
import type { NoticeCandidate } from '../shared/contract'
import { newId } from '../store/defaults'
import { isValidDate, isoWeekday } from './datetime'
import { semesterPhaseOf, teachingWeekOf } from './weeks'
import { activeOnly, findChange, resolveDate, spanTime } from './resolve'
import { conflictsAmong } from './conflict'
import { parsePeriodRange, resolveNoticeDate } from './noticeDates'

/**
 * 粘贴通知 → 调课草稿。
 *
 * 分工：模型只把通知拆成结构化候选（课程称呼、日期原文、节次、教室）；
 * 课程匹配、日期换算、课程实例定位、冲突检查和最终写入全部在本文件完成，
 * 这样这些规则可以用固定日期直接测试，也不受模型输出波动影响。
 */

export type NoticeDraftKind = 'cancel' | 'room' | 'move' | 'makeup' | 'unknown'

export interface NoticeDraftItem {
  id: string
  kind: NoticeDraftKind
  /** 通知原文片段。 */
  sourceText: string
  /** 模型标记的含糊或矛盾之处。 */
  notes?: string

  courseHint?: string
  courseId?: string
  slotId?: string
  originalDate?: DateStr
  targetDate?: DateStr
  targetStartPeriod?: number
  targetEndPeriod?: number
  room?: string

  /* 日期解析溯源，展示给用户核对 */
  originalDateText?: string
  originalDateBasis?: string
  originalDateAssumed?: boolean
  targetDateText?: string
  targetDateBasis?: string
  targetDateAssumed?: boolean

  /** 用户取消这一项时置为 true，保存时跳过。 */
  excluded: boolean
}

export interface NoticeIssue {
  itemId: string
  field: 'kind' | 'course' | 'slot' | 'originalDate' | 'targetDate' | 'period' | 'room' | 'item'
  severity: 'required' | 'warning'
  message: string
}

export interface NoticePreview {
  courseName?: string
  before?: { date: DateStr; week: number; periods: string; room: string }
  after?: { date: DateStr; week: number; periods: string; room: string }
}

export interface NoticeDraftView {
  item: NoticeDraftItem
  courseCandidates: Course[]
  slotCandidates: RecurringSlot[]
  issues: NoticeIssue[]
  preview: NoticePreview
}

export const KIND_LABEL: Record<NoticeDraftKind, string> = {
  cancel: '停课',
  room: '换教室',
  move: '改期',
  makeup: '补课',
  unknown: '待确认类型',
}

/* ---------------- 课程匹配 ---------------- */

function normalizeName(name: string): string {
  return name
    .replace(/[\s（）()【】[\]·・、,，.。\-_/]/g, '')
    .toLowerCase()
}

/** hint 的字符是否按顺序出现在 name 中，用于「高数」→「高等数学 A」这类简称。 */
function isSubsequence(hint: string, name: string): boolean {
  let index = 0
  for (const ch of name) {
    if (ch === hint[index]) index += 1
    if (index === hint.length) return true
  }
  return hint.length === 0
}

/**
 * 按课程称呼给出候选，只返回匹配度最高的一组。
 * 返回多于一条时说明存在歧义，必须由用户选择，不能自动确定。
 */
export function matchCourses(hint: string | undefined, courses: Course[]): Course[] {
  const needle = normalizeName(hint ?? '')
  if (!needle) return []

  const scored: Array<{ course: Course; score: number }> = []
  for (const course of courses) {
    const name = normalizeName(course.name)
    if (!name) continue
    if (name === needle) scored.push({ course, score: 0 })
    else if (name.includes(needle) || needle.includes(name)) scored.push({ course, score: 1 })
    else if (isSubsequence(needle, name)) scored.push({ course, score: 2 })
  }
  if (!scored.length) return []
  const best = Math.min(...scored.map((s) => s.score))
  return scored.filter((s) => s.score === best).map((s) => s.course)
}

/** 某门课在某个日期上实际存在的重复安排。 */
export function slotsOnDate(data: AppData, courseId: string, date: DateStr): RecurringSlot[] {
  if (!isValidDate(date)) return []
  if (semesterPhaseOf(data.semester, date) !== 'during') return []
  const week = teachingWeekOf(data.semester, date)
  const weekday = isoWeekday(date)
  return data.slots.filter(
    (slot) => slot.courseId === courseId && slot.weekday === weekday && slot.weeks.includes(week),
  )
}

/* ---------------- 候选 → 草稿 ---------------- */

/**
 * 把模型给出的候选转成草稿项。
 * 日期一律用本地规则重新解析；只有在课程或安排唯一时才自动选定，有歧义时留空交给用户。
 */
export function candidatesToDrafts(
  candidates: NoticeCandidate[],
  data: AppData,
  noticeDate: DateStr,
): NoticeDraftItem[] {
  return candidates.map((candidate) => {
    const original = resolveNoticeDate(candidate.originalDateText ?? undefined, noticeDate, data.semester)
    const target = resolveNoticeDate(candidate.targetDateText ?? undefined, noticeDate, data.semester)

    // 本地解析不出来时，才退回模型给的日期，并保留为「待确认」。
    const originalDate =
      original.date ?? (candidate.originalDate && isValidDate(candidate.originalDate) ? candidate.originalDate : undefined)
    const targetDate =
      target.date ?? (candidate.targetDate && isValidDate(candidate.targetDate) ? candidate.targetDate : undefined)

    const item: NoticeDraftItem = {
      id: newId('notice'),
      kind: candidate.kind,
      sourceText: candidate.sourceText,
      notes: candidate.notes ?? undefined,
      courseHint: candidate.courseHint ?? undefined,
      originalDate,
      targetDate,
      room: candidate.room ?? undefined,
      originalDateText: candidate.originalDateText ?? undefined,
      originalDateBasis: original.basis ?? (original.date ? undefined : original.reason),
      originalDateAssumed: original.assumed || (!original.date && Boolean(originalDate)),
      targetDateText: candidate.targetDateText ?? undefined,
      targetDateBasis: target.basis ?? (target.date ? undefined : target.reason),
      targetDateAssumed: target.assumed || (!target.date && Boolean(targetDate)),
      excluded: false,
    }

    const periods = parsePeriodRange(candidate.sourceText)
    item.targetStartPeriod = candidate.targetPeriodStart ?? periods?.start ?? undefined
    item.targetEndPeriod = candidate.targetPeriodEnd ?? periods?.end ?? item.targetStartPeriod

    // 补课没有原安排，把目标日期补齐为原文里唯一的日期。
    if (item.kind === 'makeup' && !item.targetDate && item.originalDate) {
      item.targetDate = item.originalDate
      item.targetDateBasis = item.originalDateBasis
      item.targetDateAssumed = item.originalDateAssumed
      item.originalDate = undefined
    }

    const courses = matchCourses(item.courseHint, data.courses)
    if (courses.length === 1) item.courseId = courses[0].id

    if (item.courseId && item.originalDate) {
      const slots = narrowSlots(slotsOnDate(data, item.courseId, item.originalDate), candidate)
      if (slots.length === 1) {
        item.slotId = slots[0].id
        if (item.kind === 'move' && item.targetStartPeriod === undefined) {
          item.targetStartPeriod = slots[0].startPeriod
          item.targetEndPeriod = slots[0].endPeriod
        }
      }
    }

    return item
  })
}

/** 通知里写了原节次时，用它缩小同一天的多个安排。 */
function narrowSlots(slots: RecurringSlot[], candidate: NoticeCandidate): RecurringSlot[] {
  const start = candidate.originalPeriodStart
  const end = candidate.originalPeriodEnd ?? candidate.originalPeriodStart
  if (start == null || end == null) return slots
  const narrowed = slots.filter((slot) => slot.startPeriod <= end && start <= slot.endPeriod)
  return narrowed.length ? narrowed : slots
}

/* ---------------- 校验 ---------------- */

function periodsLabel(start?: number, end?: number): string {
  if (start === undefined) return '未设置节次'
  if (end === undefined || end === start) return `第 ${start} 节`
  return `第 ${start}-${end} 节`
}

/**
 * 基于当前课表重新计算每一项的候选、问题和预览。
 * 保存前会再跑一次，避免草稿因为期间的编辑而过期。
 */
export function buildNoticeViews(
  items: NoticeDraftItem[],
  data: AppData,
): NoticeDraftView[] {
  const views: NoticeDraftView[] = []
  const seenInstances = new Map<string, string>()
  const periodNumbers = new Set(data.periods.map((p) => p.period))

  for (const item of items) {
    const issues: NoticeIssue[] = []
    const add = (field: NoticeIssue['field'], severity: NoticeIssue['severity'], message: string) =>
      issues.push({ itemId: item.id, field, severity, message })

    const courseCandidates = item.courseId
      ? data.courses.filter((c) => c.id === item.courseId)
      : matchCourses(item.courseHint, data.courses)
    const course = data.courses.find((c) => c.id === item.courseId)

    if (item.kind === 'unknown') {
      add('kind', 'required', '无法判断这是停课、换教室、改期还是补课，请选择')
    }
    if (!item.courseId) {
      const hint = item.courseHint ? `「${item.courseHint}」` : ''
      if (!courseCandidates.length) {
        add('course', 'required', `课表中找不到与${hint || '通知'}对应的课程，请选择一门课程`)
      } else if (courseCandidates.length > 1) {
        add('course', 'required', `${hint}匹配到 ${courseCandidates.length} 门课程，请选择其中一门`)
      } else {
        add('course', 'required', '请确认这一项对应的课程')
      }
    }

    const needsOriginal = item.kind === 'cancel' || item.kind === 'room' || item.kind === 'move'
    let slotCandidates: RecurringSlot[] = []

    if (needsOriginal) {
      if (!item.originalDate) {
        add('originalDate', 'required', item.originalDateBasis ?? '请补充原上课日期')
      } else if (semesterPhaseOf(data.semester, item.originalDate) !== 'during') {
        add('originalDate', 'required', `${item.originalDate} 不在当前学期范围内`)
      } else if (item.courseId) {
        slotCandidates = slotsOnDate(data, item.courseId, item.originalDate)
        if (!slotCandidates.length) {
          add('slot', 'required', `${item.originalDate} 这天「${course?.name ?? '该课程'}」没有课，请确认日期或课程`)
        } else if (!item.slotId) {
          add(
            'slot',
            'required',
            slotCandidates.length > 1
              ? `${item.originalDate} 这天有 ${slotCandidates.length} 节课，请选择要调整的那一节`
              : '请确认要调整的那一节课',
          )
        } else if (!slotCandidates.some((s) => s.id === item.slotId)) {
          add('slot', 'required', '所选的上课安排与日期不匹配，请重新选择')
        }
      }

      if (item.originalDateAssumed && item.originalDate) {
        add('originalDate', 'warning', '通知没写明是哪一周，日期按通知发布日所在周推算，请确认')
      }

      // 同一次课在一批里被改两次，属于通知里的矛盾信息。
      if (item.slotId && item.originalDate) {
        const key = `${item.slotId}@${item.originalDate}`
        const owner = seenInstances.get(key)
        if (owner && owner !== item.id && !item.excluded) {
          add('item', 'required', '这批变更里有另一项也在调整同一次课，请取消其中一项')
        } else {
          seenInstances.set(key, item.id)
        }
      }

      // 覆盖已有调整时明确提示。
      if (item.slotId && item.originalDate && findChange(data.changes, item.slotId, item.originalDate)) {
        add('item', 'warning', '这次课已经有一条调整记录，应用后会被替换')
      }
    }

    if (item.kind === 'room' && !item.room?.trim()) {
      add('room', 'required', '请填写新的教室')
    }

    const needsTarget = item.kind === 'move' || item.kind === 'makeup'
    if (needsTarget) {
      if (!item.targetDate) {
        add('targetDate', 'required', item.targetDateBasis ?? '请补充调整后的日期')
      } else if (semesterPhaseOf(data.semester, item.targetDate) !== 'during') {
        add('targetDate', 'required', `目标日期 ${item.targetDate} 超出当前学期范围`)
      }
      if (item.targetDateAssumed && item.targetDate) {
        add('targetDate', 'warning', '目标日期所在周是推算的，请确认')
      }
      if (item.targetStartPeriod === undefined || item.targetEndPeriod === undefined) {
        add('period', 'required', '请补充调整后的节次')
      } else if (item.targetStartPeriod > item.targetEndPeriod) {
        add('period', 'required', '起始节次不能大于结束节次')
      } else {
        const missing: number[] = []
        for (let p = item.targetStartPeriod; p <= item.targetEndPeriod; p++) {
          if (!periodNumbers.has(p)) missing.push(p)
        }
        if (missing.length) {
          add('period', 'required', `作息表中没有第 ${missing.join('、')} 节`)
        }
      }
    }

    const preview = buildPreview(item, data, course)

    // 冲突检查：把这一项单独套用到课表上看目标日期是否重叠。
    if (!issues.some((i) => i.severity === 'required') && needsTarget && item.targetDate) {
      for (const message of conflictMessages(item, data)) {
        add('item', 'warning', message)
      }
    }

    views.push({ item, courseCandidates, slotCandidates, issues, preview })
  }

  return views
}

function buildPreview(item: NoticeDraftItem, data: AppData, course?: Course): NoticePreview {
  const slot = data.slots.find((s) => s.id === item.slotId)
  const preview: NoticePreview = { courseName: course?.name }

  if (slot && item.originalDate && semesterPhaseOf(data.semester, item.originalDate) === 'during') {
    preview.before = {
      date: item.originalDate,
      week: teachingWeekOf(data.semester, item.originalDate),
      periods: periodsLabel(slot.startPeriod, slot.endPeriod),
      room: slot.room || '教室待补充',
    }
  }

  if (item.kind === 'cancel') {
    preview.after = undefined
  } else if (item.kind === 'room' && preview.before) {
    preview.after = { ...preview.before, room: item.room?.trim() || preview.before.room }
  } else if ((item.kind === 'move' || item.kind === 'makeup') && item.targetDate) {
    preview.after = {
      date: item.targetDate,
      week: teachingWeekOf(data.semester, item.targetDate),
      periods: periodsLabel(item.targetStartPeriod, item.targetEndPeriod),
      room: item.room?.trim() || slot?.room || '教室待补充',
    }
  }
  return preview
}

/** 把单独一项套到课表上，检查目标日期是否与其他课程冲突。 */
function conflictMessages(item: NoticeDraftItem, data: AppData): string[] {
  const staged = applyItem(data, item)
  if (!staged) return []
  const instances = resolveDate(staged.data, item.targetDate!)
  const marker = staged.entry.written.id
  return conflictsAmong(instances)
    .filter((pair) => pair.a.changeId === marker || pair.b.changeId === marker || pair.a.oneOffId === marker || pair.b.oneOffId === marker)
    .map((pair) => {
      const other = pair.a.changeId === marker || pair.a.oneOffId === marker ? pair.b : pair.a
      return `目标时间与「${other.courseName}」重叠，确认后仍可保存`
    })
}

/* ---------------- 应用 ---------------- */

/** 把一项变更套到课表上，返回新数据和写入记录；条件不足时返回 undefined。 */
function applyItem(
  data: AppData,
  item: NoticeDraftItem,
): { data: AppData; entry: AppliedBatchEntry } | undefined {
  if (item.kind === 'makeup') {
    if (!item.courseId || !item.targetDate || item.targetStartPeriod === undefined) return undefined
    const oneOff: OneOffClass = {
      id: newId('oneoff'),
      courseId: item.courseId,
      date: item.targetDate,
      startPeriod: item.targetStartPeriod,
      endPeriod: item.targetEndPeriod ?? item.targetStartPeriod,
      room: item.room?.trim() || undefined,
    }
    return {
      data: { ...data, oneOffs: [...data.oneOffs, oneOff] },
      entry: { kind: 'oneoff', written: oneOff },
    }
  }

  if (!item.slotId || !item.originalDate) return undefined
  const replaced = findChange(data.changes, item.slotId, item.originalDate)

  let change: SingleChange
  if (item.kind === 'cancel') {
    change = { id: newId('change'), slotId: item.slotId, originalDate: item.originalDate, type: 'cancel' }
  } else if (item.kind === 'room') {
    change = {
      id: newId('change'),
      slotId: item.slotId,
      originalDate: item.originalDate,
      type: 'room',
      roomOverride: item.room?.trim() || undefined,
    }
  } else if (item.kind === 'move') {
    if (!item.targetDate || item.targetStartPeriod === undefined) return undefined
    change = {
      id: newId('change'),
      slotId: item.slotId,
      originalDate: item.originalDate,
      type: 'move',
      targetDate: item.targetDate,
      targetStartPeriod: item.targetStartPeriod,
      targetEndPeriod: item.targetEndPeriod ?? item.targetStartPeriod,
      roomOverride: item.room?.trim() || undefined,
    }
  } else {
    return undefined
  }

  return {
    data: {
      ...data,
      // 同一原课程实例只保留一份有效变更（§6.3）。
      changes: [
        ...data.changes.filter((c) => !(c.slotId === item.slotId && c.originalDate === item.originalDate)),
        change,
      ],
    },
    entry: { kind: 'change', written: change, replaced },
  }
}

export interface ApplyNoticeResult {
  ok: boolean
  data?: AppData
  batch?: AppliedBatch
  /** ok 为 false 时，说明哪些项还有必填问题。 */
  blocking?: NoticeIssue[]
}

/**
 * 批量应用选中的变更。
 * 先基于最新课表重新校验，任何一项有必填问题就整批不写入；
 * 全部通过后一次性返回新数据，由调用方做一次持久化（§五 保存与撤销）。
 */
export function applyNoticeBatch(data: AppData, items: NoticeDraftItem[]): ApplyNoticeResult {
  const selected = items.filter((item) => !item.excluded)
  if (!selected.length) {
    return { ok: false, blocking: [] }
  }

  const views = buildNoticeViews(selected, data)
  const blocking = views.flatMap((view) => view.issues.filter((i) => i.severity === 'required'))
  if (blocking.length) return { ok: false, blocking }

  let next = data
  const entries: AppliedBatchEntry[] = []
  for (const item of selected) {
    const applied = applyItem(next, item)
    if (!applied) {
      // 走到这里说明校验和写入的前提不一致，宁可整批不写。
      return {
        ok: false,
        blocking: [{ itemId: item.id, field: 'item', severity: 'required', message: '这一项的信息不完整，无法应用' }],
      }
    }
    next = applied.data
    entries.push(applied.entry)
  }

  const batch: AppliedBatch = {
    id: newId('batch'),
    appliedAt: new Date().toISOString(),
    source: 'notice',
    entries,
  }
  return { ok: true, data: { ...next, lastBatch: batch }, batch }
}

/* ---------------- 撤销 ---------------- */

function sameRecord(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface UndoResult {
  data: AppData
  undone: number
  /** 因为后续编辑而无法撤销的记录，必须明确告知用户，不能静默覆盖。 */
  skipped: Array<{ reason: string }>
}

/**
 * 撤销一批变更。
 * 只处理这批写入、且之后没有被改动过的记录；
 * 被后续编辑改过或已删除的记录原样保留，并在结果里列出。
 */
export function undoNoticeBatch(data: AppData, batch: AppliedBatch): UndoResult {
  let changes = [...data.changes]
  let oneOffs = [...data.oneOffs]
  const skipped: Array<{ reason: string }> = []
  let undone = 0

  for (const entry of batch.entries) {
    if (entry.kind === 'oneoff') {
      const written = entry.written as OneOffClass
      const current = oneOffs.find((o) => o.id === written.id)
      if (!current) {
        skipped.push({ reason: `${written.date} 的补课已经被删除，无需撤销` })
        continue
      }
      if (!sameRecord(current, written)) {
        skipped.push({ reason: `${written.date} 的补课在应用后被修改过，已保留你的修改` })
        continue
      }
      oneOffs = oneOffs.filter((o) => o.id !== written.id)
      undone += 1
      continue
    }

    const written = entry.written as SingleChange
    const current = changes.find((c) => c.id === written.id)
    if (!current) {
      skipped.push({ reason: `${written.originalDate} 的调整已经被删除或替换，无需撤销` })
      continue
    }
    if (!sameRecord(current, written)) {
      skipped.push({ reason: `${written.originalDate} 的调整在应用后被修改过，已保留你的修改` })
      continue
    }
    changes = changes.filter((c) => c.id !== written.id)
    if (entry.replaced) changes.push(entry.replaced)
    undone += 1
  }

  return {
    data: { ...data, changes, oneOffs, lastBatch: undefined },
    undone,
    skipped,
  }
}

/** 应用结果摘要，用于界面提示。 */
export function summarizeBatch(batch: AppliedBatch, data: AppData): string[] {
  return batch.entries.map((entry) => {
    if (entry.kind === 'oneoff') {
      const oneOff = entry.written as OneOffClass
      const course = data.courses.find((c) => c.id === oneOff.courseId)
      return `${oneOff.date} 新增「${course?.name ?? '课程'}」补课`
    }
    const change = entry.written as SingleChange
    const slot = data.slots.find((s) => s.id === change.slotId)
    const course = data.courses.find((c) => c.id === slot?.courseId)
    const name = course?.name ?? '课程'
    if (change.type === 'cancel') return `${change.originalDate}「${name}」停课`
    if (change.type === 'room') return `${change.originalDate}「${name}」教室改为 ${change.roomOverride ?? '未填写'}`
    return `${change.originalDate}「${name}」调至 ${change.targetDate ?? '未设置'}`
  })
}

export { activeOnly, spanTime }
