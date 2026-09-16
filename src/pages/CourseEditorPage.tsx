import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { RecurringSlot, WeekRule, Weekday } from '../types'
import { Banner, Button, Card, ConfirmDialog, Field, PageTitle, inputClass, useUnsavedGuard } from '../components/ui'
import WeekRuleEditor from '../components/WeekRuleEditor'
import { useAppStore } from '../store/AppStore'
import { COURSE_COLORS, newId } from '../store/defaults'
import { expandWeekRule, inferRule } from '../core/weeks'
import { checkSlot } from '../core/conflict'
import { analyzeSlotEdit } from '../core/impact'
import { weekdayLabel } from '../core/datetime'

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]

interface SlotForm {
  id: string
  weekday: Weekday
  startPeriod: number
  endPeriod: number
  rule: WeekRule
  room: string
}

export default function CourseEditorPage() {
  const { courseId } = useParams()
  const { data, update } = useAppStore()
  const navigate = useNavigate()
  const { semester, periods, courses, slots } = data!

  const existing = courseId ? courses.find((c) => c.id === courseId) : undefined
  const isEdit = Boolean(existing)

  const [name, setName] = useState(existing?.name ?? '')
  const [teacher, setTeacher] = useState(existing?.teacher ?? '')
  const [colorIndex, setColorIndex] = useState(existing?.colorIndex ?? courses.length % COURSE_COLORS.length)
  const [forms, setForms] = useState<SlotForm[]>(() => {
    const own = existing ? slots.filter((s) => s.courseId === existing.id) : []
    if (own.length) {
      return own.map((slot) => ({
        id: slot.id,
        weekday: slot.weekday,
        startPeriod: slot.startPeriod,
        endPeriod: slot.endPeriod,
        rule: slot.rule ?? inferRule(slot.weeks, semester.totalWeeks),
        room: slot.room ?? '',
      }))
    }
    return [blankSlot(periods[0]?.period ?? 1, periods[1]?.period ?? periods[0]?.period ?? 1)]
  })
  const [dirty, setDirty] = useState(false)
  const [orphanPrompt, setOrphanPrompt] = useState(false)

  useUnsavedGuard(dirty)

  const touch = <T,>(setter: (v: T) => void) => (value: T) => {
    setDirty(true)
    setter(value)
  }

  const periodNumbers = periods.map((p) => p.period)
  const nameError = name.trim() ? undefined : '请填写课程名称'

  const nextSlots = useMemo<RecurringSlot[]>(() => {
    const targetCourseId = existing?.id ?? '__new__'
    return forms.map((form) => ({
      id: form.id,
      courseId: targetCourseId,
      weekday: form.weekday,
      startPeriod: form.startPeriod,
      endPeriod: form.endPeriod,
      weeks: expandWeekRule(form.rule, semester.totalWeeks).weeks,
      rule: form.rule,
      room: form.room.trim() || undefined,
    }))
  }, [forms, existing?.id, semester.totalWeeks])

  const slotErrors = forms.map((form, index) => {
    const errors: string[] = []
    if (form.startPeriod > form.endPeriod) errors.push('起始节次不能大于结束节次')
    if (!periodNumbers.includes(form.startPeriod) || !periodNumbers.includes(form.endPeriod)) {
      errors.push('所选节次不在当前作息表中')
    }
    const expansion = expandWeekRule(form.rule, semester.totalWeeks)
    if (expansion.errors.length) errors.push(expansion.errors[0])
    else if (!expansion.weeks.length) errors.push('请设置上课周次')
    // 同一课程内部的重复安排
    const duplicate = forms.some(
      (other, otherIndex) =>
        otherIndex < index &&
        other.weekday === form.weekday &&
        other.startPeriod === form.startPeriod &&
        other.endPeriod === form.endPeriod &&
        other.room.trim() === form.room.trim() &&
        sameSet(expandWeekRule(other.rule, semester.totalWeeks).weeks, expansion.weeks),
    )
    if (duplicate) errors.push('与上面的安排完全相同')
    return errors
  })

  // 与课表中其他课程的冲突提示；冲突不阻止保存（§6.5）。
  const slotWarnings = nextSlots.map((slot) =>
    checkSlot({ ...data!, slots: slots.filter((s) => s.courseId !== existing?.id) }, slot),
  )

  const orphanChanges = useMemo(() => {
    if (!existing) return []
    const own = slots.filter((s) => s.courseId === existing.id)
    const removedIds = own.filter((s) => !forms.some((f) => f.id === s.id)).map((s) => s.id)
    return analyzeSlotEdit(data!, nextSlots, removedIds)
  }, [data, existing, forms, nextSlots, slots])

  const formValid = !nameError && forms.length > 0 && slotErrors.every((e) => !e.length)

  const doSave = (clearOrphans: boolean) => {
    update((current) => {
      const course = existing
        ? { ...existing, name: name.trim(), teacher: teacher.trim() || undefined, colorIndex }
        : { id: newId('course'), name: name.trim(), teacher: teacher.trim() || undefined, colorIndex }

      const otherSlots = current.slots.filter((s) => s.courseId !== course.id)
      const saved = nextSlots.map((slot) => ({ ...slot, courseId: course.id }))
      const keptSlotIds = new Set(saved.map((s) => s.id))

      const changes = current.changes.filter((change) => {
        if (!keptSlotIds.has(change.slotId)) {
          // 安排被删除时，其单次变更一并清除
          const belongs = current.slots.some((s) => s.id === change.slotId && s.courseId === course.id)
          return !belongs
        }
        if (clearOrphans && orphanChanges.some((c) => c.id === change.id)) return false
        return true
      })

      return {
        ...current,
        courses: existing ? current.courses.map((c) => (c.id === course.id ? course : c)) : [...current.courses, course],
        slots: [...otherSlots, ...saved],
        changes,
      }
    })
    setDirty(false)
    navigate(existing ? `/courses/${existing.id}` : '/courses')
  }

  const handleSave = () => {
    if (!formValid) return
    if (orphanChanges.length) {
      setOrphanPrompt(true)
      return
    }
    doSave(false)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle hint="一门课程可以有多组上课安排，每组分别设置星期、节次、周次和教室。">
        {isEdit ? '编辑课程' : '添加课程'}
      </PageTitle>

      <Card className="space-y-4">
        <Field label="课程名称" required error={nameError}>
          {({ id }) => (
            <input
              id={id}
              value={name}
              onChange={(e) => touch(setName)(e.target.value)}
              className={inputClass}
              placeholder="例如 高等数学 A"
            />
          )}
        </Field>

        <Field label="教师" hint="可留空。同一门课有不同教师时，建议分成两门课程分别记录。">
          {({ id }) => (
            <input
              id={id}
              value={teacher}
              onChange={(e) => touch(setTeacher)(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-800">课表中的颜色</span>
          <div className="flex flex-wrap gap-2">
            {COURSE_COLORS.map((color, index) => (
              <button
                key={color.name}
                type="button"
                aria-label={color.name}
                aria-pressed={colorIndex === index}
                onClick={() => touch(setColorIndex)(index)}
                className={`h-9 w-9 rounded-lg ${color.bg} ${
                  colorIndex === index ? 'ring-2 ring-slate-900 ring-offset-2' : 'ring-1 ring-slate-300'
                }`}
              >
                <span className={`mx-auto block h-3 w-3 rounded-full ${color.dot}`} />
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            颜色只用于快速辨认，课表中的状态都有文字说明，不会只靠颜色表达。
          </p>
        </div>
      </Card>

      <h2 className="mb-2 mt-5 text-sm font-medium text-slate-800">上课安排</h2>
      <ul className="space-y-3">
        {forms.map((form, index) => (
          <li key={form.id}>
            <Card className={slotErrors[index].length ? 'border-rose-300' : ''}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">第 {index + 1} 组</span>
                {forms.length > 1 ? (
                  <Button
                    variant="ghost"
                    className="min-h-9 text-xs text-rose-700"
                    onClick={() => touch(setForms)(forms.filter((f) => f.id !== form.id))}
                  >
                    删除这组
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700">星期</span>
                  <select
                    value={form.weekday}
                    onChange={(e) =>
                      touch(setForms)(
                        forms.map((f) =>
                          f.id === form.id ? { ...f, weekday: Number(e.target.value) as Weekday } : f,
                        ),
                      )
                    }
                    className={inputClass}
                  >
                    {WEEKDAYS.map((w) => (
                      <option key={w} value={w}>
                        {weekdayLabel(w)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-700">教室</span>
                  <input
                    value={form.room}
                    onChange={(e) =>
                      touch(setForms)(forms.map((f) => (f.id === form.id ? { ...f, room: e.target.value } : f)))
                    }
                    className={inputClass}
                    placeholder="留空显示「教室待补充」"
                  />
                </label>

                <div className="sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-700">起止节次</span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={form.startPeriod}
                      aria-label="起始节次"
                      onChange={(e) =>
                        touch(setForms)(
                          forms.map((f) =>
                            f.id === form.id ? { ...f, startPeriod: Number(e.target.value) } : f,
                          ),
                        )
                      }
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
                      value={form.endPeriod}
                      aria-label="结束节次"
                      onChange={(e) =>
                        touch(setForms)(
                          forms.map((f) => (f.id === form.id ? { ...f, endPeriod: Number(e.target.value) } : f)),
                        )
                      }
                      className={`${inputClass} w-auto`}
                    >
                      {periodNumbers.map((p) => (
                        <option key={p} value={p}>
                          第 {p} 节
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    中间隔开的节次请分成多组安排，不要合并成一堂课。
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-700">上课周次</span>
                  <WeekRuleEditor
                    rule={form.rule}
                    totalWeeks={semester.totalWeeks}
                    idPrefix={form.id}
                    onChange={(rule) =>
                      touch(setForms)(forms.map((f) => (f.id === form.id ? { ...f, rule } : f)))
                    }
                  />
                </div>
              </div>

              {slotErrors[index].length ? (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                  {slotErrors[index].map((e) => (
                    <li key={e} className="text-xs font-medium text-rose-700">
                      · {e}
                    </li>
                  ))}
                </ul>
              ) : null}

              {slotWarnings[index].length ? (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                  {slotWarnings[index].map((issue, i) => (
                    <li key={i} className="text-xs text-amber-800">
                      <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold">
                        {issue.kind === 'duplicate' ? '疑似重复' : '时间冲突'}
                      </span>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      <Button
        variant="secondary"
        className="mt-3 w-full"
        onClick={() =>
          touch(setForms)([
            ...forms,
            blankSlot(periodNumbers[0] ?? 1, periodNumbers[1] ?? periodNumbers[0] ?? 1),
          ])
        }
      >
        ＋ 添加一组上课安排
      </Button>

      {slotWarnings.some((w) => w.length) ? (
        <div className="mt-4">
          <Banner tone="warning" title="存在冲突或疑似重复">
            冲突只是提示，确认无误后仍然可以保存。课表中会同时显示冲突双方。
          </Banner>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={!formValid}>
          保存
        </Button>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          取消
        </Button>
      </div>

      <ConfirmDialog
        open={orphanPrompt}
        title="这次修改会让部分单次调整失去对应课程"
        confirmLabel="清除这些调整并保存"
        cancelLabel="返回继续编辑"
        danger
        onConfirm={() => {
          setOrphanPrompt(false)
          doSave(true)
        }}
        onCancel={() => setOrphanPrompt(false)}
      >
        <p>以下记录在修改后不再对应任何一次课程：</p>
        <ul className="space-y-1">
          {orphanChanges.map((change) => (
            <li key={change.id} className="text-xs">
              ·{' '}
              {change.originalDate} 的
              {change.type === 'cancel' ? '停课' : change.type === 'room' ? '换教室' : '调课'}记录
            </li>
          ))}
        </ul>
        <p>你可以返回继续编辑保留它们，或清除这些记录后保存。</p>
      </ConfirmDialog>
    </div>
  )
}

function blankSlot(startPeriod: number, endPeriod: number): SlotForm {
  return {
    id: newId('slot'),
    weekday: 1,
    startPeriod,
    endPeriod,
    rule: { kind: 'all' },
    room: '',
  }
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
