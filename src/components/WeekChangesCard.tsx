import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AppData, DateStr } from '../types'
import type { RegularChange, TemporaryChange } from '../core/weekSummary'
import { REGULAR_LABEL, TEMPORARY_LABEL, buildWeekSummary } from '../core/weekSummary'
import { shortDateLabel, weekdayLabel } from '../core/datetime'

const COLLAPSED_LIMIT = 4

/**
 * 本周变化摘要。
 * 全部由本地课表规则算出，不调用模型；临时调整与常规变化分开归类。
 */
export default function WeekChangesCard({
  data,
  week,
  currentWeek,
  isDuringSemester,
  onSelectDate,
}: {
  data: AppData
  week: number
  currentWeek: number
  isDuringSemester: boolean
  onSelectDate: (date: DateStr) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => buildWeekSummary(data, week), [data, week])

  // 查看其他周时标题必须写明周次，不能仍叫「本周」。
  const isThisWeek = isDuringSemester && week === currentWeek
  const title = isThisWeek ? '本周变化' : `第 ${week} 周变化`

  if (!summary.total) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-800">{title}</h2>
          <span className="text-xs text-slate-500">
            {summary.hasBaseline ? '与上周相比没有变化' : '本学期第 1 周，没有上周可比较'}
          </span>
        </div>
      </section>
    )
  }

  const temporaryShown = expanded ? summary.temporary : summary.temporary.slice(0, COLLAPSED_LIMIT)
  const regularBudget = Math.max(0, COLLAPSED_LIMIT - temporaryShown.length)
  const regularShown = expanded ? summary.regular : summary.regular.slice(0, regularBudget)
  const hidden = summary.total - temporaryShown.length - regularShown.length

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-800">
          {title}
          <span className="ml-2 text-xs font-normal text-slate-500">共 {summary.total} 项</span>
        </h2>
        {hidden > 0 || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-indigo-700 hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? '收起' : `展开全部 ${summary.total} 项`}
          </button>
        ) : null}
      </div>

      {temporaryShown.length ? (
        <div className="mt-2.5">
          <p className="text-xs font-semibold tracking-wide text-slate-500">临时调整</p>
          <ul className="mt-1 space-y-1">
            {temporaryShown.map((change) => (
              <li key={change.key}>
                <TemporaryRow change={change} onSelectDate={onSelectDate} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {regularShown.length ? (
        <div className="mt-2.5">
          <p className="text-xs font-semibold tracking-wide text-slate-500">正常排课变化</p>
          <ul className="mt-1 space-y-1">
            {regularShown.map((change) => (
              <li key={change.key}>
                <RegularRow change={change} onSelectDate={onSelectDate} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hidden > 0 && !expanded ? (
        <p className="mt-2 text-xs text-slate-500">还有 {hidden} 项未显示。</p>
      ) : null}
    </section>
  )
}

const TEMPORARY_STYLE: Record<TemporaryChange['kind'], string> = {
  cancelled: 'bg-rose-100 text-rose-800',
  room: 'bg-amber-100 text-amber-900',
  'moved-in': 'bg-emerald-100 text-emerald-900',
  'moved-out': 'bg-slate-200 text-slate-700',
  makeup: 'bg-sky-100 text-sky-900',
}

function TemporaryRow({
  change,
  onSelectDate,
}: {
  change: TemporaryChange
  onSelectDate: (date: DateStr) => void
}) {
  const detail = () => {
    if (change.kind === 'moved-in' && change.relatedDate) return `由 ${shortDateLabel(change.relatedDate)} 调入`
    if (change.kind === 'moved-out' && change.relatedDate) return `调至 ${shortDateLabel(change.relatedDate)}`
    if (change.kind === 'room') return `本次在 ${change.room || '教室待补充'}`
    if (change.kind === 'makeup') return change.room ? `在 ${change.room}` : '一次性补课'
    return '这次不上课'
  }

  return (
    <button
      type="button"
      onClick={() => onSelectDate(change.date)}
      className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-slate-50"
    >
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${TEMPORARY_STYLE[change.kind]}`}>
        {TEMPORARY_LABEL[change.kind]}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-800">
        {shortDateLabel(change.date)} {weekdayLabel(change.weekday)} · {change.courseName}
        <span className="text-slate-500">
          {' '}
          {change.periods} · {detail()}
        </span>
      </span>
    </button>
  )
}

const REGULAR_STYLE: Record<RegularChange['kind'], string> = {
  starts: 'bg-indigo-100 text-indigo-900',
  resumed: 'bg-emerald-100 text-emerald-900',
  paused: 'bg-slate-200 text-slate-700',
  ends: 'bg-slate-300 text-slate-800',
}

function RegularRow({
  change,
  onSelectDate,
}: {
  change: RegularChange
  onSelectDate: (date: DateStr) => void
}) {
  const content = (
    <>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${REGULAR_STYLE[change.kind]}`}>
        {REGULAR_LABEL[change.kind]}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-800">
        {change.courseName}
        <span className="text-slate-500">
          {' '}
          {weekdayLabel(change.weekday)} {change.periods}
          {change.room ? ` · ${change.room}` : ''}
        </span>
      </span>
    </>
  )

  // 本周有课的项跳到当天，本周不排的项跳到课程详情。
  if (change.kind === 'paused' || change.kind === 'ends') {
    return (
      <Link
        to={`/courses/${change.courseId}`}
        className="flex items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50"
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onSelectDate(change.date)}
      className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-slate-50"
    >
      {content}
    </button>
  )
}
