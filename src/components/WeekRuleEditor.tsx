import type { WeekRule, WeekRuleKind } from '../types'
import { describeWeeks, expandWeekRule } from '../core/weeks'
import { inputClass } from './ui'

const KINDS: Array<{ value: WeekRuleKind; label: string }> = [
  { value: 'all', label: '全学期' },
  { value: 'range', label: '连续区间' },
  { value: 'odd', label: '区间内单周' },
  { value: 'even', label: '区间内双周' },
  { value: 'custom', label: '自定义周次' },
]

export default function WeekRuleEditor({
  rule,
  totalWeeks,
  onChange,
  idPrefix,
}: {
  rule: WeekRule
  totalWeeks: number
  onChange: (next: WeekRule) => void
  idPrefix: string
}) {
  const expansion = expandWeekRule(rule, totalWeeks)
  const needsRange = rule.kind === 'range' || rule.kind === 'odd' || rule.kind === 'even'

  const setKind = (kind: WeekRuleKind) => {
    if (kind === 'all') onChange({ kind })
    else if (kind === 'custom') onChange({ kind, custom: rule.custom ?? expansionToCustom(expansion.weeks) })
    else onChange({ kind, from: rule.from ?? 1, to: rule.to ?? totalWeeks })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select
          id={`${idPrefix}-kind`}
          aria-label="周次规则"
          value={rule.kind}
          onChange={(e) => setKind(e.target.value as WeekRuleKind)}
          className={`${inputClass} min-h-10 w-auto`}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        {needsRange ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={totalWeeks}
              value={rule.from ?? ''}
              aria-label="起始周"
              onChange={(e) => onChange({ ...rule, from: Number(e.target.value) })}
              className={`${inputClass} min-h-10 w-20`}
            />
            <span className="text-sm text-slate-500">至</span>
            <input
              type="number"
              min={1}
              max={totalWeeks}
              value={rule.to ?? ''}
              aria-label="结束周"
              onChange={(e) => onChange({ ...rule, to: Number(e.target.value) })}
              className={`${inputClass} min-h-10 w-20`}
            />
            <span className="text-sm text-slate-500">周</span>
          </div>
        ) : null}
      </div>

      {rule.kind === 'custom' ? (
        <input
          value={rule.custom ?? ''}
          aria-label="自定义周次"
          placeholder="例如 1-4,6,8-12"
          onChange={(e) => onChange({ kind: 'custom', custom: e.target.value })}
          className={`${inputClass} min-h-10`}
        />
      ) : null}

      {expansion.errors.length ? (
        <p className="text-xs font-medium text-rose-700">{expansion.errors[0]}</p>
      ) : (
        <p className="text-xs text-slate-500">
          实际上课：{describeWeeks(expansion.weeks, totalWeeks)}
          {expansion.weeks.length ? `，共 ${expansion.weeks.length} 周` : ''}
        </p>
      )}
    </div>
  )
}

function expansionToCustom(weeks: number[]): string {
  return weeks.join(',')
}
