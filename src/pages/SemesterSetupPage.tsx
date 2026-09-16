import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PeriodTime, Semester } from '../types'
import { Banner, Button, Card, ConfirmDialog, Field, PageTitle, inputClass } from '../components/ui'
import PeriodsEditor from '../components/PeriodsEditor'
import { useAppStore, useClock } from '../store/AppStore'
import {
  DEFAULT_TOTAL_WEEKS,
  MAX_TOTAL_WEEKS,
  MIN_TOTAL_WEEKS,
  createEmptyData,
  suggestSemesterName,
} from '../store/defaults'
import { validatePeriods } from '../store/validate'
import { fullDateLabel, isValidDate, isoWeekday, mondayOf } from '../core/datetime'
import { analyzeConfigChange, trimWeeksToSemester } from '../core/impact'
import type { ImpactItem } from '../core/impact'

export default function SemesterSetupPage() {
  const { data, commit } = useAppStore()
  const { today } = useClock()
  const navigate = useNavigate()
  const isFirstTime = !data

  const [name, setName] = useState(() => data?.semester.name ?? suggestSemesterName(today))
  const [firstMonday, setFirstMonday] = useState(
    () => data?.semester.firstWeekMonday ?? mondayOf(today),
  )
  const [totalWeeks, setTotalWeeks] = useState(
    () => String(data?.semester.totalWeeks ?? DEFAULT_TOTAL_WEEKS),
  )
  const [periods, setPeriods] = useState<PeriodTime[]>(
    () => data?.periods.map((p) => ({ ...p })) ?? createEmptyData(today).periods,
  )
  const [showImpact, setShowImpact] = useState(false)
  const [afterCreate, setAfterCreate] = useState(false)

  const weeksNumber = Number(totalWeeks)
  const nameError = name.trim() ? undefined : '请填写学期名称'
  const dateError = !isValidDate(firstMonday)
    ? '请选择有效日期'
    : isoWeekday(firstMonday) !== 1
      ? `${fullDateLabel(firstMonday)} 不是周一`
      : undefined
  const weeksError =
    !Number.isInteger(weeksNumber) || weeksNumber < MIN_TOTAL_WEEKS || weeksNumber > MAX_TOTAL_WEEKS
      ? `请填写 ${MIN_TOTAL_WEEKS}–${MAX_TOTAL_WEEKS} 之间的整数`
      : undefined
  const periodErrors = useMemo(() => validatePeriods(periods), [periods])

  const nextSemester: Semester = {
    id: data?.semester.id ?? 'semester',
    name: name.trim(),
    firstWeekMonday: firstMonday,
    totalWeeks: weeksNumber,
    timezone: data?.semester.timezone ?? 'Asia/Shanghai',
  }

  const formValid = !nameError && !dateError && !weeksError && periodErrors.length === 0

  // 修改已有学期设置时分析影响（§6.4）。
  const impact = useMemo(() => {
    if (!data || !formValid) return undefined
    return analyzeConfigChange(data, { semester: nextSemester, periods })
  }, [data, formValid, nextSemester.name, nextSemester.firstWeekMonday, nextSemester.totalWeeks, periods])

  const blocked = Boolean(impact?.blocking.length)

  const handleCreate = () => {
    const base = createEmptyData(today)
    if (commit({ ...base, semester: nextSemester, periods })) {
      setAfterCreate(true)
    }
  }

  const applyEdit = () => {
    if (!data) return
    const trimmed = trimWeeksToSemester(data, nextSemester.totalWeeks)
    commit({ ...trimmed, semester: nextSemester, periods })
    setShowImpact(false)
    navigate('/settings')
  }

  const handleSave = () => {
    if (!formValid || blocked) return
    if (isFirstTime) {
      handleCreate()
      return
    }
    if (impact?.confirmable.length) {
      setShowImpact(true)
      return
    }
    applyEdit()
  }

  if (afterCreate) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <PageTitle hint="学期设置已保存。接下来可以上传课表截图，也可以直接手动添加课程。">
          课表已创建
        </PageTitle>
        <div className="space-y-3">
          <Button className="w-full" onClick={() => navigate('/import')}>
            上传课表截图
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => navigate('/courses/new')}>
            手动添加课程
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate('/')}>
            先看看空课表
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle hint={isFirstTime ? '这些信息决定每周显示哪些课程，之后可以修改。' : undefined}>
        {isFirstTime ? '设置学期' : '修改学期设置'}
      </PageTitle>

      <Card className="space-y-5">
        <Field label="学期名称" required error={nameError}>
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="例如：2026-2027 学年第一学期"
            />
          )}
        </Field>

        <Field
          label="第 1 教学周的周一"
          required
          error={dateError}
          hint="填第 1 教学周那一周的周一，不是开学第一天。周次和课程日期都按这个起点计算。"
        >
          {({ id, describedBy }) => (
            <div className="space-y-2">
              <input
                id={id}
                aria-describedby={describedBy}
                type="date"
                value={firstMonday}
                onChange={(e) => setFirstMonday(e.target.value)}
                className={inputClass}
              />
              {dateError && isValidDate(firstMonday) ? (
                <Button
                  variant="secondary"
                  className="min-h-9 text-xs"
                  onClick={() => setFirstMonday(mondayOf(firstMonday))}
                >
                  改为该周的周一（{mondayOf(firstMonday)}）
                </Button>
              ) : null}
              {!dateError ? (
                <p className="text-xs text-slate-500">第 1 周为 {fullDateLabel(firstMonday)} 起的一周。</p>
              ) : null}
            </div>
          )}
        </Field>

        <Field label="学期总周数" required error={weeksError} hint={`支持 ${MIN_TOTAL_WEEKS}–${MAX_TOTAL_WEEKS} 周。`}>
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="number"
              inputMode="numeric"
              min={MIN_TOTAL_WEEKS}
              max={MAX_TOTAL_WEEKS}
              value={totalWeeks}
              onChange={(e) => setTotalWeeks(e.target.value)}
              className={`${inputClass} max-w-32`}
            />
          )}
        </Field>

        <div className="border-t border-slate-100 pt-5">
          <PeriodsEditor periods={periods} errors={periodErrors} onChange={setPeriods} />
        </div>
      </Card>

      {impact?.blocking.length ? (
        <div className="mt-4 space-y-2">
          <Banner tone="error" title="以下问题需要先处理，才能保存这次修改">
            <ImpactList items={impact.blocking} />
          </Banner>
        </div>
      ) : null}

      {impact?.confirmable.length && !blocked ? (
        <div className="mt-4">
          <Banner tone="warning" title="这次修改会影响已有课表">
            <ImpactList items={impact.confirmable} />
          </Banner>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={!formValid || blocked}>
          {isFirstTime ? '保存并继续' : '保存修改'}
        </Button>
        {!isFirstTime ? (
          <Button variant="secondary" onClick={() => navigate('/settings')}>
            取消
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={showImpact}
        title="确认保存这次修改"
        confirmLabel="确认保存"
        onConfirm={applyEdit}
        onCancel={() => setShowImpact(false)}
      >
        <p>保存后将发生以下变化：</p>
        {impact ? <ImpactList items={impact.confirmable} /> : null}
      </ConfirmDialog>
    </div>
  )
}

function ImpactList({ items }: { items: ImpactItem[] }) {
  return (
    <ul className="mt-1 space-y-2">
      {items.map((item, index) => (
        <li key={`${item.kind}-${index}`}>
          <p className="font-medium">{item.title}</p>
          <p className="text-xs leading-relaxed opacity-90">{item.detail}</p>
        </li>
      ))}
    </ul>
  )
}
