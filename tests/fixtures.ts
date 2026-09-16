import type { AppData, Course, RecurringSlot, Weekday } from '../src/types'
import { DEFAULT_PERIODS } from '../src/store/defaults'
import { expandWeekRule } from '../src/core/weeks'
import type { WeekRule } from '../src/types'

export const TOTAL_WEEKS = 16
/** 2026-09-07 是周一，作为第 1 教学周的起点。 */
export const FIRST_MONDAY = '2026-09-07'

export function emptyData(): AppData {
  return {
    semester: {
      id: 'semester',
      name: '2026-2027 学年第一学期',
      firstWeekMonday: FIRST_MONDAY,
      totalWeeks: TOTAL_WEEKS,
      timezone: 'Asia/Shanghai',
    },
    periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
    courses: [],
    slots: [],
    changes: [],
    oneOffs: [],
  }
}

export function course(id: string, name: string, teacher?: string): Course {
  return { id, name, teacher, colorIndex: 0 }
}

export function slot(
  id: string,
  courseId: string,
  weekday: Weekday,
  startPeriod: number,
  endPeriod: number,
  rule: WeekRule,
  room?: string,
  totalWeeks = TOTAL_WEEKS,
): RecurringSlot {
  return {
    id,
    courseId,
    weekday,
    startPeriod,
    endPeriod,
    weeks: expandWeekRule(rule, totalWeeks).weeks,
    rule,
    room,
  }
}
