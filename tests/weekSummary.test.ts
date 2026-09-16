import { describe, expect, it } from 'vitest'
import type { AppData } from '../src/types'
import { FIRST_MONDAY, emptyData, course, slot } from './fixtures'
import { buildWeekSummary } from '../src/core/weekSummary'
import { addDays } from '../src/core/datetime'

const week = (n: number) => addDays(FIRST_MONDAY, (n - 1) * 7)
const kinds = <T extends { kind: string }>(list: T[]) => list.map((i) => i.kind)

describe('单双周切换归入常规变化，不写成临时停课', () => {
  function oddEven(): AppData {
    const data = emptyData()
    data.courses.push(course('c1', '大学物理'), course('c2', '体育'))
    data.slots.push(slot('s1', 'c1', 3, 5, 6, { kind: 'odd', from: 1, to: 15 }))
    data.slots.push(slot('s2', 'c2', 3, 5, 6, { kind: 'even', from: 2, to: 14 }))
    return data
  }

  it('第 3 周：单周课恢复，双周课本周不排', () => {
    const summary = buildWeekSummary(oddEven(), 3)
    expect(summary.temporary).toHaveLength(0) // 不产生任何临时调整
    const byName = Object.fromEntries(summary.regular.map((r) => [r.courseName, r.kind]))
    expect(byName['大学物理']).toBe('resumed')
    expect(byName['体育']).toBe('paused')
  })

  it('第 4 周正好相反', () => {
    const summary = buildWeekSummary(oddEven(), 4)
    const byName = Object.fromEntries(summary.regular.map((r) => [r.courseName, r.kind]))
    expect(byName['大学物理']).toBe('paused')
    expect(byName['体育']).toBe('resumed')
    expect(summary.temporary).toHaveLength(0)
  })

  it('第 2 周：单周课上周上过、本周不上，判为本周不排而不是结束', () => {
    const summary = buildWeekSummary(oddEven(), 2)
    const physics = summary.regular.find((r) => r.courseName === '大学物理')
    expect(physics?.kind).toBe('paused')
  })
})

describe('课程开始与结束', () => {
  function lifecycle(): AppData {
    const data = emptyData()
    data.courses.push(course('c1', '思想道德与法治'), course('c2', '专业导论'))
    data.slots.push(slot('s1', 'c1', 5, 7, 8, { kind: 'range', from: 1, to: 8 }))
    data.slots.push(slot('s2', 'c2', 5, 1, 2, { kind: 'range', from: 5, to: 16 }))
    return data
  }

  it('第 5 周有课程从本周开始', () => {
    const summary = buildWeekSummary(lifecycle(), 5)
    const started = summary.regular.find((r) => r.courseName === '专业导论')
    expect(started?.kind).toBe('starts')
    expect(started?.date).toBe(addDays(week(5), 4)) // 周五
  })

  it('第 9 周有课程从本周起不再安排', () => {
    const summary = buildWeekSummary(lifecycle(), 9)
    const ended = summary.regular.find((r) => r.courseName === '思想道德与法治')
    expect(ended?.kind).toBe('ends')
    // 后面还有课的不算结束
    expect(summary.regular.find((r) => r.courseName === '专业导论')).toBeUndefined()
  })

  it('间隔后恢复算恢复，不算新开始', () => {
    const data = emptyData()
    data.courses.push(course('c1', '实验课'))
    data.slots.push(slot('s1', 'c1', 2, 1, 2, { kind: 'custom', custom: '1,5,9' }))
    expect(buildWeekSummary(data, 5).regular[0].kind).toBe('resumed')
    expect(buildWeekSummary(data, 2).regular[0].kind).toBe('paused')
  })
})

describe('第一教学周与无变化', () => {
  it('第 1 周没有上周基线，不把所有课程报成新增', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'), course('c2', '大学英语'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    data.slots.push(slot('s2', 'c2', 2, 3, 4, { kind: 'all' }))

    const summary = buildWeekSummary(data, 1)
    expect(summary.hasBaseline).toBe(false)
    expect(summary.regular).toHaveLength(0)
    expect(summary.total).toBe(0)
  })

  it('全学期课程在中间周没有任何变化', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    const summary = buildWeekSummary(data, 6)
    expect(summary.total).toBe(0)
    expect(summary.hasBaseline).toBe(true)
  })

  it('超出学期范围的周返回空摘要', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    expect(buildWeekSummary(data, 0).total).toBe(0)
    expect(buildWeekSummary(data, 99).total).toBe(0)
  })
})

describe('临时调整', () => {
  function base(): AppData {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'), course('c2', '大学英语'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101'))
    data.slots.push(slot('s2', 'c2', 2, 3, 4, { kind: 'all' }, 'C305'))
    return data
  }

  it('停课、换教室、补课分别归类', () => {
    const data = base()
    data.changes.push({ id: 'ch1', slotId: 's1', originalDate: week(3), type: 'cancel' })
    data.changes.push({
      id: 'ch2',
      slotId: 's2',
      originalDate: addDays(week(3), 1),
      type: 'room',
      roomOverride: 'C999',
    })
    data.oneOffs.push({ id: 'o1', courseId: 'c1', date: addDays(week(3), 4), startPeriod: 5, endPeriod: 6 })

    const summary = buildWeekSummary(data, 3)
    expect(kinds(summary.temporary).sort()).toEqual(['cancelled', 'makeup', 'room'])
    expect(summary.regular).toHaveLength(0) // 临时调整不会同时出现在常规变化里
  })

  it('跨周调课在原周显示调出，在目标周显示调入', () => {
    const data = base()
    data.changes.push({
      id: 'ch1',
      slotId: 's1',
      originalDate: week(3),
      type: 'move',
      targetDate: addDays(week(5), 2),
      targetStartPeriod: 5,
      targetEndPeriod: 6,
    })

    const origin = buildWeekSummary(data, 3)
    expect(kinds(origin.temporary)).toEqual(['moved-out'])
    expect(origin.temporary[0].relatedDate).toBe(addDays(week(5), 2))

    const target = buildWeekSummary(data, 5)
    expect(kinds(target.temporary)).toEqual(['moved-in'])
    expect(target.temporary[0].relatedDate).toBe(week(3))

    // 中间的第 4 周不受影响
    expect(buildWeekSummary(data, 4).total).toBe(0)
  })

  it('停课不会被重复计成常规变化', () => {
    const data = base()
    // 单双周课程本周正常跳过 + 另一门课本周临时停课
    data.courses.push(course('c3', '大学物理'))
    data.slots.push(slot('s3', 'c3', 3, 5, 6, { kind: 'even', from: 2, to: 14 }))
    data.changes.push({ id: 'ch1', slotId: 's1', originalDate: week(3), type: 'cancel' })

    const summary = buildWeekSummary(data, 3)
    expect(summary.temporary.map((t) => t.courseName)).toEqual(['高等数学 A'])
    expect(summary.regular.map((r) => r.courseName)).toEqual(['大学物理'])
    expect(summary.regular[0].kind).toBe('paused') // 不是「停课」
    expect(summary.total).toBe(2)
  })

  it('摘要随课表修改更新', () => {
    const data = base()
    expect(buildWeekSummary(data, 3).total).toBe(0)
    const withChange: AppData = {
      ...data,
      changes: [{ id: 'ch1', slotId: 's1', originalDate: week(3), type: 'cancel' }],
    }
    expect(buildWeekSummary(withChange, 3).total).toBe(1)
  })
})
