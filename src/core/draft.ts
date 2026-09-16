import type { AppData, Course, RecurringSlot, WeekRule, Weekday } from '../types'
import type { OcrEntry } from '../ocr/types'
import { newId } from '../store/defaults'
import { COURSE_COLORS } from '../store/defaults'
import { describeWeeks, expandWeekRule } from './weeks'
import { spanTime } from './resolve'
import { toMinutes } from './datetime'

/** 核对页的一条待确认安排。原图仅用于本次核对，不进入课表备份（§7）。 */
export interface DraftEntry {
  id: string
  courseName: string
  teacher: string
  room: string
  weekday?: Weekday
  startPeriod?: number
  endPeriod?: number
  rule: WeekRule
  /** 图片未写周次时为 false，显示「周次待确认」，不自动当作全学期（§5.3）。 */
  weeksConfirmed: boolean
  /** 识别服务标记的不确定字段。 */
  uncertainFields: string[]
  /** 该条在截图中的原文，供用户与原图逐条对照；服务未提供时为空。 */
  sourceText?: string
  removed: boolean
}

export type IssueField = 'courseName' | 'weekday' | 'period' | 'weeks' | 'room' | 'entry'

/**
 * 问题类别，核对页据此分组展示：
 * format    格式错误，例如起止节次颠倒、周次写法无法解析
 * missing   信息缺失，例如没有课程名、周次待确认
 * uncertain 识别服务标记的不确定项
 * conflict  与其他安排时间重叠
 * duplicate 疑似重复条目
 */
export type IssueCategory = 'format' | 'missing' | 'uncertain' | 'conflict' | 'duplicate'

export interface DraftIssue {
  entryId: string
  field: IssueField
  category: IssueCategory
  /** required 必须修改才能保存；warning 允许用户确认后保留（§5.3）。 */
  severity: 'required' | 'warning'
  message: string
}

export const ISSUE_CATEGORY_LABEL: Record<IssueCategory, string> = {
  format: '格式错误',
  missing: '信息缺失',
  uncertain: '识别不确定',
  conflict: '时间冲突',
  duplicate: '疑似重复',
}

/* ---------- 从识别结果构造草稿 ---------- */

/** 解析 "单周 1-15周" 这类原始周次文本。无法确定时返回 confirmed: false。 */
export function interpretWeeksText(
  text: string | undefined,
  totalWeeks: number,
): { rule: WeekRule; confirmed: boolean } {
  const raw = (text ?? '').trim()
  if (!raw) return { rule: { kind: 'custom', custom: '' }, confirmed: false }

  const odd = /[单奇]/.test(raw)
  const even = /[双偶]/.test(raw)
  const normalized = raw.replace(/[－—–~～]/g, '-')
  const ranges = [...normalized.matchAll(/(\d+)\s*-\s*(\d+)/g)]
  const singles = [...normalized.matchAll(/(?<![\d-])(\d+)(?![\d-])/g)]

  if (ranges.length === 1 && !singles.length) {
    const from = Number(ranges[0][1])
    const to = Number(ranges[0][2])
    const kind: WeekRule['kind'] = odd ? 'odd' : even ? 'even' : 'range'
    return { rule: { kind, from, to }, confirmed: true }
  }

  const parts: string[] = []
  for (const r of ranges) parts.push(`${r[1]}-${r[2]}`)
  for (const s of singles) parts.push(s[1])
  if (!parts.length) return { rule: { kind: 'custom', custom: '' }, confirmed: false }

  const custom = parts.join(',')
  const expanded = expandWeekRule({ kind: 'custom', custom }, totalWeeks)
  if (odd || even) {
    const filtered = expanded.weeks.filter((w) => (odd ? w % 2 !== 0 : w % 2 === 0))
    return { rule: { kind: 'custom', custom: filtered.join(',') }, confirmed: filtered.length > 0 }
  }
  return { rule: { kind: 'custom', custom }, confirmed: true }
}

export function entriesToDraft(entries: OcrEntry[], totalWeeks: number): DraftEntry[] {
  return entries.map((entry) => {
    const weeks = interpretWeeksText(entry.weeksText, totalWeeks)
    return {
      id: newId('draft'),
      courseName: entry.courseName?.trim() ?? '',
      teacher: entry.teacher?.trim() ?? '',
      room: entry.room?.trim() ?? '',
      weekday: entry.weekday,
      startPeriod: entry.startPeriod,
      endPeriod: entry.endPeriod,
      rule: weeks.rule,
      weeksConfirmed: weeks.confirmed,
      uncertainFields: entry.uncertainFields ?? [],
      sourceText: entry.sourceText,
      removed: false,
    }
  })
}

/* ---------- 核对校验 ---------- */

export function draftWeeks(entry: DraftEntry, totalWeeks: number): number[] {
  if (!entry.weeksConfirmed) return []
  return expandWeekRule(entry.rule, totalWeeks).weeks
}

interface Interval {
  start: number
  end: number
}

function draftInterval(entry: DraftEntry, data: AppData): Interval | undefined {
  if (entry.startPeriod === undefined || entry.endPeriod === undefined) return undefined
  const time = spanTime(data.periods, entry.startPeriod, entry.endPeriod)
  if (!time) return undefined
  return { start: toMinutes(time.start), end: toMinutes(time.end) }
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

function shareWeek(a: number[], b: number[]): number[] {
  const set = new Set(b)
  return a.filter((w) => set.has(w))
}

/**
 * 核对页的字段校验与提示。
 * required 必须修改，warning（冲突、疑似重复、不确定项）允许用户确认后保留。
 */
export function validateDraft(entries: DraftEntry[], data: AppData): DraftIssue[] {
  const issues: DraftIssue[] = []
  const total = data.semester.totalWeeks
  const live = entries.filter((e) => !e.removed)
  const periodNumbers = new Set(data.periods.map((p) => p.period))

  for (const entry of live) {
    if (!entry.courseName.trim()) {
      issues.push({ entryId: entry.id, field: 'courseName', category: 'missing', severity: 'required', message: '请填写课程名称' })
    }
    if (!entry.weekday) {
      issues.push({ entryId: entry.id, field: 'weekday', category: 'missing', severity: 'required', message: '请选择星期' })
    }
    if (entry.startPeriod === undefined || entry.endPeriod === undefined) {
      issues.push({ entryId: entry.id, field: 'period', category: 'missing', severity: 'required', message: '请填写起止节次' })
    } else if (entry.startPeriod > entry.endPeriod) {
      issues.push({ entryId: entry.id, field: 'period', category: 'format', severity: 'required', message: '起始节次不能大于结束节次' })
    } else {
      const missing: number[] = []
      for (let p = entry.startPeriod; p <= entry.endPeriod; p++) {
        if (!periodNumbers.has(p)) missing.push(p)
      }
      if (missing.length) {
        issues.push({
          entryId: entry.id,
          field: 'period',
          category: 'format',
          severity: 'required',
          message: `作息表中没有第 ${missing.join('、')} 节，请修改节次或先调整作息表`,
        })
      }
    }

    if (!entry.weeksConfirmed) {
      issues.push({
        entryId: entry.id,
        field: 'weeks',
        category: 'missing',
        severity: 'required',
        message: '周次待确认，请设置上课周次',
      })
    } else {
      const expansion = expandWeekRule(entry.rule, total)
      if (expansion.errors.length) {
        issues.push({ entryId: entry.id, field: 'weeks', category: 'format', severity: 'required', message: expansion.errors[0] })
      } else if (!expansion.weeks.length) {
        issues.push({ entryId: entry.id, field: 'weeks', category: 'missing', severity: 'required', message: '请设置上课周次' })
      }
    }

    if (!entry.room.trim()) {
      issues.push({ entryId: entry.id, field: 'room', category: 'missing', severity: 'warning', message: '教室待补充' })
    }
    for (const field of entry.uncertainFields) {
      const label =
        field === 'courseName' ? '课程名称' : field === 'room' ? '教室' : field === 'teacher' ? '教师' : field
      issues.push({
        entryId: entry.id,
        field: 'entry',
        category: 'uncertain',
        severity: 'warning',
        message: `识别服务标记「${label}」不确定，请重点核对`,
      })
    }
  }

  // 草稿内部之间的重复与冲突
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (!a.weekday || a.weekday !== b.weekday) continue
      const wa = draftWeeks(a, total)
      const wb = draftWeeks(b, total)
      const shared = shareWeek(wa, wb)
      if (!shared.length) continue

      if (
        a.courseName.trim() === b.courseName.trim() &&
        a.startPeriod === b.startPeriod &&
        a.endPeriod === b.endPeriod &&
        a.room.trim() === b.room.trim()
      ) {
        issues.push({
          entryId: b.id,
          field: 'entry',
          category: 'duplicate',
          severity: 'warning',
          message: `与上面的「${a.courseName}」是疑似重复条目`,
        })
        continue
      }

      const ia = draftInterval(a, data)
      const ib = draftInterval(b, data)
      if (ia && ib && overlaps(ia, ib)) {
        const message = `与「${b.courseName || '未命名课程'}」在第 ${shared.join('、')} 周时间重叠`
        issues.push({ entryId: a.id, field: 'entry', category: 'conflict', severity: 'warning', message })
        issues.push({
          entryId: b.id,
          field: 'entry',
          category: 'conflict',
          severity: 'warning',
          message: `与「${a.courseName || '未命名课程'}」在第 ${shared.join('、')} 周时间重叠`,
        })
      }
    }
  }

  // 与已有课表的重复与冲突
  for (const entry of live) {
    if (!entry.weekday) continue
    const weeks = draftWeeks(entry, total)
    if (!weeks.length) continue
    const interval = draftInterval(entry, data)

    for (const slot of data.slots) {
      if (slot.weekday !== entry.weekday) continue
      const shared = shareWeek(weeks, slot.weeks)
      if (!shared.length) continue
      const course = data.courses.find((c) => c.id === slot.courseId)
      if (!course) continue

      if (isSameArrangement(entry, slot, course, weeks)) {
        issues.push({
          entryId: entry.id,
          field: 'entry',
          category: 'duplicate',
          severity: 'warning',
          message: '课表中已有完全相同的安排，保存时将自动跳过',
        })
        continue
      }
      const theirs = spanTime(data.periods, slot.startPeriod, slot.endPeriod)
      if (interval && theirs && overlaps(interval, { start: toMinutes(theirs.start), end: toMinutes(theirs.end) })) {
        issues.push({
          entryId: entry.id,
          field: 'entry',
          category: 'conflict',
          severity: 'warning',
          message: `与课表中已有的「${course.name}」在第 ${shared.join('、')} 周时间重叠`,
        })
      }
    }
  }

  return issues
}

function isSameArrangement(
  entry: DraftEntry,
  slot: RecurringSlot,
  course: Course,
  weeks: number[],
): boolean {
  if (course.name !== entry.courseName.trim()) return false
  if (slot.startPeriod !== entry.startPeriod || slot.endPeriod !== entry.endPeriod) return false
  if ((slot.room ?? '') !== entry.room.trim()) return false
  if (slot.weeks.length !== weeks.length) return false
  const sorted = [...weeks].sort((a, b) => a - b)
  const theirs = [...slot.weeks].sort((a, b) => a - b)
  return sorted.every((w, i) => w === theirs[i])
}

export function requiredIssueCount(issues: DraftIssue[]): number {
  return issues.filter((i) => i.severity === 'required').length
}

/* ---------- 写入正式课表 ---------- */

export interface CommitDraftResult {
  data: AppData
  added: number
  skipped: number
}

/**
 * 用户确认后把草稿写入课表。已有课表时默认追加；
 * 完全相同的上课安排默认不重复添加（§5.3）。
 */
export function commitDraft(data: AppData, entries: DraftEntry[]): CommitDraftResult {
  const total = data.semester.totalWeeks
  const courses = [...data.courses]
  const slots = [...data.slots]
  let added = 0
  let skipped = 0

  for (const entry of entries) {
    if (entry.removed) continue
    const name = entry.courseName.trim()
    const teacher = entry.teacher.trim()
    const room = entry.room.trim()
    const weeks = draftWeeks(entry, total)
    if (!name || !entry.weekday || entry.startPeriod === undefined || entry.endPeriod === undefined) continue
    if (!weeks.length) continue

    // 同名同教师视为同一门课；教师不同时建立独立课程（§7）。
    let course = courses.find((c) => c.name === name && (c.teacher ?? '') === teacher)
    if (!course) {
      course = { id: newId('course'), name, teacher: teacher || undefined, colorIndex: courses.length % COURSE_COLORS.length }
      courses.push(course)
    }

    const duplicate = slots.some(
      (slot) =>
        slot.courseId === course!.id &&
        slot.weekday === entry.weekday &&
        slot.startPeriod === entry.startPeriod &&
        slot.endPeriod === entry.endPeriod &&
        (slot.room ?? '') === room &&
        slot.weeks.length === weeks.length &&
        slot.weeks.every((w, i) => w === weeks[i]),
    )
    if (duplicate) {
      skipped += 1
      continue
    }

    slots.push({
      id: newId('slot'),
      courseId: course.id,
      weekday: entry.weekday,
      startPeriod: entry.startPeriod,
      endPeriod: entry.endPeriod,
      weeks,
      rule: entry.rule,
      room: room || undefined,
    })
    added += 1
  }

  return { data: { ...data, courses, slots }, added, skipped }
}

/* ---------- 批量设置周次 ---------- */

export interface BatchWeeksRow {
  entryId: string
  courseName: string
  /** 应用前的周次描述；未确认时为「周次待确认」。 */
  before: string
  /** 应用后的周次描述。 */
  after: string
  changed: boolean
}

export interface BatchWeeksPreview {
  rows: BatchWeeksRow[]
  /** 规则本身的问题，例如区间超出学期范围；非空时不允许应用。 */
  errors: string[]
}

/**
 * 预览批量设置周次的影响范围。
 * 只覆盖选中且未删除的条目，不触碰其他条目（§5.3 批量操作需先展示影响）。
 */
export function previewBatchWeeks(
  entries: DraftEntry[],
  selectedIds: ReadonlySet<string>,
  rule: WeekRule,
  totalWeeks: number,
): BatchWeeksPreview {
  const expansion = expandWeekRule(rule, totalWeeks)
  const after = expansion.weeks.length ? describeWeeks(expansion.weeks, totalWeeks) : '（无有效周次）'

  const rows: BatchWeeksRow[] = []
  for (const entry of entries) {
    if (entry.removed || !selectedIds.has(entry.id)) continue
    const currentWeeks = draftWeeks(entry, totalWeeks)
    const before = entry.weeksConfirmed
      ? currentWeeks.length
        ? describeWeeks(currentWeeks, totalWeeks)
        : '（无有效周次）'
      : '周次待确认'
    rows.push({
      entryId: entry.id,
      courseName: entry.courseName || '未命名课程',
      before,
      after,
      changed: before !== after,
    })
  }
  return { rows, errors: expansion.errors }
}

/** 应用批量设置；未选中的条目原样返回。 */
export function applyBatchWeeks(
  entries: DraftEntry[],
  selectedIds: ReadonlySet<string>,
  rule: WeekRule,
): DraftEntry[] {
  return entries.map((entry) =>
    entry.removed || !selectedIds.has(entry.id)
      ? entry
      : { ...entry, rule, weeksConfirmed: true },
  )
}

/** 核对页的排序：有必填错误的排在最前，其次是需确认的（§5.3）。 */
export function sortEntriesForReview(entries: DraftEntry[], issues: DraftIssue[]): DraftEntry[] {
  const rank = new Map<string, number>()
  for (const entry of entries) {
    const own = issues.filter((i) => i.entryId === entry.id)
    if (own.some((i) => i.severity === 'required')) rank.set(entry.id, 0)
    else if (own.length) rank.set(entry.id, 1)
    else rank.set(entry.id, 2)
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ra = a.entry.removed ? 3 : (rank.get(a.entry.id) ?? 2)
      const rb = b.entry.removed ? 3 : (rank.get(b.entry.id) ?? 2)
      return ra !== rb ? ra - rb : a.index - b.index
    })
    .map((item) => item.entry)
}

export function countByCategory(issues: DraftIssue[]): Record<IssueCategory, number> {
  const counts: Record<IssueCategory, number> = {
    format: 0,
    missing: 0,
    uncertain: 0,
    conflict: 0,
    duplicate: 0,
  }
  for (const issue of issues) counts[issue.category] += 1
  return counts
}
