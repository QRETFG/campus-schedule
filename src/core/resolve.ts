import type {
  AppData,
  ClassInstance,
  Course,
  DateStr,
  PeriodTime,
  RecurringSlot,
  SingleChange,
} from '../types'
import { isoWeekday, toMinutes } from './datetime'
import { datesOfWeek, semesterPhaseOf, teachingWeekOf } from './weeks'

export function findPeriod(periods: PeriodTime[], period: number): PeriodTime | undefined {
  return periods.find((p) => p.period === period)
}

/** 起止节次对应的时间区间；任一端节次不存在时返回 undefined。 */
export function spanTime(
  periods: PeriodTime[],
  startPeriod: number,
  endPeriod: number,
): { start: string; end: string } | undefined {
  const first = findPeriod(periods, startPeriod)
  const last = findPeriod(periods, endPeriod)
  if (!first || !last) return undefined
  return { start: first.start, end: last.end }
}

function courseOf(courses: Course[], courseId: string): Course | undefined {
  return courses.find((c) => c.id === courseId)
}

/** 找到某次课当前有效的单次变更；同一原课程实例只允许一份（§6.3）。 */
export function findChange(
  changes: SingleChange[],
  slotId: string,
  originalDate: DateStr,
): SingleChange | undefined {
  return changes.find((c) => c.slotId === slotId && c.originalDate === originalDate)
}

interface BuildArgs {
  key: string
  course: Course
  date: DateStr
  startPeriod: number
  endPeriod: number
  periods: PeriodTime[]
  room?: string
}

function buildInstance(args: BuildArgs, extra: Partial<ClassInstance>): ClassInstance {
  const time = spanTime(args.periods, args.startPeriod, args.endPeriod)
  return {
    key: args.key,
    courseId: args.course.id,
    courseName: args.course.name,
    teacher: args.course.teacher,
    colorIndex: args.course.colorIndex,
    date: args.date,
    weekday: isoWeekday(args.date),
    startPeriod: args.startPeriod,
    endPeriod: args.endPeriod,
    startTime: time?.start ?? '',
    endTime: time?.end ?? '',
    room: args.room,
    origin: 'recurring',
    state: 'normal',
    timeValid: Boolean(time),
    ...extra,
  }
}

/**
 * 解算某一天实际发生的课程。
 * 结果同时包含已停课、已调出的记录，供当日列表展示与恢复（§6.3）；
 * 周视图和下一节课程应当只使用 state === 'normal' 的条目。
 */
export function resolveDate(data: AppData, date: DateStr): ClassInstance[] {
  const { semester, periods, courses, slots, changes, oneOffs } = data
  const out: ClassInstance[] = []
  const weekday = isoWeekday(date)
  const week = teachingWeekOf(semester, date)
  const inSemester = semesterPhaseOf(semester, date) === 'during'

  if (inSemester) {
    for (const slot of slots) {
      if (slot.weekday !== weekday) continue
      if (!slot.weeks.includes(week)) continue
      const course = courseOf(courses, slot.courseId)
      if (!course) continue

      const change = findChange(changes, slot.id, date)
      const base: BuildArgs = {
        key: `slot:${slot.id}@${date}`,
        course,
        date,
        startPeriod: slot.startPeriod,
        endPeriod: slot.endPeriod,
        periods,
        room: slot.room,
      }

      if (!change) {
        out.push(buildInstance(base, { slotId: slot.id }))
        continue
      }
      if (change.type === 'cancel') {
        out.push(buildInstance(base, { slotId: slot.id, state: 'cancelled', changeId: change.id }))
        continue
      }
      if (change.type === 'room') {
        out.push(
          buildInstance(
            { ...base, room: change.roomOverride || slot.room },
            { slotId: slot.id, changeId: change.id, roomChanged: true },
          ),
        )
        continue
      }
      // 改期：原时段不再上课，仅保留一条可见记录。
      out.push(
        buildInstance(base, {
          slotId: slot.id,
          state: 'moved-out',
          changeId: change.id,
          movedTo: change.targetDate,
        }),
      )
    }
  }

  // 调入本日的课程；即便其原始实例已失去匹配，也照常显示，避免静默丢失（§6.4）。
  for (const change of changes) {
    if (change.type !== 'move' || change.targetDate !== date) continue
    const slot = slots.find((s) => s.id === change.slotId)
    if (!slot) continue
    const course = courseOf(courses, slot.courseId)
    if (!course) continue
    out.push(
      buildInstance(
        {
          key: `move:${change.id}`,
          course,
          date,
          startPeriod: change.targetStartPeriod ?? slot.startPeriod,
          endPeriod: change.targetEndPeriod ?? slot.endPeriod,
          periods,
          room: change.roomOverride || slot.room,
        },
        {
          slotId: slot.id,
          changeId: change.id,
          origin: 'moved-in',
          movedFrom: change.originalDate,
          roomChanged: Boolean(change.roomOverride && change.roomOverride !== slot.room),
        },
      ),
    )
  }

  for (const oneOff of oneOffs) {
    if (oneOff.date !== date) continue
    const course = courseOf(courses, oneOff.courseId)
    if (!course) continue
    out.push(
      buildInstance(
        {
          key: `oneoff:${oneOff.id}`,
          course,
          date,
          startPeriod: oneOff.startPeriod,
          endPeriod: oneOff.endPeriod,
          periods,
          room: oneOff.room,
        },
        { origin: 'oneoff', oneOffId: oneOff.id },
      ),
    )
  }

  return sortInstances(out)
}

export function sortInstances(list: ClassInstance[]): ClassInstance[] {
  return [...list].sort((a, b) => {
    if (a.startPeriod !== b.startPeriod) return a.startPeriod - b.startPeriod
    if (a.endPeriod !== b.endPeriod) return a.endPeriod - b.endPeriod
    return a.courseName.localeCompare(b.courseName, 'zh-CN')
  })
}

/** 正常上课的条目：排除已停课和已调出。 */
export function activeOnly(list: ClassInstance[]): ClassInstance[] {
  return list.filter((i) => i.state === 'normal')
}

export interface ResolvedDay {
  date: DateStr
  instances: ClassInstance[]
}

export function resolveWeek(data: AppData, week: number): ResolvedDay[] {
  return datesOfWeek(data.semester, week).map((date) => ({
    date,
    instances: resolveDate(data, date),
  }))
}

/** 分钟区间，用于冲突判定与「正在上课」。 */
export function instanceMinutes(instance: ClassInstance): { start: number; end: number } | undefined {
  if (!instance.timeValid) return undefined
  return { start: toMinutes(instance.startTime), end: toMinutes(instance.endTime) }
}

export function slotLabel(slot: Pick<RecurringSlot, 'startPeriod' | 'endPeriod'>): string {
  return slot.startPeriod === slot.endPeriod
    ? `第 ${slot.startPeriod} 节`
    : `第 ${slot.startPeriod}-${slot.endPeriod} 节`
}
