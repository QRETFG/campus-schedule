import { Link } from 'react-router-dom'
import { Button, EmptyState, PageTitle } from '../components/ui'
import { useAppStore } from '../store/AppStore'
import { colorOf } from '../store/defaults'
import { describeWeeks } from '../core/weeks'
import { slotLabel } from '../core/resolve'
import { weekdayLabel } from '../core/datetime'

export default function CoursesPage() {
  const { data } = useAppStore()
  const { courses, slots, oneOffs, semester } = data!

  return (
    <div>
      <PageTitle hint={`${courses.length} 门课程 · ${slots.length} 组上课安排`}>课程</PageTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link to="/courses/new">
          <Button>添加课程</Button>
        </Link>
        <Link to="/import">
          <Button variant="secondary">导入课表截图</Button>
        </Link>
      </div>

      {!courses.length ? (
        <EmptyState
          title="还没有课程"
          description="可以上传教务系统的课表截图快速建表，也可以手动逐门添加。"
          action={
            <Link to="/courses/new">
              <Button>添加第一门课程</Button>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {courses.map((course) => {
            const own = slots.filter((s) => s.courseId === course.id)
            const makeups = oneOffs.filter((o) => o.courseId === course.id)
            const color = colorOf(course.colorIndex)
            return (
              <li key={course.id}>
                <Link
                  to={`/courses/${course.id}`}
                  className="flex items-stretch gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50"
                >
                  <span className={`w-1.5 shrink-0 rounded-full ${color.dot}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{course.name}</p>
                    {course.teacher ? <p className="text-sm text-slate-600">{course.teacher}</p> : null}
                    <ul className="mt-1.5 space-y-0.5">
                      {own.map((slot) => (
                        <li key={slot.id} className="text-xs text-slate-600">
                          {weekdayLabel(slot.weekday)} {slotLabel(slot)} ·{' '}
                          {describeWeeks(slot.weeks, semester.totalWeeks)} · {slot.room || '教室待补充'}
                        </li>
                      ))}
                      {!own.length ? (
                        <li className="text-xs text-amber-700">尚未设置上课安排</li>
                      ) : null}
                      {makeups.length ? (
                        <li className="text-xs text-slate-500">另有 {makeups.length} 次补课</li>
                      ) : null}
                    </ul>
                  </div>
                  <span className="self-center text-slate-400" aria-hidden>
                    ›
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
