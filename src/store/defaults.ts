import type { AppData, PeriodTime, Semester } from '../types'
import { TIMEZONE, mondayOf, todayIn } from '../core/datetime'

/** 可编辑的作息模板，需要按学校实际作息核对（§5.1）。 */
export const DEFAULT_PERIODS: PeriodTime[] = [
  { period: 1, start: '08:00', end: '08:45' },
  { period: 2, start: '08:55', end: '09:40' },
  { period: 3, start: '10:00', end: '10:45' },
  { period: 4, start: '10:55', end: '11:40' },
  { period: 5, start: '14:00', end: '14:45' },
  { period: 6, start: '14:55', end: '15:40' },
  { period: 7, start: '16:00', end: '16:45' },
  { period: 8, start: '16:55', end: '17:40' },
  { period: 9, start: '19:00', end: '19:45' },
  { period: 10, start: '19:55', end: '20:40' },
  { period: 11, start: '20:50', end: '21:35' },
  { period: 12, start: '21:45', end: '22:30' },
]

export const MAX_PERIODS = 16
export const MIN_TOTAL_WEEKS = 1
export const MAX_TOTAL_WEEKS = 30
export const DEFAULT_TOTAL_WEEKS = 20

/** 课程展示色板；同一课程使用稳定颜色，但不能仅靠颜色区分状态（§5.4）。 */
export const COURSE_COLORS = [
  { name: '靛蓝', bg: 'bg-indigo-100', text: 'text-indigo-900', border: 'border-indigo-300', dot: 'bg-indigo-500' },
  { name: '青绿', bg: 'bg-teal-100', text: 'text-teal-900', border: 'border-teal-300', dot: 'bg-teal-500' },
  { name: '琥珀', bg: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-300', dot: 'bg-amber-500' },
  { name: '玫红', bg: 'bg-rose-100', text: 'text-rose-900', border: 'border-rose-300', dot: 'bg-rose-500' },
  { name: '天蓝', bg: 'bg-sky-100', text: 'text-sky-900', border: 'border-sky-300', dot: 'bg-sky-500' },
  { name: '紫罗兰', bg: 'bg-violet-100', text: 'text-violet-900', border: 'border-violet-300', dot: 'bg-violet-500' },
  { name: '青柠', bg: 'bg-lime-100', text: 'text-lime-900', border: 'border-lime-300', dot: 'bg-lime-500' },
  { name: '橙', bg: 'bg-orange-100', text: 'text-orange-900', border: 'border-orange-300', dot: 'bg-orange-500' },
]

export function colorOf(colorIndex: number) {
  return COURSE_COLORS[colorIndex % COURSE_COLORS.length]
}

/** 根据当前日期建议一个学期名称，允许用户修改（§5.1）。 */
export function suggestSemesterName(today = todayIn()): string {
  const [y, m] = today.split('-').map(Number)
  // 2 月至 7 月视为春季学期，其余为秋季学期。
  if (m >= 2 && m <= 7) return `${y - 1}-${y} 学年第二学期`
  const startYear = m >= 8 ? y : y - 1
  return `${startYear}-${startYear + 1} 学年第一学期`
}

export function createDefaultSemester(today = todayIn()): Semester {
  return {
    id: 'semester',
    name: suggestSemesterName(today),
    firstWeekMonday: mondayOf(today),
    totalWeeks: DEFAULT_TOTAL_WEEKS,
    timezone: TIMEZONE,
  }
}

export function createEmptyData(today = todayIn()): AppData {
  return {
    semester: createDefaultSemester(today),
    periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
    courses: [],
    slots: [],
    changes: [],
    oneOffs: [],
  }
}

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`
}
