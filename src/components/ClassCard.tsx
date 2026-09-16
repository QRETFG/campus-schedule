import { Link } from 'react-router-dom'
import type { ClassInstance } from '../types'
import { colorOf } from '../store/defaults'
import { shortDateLabel } from '../core/datetime'

/** 状态标签：不能仅靠颜色区分状态（§5.4）。 */
export function stateBadges(instance: ClassInstance): string[] {
  const badges: string[] = []
  if (instance.state === 'cancelled') badges.push('已停课')
  if (instance.state === 'moved-out') {
    badges.push(instance.movedTo ? `已调至 ${shortDateLabel(instance.movedTo)}` : '已调走')
  }
  if (instance.origin === 'moved-in' && instance.movedFrom) {
    badges.push(`由 ${shortDateLabel(instance.movedFrom)} 调入`)
  }
  if (instance.origin === 'oneoff') badges.push('补课')
  if (instance.roomChanged && instance.state === 'normal') badges.push('本次换教室')
  if (!instance.timeValid) badges.push('节次已失效')
  return badges
}

export function instanceLink(instance: ClassInstance): string {
  return `/courses/${instance.courseId}?date=${instance.date}&key=${encodeURIComponent(instance.key)}`
}

export function periodLabel(instance: ClassInstance): string {
  return instance.startPeriod === instance.endPeriod
    ? `第 ${instance.startPeriod} 节`
    : `第 ${instance.startPeriod}-${instance.endPeriod} 节`
}

/** 周视图中的课程卡片。 */
export function GridCard({
  instance,
  conflicting,
  style,
}: {
  instance: ClassInstance
  conflicting: boolean
  style: React.CSSProperties
}) {
  const color = colorOf(instance.colorIndex)
  const badges = stateBadges(instance)
  return (
    <Link
      to={instanceLink(instance)}
      style={style}
      className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-[11px] leading-tight transition-shadow hover:shadow-md ${color.bg} ${color.text} ${
        conflicting ? 'border-rose-500 ring-1 ring-rose-400' : color.border.replace('border-', 'border-l-')
      }`}
    >
      <span className="block truncate font-medium">{instance.courseName}</span>
      <span className="block truncate opacity-80">{instance.room || '教室待补充'}</span>
      <span className="block truncate opacity-70">{periodLabel(instance)}</span>
      {conflicting ? <span className="mt-0.5 block font-semibold text-rose-700">时间冲突</span> : null}
      {badges.map((b) => (
        <span key={b} className="mt-0.5 block truncate font-medium opacity-90">
          {b}
        </span>
      ))}
    </Link>
  )
}

/** 列表视图中的课程条目。 */
export function ListCard({
  instance,
  conflicting,
  now,
}: {
  instance: ClassInstance
  conflicting: boolean
  now?: string
}) {
  const color = colorOf(instance.colorIndex)
  const badges = stateBadges(instance)
  const dimmed = instance.state !== 'normal'
  const ongoing =
    !dimmed && now && instance.timeValid && instance.startTime <= now && now < instance.endTime

  return (
    <Link
      to={instanceLink(instance)}
      className={`flex items-stretch gap-3 rounded-lg border bg-white p-3 transition-colors hover:bg-slate-50 ${
        conflicting ? 'border-rose-300' : 'border-slate-200'
      } ${dimmed ? 'opacity-70' : ''}`}
    >
      <span className={`w-1.5 shrink-0 rounded-full ${dimmed ? 'bg-slate-300' : color.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`font-medium ${dimmed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
            {instance.courseName}
          </span>
          {ongoing ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">
              正在上课
            </span>
          ) : null}
          {badges.map((b) => (
            <span key={b} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
              {b}
            </span>
          ))}
          {conflicting ? (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-800">
              时间冲突
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {instance.timeValid ? `${instance.startTime}–${instance.endTime}` : '时间未知'} · {periodLabel(instance)}
          {' · '}
          {instance.room || '教室待补充'}
          {instance.teacher ? ` · ${instance.teacher}` : ''}
        </p>
      </div>
      <span className="self-center text-slate-400" aria-hidden>
        ›
      </span>
    </Link>
  )
}
