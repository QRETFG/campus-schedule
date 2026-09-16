import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { DateStr, RecurringSlot } from '../types'
import { Banner, Button, Card, ConfirmDialog, PageTitle, inputClass } from '../components/ui'
import { useAppStore, useClock } from '../store/AppStore'
import { colorOf, newId } from '../store/defaults'
import { describeWeeks, mondayOfWeek, semesterPhaseOf } from '../core/weeks'
import { findChange, slotLabel } from '../core/resolve'
import { addDays, fullDateLabel, isValidDate, shortDateLabel, weekdayLabel } from '../core/datetime'

export default function CourseDetailPage() {
  const { courseId } = useParams()
  const { data, update } = useAppStore()
  const { today } = useClock()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const { semester, periods, courses, slots, changes, oneOffs } = data!
  const course = courses.find((c) => c.id === courseId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showMakeup, setShowMakeup] = useState(false)

  if (!course) return <Navigate to="/courses" replace />

  const own = slots.filter((s) => s.courseId === course.id)
  const ownChanges = changes.filter((c) => own.some((s) => s.id === c.slotId))
  const makeups = oneOffs.filter((o) => o.courseId === course.id).sort((a, b) => a.date.localeCompare(b.date))
  const color = colorOf(course.colorIndex)

  // 从课表点进来时带着具体日期，直接提供「调整本次」入口。
  const focusDate = params.get('date') ?? undefined
  const focusKey = params.get('key') ?? undefined
  const focusSlot = focusKey?.startsWith('slot:')
    ? own.find((s) => s.id === focusKey.slice(5).split('@')[0])
    : undefined

  const deleteCourse = () => {
    update((current) => {
      const removedSlotIds = new Set(current.slots.filter((s) => s.courseId === course.id).map((s) => s.id))
      return {
        ...current,
        courses: current.courses.filter((c) => c.id !== course.id),
        slots: current.slots.filter((s) => s.courseId !== course.id),
        changes: current.changes.filter((c) => !removedSlotIds.has(c.slotId)),
        oneOffs: current.oneOffs.filter((o) => o.courseId !== course.id),
      }
    })
    navigate('/courses')
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/courses" className="mb-2 inline-block text-sm text-indigo-700 hover:underline">
        ‹ 返回课程列表
      </Link>

      <div className="mb-4 flex items-start gap-3">
        <span className={`mt-1 h-10 w-1.5 shrink-0 rounded-full ${color.dot}`} aria-hidden />
        <PageTitle hint={course.teacher ? `教师：${course.teacher}` : '未填写教师'}>{course.name}</PageTitle>
      </div>

      {focusDate && focusSlot ? (
        <div className="mb-4">
          <Banner tone="info" title={`${fullDateLabel(focusDate)} 的这次课`}>
            <p className="text-xs">
              {slotLabel(focusSlot)} · {focusSlot.room || '教室待补充'}
            </p>
            <div className="mt-2">
              <Link to={`/adjust?slot=${focusSlot.id}&date=${focusDate}`}>
                <Button variant="secondary" className="min-h-9 text-xs">
                  调整本次
                </Button>
              </Link>
            </div>
          </Banner>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-2">
        <Link to={`/courses/${course.id}/edit`}>
          <Button>编辑课程</Button>
        </Link>
        <Button variant="secondary" onClick={() => setShowMakeup((v) => !v)}>
          添加一次性补课
        </Button>
        <Button variant="ghost" className="text-rose-700" onClick={() => setConfirmDelete(true)}>
          删除课程
        </Button>
      </div>

      {showMakeup ? (
        <MakeupForm
          courseId={course.id}
          periods={periods.map((p) => p.period)}
          today={today}
          onCancel={() => setShowMakeup(false)}
          onSubmit={(date, startPeriod, endPeriod, room) => {
            update((current) => ({
              ...current,
              oneOffs: [
                ...current.oneOffs,
                { id: newId('oneoff'), courseId: course.id, date, startPeriod, endPeriod, room: room || undefined },
              ],
            }))
            setShowMakeup(false)
          }}
          validDate={(date) => semesterPhaseOf(semester, date) === 'during'}
        />
      ) : null}

      <h2 className="mb-2 text-sm font-medium text-slate-800">重复上课安排</h2>
      {own.length ? (
        <ul className="space-y-2">
          {own.map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              totalWeeks={semester.totalWeeks}
              firstMonday={semester.firstWeekMonday}
              today={today}
              hasChangeOn={(date) => Boolean(findChange(changes, slot.id, date))}
            />
          ))}
        </ul>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">这门课程还没有上课安排。</p>
          <Link to={`/courses/${course.id}/edit`} className="mt-2 inline-block text-sm text-indigo-700 hover:underline">
            去添加安排
          </Link>
        </Card>
      )}

      {makeups.length ? (
        <>
          <h2 className="mb-2 mt-5 text-sm font-medium text-slate-800">一次性补课</h2>
          <ul className="space-y-2">
            {makeups.map((oneOff) => (
              <li
                key={oneOff.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{fullDateLabel(oneOff.date)}</p>
                  <p className="text-xs text-slate-600">
                    第 {oneOff.startPeriod}
                    {oneOff.endPeriod !== oneOff.startPeriod ? `-${oneOff.endPeriod}` : ''} 节 ·{' '}
                    {oneOff.room || '教室待补充'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="min-h-9 shrink-0 text-xs text-rose-700"
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      oneOffs: current.oneOffs.filter((o) => o.id !== oneOff.id),
                    }))
                  }
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {ownChanges.length ? (
        <>
          <h2 className="mb-2 mt-5 text-sm font-medium text-slate-800">单次调整</h2>
          <ul className="space-y-2">
            {ownChanges
              .slice()
              .sort((a, b) => a.originalDate.localeCompare(b.originalDate))
              .map((change) => (
                <li
                  key={change.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {fullDateLabel(change.originalDate)}
                    </p>
                    <p className="text-xs text-slate-600">
                      {change.type === 'cancel'
                        ? '停课'
                        : change.type === 'room'
                          ? `换教室至 ${change.roomOverride || '未填写'}`
                          : `改至 ${change.targetDate ? shortDateLabel(change.targetDate) : '未设置'}${
                              change.targetStartPeriod ? ` 第 ${change.targetStartPeriod}-${change.targetEndPeriod} 节` : ''
                            }`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link to={`/adjust?slot=${change.slotId}&date=${change.originalDate}`}>
                      <Button variant="ghost" className="min-h-9 text-xs">
                        修改
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      className="min-h-9 text-xs text-rose-700"
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          changes: current.changes.filter((c) => c.id !== change.id),
                        }))
                      }
                    >
                      取消调整
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={`删除「${course.name}」？`}
        confirmLabel="删除课程"
        danger
        onConfirm={deleteCourse}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>
          将同时删除这门课程的 {own.length} 组上课安排
          {ownChanges.length ? `、${ownChanges.length} 条单次调整` : ''}
          {makeups.length ? `、${makeups.length} 次补课` : ''}。此操作不可撤销。
        </p>
      </ConfirmDialog>
    </div>
  )
}

function SlotCard({
  slot,
  totalWeeks,
  firstMonday,
  today,
  hasChangeOn,
}: {
  slot: RecurringSlot
  totalWeeks: number
  firstMonday: DateStr
  today: DateStr
  hasChangeOn: (date: DateStr) => boolean
}) {
  const semester = { id: 's', name: '', firstWeekMonday: firstMonday, totalWeeks, timezone: 'Asia/Shanghai' }
  const occurrences = slot.weeks.map((week) => addDays(mondayOfWeek(semester, week), slot.weekday - 1))
  const upcoming = occurrences.filter((date) => date >= today).slice(0, 4)

  return (
    <li>
      <Card>
        <p className="font-medium text-slate-900">
          {weekdayLabel(slot.weekday)} {slotLabel(slot)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {describeWeeks(slot.weeks, totalWeeks)} · 共 {slot.weeks.length} 周 · {slot.room || '教室待补充'}
        </p>

        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-700">调整某一次</p>
          {upcoming.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {upcoming.map((date) => (
                <Link key={date} to={`/adjust?slot=${slot.id}&date=${date}`}>
                  <Button variant="secondary" className="min-h-9 text-xs">
                    {shortDateLabel(date)}
                    {hasChangeOn(date) ? ' · 已调整' : ''}
                  </Button>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">这组安排接下来没有课了。</p>
          )}
        </div>
      </Card>
    </li>
  )
}

function MakeupForm({
  periods,
  today,
  onCancel,
  onSubmit,
  validDate,
}: {
  courseId: string
  periods: number[]
  today: DateStr
  onCancel: () => void
  onSubmit: (date: DateStr, startPeriod: number, endPeriod: number, room: string) => void
  validDate: (date: DateStr) => boolean
}) {
  const [date, setDate] = useState(today)
  const [startPeriod, setStartPeriod] = useState(periods[0] ?? 1)
  const [endPeriod, setEndPeriod] = useState(periods[1] ?? periods[0] ?? 1)
  const [room, setRoom] = useState('')

  const dateError = !isValidDate(date)
    ? '请选择有效日期'
    : !validDate(date)
      ? '该日期不在当前学期范围内'
      : undefined
  const periodError = startPeriod > endPeriod ? '起始节次不能大于结束节次' : undefined

  return (
    <Card className="mb-5 space-y-3">
      <h2 className="text-sm font-medium text-slate-800">添加一次性补课</h2>
      <p className="text-xs text-slate-500">补课只在指定日期生效，不影响其他周。</p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">日期</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        {dateError ? <span className="mt-1 block text-xs font-medium text-rose-700">{dateError}</span> : null}
      </label>

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-700">起止节次</span>
        <div className="flex items-center gap-1.5">
          <select
            value={startPeriod}
            aria-label="起始节次"
            onChange={(e) => setStartPeriod(Number(e.target.value))}
            className={`${inputClass} w-auto`}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                第 {p} 节
              </option>
            ))}
          </select>
          <span className="text-sm text-slate-500">至</span>
          <select
            value={endPeriod}
            aria-label="结束节次"
            onChange={(e) => setEndPeriod(Number(e.target.value))}
            className={`${inputClass} w-auto`}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                第 {p} 节
              </option>
            ))}
          </select>
        </div>
        {periodError ? <span className="mt-1 block text-xs font-medium text-rose-700">{periodError}</span> : null}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">教室</span>
        <input value={room} onChange={(e) => setRoom(e.target.value)} className={inputClass} placeholder="可留空" />
      </label>

      <div className="flex gap-2">
        <Button
          disabled={Boolean(dateError || periodError)}
          onClick={() => onSubmit(date, startPeriod, endPeriod, room.trim())}
        >
          添加补课
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </Card>
  )
}
