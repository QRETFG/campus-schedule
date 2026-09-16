import type { AppData, PeriodTime, RecurringSlot, Semester, SingleChange } from '../types'
import { isoWeekday } from './datetime'
import { describeWeeks } from './weeks'
import { semesterPhaseOf, teachingWeekOf } from './weeks'

export type ImpactKind =
  | 'week-out-of-range'
  | 'period-missing'
  | 'change-orphaned'
  | 'change-out-of-range'
  | 'oneoff-out-of-range'
  | 'dates-shifted'

export interface ImpactItem {
  kind: ImpactKind
  /** blocking 必须先由用户修改；confirm 需要用户确认后才保存。 */
  severity: 'blocking' | 'confirm'
  title: string
  detail: string
  slotId?: string
  changeId?: string
  oneOffId?: string
  courseId?: string
}

export interface ImpactReport {
  items: ImpactItem[]
  blocking: ImpactItem[]
  confirmable: ImpactItem[]
}

function report(items: ImpactItem[]): ImpactReport {
  return {
    items,
    blocking: items.filter((i) => i.severity === 'blocking'),
    confirmable: items.filter((i) => i.severity === 'confirm'),
  }
}

function courseName(data: AppData, courseId: string): string {
  return data.courses.find((c) => c.id === courseId)?.name ?? '未知课程'
}

function slotCourseName(data: AppData, slotId: string): string {
  const slot = data.slots.find((s) => s.id === slotId)
  return slot ? courseName(data, slot.courseId) : '未知课程'
}

/** 某次重复课程在给定学期与安排下是否仍然真实存在。 */
export function changeStillMatches(
  slot: RecurringSlot | undefined,
  semester: Semester,
  change: SingleChange,
  trimmedWeeks?: number[],
): boolean {
  if (!slot) return false
  if (slot.weekday !== isoWeekday(change.originalDate)) return false
  const week = teachingWeekOf(semester, change.originalDate)
  if (week < 1 || week > semester.totalWeeks) return false
  return (trimmedWeeks ?? slot.weeks).includes(week)
}

/**
 * 分析修改学期设置或作息表带来的影响（§6.4）。
 * 返回的 blocking 项必须由用户先修改，confirmable 项需要用户确认后才能保存。
 */
export function analyzeConfigChange(
  data: AppData,
  next: { semester: Semester; periods: PeriodTime[] },
): ImpactReport {
  const items: ImpactItem[] = []
  const periodNumbers = new Set(next.periods.map((p) => p.period))
  const startShifted = data.semester.firstWeekMonday !== next.semester.firstWeekMonday

  if (startShifted && (data.slots.length || data.oneOffs.length)) {
    items.push({
      kind: 'dates-shifted',
      severity: 'confirm',
      title: '重复课程的实际日期将整体移动',
      detail:
        '已记录的停课、调课和补课保持在原来的日历日期上，请保存后核对这些记录是否仍然对应正确的课程。',
    })
  }

  // 节次被移除：课程仍引用时必须先修改。
  for (const slot of data.slots) {
    const missing: number[] = []
    for (let p = slot.startPeriod; p <= slot.endPeriod; p++) {
      if (!periodNumbers.has(p)) missing.push(p)
    }
    if (missing.length) {
      items.push({
        kind: 'period-missing',
        severity: 'blocking',
        title: `「${courseName(data, slot.courseId)}」引用了已移除的节次`,
        detail: `该安排占用第 ${missing.join('、')} 节，新的作息表中不存在，请先修改这门课程。`,
        slotId: slot.id,
        courseId: slot.courseId,
      })
    }
  }
  for (const oneOff of data.oneOffs) {
    const missing: number[] = []
    for (let p = oneOff.startPeriod; p <= oneOff.endPeriod; p++) {
      if (!periodNumbers.has(p)) missing.push(p)
    }
    if (missing.length) {
      items.push({
        kind: 'period-missing',
        severity: 'blocking',
        title: `补课「${courseName(data, oneOff.courseId)}」引用了已移除的节次`,
        detail: `该补课占用第 ${missing.join('、')} 节，请先修改或删除这次补课。`,
        oneOffId: oneOff.id,
        courseId: oneOff.courseId,
      })
    }
  }

  // 缩短总周数：列出超出范围的周次，确认裁剪后才能保存。
  for (const slot of data.slots) {
    const over = slot.weeks.filter((w) => w > next.semester.totalWeeks)
    if (over.length) {
      const remain = slot.weeks.filter((w) => w <= next.semester.totalWeeks)
      items.push({
        kind: 'week-out-of-range',
        severity: 'confirm',
        title: `「${courseName(data, slot.courseId)}」有周次超出新的学期范围`,
        detail:
          `第 ${over.join('、')} 周将被裁剪，保留 ` +
          (remain.length ? describeWeeks(remain, next.semester.totalWeeks) : '（裁剪后不再有上课周次）') +
          '。',
        slotId: slot.id,
        courseId: slot.courseId,
      })
    }
  }

  // 单次变更：超出新学期范围，或原始课程实例无法匹配。
  for (const change of data.changes) {
    const slot = data.slots.find((s) => s.id === change.slotId)
    const trimmed = slot?.weeks.filter((w) => w <= next.semester.totalWeeks)
    if (!changeStillMatches(slot, next.semester, change, trimmed)) {
      items.push({
        kind: 'change-orphaned',
        severity: 'blocking',
        title: `${change.originalDate} 的调整已失去对应课程`,
        detail: `「${slotCourseName(data, change.slotId)}」在该日期不再有课，请取消或重新设置这次调整。`,
        changeId: change.id,
      })
      continue
    }
    if (change.type === 'move' && change.targetDate) {
      if (semesterPhaseOf(next.semester, change.targetDate) !== 'during') {
        items.push({
          kind: 'change-out-of-range',
          severity: 'blocking',
          title: `${change.originalDate} 的调课目标日期超出学期范围`,
          detail: `目标日期 ${change.targetDate} 不在新的学期范围内，请修改或取消这次调课。`,
          changeId: change.id,
        })
      }
    }
  }

  for (const oneOff of data.oneOffs) {
    if (semesterPhaseOf(next.semester, oneOff.date) !== 'during') {
      items.push({
        kind: 'oneoff-out-of-range',
        severity: 'confirm',
        title: `补课「${courseName(data, oneOff.courseId)}」不在新的学期范围内`,
        detail: `${oneOff.date} 超出新的学期范围，保存后这次补课将不再显示在课表中。`,
        oneOffId: oneOff.id,
        courseId: oneOff.courseId,
      })
    }
  }

  return report(items)
}

/** 用户确认后执行裁剪：把超出总周数的周次从重复安排中去掉。 */
export function trimWeeksToSemester(data: AppData, totalWeeks: number): AppData {
  return {
    ...data,
    slots: data.slots.map((slot) => {
      const weeks = slot.weeks.filter((w) => w <= totalWeeks)
      return weeks.length === slot.weeks.length ? slot : { ...slot, weeks }
    }),
  }
}

/**
 * 编辑一组重复安排前，检查哪些已有单次变更会失去匹配（§6.4 最后一条）。
 * 返回受影响的变更，由用户选择取消编辑或清除这些变更。
 */
export function analyzeSlotEdit(
  data: AppData,
  nextSlots: RecurringSlot[],
  removedSlotIds: string[] = [],
): SingleChange[] {
  const removed = new Set(removedSlotIds)
  return data.changes.filter((change) => {
    if (removed.has(change.slotId)) return true
    const next = nextSlots.find((s) => s.id === change.slotId)
    if (!next) return false // 不属于本次编辑范围
    return !changeStillMatches(next, data.semester, change)
  })
}
