import { Link } from 'react-router-dom'
import type { AppData, DateStr } from '../types'
import { computeNextClass } from '../core/nextClass'
import { colorOf } from '../store/defaults'
import { fullDateLabel, shortDateLabel } from '../core/datetime'
import { instanceLink, periodLabel } from './ClassCard'

export default function NextClassCard({
  data,
  today,
  now,
}: {
  data: AppData
  today: DateStr
  now: string
}) {
  const view = computeNextClass(data, today, now)

  if (view.kind === 'ongoing' || view.kind === 'upcoming-today') {
    const instance = view.primary!
    const color = colorOf(instance.colorIndex)
    const ongoing = view.kind === 'ongoing'
    return (
      <section className={`rounded-xl border p-4 ${color.bg} ${color.border}`}>
        <p className="text-xs font-semibold tracking-wide text-slate-700">
          {ongoing ? '正在上课' : '下一节课'}
        </p>
        <Link to={instanceLink(instance)} className="mt-1.5 block">
          <h2 className={`text-xl font-semibold ${color.text}`}>{instance.courseName}</h2>
          <p className="mt-1 text-sm text-slate-700">
            {instance.room || '教室待补充'}
            {instance.teacher ? ` · ${instance.teacher}` : ''}
          </p>
          <p className="mt-0.5 text-sm font-medium text-slate-800">
            {ongoing
              ? `${instance.endTime} 下课`
              : `${instance.startTime} 开始`}
            {' · '}
            {periodLabel(instance)}
          </p>
        </Link>

        {view.concurrent.length ? (
          <div className="mt-3 rounded-lg border border-rose-300 bg-white/80 px-3 py-2">
            <p className="text-xs font-semibold text-rose-800">
              这个时间还有 {view.concurrent.length} 门课程，存在冲突
            </p>
            <ul className="mt-1 space-y-0.5">
              {view.concurrent.map((other) => (
                <li key={other.key}>
                  <Link to={instanceLink(other)} className="text-sm text-slate-800 underline">
                    {other.courseName}
                    {other.room ? ` · ${other.room}` : ''}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold tracking-wide text-slate-600">今日安排</p>
      <h2 className="mt-1.5 text-xl font-semibold text-slate-900">
        {view.kind === 'done-today' ? '今日课程已结束' : '今天没有课程'}
      </h2>
      {view.upcomingDate ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-600">
            最近一次上课：{fullDateLabel(view.upcomingDate)}
          </p>
          <ul className="mt-1.5 space-y-1">
            {view.upcomingInstances.slice(0, 3).map((instance) => (
              <li key={instance.key} className="text-sm">
                <Link to={instanceLink(instance)} className="text-slate-800 hover:underline">
                  <span className="font-medium">{instance.courseName}</span>
                  <span className="text-slate-500">
                    {' '}
                    {instance.timeValid ? instance.startTime : ''} · {instance.room || '教室待补充'}
                  </span>
                </Link>
              </li>
            ))}
            {view.upcomingInstances.length > 3 ? (
              <li className="text-sm text-slate-500">
                等共 {view.upcomingInstances.length} 门课程（{shortDateLabel(view.upcomingDate)}）
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">本学期接下来没有安排课程。</p>
      )}
    </section>
  )
}
