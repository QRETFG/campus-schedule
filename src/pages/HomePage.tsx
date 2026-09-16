import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore, useClock } from '../store/AppStore'
import { Banner, Button } from '../components/ui'
import NextClassCard from '../components/NextClassCard'
import WeekChangesCard from '../components/WeekChangesCard'
import DayList from '../components/DayList'
import WeekGrid from '../components/WeekGrid'
import { addDays, fullDateLabel, isoWeekday, weekdayLabel } from '../core/datetime'
import { datesOfWeek, defaultWeekFor, semesterPhaseOf, teachingWeekOf } from '../core/weeks'
import { resolveWeek } from '../core/resolve'

type View = 'day' | 'week'

/** 电脑端默认周课表，手机端默认今日列表（§5.4）。 */
function initialView(): View {
  if (typeof window === 'undefined') return 'day'
  return window.matchMedia('(min-width: 640px)').matches ? 'week' : 'day'
}

export default function HomePage() {
  const { data } = useAppStore()
  const { today, now } = useClock()
  const semester = data!.semester

  const phase = semesterPhaseOf(semester, today)
  const currentWeek = teachingWeekOf(semester, today)
  const [week, setWeek] = useState(() => defaultWeekFor(semester, today))
  const [view, setView] = useState<View>(initialView)
  const [selectedDate, setSelectedDate] = useState(today)

  // 日期跨天后跟随更新（§6.1）。
  useEffect(() => {
    setSelectedDate(today)
    setWeek(defaultWeekFor(semester, today))
  }, [today, semester.firstWeekMonday, semester.totalWeeks])

  const weekDates = useMemo(() => datesOfWeek(semester, week), [semester, week])
  const weekHasClasses = useMemo(
    () => resolveWeek(data!, week).some((d) => d.instances.some((i) => i.state === 'normal')),
    [data, week],
  )
  const selectedInWeek = weekDates.includes(selectedDate)

  const goWeek = (next: number) => {
    const clamped = Math.max(1, Math.min(semester.totalWeeks, next))
    setWeek(clamped)
    if (view === 'day') {
      const dates = datesOfWeek(semester, clamped)
      setSelectedDate(dates[isoWeekday(selectedDate) - 1])
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{semester.name}</h1>
          <p className="text-sm text-slate-600">
            {fullDateLabel(today)}
            {' · '}
            {phase === 'during'
              ? `第 ${currentWeek} 教学周`
              : phase === 'before'
                ? '学期尚未开始'
                : '学期已结束'}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="tablist">
          {(['day', 'week'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${
                view === value ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {value === 'day' ? '按天' : '周课表'}
            </button>
          ))}
        </div>
      </header>

      {phase !== 'during' ? (
        <Banner tone="info" title={phase === 'before' ? '学期尚未开始' : '学期已结束'}>
          当前日期不在 {semester.name} 的教学周内，下面仍然可以浏览这个学期的课表。
        </Banner>
      ) : null}

      {phase === 'during' ? <NextClassCard data={data!} today={today} now={now} /> : null}

      <WeekChangesCard
        data={data!}
        week={week}
        currentWeek={currentWeek}
        isDuringSemester={phase === 'during'}
        onSelectDate={(date) => {
          setSelectedDate(date)
          setView('day')
        }}
      />

      {/* 教学周导航 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="min-h-9 px-3" onClick={() => goWeek(week - 1)} disabled={week <= 1}>
          ‹ 上一周
        </Button>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <span className="sr-only sm:not-sr-only">教学周</span>
          <select
            value={week}
            onChange={(e) => goWeek(Number(e.target.value))}
            className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
          >
            {Array.from({ length: semester.totalWeeks }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                第 {w} 周{w === currentWeek && phase === 'during' ? '（本周）' : ''}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="secondary"
          className="min-h-9 px-3"
          onClick={() => goWeek(week + 1)}
          disabled={week >= semester.totalWeeks}
        >
          下一周 ›
        </Button>
        {phase === 'during' && week !== currentWeek ? (
          <Button
            variant="ghost"
            className="min-h-9 px-3"
            onClick={() => {
              setWeek(currentWeek)
              setSelectedDate(today)
            }}
          >
            返回本周
          </Button>
        ) : null}
      </div>

      {view === 'week' ? (
        <>
          <WeekGrid data={data!} week={week} today={today} now={now} />
          {!weekHasClasses ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
              <p className="text-sm text-slate-700">第 {week} 周没有课程。</p>
              <div className="mt-3 flex justify-center gap-2">
                <Link to="/courses/new">
                  <Button variant="secondary" className="min-h-9">添加课程</Button>
                </Link>
                <Link to="/import">
                  <Button variant="ghost" className="min-h-9">导入课表</Button>
                </Link>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-3">
          <div className="scroll-x flex gap-1.5 overflow-x-auto pb-1">
            {weekDates.map((date) => {
              const active = date === selectedDate
              const isToday = date === today
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  aria-current={active ? 'date' : undefined}
                  className={`flex min-h-14 min-w-14 flex-1 shrink-0 flex-col items-center justify-center rounded-lg border px-2 text-xs transition-colors ${
                    active
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="font-medium">{weekdayLabel(isoWeekday(date))}</span>
                  <span className={active ? 'opacity-90' : 'text-slate-500'}>{date.slice(5).replace('-', '/')}</span>
                  {isToday ? <span className="text-[10px] font-semibold">今天</span> : null}
                </button>
              )
            })}
          </div>

          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-slate-800">
              {fullDateLabel(selectedDate)} · 第 {teachingWeekOf(semester, selectedDate)} 周
            </h2>
            {!selectedInWeek ? null : (
              <Link to="/courses/new" className="text-sm text-indigo-700 hover:underline">
                添加课程
              </Link>
            )}
          </div>

          <DayList
            data={data!}
            date={selectedDate}
            now={selectedDate === today ? now : undefined}
            emptyAction={
              <div className="flex gap-2">
                <Link to="/courses/new">
                  <Button variant="secondary" className="min-h-9">添加课程</Button>
                </Link>
                <Button
                  variant="ghost"
                  className="min-h-9"
                  onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                >
                  看下一天
                </Button>
              </div>
            }
          />
        </div>
      )}
    </div>
  )
}
