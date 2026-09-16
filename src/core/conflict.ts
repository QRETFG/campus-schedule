import type { AppData, ClassInstance, RecurringSlot } from '../types'
import { instanceMinutes, spanTime } from './resolve'
import { toMinutes } from './datetime'

/** 首尾相接不算冲突（§6.5）：仅当区间真正重叠才判定。 */
function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

export interface ConflictPair {
  a: ClassInstance
  b: ClassInstance
}

/** 同一天内实际上课的条目之间的冲突。已停课与已调出不参与。 */
export function conflictsAmong(instances: ClassInstance[]): ConflictPair[] {
  const active = instances.filter((i) => i.state === 'normal')
  const pairs: ConflictPair[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const ra = instanceMinutes(active[i])
      const rb = instanceMinutes(active[j])
      if (!ra || !rb) continue
      if (overlaps(ra, rb)) pairs.push({ a: active[i], b: active[j] })
    }
  }
  return pairs
}

export function hasConflict(instances: ClassInstance[]): boolean {
  return conflictsAmong(instances).length > 0
}

/** 参与冲突的条目 key 集合，供列表逐条标注。 */
export function conflictingKeys(instances: ClassInstance[]): Set<string> {
  const keys = new Set<string>()
  for (const { a, b } of conflictsAmong(instances)) {
    keys.add(a.key)
    keys.add(b.key)
  }
  return keys
}

/* ---------- 编辑重复安排时的预检查 ---------- */

export interface SlotIssue {
  kind: 'conflict' | 'duplicate'
  otherSlotId: string
  otherCourseName: string
  sharedWeeks: number[]
  message: string
}

function intersect(a: number[], b: number[]): number[] {
  const set = new Set(b)
  return a.filter((w) => set.has(w))
}

function sameWeeks(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort((x, y) => x - y)
  const sb = [...b].sort((x, y) => x - y)
  return sa.every((w, i) => w === sb[i])
}

/**
 * 检查一组重复安排与已有安排的冲突与重复。
 * 仅占用相同星期节次但没有共同周次时不算冲突（§6.5）。
 */
export function checkSlot(data: AppData, candidate: RecurringSlot): SlotIssue[] {
  const issues: SlotIssue[] = []
  const mine = spanTime(data.periods, candidate.startPeriod, candidate.endPeriod)

  for (const other of data.slots) {
    if (other.id === candidate.id) continue
    if (other.weekday !== candidate.weekday) continue

    const shared = intersect(candidate.weeks, other.weeks)
    const otherCourse = data.courses.find((c) => c.id === other.courseId)
    const otherName = otherCourse?.name ?? '未知课程'

    if (
      other.courseId === candidate.courseId &&
      other.startPeriod === candidate.startPeriod &&
      other.endPeriod === candidate.endPeriod &&
      sameWeeks(other.weeks, candidate.weeks) &&
      (other.room ?? '') === (candidate.room ?? '')
    ) {
      issues.push({
        kind: 'duplicate',
        otherSlotId: other.id,
        otherCourseName: otherName,
        sharedWeeks: shared,
        message: '与已有安排完全相同，属于重复安排',
      })
      continue
    }

    if (!shared.length) continue
    const theirs = spanTime(data.periods, other.startPeriod, other.endPeriod)
    if (!mine || !theirs) continue
    const overlapping = overlaps(
      { start: toMinutes(mine.start), end: toMinutes(mine.end) },
      { start: toMinutes(theirs.start), end: toMinutes(theirs.end) },
    )
    if (overlapping) {
      issues.push({
        kind: 'conflict',
        otherSlotId: other.id,
        otherCourseName: otherName,
        sharedWeeks: shared,
        message: `与「${otherName}」在第 ${shared.join('、')} 周时间重叠`,
      })
    }
  }
  return issues
}
