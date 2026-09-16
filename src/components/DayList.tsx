import type { AppData, DateStr } from '../types'
import { resolveDate } from '../core/resolve'
import { conflictingKeys } from '../core/conflict'
import { ListCard } from './ClassCard'
import { EmptyState } from './ui'

export default function DayList({
  data,
  date,
  now,
  emptyAction,
}: {
  data: AppData
  date: DateStr
  now?: string
  emptyAction?: React.ReactNode
}) {
  const instances = resolveDate(data, date)
  const conflicts = conflictingKeys(instances)

  if (!instances.length) {
    return <EmptyState title="这一天没有课程" action={emptyAction} />
  }

  return (
    <ul className="space-y-2">
      {instances.map((instance) => (
        <li key={instance.key}>
          <ListCard instance={instance} conflicting={conflicts.has(instance.key)} now={now} />
        </li>
      ))}
    </ul>
  )
}
