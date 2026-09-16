import type { DateStr, Semester, WeekRule } from '../types'
import { addDays, diffDays, mondayOf } from './datetime'

/**
 * 当前教学周 = 日历日期与第 1 周周一相差的完整周数 + 1（§6.1）。
 * 学期开始前返回 <= 0，结束后返回 > totalWeeks，由调用方判断阶段。
 */
export function teachingWeekOf(semester: Semester, date: DateStr): number {
  return Math.floor(diffDays(semester.firstWeekMonday, mondayOf(date)) / 7) + 1
}

export type SemesterPhase = 'before' | 'during' | 'after'

export function semesterPhaseOf(semester: Semester, date: DateStr): SemesterPhase {
  const week = teachingWeekOf(semester, date)
  if (week < 1) return 'before'
  if (week > semester.totalWeeks) return 'after'
  return 'during'
}

/** 某教学周的周一。week 从 1 开始。 */
export function mondayOfWeek(semester: Semester, week: number): DateStr {
  return addDays(semester.firstWeekMonday, (week - 1) * 7)
}

/** 某教学周的周一至周日 7 个日期。 */
export function datesOfWeek(semester: Semester, week: number): DateStr[] {
  const monday = mondayOfWeek(semester, week)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** 打开页面时默认落在的教学周：学期开始前是第 1 周，结束后是最后一周（§5.4）。 */
export function defaultWeekFor(semester: Semester, date: DateStr): number {
  const week = teachingWeekOf(semester, date)
  if (week < 1) return 1
  if (week > semester.totalWeeks) return semester.totalWeeks
  return week
}

/* ---------- 周次规则展开 ---------- */

export interface WeekExpansion {
  weeks: number[]
  errors: string[]
}

/** 解析 "1-4,6,8-12" 形式的自定义周次。 */
export function parseCustomWeeks(input: string, totalWeeks: number): WeekExpansion {
  const errors: string[] = []
  const weeks = new Set<number>()
  const trimmed = input.trim()
  if (!trimmed) return { weeks: [], errors: ['请填写周次，例如 1-4、6、8-12'] }

  for (const rawPart of trimmed.split(/[,，、\s]+/).filter(Boolean)) {
    const part = rawPart.replace(/[－—–]/g, '-')
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from > to) {
        errors.push(`「${rawPart}」的起始周大于结束周`)
        continue
      }
      for (let w = from; w <= to; w++) weeks.add(w)
      continue
    }
    if (/^\d+$/.test(part)) {
      weeks.add(Number(part))
      continue
    }
    errors.push(`无法识别「${rawPart}」`)
  }

  return finalize(weeks, totalWeeks, errors)
}

/** 统一得到实际周次集合：去重、排序，并校验范围（§6.2）。 */
function finalize(weeks: Set<number>, totalWeeks: number, errors: string[]): WeekExpansion {
  const outOfRange: number[] = []
  const valid: number[] = []
  for (const w of weeks) {
    if (!Number.isInteger(w) || w < 1) {
      outOfRange.push(w)
    } else if (w > totalWeeks) {
      outOfRange.push(w)
    } else {
      valid.push(w)
    }
  }
  if (outOfRange.length) {
    errors.push(`第 ${outOfRange.sort((a, b) => a - b).join('、')} 周超出学期范围（共 ${totalWeeks} 周）`)
  }
  return { weeks: valid.sort((a, b) => a - b), errors }
}

export function expandWeekRule(rule: WeekRule, totalWeeks: number): WeekExpansion {
  if (rule.kind === 'custom') {
    return parseCustomWeeks(rule.custom ?? '', totalWeeks)
  }
  if (rule.kind === 'all') {
    return { weeks: Array.from({ length: totalWeeks }, (_, i) => i + 1), errors: [] }
  }

  const from = rule.from ?? 1
  const to = rule.to ?? totalWeeks
  const errors: string[] = []
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
    return { weeks: [], errors: ['周次区间必须是正整数'] }
  }
  if (from > to) {
    return { weeks: [], errors: ['起始周不能大于结束周'] }
  }

  const weeks = new Set<number>()
  for (let w = from; w <= to; w++) {
    // 单双周以学期教学周编号为准（§6.2）。
    if (rule.kind === 'odd' && w % 2 === 0) continue
    if (rule.kind === 'even' && w % 2 !== 0) continue
    weeks.add(w)
  }
  const result = finalize(weeks, totalWeeks, errors)
  if (!result.weeks.length && !result.errors.length) {
    result.errors.push('该区间内没有符合单双周条件的周次')
  }
  return result
}

/* ---------- 展示 ---------- */

/** 把周次集合压缩成连续区间，例如 [1,2,3,6,8,9] → [[1,3],[6,6],[8,9]]。 */
export function compressWeeks(weeks: number[]): Array<[number, number]> {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b)
  const runs: Array<[number, number]> = []
  for (const w of sorted) {
    const last = runs[runs.length - 1]
    if (last && w === last[1] + 1) last[1] = w
    else runs.push([w, w])
  }
  return runs
}

export function describeWeeks(weeks: number[], totalWeeks: number): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b)
  if (!sorted.length) return '未设置周次'
  if (sorted.length === totalWeeks && sorted[0] === 1 && sorted[sorted.length - 1] === totalWeeks) {
    return '全学期'
  }

  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const span = max - min + 1
  if (span > 2 && sorted.length > 1) {
    const allOdd = sorted.every((w) => w % 2 !== 0)
    const allEven = sorted.every((w) => w % 2 === 0)
    const expected = Math.floor(span / 2) + (span % 2 === 0 ? 0 : 1)
    if (allOdd && sorted.length === (min % 2 !== 0 ? expected : span - expected)) {
      return `第 ${min}-${max} 周（单周）`
    }
    if (allEven && sorted.length === (min % 2 === 0 ? expected : span - expected)) {
      return `第 ${min}-${max} 周（双周）`
    }
  }

  const parts = compressWeeks(sorted).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`))
  return `第 ${parts.join('、')} 周`
}

/** 从实际周次集合反推一个尽量贴切的规则，用于编辑表单回显。 */
export function inferRule(weeks: number[], totalWeeks: number): WeekRule {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b)
  if (!sorted.length) return { kind: 'custom', custom: '' }
  for (const kind of ['all', 'range', 'odd', 'even'] as const) {
    const candidate: WeekRule =
      kind === 'all'
        ? { kind }
        : { kind, from: sorted[0], to: sorted[sorted.length - 1] }
    const expanded = expandWeekRule(candidate, totalWeeks)
    if (expanded.weeks.length === sorted.length && expanded.weeks.every((w, i) => w === sorted[i])) {
      return candidate
    }
  }
  const parts = compressWeeks(sorted).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`))
  return { kind: 'custom', custom: parts.join(',') }
}
