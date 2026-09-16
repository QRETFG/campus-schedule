import type { AppData, ClassInstance, DateStr, RecurringSlot, Weekday } from '../types'
import { datesOfWeek } from './weeks'
import { resolveWeek, slotLabel } from './resolve'

/**
 * 本周变化摘要。
 *
 * 全部基于已有的周次规则和课程实例计算，不调用任何模型生成事实。
 * 两类内容分开归类：
 *  - 临时调整：停课、换教室、调入调出、一次性补课；
 *  - 常规变化：单双周切换、课程从本周开始、课程从本周起不再安排。
 * 常规变化按「重复安排在哪些教学周生效」比较，不比较日历日期，
 * 因此单双周的正常跳过不会被写成临时停课。
 */

export type TemporaryKind = 'cancelled' | 'room' | 'moved-in' | 'moved-out' | 'makeup'
export type RegularKind = 'starts' | 'ends' | 'resumed' | 'paused'

export const TEMPORARY_LABEL: Record<TemporaryKind, string> = {
  cancelled: '停课',
  room: '换教室',
  'moved-in': '调入',
  'moved-out': '调出',
  makeup: '补课',
}

export const REGULAR_LABEL: Record<RegularKind, string> = {
  starts: '本周开始',
  ends: '本周起结束',
  resumed: '本周恢复',
  paused: '本周不排',
}

export interface TemporaryChange {
  key: string
  kind: TemporaryKind
  courseId: string
  courseName: string
  date: DateStr
  weekday: Weekday
  periods: string
  room?: string
  /** 调入时是原日期，调出时是目标日期。 */
  relatedDate?: DateStr
}

export interface RegularChange {
  key: string
  kind: RegularKind
  courseId: string
  courseName: string
  slotId: string
  weekday: Weekday
  periods: string
  room?: string
  /** 本周对应星期的日期，供点击定位。 */
  date: DateStr
}

export interface WeekSummary {
  week: number
  /** 第 1 周没有上周基线，此时不产出常规变化，避免把所有课程都报成新增。 */
  hasBaseline: boolean
  temporary: TemporaryChange[]
  regular: RegularChange[]
  total: number
}

function periodsOf(instance: ClassInstance): string {
  return instance.startPeriod === instance.endPeriod
    ? `第 ${instance.startPeriod} 节`
    : `第 ${instance.startPeriod}-${instance.endPeriod} 节`
}

function activeSlots(slots: RecurringSlot[], week: number): Map<string, RecurringSlot> {
  const map = new Map<string, RecurringSlot>()
  for (const slot of slots) {
    if (slot.weeks.includes(week)) map.set(slot.id, slot)
  }
  return map
}

export function buildWeekSummary(data: AppData, week: number): WeekSummary {
  const { semester, slots, courses } = data
  const empty: WeekSummary = { week, hasBaseline: week > 1, temporary: [], regular: [], total: 0 }
  if (week < 1 || week > semester.totalWeeks) return { ...empty, hasBaseline: false }

  /* ---- 临时调整 ---- */
  const temporary: TemporaryChange[] = []
  for (const day of resolveWeek(data, week)) {
    for (const instance of day.instances) {
      const base = {
        key: instance.key,
        courseId: instance.courseId,
        courseName: instance.courseName,
        date: instance.date,
        weekday: instance.weekday,
        periods: periodsOf(instance),
        room: instance.room,
      }
      if (instance.state === 'cancelled') {
        temporary.push({ ...base, kind: 'cancelled' })
      } else if (instance.state === 'moved-out') {
        temporary.push({ ...base, kind: 'moved-out', relatedDate: instance.movedTo })
      } else if (instance.origin === 'moved-in') {
        temporary.push({ ...base, kind: 'moved-in', relatedDate: instance.movedFrom })
      } else if (instance.origin === 'oneoff') {
        temporary.push({ ...base, kind: 'makeup' })
      } else if (instance.roomChanged) {
        // 调入的课程已经在上面单独归类，这里只处理原时段换教室。
        temporary.push({ ...base, kind: 'room' })
      }
    }
  }

  /* ---- 常规变化 ---- */
  const regular: RegularChange[] = []
  if (week > 1) {
    const current = activeSlots(slots, week)
    const previous = activeSlots(slots, week - 1)
    const dates = datesOfWeek(semester, week)
    const nameOf = (courseId: string) => courses.find((c) => c.id === courseId)?.name ?? '未知课程'

    for (const [id, slot] of current) {
      if (previous.has(id)) continue
      // 更早的周次里上过课，说明是单双周或间隔安排的恢复，而不是新课开始。
      const hadEarlier = slot.weeks.some((w) => w < week - 1)
      regular.push({
        key: `regular:${id}:${week}`,
        kind: hadEarlier ? 'resumed' : 'starts',
        courseId: slot.courseId,
        courseName: nameOf(slot.courseId),
        slotId: slot.id,
        weekday: slot.weekday,
        periods: slotLabel(slot),
        room: slot.room,
        date: dates[slot.weekday - 1],
      })
    }

    for (const [id, slot] of previous) {
      if (current.has(id)) continue
      // 后面还会再上，说明只是本周跳过；否则才是真正结束。
      const hasLater = slot.weeks.some((w) => w > week)
      regular.push({
        key: `regular:${id}:${week}`,
        kind: hasLater ? 'paused' : 'ends',
        courseId: slot.courseId,
        courseName: nameOf(slot.courseId),
        slotId: slot.id,
        weekday: slot.weekday,
        periods: slotLabel(slot),
        room: slot.room,
        date: dates[slot.weekday - 1],
      })
    }
  }

  const byWeekdayThenPeriod = <T extends { weekday: number; periods: string }>(a: T, b: T) =>
    a.weekday !== b.weekday ? a.weekday - b.weekday : a.periods.localeCompare(b.periods, 'zh-CN')

  temporary.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : byWeekdayThenPeriod(a, b)))
  regular.sort(byWeekdayThenPeriod)

  return {
    week,
    hasBaseline: week > 1,
    temporary,
    regular,
    total: temporary.length + regular.length,
  }
}
