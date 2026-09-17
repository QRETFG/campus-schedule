import { describe, expect, it } from 'vitest'
import { WORKSPACE_VERSION } from '../src/types'
import type { ScheduleWorkspace } from '../src/types'
import { buildBackup } from '../src/store/storage'
import { parseBackup, validateWorkspace } from '../src/store/validate'
import { defaultSemesterId, migrateWorkspace } from '../src/store/workspace'
import { emptyData } from './fixtures'

function multipleSemesters(): ScheduleWorkspace {
  const autumn = emptyData()
  autumn.semester.id = 'autumn-2026'
  autumn.semester.name = '2026 秋季学期'
  autumn.semester.firstWeekMonday = '2026-09-07'
  autumn.courses.push({ id: 'autumn-course', name: '秋季课程', colorIndex: 0 })

  const spring = emptyData()
  spring.semester.id = 'spring-2027'
  spring.semester.name = '2027 春季学期'
  spring.semester.firstWeekMonday = '2027-02-22'
  spring.courses.push({ id: 'spring-course', name: '春季课程', colorIndex: 1 })

  return { workspaceVersion: WORKSPACE_VERSION, semesters: [autumn, spring] }
}

describe('多学期课表集合', () => {
  it('旧版单学期数据自动包装且内容不变', () => {
    const legacy = emptyData()
    const workspace = migrateWorkspace(legacy)
    expect(workspace.workspaceVersion).toBe(WORKSPACE_VERSION)
    expect(workspace.semesters).toHaveLength(1)
    expect(workspace.semesters[0].semester.name).toBe(legacy.semester.name)
  })

  it('各学期课程独立保存并可完整备份恢复', () => {
    const workspace = multipleSemesters()
    expect(validateWorkspace(workspace)).toBeUndefined()

    const parsed = parseBackup(JSON.stringify(buildBackup(workspace)))
    expect(parsed.ok).toBe(true)
    expect(parsed.summary).toMatchObject({ semesterCount: 2, courseCount: 2 })
    expect(parsed.backup?.data.semesters.map((item) => item.courses[0].name)).toEqual([
      '秋季课程',
      '春季课程',
    ])
  })

  it('默认展示当前日期所在学期，日期不在学期内时选择最近学期', () => {
    const workspace = multipleSemesters()
    expect(defaultSemesterId(workspace, '2026-09-17')).toBe('autumn-2026')
    expect(defaultSemesterId(workspace, '2027-03-01')).toBe('spring-2027')
    expect(defaultSemesterId(workspace, '2027-02-10')).toBe('spring-2027')
  })

  it('拒绝重复学期标识，防止切换时指向错误课表', () => {
    const workspace = multipleSemesters()
    workspace.semesters[1].semester.id = workspace.semesters[0].semester.id
    expect(validateWorkspace(workspace)).toContain('重复')
  })
})
