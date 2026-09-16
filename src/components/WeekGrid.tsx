import { useMemo } from 'react'
import type { AppData, ClassInstance, DateStr } from '../types'
import { conflictingKeys } from '../core/conflict'
import { resolveWeek } from '../core/resolve'
import { isoWeekday, shortDateLabel, toMinutes, weekdayLabel } from '../core/datetime'
import { GridCard } from './ClassCard'

const ROW_HEIGHT = 64
const LANE_MIN_WIDTH = 92
const GAP = 3

interface Placed {
  instance: ClassInstance
  lane: number
  lanes: number
  rowStart: number
  rowSpan: number
}

/**
 * 同一天内时间重叠的课程分到不同泳道并排显示，
 * 保证冲突双方都能看到，不通过覆盖卡片隐藏（§5.4）。
 */
function placeDay(instances: ClassInstance[], indexOf: Map<number, number>): Placed[] {
  const visible = instances.filter((i) => i.state === 'normal')
  const ranges = visible
    .map((instance) => {
      const start = indexOf.get(instance.startPeriod)
      const end = indexOf.get(instance.endPeriod)
      if (start === undefined || end === undefined) return undefined
      return { instance, rowStart: start, rowSpan: end - start + 1 }
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .sort((a, b) => a.rowStart - b.rowStart || b.rowSpan - a.rowSpan)

  // 贪心分组：把首尾相接之外真正重叠的条目放进同一组，组内按泳道排开。
  const groups: Array<typeof ranges> = []
  for (const item of ranges) {
    const group = groups.find((g) =>
      g.some((other) => item.rowStart < other.rowStart + other.rowSpan && other.rowStart < item.rowStart + item.rowSpan),
    )
    if (group) group.push(item)
    else groups.push([item])
  }

  const placed: Placed[] = []
  for (const group of groups) {
    const laneEnds: number[] = []
    const assigned = group.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.rowStart)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(0)
      }
      laneEnds[lane] = item.rowStart + item.rowSpan
      return { ...item, lane }
    })
    const lanes = laneEnds.length
    for (const item of assigned) placed.push({ ...item, lanes })
  }
  return placed
}

export default function WeekGrid({
  data,
  week,
  today,
  now,
}: {
  data: AppData
  week: number
  today: DateStr
  now: string
}) {
  const days = useMemo(() => resolveWeek(data, week), [data, week])
  const periods = useMemo(() => [...data.periods].sort((a, b) => a.period - b.period), [data.periods])
  const indexOf = useMemo(
    () => new Map(periods.map((p, index) => [p.period, index])),
    [periods],
  )

  // 每天的泳道数决定该列的最小宽度：冲突课程并排时把列撑宽，
  // 靠横向滚动而不是压缩文字来容纳（§5.4）。
  const placedByDay = useMemo(
    () => days.map(({ instances }) => placeDay(instances, indexOf)),
    [days, indexOf],
  )
  const laneCounts = placedByDay.map((placed) => Math.max(1, ...placed.map((p) => p.lanes)))
  const columns = `52px ${laneCounts.map((lanes) => `minmax(${LANE_MIN_WIDTH * lanes}px, 1fr)`).join(' ')}`
  const minWidth = 52 + laneCounts.reduce((sum, lanes) => sum + LANE_MIN_WIDTH * lanes, 0)

  const nowMinutes = toMinutes(now)
  const currentPeriod = periods.find(
    (p) => toMinutes(p.start) <= nowMinutes && nowMinutes < toMinutes(p.end),
  )
  const todayInWeek = days.some((d) => d.date === today)
  const bodyHeight = periods.length * ROW_HEIGHT

  return (
    <div className="scroll-x overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div style={{ minWidth }}>
        {/* 表头：星期 + 实际日期 */}
        <div
          className="sticky top-0 z-20 grid border-b border-slate-200 bg-white"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="sticky left-0 z-10 bg-white" />
          {days.map(({ date }) => {
            const isToday = date === today
            return (
              <div
                key={date}
                className={`border-l border-slate-100 px-1 py-2 text-center ${isToday ? 'bg-indigo-50' : ''}`}
              >
                <div className={`text-xs font-medium ${isToday ? 'text-indigo-800' : 'text-slate-700'}`}>
                  {weekdayLabel(isoWeekday(date))}
                </div>
                <div className={`text-[11px] ${isToday ? 'font-semibold text-indigo-700' : 'text-slate-500'}`}>
                  {shortDateLabel(date)}
                  {isToday ? ' · 今天' : ''}
                </div>
              </div>
            )
          })}
        </div>

        {/* 课程区 */}
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="sticky left-0 z-10 bg-white" style={{ height: bodyHeight }}>
            {periods.map((p) => {
              const isCurrent = todayInWeek && currentPeriod?.period === p.period
              return (
                <div
                  key={p.period}
                  style={{ height: ROW_HEIGHT }}
                  className={`flex flex-col items-center justify-center border-b border-slate-100 text-[11px] ${
                    isCurrent ? 'bg-indigo-100 font-semibold text-indigo-800' : 'text-slate-500'
                  }`}
                >
                  <span>{p.period}</span>
                  <span className="opacity-70">{p.start}</span>
                  {isCurrent ? <span className="text-[9px] font-semibold">当前</span> : null}
                </div>
              )
            })}
          </div>

          {days.map(({ date, instances }, dayIndex) => {
            const conflicts = conflictingKeys(instances)
            const placed = placedByDay[dayIndex]
            const isToday = date === today
            return (
              <div
                key={date}
                className={`relative border-l border-slate-100 ${isToday ? 'bg-indigo-50/40' : ''}`}
                style={{ height: bodyHeight }}
              >
                {periods.map((p) => (
                  <div
                    key={p.period}
                    style={{ height: ROW_HEIGHT }}
                    className={`border-b border-slate-100 ${
                      isToday && currentPeriod?.period === p.period ? 'bg-indigo-100/60' : ''
                    }`}
                  />
                ))}
                {placed.map(({ instance, lane, lanes, rowStart, rowSpan }) => (
                  <GridCard
                    key={instance.key}
                    instance={instance}
                    conflicting={conflicts.has(instance.key)}
                    style={{
                      top: rowStart * ROW_HEIGHT + GAP,
                      height: rowSpan * ROW_HEIGHT - GAP * 2,
                      left: `calc(${(lane / lanes) * 100}% + ${GAP}px)`,
                      width: `calc(${100 / lanes}% - ${GAP * 2}px)`,
                    }}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
