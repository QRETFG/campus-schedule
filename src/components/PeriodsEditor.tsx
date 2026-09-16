import type { PeriodTime } from '../types'
import { Button, inputClass } from './ui'
import { MAX_PERIODS } from '../store/defaults'
import { toMinutes } from '../core/datetime'

/** 每节课时间编辑；节次按时间递增且不得重叠（§5.1）。 */
export default function PeriodsEditor({
  periods,
  errors,
  onChange,
}: {
  periods: PeriodTime[]
  errors: string[]
  onChange: (next: PeriodTime[]) => void
}) {
  const setCount = (count: number) => {
    const clamped = Math.max(1, Math.min(MAX_PERIODS, count))
    if (clamped === periods.length) return
    if (clamped < periods.length) {
      onChange(periods.slice(0, clamped))
      return
    }
    const next = [...periods]
    while (next.length < clamped) {
      const last = next[next.length - 1]
      const startMin = last ? toMinutes(last.end) + 10 : 8 * 60
      const pad = (v: number) => String(Math.floor(v) % 60).padStart(2, '0')
      const start = `${String(Math.floor(startMin / 60) % 24).padStart(2, '0')}:${pad(startMin % 60)}`
      const endMin = startMin + 45
      const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${pad(endMin % 60)}`
      next.push({ period: next.length + 1, start, end })
    }
    onChange(next)
  }

  const setTime = (period: number, key: 'start' | 'end', value: string) => {
    onChange(periods.map((p) => (p.period === period ? { ...p, [key]: value } : p)))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-800">每天的节次数量</span>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            className="min-h-9 px-3"
            onClick={() => setCount(periods.length - 1)}
            disabled={periods.length <= 1}
            aria-label="减少一节"
          >
            −
          </Button>
          <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">
            {periods.length} 节
          </span>
          <Button
            variant="secondary"
            className="min-h-9 px-3"
            onClick={() => setCount(periods.length + 1)}
            disabled={periods.length >= MAX_PERIODS}
            aria-label="增加一节"
          >
            ＋
          </Button>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        下面是常见作息模板，请按你们学校的实际作息核对后再保存。课程的「正在上课」和「下一节」判断都使用这里的时间。
      </p>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">节次</th>
              <th scope="col" className="px-3 py-2 font-medium">开始</th>
              <th scope="col" className="px-3 py-2 font-medium">结束</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {periods.map((p) => (
              <tr key={p.period}>
                <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal text-slate-700">
                  第 {p.period} 节
                </th>
                <td className="px-2 py-1.5">
                  <input
                    type="time"
                    value={p.start}
                    aria-label={`第 ${p.period} 节开始时间`}
                    onChange={(e) => setTime(p.period, 'start', e.target.value)}
                    className={`${inputClass} min-h-9`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="time"
                    value={p.end}
                    aria-label={`第 ${p.period} 节结束时间`}
                    onChange={(e) => setTime(p.period, 'end', e.target.value)}
                    className={`${inputClass} min-h-9`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errors.length ? (
        <ul className="space-y-1 text-xs font-medium text-rose-700">
          {errors.map((e) => (
            <li key={e}>· {e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
