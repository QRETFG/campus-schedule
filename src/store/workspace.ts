import type { AppData, DateStr, ScheduleWorkspace } from '../types'
import { WORKSPACE_VERSION } from '../types'
import { addDays, diffDays, todayIn } from '../core/datetime'
import { migrateData } from './migrate'

export function createWorkspace(data: AppData): ScheduleWorkspace {
  return { workspaceVersion: WORKSPACE_VERSION, semesters: [migrateData(data)] }
}

/** 已通过结构校验的数据统一迁移为多学期容器。 */
export function migrateWorkspace(input: AppData | ScheduleWorkspace): ScheduleWorkspace {
  if (isWorkspace(input)) {
    return {
      workspaceVersion: WORKSPACE_VERSION,
      semesters: input.semesters.map(migrateData),
    }
  }
  return createWorkspace(input)
}

export function isWorkspace(value: AppData | ScheduleWorkspace): value is ScheduleWorkspace {
  return Array.isArray((value as ScheduleWorkspace).semesters)
}

/** 优先打开当前日期所在学期，其次打开距离今天最近的学期。 */
export function defaultSemesterId(workspace: ScheduleWorkspace, today: DateStr = todayIn()): string | undefined {
  const ranked = workspace.semesters.map((data, index) => {
    const start = data.semester.firstWeekMonday
    const end = addDays(start, data.semester.totalWeeks * 7 - 1)
    const distance = diffDays(today, start) > 0
      ? dateDistance(today, start)
      : diffDays(end, today) > 0
        ? dateDistance(end, today)
        : 0
    return { id: data.semester.id, distance, index }
  })
  ranked.sort((a, b) => a.distance - b.distance || b.index - a.index)
  return ranked[0]?.id
}

function dateDistance(from: DateStr, to: DateStr): number {
  return Math.abs(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  )
}
