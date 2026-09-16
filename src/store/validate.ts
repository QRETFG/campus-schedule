import type { AppData, Backup, PeriodTime } from '../types'
import { BACKUP_FORMAT_VERSION } from '../types'
import { migrateData } from './migrate'
import { isValidDate, isValidTime, toMinutes } from '../core/datetime'
import { MAX_TOTAL_WEEKS, MIN_TOTAL_WEEKS } from './defaults'

/** 节次必须按时间递增且不重叠，开始早于结束（§5.1）。 */
export function validatePeriods(periods: PeriodTime[]): string[] {
  const errors: string[] = []
  if (!periods.length) return ['至少需要 1 节']

  const seen = new Set<number>()
  for (const p of periods) {
    if (!Number.isInteger(p.period) || p.period < 1) errors.push(`节次编号无效：${p.period}`)
    if (seen.has(p.period)) errors.push(`第 ${p.period} 节重复`)
    seen.add(p.period)
    if (!isValidTime(p.start) || !isValidTime(p.end)) {
      errors.push(`第 ${p.period} 节的时间格式无效`)
      continue
    }
    if (toMinutes(p.start) >= toMinutes(p.end)) {
      errors.push(`第 ${p.period} 节的开始时间必须早于结束时间`)
    }
  }

  const sorted = [...periods].sort((a, b) => a.period - b.period)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (!isValidTime(prev.end) || !isValidTime(cur.start)) continue
    if (toMinutes(cur.start) < toMinutes(prev.end)) {
      errors.push(`第 ${cur.period} 节与第 ${prev.period} 节的时间重叠`)
    }
  }
  return errors
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ParseResult {
  ok: boolean
  /** 校验通过时的数据。 */
  backup?: Backup
  /** 摘要，用于恢复前展示（§5.6）。 */
  summary?: { semesterName: string; courseCount: number; slotCount: number; changeCount: number }
  error?: string
}

/** 恢复备份前校验格式与版本；任何失败都不修改已有课表（§8.1）。 */
export function parseBackup(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '文件不是有效的 JSON，无法读取。' }
  }
  if (!isObject(parsed)) return { ok: false, error: '备份文件结构不正确。' }

  const version = parsed.formatVersion
  if (typeof version !== 'number') {
    return { ok: false, error: '备份文件缺少格式版本，无法确认来源。' }
  }
  if (version > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `备份格式版本为 ${version}，高于当前支持的 ${BACKUP_FORMAT_VERSION}，请升级后再恢复。`,
    }
  }

  const data = parsed.data
  const problem = validateData(data)
  if (problem) return { ok: false, error: problem }

  // 旧版本备份在这里升级成当前结构，字段缺失时补默认值。
  const typed = migrateData(data as AppData)
  return {
    ok: true,
    backup: {
      formatVersion: version,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      data: typed,
    },
    summary: {
      semesterName: typed.semester.name,
      courseCount: typed.courses.length,
      slotCount: typed.slots.length,
      changeCount: typed.changes.length + typed.oneOffs.length,
    },
  }
}

/** 返回错误描述；结构完整时返回 undefined。 */
export function validateData(data: unknown): string | undefined {
  if (!isObject(data)) return '备份中缺少课表数据。'

  const semester = data.semester
  if (!isObject(semester)) return '备份中缺少学期信息。'
  if (typeof semester.name !== 'string' || !semester.name.trim()) return '学期名称无效。'
  if (typeof semester.firstWeekMonday !== 'string' || !isValidDate(semester.firstWeekMonday)) {
    return '第 1 教学周的周一日期无效。'
  }
  if (
    typeof semester.totalWeeks !== 'number' ||
    !Number.isInteger(semester.totalWeeks) ||
    semester.totalWeeks < MIN_TOTAL_WEEKS ||
    semester.totalWeeks > MAX_TOTAL_WEEKS
  ) {
    return '学期总周数超出支持范围。'
  }

  for (const key of ['periods', 'courses', 'slots', 'changes', 'oneOffs'] as const) {
    if (!Array.isArray(data[key])) return `备份中的 ${key} 数据不完整。`
  }

  const periodErrors = validatePeriods(data.periods as PeriodTime[])
  if (periodErrors.length) return `作息时间数据有问题：${periodErrors[0]}`

  const courseIds = new Set((data.courses as Array<{ id?: unknown }>).map((c) => c.id))
  for (const slot of data.slots as Array<Record<string, unknown>>) {
    if (typeof slot.id !== 'string') return '上课安排缺少标识。'
    if (!courseIds.has(slot.courseId)) return '存在找不到对应课程的上课安排。'
    if (typeof slot.weekday !== 'number' || slot.weekday < 1 || slot.weekday > 7) {
      return '上课安排的星期无效。'
    }
    if (!Array.isArray(slot.weeks)) return '上课安排缺少周次。'
  }

  const slotIds = new Set((data.slots as Array<{ id?: unknown }>).map((s) => s.id))
  for (const change of data.changes as Array<Record<string, unknown>>) {
    if (!slotIds.has(change.slotId)) return '存在找不到对应安排的单次变更。'
    if (typeof change.originalDate !== 'string' || !isValidDate(change.originalDate)) {
      return '单次变更的原始日期无效。'
    }
  }
  for (const oneOff of data.oneOffs as Array<Record<string, unknown>>) {
    if (!courseIds.has(oneOff.courseId)) return '存在找不到对应课程的补课记录。'
    if (typeof oneOff.date !== 'string' || !isValidDate(oneOff.date)) return '补课日期无效。'
  }

  return undefined
}
