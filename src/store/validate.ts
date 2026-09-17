import type { AppData, Backup, PeriodTime, ScheduleWorkspace } from '../types'
import { BACKUP_FORMAT_VERSION, WORKSPACE_VERSION } from '../types'
import { migrateData } from './migrate'
import { createWorkspace, migrateWorkspace } from './workspace'
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
  summary?: { semesterName: string; semesterCount: number; courseCount: number; slotCount: number; changeCount: number }
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
  let workspace: ScheduleWorkspace
  if (version < 3) {
    const problem = validateData(data)
    if (problem) return { ok: false, error: problem }
    // v1/v2 备份只有一个学期，恢复时自动包装成学期集合。
    workspace = createWorkspace(migrateData(data as AppData))
  } else {
    const problem = validateWorkspace(data)
    if (problem) return { ok: false, error: problem }
    workspace = migrateWorkspace(data as ScheduleWorkspace)
  }
  const semesterNames = workspace.semesters.map((item) => item.semester.name)
  return {
    ok: true,
    backup: {
      formatVersion: version,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      data: workspace,
    },
    summary: {
      semesterName: semesterNames.length === 1 ? semesterNames[0] : semesterNames.join('、'),
      semesterCount: workspace.semesters.length,
      courseCount: workspace.semesters.reduce((total, item) => total + item.courses.length, 0),
      slotCount: workspace.semesters.reduce((total, item) => total + item.slots.length, 0),
      changeCount: workspace.semesters.reduce((total, item) => total + item.changes.length + item.oneOffs.length, 0),
    },
  }
}

/** 云端与本地持久化接受多学期容器；服务端同时兼容升级前的单学期数据。 */
export function validateWorkspace(data: unknown): string | undefined {
  if (!isObject(data)) return '缺少课表数据。'

  // 旧客户端写入的单学期对象继续接受，由迁移层包装。
  if (!Array.isArray(data.semesters)) return validateData(data)
  if (
    typeof data.workspaceVersion !== 'number' ||
    !Number.isInteger(data.workspaceVersion) ||
    data.workspaceVersion < 1 ||
    data.workspaceVersion > WORKSPACE_VERSION
  ) {
    return '课表集合版本无法识别。'
  }
  if (data.semesters.length === 0) return '至少需要保留一个学期。'

  const ids = new Set<string>()
  for (let index = 0; index < data.semesters.length; index += 1) {
    const semesterData = data.semesters[index]
    const problem = validateData(semesterData)
    if (problem) return `第 ${index + 1} 个学期数据有问题：${problem}`
    const id = (semesterData as AppData).semester.id
    if (!id || typeof id !== 'string') return `第 ${index + 1} 个学期缺少标识。`
    if (ids.has(id)) return '存在重复的学期标识。'
    ids.add(id)
  }
  return undefined
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
