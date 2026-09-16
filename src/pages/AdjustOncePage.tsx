import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ChangeType, DateStr, SingleChange } from '../types'
import { Banner, Button, Card, PageTitle, inputClass } from '../components/ui'
import { useAppStore } from '../store/AppStore'
import { newId } from '../store/defaults'
import { semesterPhaseOf, teachingWeekOf } from '../core/weeks'
import { activeOnly, findChange, resolveDate, slotLabel } from '../core/resolve'
import { conflictsAmong } from '../core/conflict'
import { fullDateLabel, isValidDate, isoWeekday, weekdayLabel } from '../core/datetime'

const OPTIONS: Array<{ value: ChangeType; label: string; hint: string }> = [
  { value: 'cancel', label: '这次停课', hint: '只取消这一次，后续周不受影响。' },
  { value: 'room', label: '这次换教室', hint: '只改这一次的上课地点。' },
  { value: 'move', label: '这次改期', hint: '原时段不再上课，课程移到你指定的日期和节次。' },
]

export default function AdjustOncePage() {
  const [params] = useSearchParams()
  const { data, update } = useAppStore()
  const navigate = useNavigate()

  const slotId = params.get('slot') ?? ''
  const originalDate = params.get('date') ?? ''
  const { semester, periods, courses, slots, changes } = data!

  const slot = slots.find((s) => s.id === slotId)
  const existing = slot ? findChange(changes, slot.id, originalDate) : undefined

  const [type, setType] = useState<ChangeType>(existing?.type ?? 'cancel')
  const [room, setRoom] = useState(existing?.roomOverride ?? slot?.room ?? '')
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? originalDate)
  const [targetStart, setTargetStart] = useState(existing?.targetStartPeriod ?? slot?.startPeriod ?? 1)
  const [targetEnd, setTargetEnd] = useState(existing?.targetEndPeriod ?? slot?.endPeriod ?? 1)

  const draftChange = useMemo<SingleChange | undefined>(() => {
    if (!slot) return undefined
    const base = { id: existing?.id ?? newId('change'), slotId: slot.id, originalDate }
    if (type === 'cancel') return { ...base, type }
    if (type === 'room') return { ...base, type, roomOverride: room.trim() || undefined }
    return {
      ...base,
      type,
      targetDate,
      targetStartPeriod: targetStart,
      targetEndPeriod: targetEnd,
      roomOverride: room.trim() || undefined,
    }
  }, [slot, existing?.id, originalDate, type, room, targetDate, targetStart, targetEnd])

  // 变更后的课程也参与冲突检查（§6.3）。
  const targetConflicts = useMemo(() => {
    if (!slot || !draftChange || type !== 'move' || !isValidDate(targetDate)) return []
    const preview = {
      ...data!,
      changes: [...changes.filter((c) => c.id !== draftChange.id), draftChange],
    }
    const instances = resolveDate(preview, targetDate)
    return conflictsAmong(instances).filter(
      (pair) => pair.a.changeId === draftChange.id || pair.b.changeId === draftChange.id,
    )
  }, [data, changes, draftChange, slot, targetDate, type])

  if (!slot || !isValidDate(originalDate)) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>找不到要调整的课程</PageTitle>
        <Banner tone="error">请从课表或课程详情里选择具体的某一次课，再进行调整。</Banner>
        <div className="mt-4">
          <Link to="/">
            <Button>返回课表</Button>
          </Link>
        </div>
      </div>
    )
  }

  const course = courses.find((c) => c.id === slot.courseId)
  const week = teachingWeekOf(semester, originalDate)
  const originalValid = slot.weekday === isoWeekday(originalDate) && slot.weeks.includes(week)

  const targetDateError =
    type !== 'move'
      ? undefined
      : !isValidDate(targetDate)
        ? '请选择有效日期'
        : semesterPhaseOf(semester, targetDate) !== 'during'
          ? '目标日期必须在当前学期范围内'
          : undefined
  const targetPeriodError = type === 'move' && targetStart > targetEnd ? '起始节次不能大于结束节次' : undefined
  const canSave = !targetDateError && !targetPeriodError

  const save = () => {
    if (!draftChange || !canSave) return
    update((current) => ({
      ...current,
      // 同一原课程实例只允许一份当前有效的变更，重复编辑更新已有变更（§6.3）。
      changes: [...current.changes.filter((c) => !(c.slotId === slot.id && c.originalDate === originalDate)), draftChange],
    }))
    navigate(`/courses/${slot.courseId}`)
  }

  const removeChange = () => {
    update((current) => ({
      ...current,
      changes: current.changes.filter((c) => !(c.slotId === slot.id && c.originalDate === originalDate)),
    }))
    navigate(`/courses/${slot.courseId}`)
  }

  const periodNumbers = periods.map((p) => p.period)

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={`/courses/${slot.courseId}`} className="mb-2 inline-block text-sm text-indigo-700 hover:underline">
        ‹ 返回课程详情
      </Link>
      <PageTitle>调整这一次课</PageTitle>

      {/* 必须明确展示原日期和原节次（§6.3） */}
      <Card className="mb-4 bg-slate-50">
        <p className="text-xs font-medium text-slate-600">原安排</p>
        <p className="mt-1 text-base font-semibold text-slate-900">{course?.name ?? '未知课程'}</p>
        <p className="mt-1 text-sm text-slate-700">
          {fullDateLabel(originalDate)} · 第 {week} 教学周
        </p>
        <p className="text-sm text-slate-700">
          {weekdayLabel(slot.weekday)} {slotLabel(slot)} · {slot.room || '教室待补充'}
        </p>
      </Card>

      {!originalValid ? (
        <div className="mb-4">
          <Banner tone="warning" title="这一天原本没有这门课">
            该日期与这组上课安排的星期或周次不匹配，调整记录可能来自更早的设置。建议取消这次调整，或先修改课程安排。
          </Banner>
        </div>
      ) : null}

      <Card className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-800">选择调整方式</legend>
          <div className="space-y-2">
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                  type === option.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="adjust-type"
                  value={option.value}
                  checked={type === option.value}
                  onChange={() => setType(option.value)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{option.label}</span>
                  <span className="block text-xs text-slate-600">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {type === 'room' ? (
          <label className="block border-t border-slate-100 pt-4">
            <span className="mb-1 block text-sm font-medium text-slate-800">本次教室</span>
            <input value={room} onChange={(e) => setRoom(e.target.value)} className={inputClass} placeholder="例如 A999" />
          </label>
        ) : null}

        {type === 'move' ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-800">调到哪一天</span>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={inputClass}
              />
              {targetDateError ? (
                <span className="mt-1 block text-xs font-medium text-rose-700">{targetDateError}</span>
              ) : isValidDate(targetDate) ? (
                <span className="mt-1 block text-xs text-slate-500">
                  {fullDateLabel(targetDate)} · 第 {teachingWeekOf(semester, targetDate)} 教学周。支持跨教学周。
                </span>
              ) : null}
            </label>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-800">调到第几节</span>
              <div className="flex items-center gap-1.5">
                <select
                  value={targetStart}
                  aria-label="目标起始节次"
                  onChange={(e) => setTargetStart(Number(e.target.value))}
                  className={`${inputClass} w-auto`}
                >
                  {periodNumbers.map((p) => (
                    <option key={p} value={p}>
                      第 {p} 节
                    </option>
                  ))}
                </select>
                <span className="text-sm text-slate-500">至</span>
                <select
                  value={targetEnd}
                  aria-label="目标结束节次"
                  onChange={(e) => setTargetEnd(Number(e.target.value))}
                  className={`${inputClass} w-auto`}
                >
                  {periodNumbers.map((p) => (
                    <option key={p} value={p}>
                      第 {p} 节
                    </option>
                  ))}
                </select>
              </div>
              {targetPeriodError ? (
                <span className="mt-1 block text-xs font-medium text-rose-700">{targetPeriodError}</span>
              ) : null}
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-800">本次教室</span>
              <input value={room} onChange={(e) => setRoom(e.target.value)} className={inputClass} placeholder="可留空" />
            </label>

            {targetConflicts.length ? (
              <Banner tone="warning" title="目标时间与其他课程冲突">
                <ul className="mt-1 space-y-0.5 text-xs">
                  {targetConflicts.map((pair, i) => {
                    const other = pair.a.changeId === draftChange?.id ? pair.b : pair.a
                    return <li key={i}>· 与「{other.courseName}」时间重叠</li>
                  })}
                </ul>
                <p className="mt-1 text-xs">冲突只是提示，确认后仍可保存，课表中会同时显示两门课程。</p>
              </Banner>
            ) : isValidDate(targetDate) && !targetDateError ? (
              <p className="text-xs text-slate-500">
                目标日期当前有 {activeOnly(resolveDate(data!, targetDate)).length} 门课程。
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={save} disabled={!canSave}>
          {existing ? '更新调整' : '保存调整'}
        </Button>
        {existing ? (
          <Button variant="secondary" onClick={removeChange}>
            取消调整，恢复原安排
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => navigate(-1)}>
          返回
        </Button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        单次调整优先于原来的重复安排，只影响 {fullDateLabel(originalDate as DateStr)} 这一次。
        同一次课只保留一份调整记录，再次调整会覆盖上一次。
      </p>
    </div>
  )
}
