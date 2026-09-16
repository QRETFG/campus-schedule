import type { AppData, ClassInstance, DateStr, TimeStr } from '../types'
import { addDays, toMinutes } from './datetime'
import { activeOnly, instanceMinutes, resolveDate } from './resolve'
import { semesterPhaseOf, teachingWeekOf } from './weeks'

export type NextClassKind = 'ongoing' | 'upcoming-today' | 'done-today' | 'none-today'

export interface NextClassView {
  kind: NextClassKind
  /** ongoing / upcoming-today 时的主课程。 */
  primary?: ClassInstance
  /** 与主课程同一时间的其他课程，存在时说明有冲突（§5.4）。 */
  concurrent: ClassInstance[]
  /** 今天没有可展示的课程时，最近一次上课。 */
  upcomingDate?: DateStr
  upcomingInstances: ClassInstance[]
}

/** 学期内向后查找的最大天数，避免无课时无限扫描。 */
const LOOKAHEAD_LIMIT = 400

export function computeNextClass(data: AppData, today: DateStr, now: TimeStr): NextClassView {
  const minutes = toMinutes(now)
  const todayList = activeOnly(resolveDate(data, today))

  const ongoing = todayList.filter((i) => {
    const range = instanceMinutes(i)
    // 开始时间包含在区间内，结束时间不包含（§6.1）。
    return range ? range.start <= minutes && minutes < range.end : false
  })
  if (ongoing.length) {
    return {
      kind: 'ongoing',
      primary: ongoing[0],
      concurrent: ongoing.slice(1),
      upcomingInstances: [],
    }
  }

  const upcoming = todayList.filter((i) => {
    const range = instanceMinutes(i)
    return range ? range.start > minutes : false
  })
  if (upcoming.length) {
    const first = upcoming[0]
    const sameStart = upcoming.filter(
      (i) => i.key !== first.key && i.startTime === first.startTime,
    )
    return {
      kind: 'upcoming-today',
      primary: first,
      concurrent: sameStart,
      upcomingInstances: [],
    }
  }

  const future = findNextTeachingDay(data, today)
  return {
    kind: todayList.length ? 'done-today' : 'none-today',
    concurrent: [],
    upcomingDate: future?.date,
    upcomingInstances: future?.instances ?? [],
  }
}

/** 从 today 之后第一天开始，找到学期内最近一个有课的日期。 */
export function findNextTeachingDay(
  data: AppData,
  today: DateStr,
): { date: DateStr; instances: ClassInstance[] } | undefined {
  for (let offset = 1; offset <= LOOKAHEAD_LIMIT; offset++) {
    const date = addDays(today, offset)
    if (semesterPhaseOf(data.semester, date) === 'after') {
      // 调入的补课可能落在学期末之后的日期之外，正常情况直接结束扫描。
      if (teachingWeekOf(data.semester, date) > data.semester.totalWeeks) break
    }
    const instances = activeOnly(resolveDate(data, date))
    if (instances.length) return { date, instances }
  }
  return undefined
}
