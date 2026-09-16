// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialAppData } from '../src/store/seed'
import { clearData, loadData, saveData } from '../src/store/storage'
import { validateData } from '../src/store/validate'
import { emptyData } from './fixtures'

describe('首次访问默认课表', () => {
  beforeEach(() => window.localStorage.clear())

  it('默认数据结构有效，并包含当前学期、作息和全部课程安排', () => {
    const data = createInitialAppData()
    expect(validateData(data)).toBeUndefined()
    expect(data.semester).toMatchObject({
      name: '2026-2027 学年第一学期',
      firstWeekMonday: '2026-08-31',
      totalWeeks: 20,
      timezone: 'Asia/Shanghai',
    })
    expect(data.periods).toHaveLength(12)
    expect(data.periods[2]).toEqual({ period: 3, start: '10:10', end: '10:55' })
    expect(data.courses).toHaveLength(7)
    expect(data.slots).toHaveLength(13)
  })

  it('本地没有课表时只自动导入一次', () => {
    expect(loadData()?.courses).toHaveLength(7)
    clearData()
    expect(loadData()).toBeUndefined()
  })

  it('浏览器已有课表时优先使用用户数据，不被默认值覆盖', () => {
    const existing = emptyData()
    saveData(existing)
    expect(loadData()?.semester.firstWeekMonday).toBe(existing.semester.firstWeekMonday)
    expect(loadData()?.courses).toHaveLength(0)
  })

  it('每次创建的默认课表都是独立副本', () => {
    const first = createInitialAppData()
    first.courses[0].name = '已修改'
    expect(createInitialAppData().courses[0].name).toBe('CSIT882 Data Management Systems')
  })
})
