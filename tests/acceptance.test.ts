import { describe, expect, it } from 'vitest'
import { FIRST_MONDAY, TOTAL_WEEKS, course, emptyData, slot } from './fixtures'
import { addDays, isoWeekday, mondayOf } from '../src/core/datetime'
import { defaultWeekFor, describeWeeks, expandWeekRule, parseCustomWeeks, semesterPhaseOf, teachingWeekOf } from '../src/core/weeks'
import { activeOnly, resolveDate } from '../src/core/resolve'
import { conflictsAmong } from '../src/core/conflict'
import { computeNextClass } from '../src/core/nextClass'
import { analyzeConfigChange, analyzeSlotEdit, trimWeeksToSemester } from '../src/core/impact'
import { commitDraft, entriesToDraft, interpretWeeksText, requiredIssueCount, validateDraft } from '../src/core/draft'
import { parseBackup } from '../src/store/validate'
import { buildBackup } from '../src/store/storage'
import type { AppData } from '../src/types'

const names = (data: AppData, date: string) => activeOnly(resolveDate(data, date)).map((i) => i.courseName)

/* ---------------------------------------------------------------- A01 */
describe('A01 首次手动建表', () => {
  it('不经过截图导入也能建立课程并在对应周看到', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A', '王敏'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101'))

    expect(names(data, FIRST_MONDAY)).toEqual(['高等数学 A'])
    const instance = resolveDate(data, FIRST_MONDAY)[0]
    expect(instance.room).toBe('A101')
    expect(instance.startTime).toBe('08:00')
    expect(instance.endTime).toBe('09:40') // 第 1-2 节连排，取首节开始与末节结束
  })
})

/* ---------------------------------------------------------------- A02 */
describe('A02 标准截图导入', () => {
  it('草稿在确认前不写入课表，确认后才追加', () => {
    const data = emptyData()
    const draft = entriesToDraft(
      [{ courseName: '大学英语', teacher: '李文静', room: 'C305', weekday: 2, startPeriod: 3, endPeriod: 4, weeksText: '1-16周' }],
      TOTAL_WEEKS,
    )
    expect(data.slots).toHaveLength(0) // 生成草稿本身不改动课表

    const result = commitDraft(data, draft)
    expect(result.added).toBe(1)
    expect(data.slots).toHaveLength(0) // 原对象未被就地修改
    expect(names(result.data, addDays(FIRST_MONDAY, 1))).toEqual(['大学英语'])
  })
})

/* ---------------------------------------------------------------- A03 */
describe('A03 周次缺失', () => {
  it('图片未写周次时标记待确认，不默认扩展到全学期', () => {
    const data = emptyData()
    const draft = entriesToDraft(
      [{ courseName: '线性代数', weekday: 3, startPeriod: 1, endPeriod: 2, room: 'A208' }],
      TOTAL_WEEKS,
    )
    expect(draft[0].weeksConfirmed).toBe(false)

    const issues = validateDraft(draft, data)
    expect(issues.some((i) => i.field === 'weeks' && i.severity === 'required')).toBe(true)
    expect(requiredIssueCount(issues)).toBeGreaterThan(0)

    // 未确认的条目不会被写入课表
    expect(commitDraft(data, draft).added).toBe(0)
  })

  it('「设为全学期」后即可保存', () => {
    const data = emptyData()
    const draft = entriesToDraft([{ courseName: '线性代数', weekday: 3, startPeriod: 1, endPeriod: 2, room: 'A208' }], TOTAL_WEEKS)
    draft[0].rule = { kind: 'all' }
    draft[0].weeksConfirmed = true
    expect(requiredIssueCount(validateDraft(draft, data))).toBe(0)
    expect(commitDraft(data, draft).added).toBe(1)
  })
})

/* ---------------------------------------------------------------- A04 */
describe('A04 单双周', () => {
  const data = emptyData()
  data.courses.push(course('c1', '大学物理'), course('c2', '体育'))
  data.slots.push(slot('s1', 'c1', 3, 5, 6, { kind: 'odd', from: 1, to: 15 }))
  data.slots.push(slot('s2', 'c2', 3, 5, 6, { kind: 'even', from: 2, to: 14 }))

  const week3Wed = addDays(FIRST_MONDAY, 14 + 2)
  const week4Wed = addDays(FIRST_MONDAY, 21 + 2)

  it('第 3 周只显示单周课程', () => {
    expect(teachingWeekOf(data.semester, week3Wed)).toBe(3)
    expect(names(data, week3Wed)).toEqual(['大学物理'])
  })

  it('第 4 周只显示双周课程', () => {
    expect(teachingWeekOf(data.semester, week4Wed)).toBe(4)
    expect(names(data, week4Wed)).toEqual(['体育'])
  })

  it('单双周以教学周编号为准并正确展开', () => {
    expect(expandWeekRule({ kind: 'odd', from: 1, to: 15 }, 16).weeks).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
    expect(expandWeekRule({ kind: 'even', from: 2, to: 12 }, 16).weeks).toEqual([2, 4, 6, 8, 10, 12])
  })

  it('自定义周次去重排序，超出范围报错', () => {
    expect(parseCustomWeeks('8-12, 1-4, 6, 6', 16).weeks).toEqual([1, 2, 3, 4, 6, 8, 9, 10, 11, 12])
    expect(parseCustomWeeks('1-4,18', 16).errors[0]).toContain('超出学期范围')
  })

  it('周次描述可读', () => {
    expect(describeWeeks(expandWeekRule({ kind: 'all' }, 16).weeks, 16)).toBe('全学期')
    expect(describeWeeks([1, 3, 5, 7, 9, 11, 13, 15], 16)).toBe('第 1-15 周（单周）')
    expect(describeWeeks([1, 2, 3, 4, 6, 8, 9, 10, 11, 12], 16)).toBe('第 1-4、6、8-12 周')
  })
})

/* ---------------------------------------------------------------- A05 */
describe('A05 多组安排', () => {
  it('同一课程的不同日期、教室和周次分别正确显示', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A', '王敏'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'range', from: 1, to: 8 }, 'A101'))
    data.slots.push(slot('s2', 'c1', 4, 3, 4, { kind: 'range', from: 9, to: 16 }, 'B203'))

    const week1Mon = FIRST_MONDAY
    const week1Thu = addDays(FIRST_MONDAY, 3)
    const week10Thu = addDays(FIRST_MONDAY, 63 + 3)

    expect(resolveDate(data, week1Mon)[0].room).toBe('A101')
    expect(names(data, week1Thu)).toEqual([]) // 第 1 周周四还没开始
    expect(resolveDate(data, week10Thu)[0].room).toBe('B203')
  })
})

/* ---------------------------------------------------------------- A06 */
describe('A06 日期边界', () => {
  const data = emptyData()

  it('周日属于本周，下一个周一进入下一教学周', () => {
    const week1Sunday = addDays(FIRST_MONDAY, 6)
    expect(isoWeekday(week1Sunday)).toBe(7)
    expect(teachingWeekOf(data.semester, week1Sunday)).toBe(1)
    expect(teachingWeekOf(data.semester, addDays(week1Sunday, 1))).toBe(2)
    expect(mondayOf(week1Sunday)).toBe(FIRST_MONDAY)
  })

  it('学期开始前与结束后状态正确，并有合理的默认周', () => {
    const before = addDays(FIRST_MONDAY, -1)
    const lastDay = addDays(FIRST_MONDAY, TOTAL_WEEKS * 7 - 1)
    const after = addDays(lastDay, 1)

    expect(semesterPhaseOf(data.semester, before)).toBe('before')
    expect(semesterPhaseOf(data.semester, lastDay)).toBe('during')
    expect(teachingWeekOf(data.semester, lastDay)).toBe(TOTAL_WEEKS)
    expect(semesterPhaseOf(data.semester, after)).toBe('after')

    expect(defaultWeekFor(data.semester, before)).toBe(1)
    expect(defaultWeekFor(data.semester, after)).toBe(TOTAL_WEEKS)
  })

  it('学期范围外不产生课程', () => {
    const withCourse = emptyData()
    withCourse.courses.push(course('c1', '高等数学 A'))
    withCourse.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    expect(names(withCourse, addDays(FIRST_MONDAY, -7))).toEqual([])
    expect(names(withCourse, addDays(FIRST_MONDAY, TOTAL_WEEKS * 7))).toEqual([])
  })
})

/* ---------------------------------------------------------------- A07 */
describe('A07 下一节课程', () => {
  const data = emptyData()
  data.courses.push(course('c1', '高等数学 A'), course('c2', '大学英语'))
  data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101')) // 08:00-09:40
  data.slots.push(slot('s2', 'c2', 1, 5, 6, { kind: 'all' }, 'C305')) // 14:00-15:40

  it('课前显示今天最近一节未开始的课程', () => {
    const view = computeNextClass(data, FIRST_MONDAY, '07:30')
    expect(view.kind).toBe('upcoming-today')
    expect(view.primary?.courseName).toBe('高等数学 A')
  })

  it('开始时刻计入正在上课，结束时刻不计入', () => {
    expect(computeNextClass(data, FIRST_MONDAY, '08:00').kind).toBe('ongoing')
    expect(computeNextClass(data, FIRST_MONDAY, '09:39').kind).toBe('ongoing')
    const atEnd = computeNextClass(data, FIRST_MONDAY, '09:40')
    expect(atEnd.kind).toBe('upcoming-today')
    expect(atEnd.primary?.courseName).toBe('大学英语')
  })

  it('今日课程结束后显示已结束，并给出最近一次上课', () => {
    const view = computeNextClass(data, FIRST_MONDAY, '20:00')
    expect(view.kind).toBe('done-today')
    expect(view.upcomingDate).toBe(addDays(FIRST_MONDAY, 7))
    expect(view.upcomingInstances.map((i) => i.courseName)).toEqual(['高等数学 A', '大学英语'])
  })

  it('全天无课时区分「今天没有课程」', () => {
    const view = computeNextClass(data, addDays(FIRST_MONDAY, 1), '09:00')
    expect(view.kind).toBe('none-today')
    expect(view.upcomingDate).toBe(addDays(FIRST_MONDAY, 7))
  })

  it('同一时间多门课程时可以看到全部', () => {
    const clash = emptyData()
    clash.courses.push(course('c1', 'A 课'), course('c2', 'B 课'))
    clash.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    clash.slots.push(slot('s2', 'c2', 1, 1, 2, { kind: 'all' }))
    const view = computeNextClass(clash, FIRST_MONDAY, '08:10')
    expect(view.kind).toBe('ongoing')
    expect([view.primary!.courseName, ...view.concurrent.map((i) => i.courseName)].sort()).toEqual(['A 课', 'B 课'])
  })
})

/* ---------------------------------------------------------------- A08 */
describe('A08 单次停课', () => {
  function withCancel() {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101'))
    data.changes.push({ id: 'ch1', slotId: 's1', originalDate: addDays(FIRST_MONDAY, 7), type: 'cancel' })
    return data
  }

  it('仅影响选中日期，后续周不受影响', () => {
    const data = withCancel()
    const week2Mon = addDays(FIRST_MONDAY, 7)
    expect(names(data, week2Mon)).toEqual([])
    expect(names(data, FIRST_MONDAY)).toEqual(['高等数学 A'])
    expect(names(data, addDays(FIRST_MONDAY, 14))).toEqual(['高等数学 A'])
  })

  it('当日列表保留「已停课」记录供恢复', () => {
    const data = withCancel()
    const week2Mon = addDays(FIRST_MONDAY, 7)
    const all = resolveDate(data, week2Mon)
    expect(all).toHaveLength(1)
    expect(all[0].state).toBe('cancelled')

    data.changes = []
    expect(names(data, week2Mon)).toEqual(['高等数学 A']) // 取消变更后恢复原始安排
  })

  it('修改教室只影响该次课程', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101'))
    const week2Mon = addDays(FIRST_MONDAY, 7)
    data.changes.push({ id: 'ch1', slotId: 's1', originalDate: week2Mon, type: 'room', roomOverride: 'A999' })

    expect(resolveDate(data, week2Mon)[0].room).toBe('A999')
    expect(resolveDate(data, week2Mon)[0].roomChanged).toBe(true)
    expect(resolveDate(data, FIRST_MONDAY)[0].room).toBe('A101')
  })
})

/* ---------------------------------------------------------------- A09 */
describe('A09 跨周调课', () => {
  const data = emptyData()
  data.courses.push(course('c1', '高等数学 A'))
  data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101'))
  const origin = addDays(FIRST_MONDAY, 7) // 第 2 周周一
  const target = addDays(FIRST_MONDAY, 16) // 第 3 周周三
  data.changes.push({
    id: 'ch1',
    slotId: 's1',
    originalDate: origin,
    type: 'move',
    targetDate: target,
    targetStartPeriod: 5,
    targetEndPeriod: 6,
    roomOverride: 'B203',
  })

  it('原时间不再作为有效课程，但保留可见记录', () => {
    expect(names(data, origin)).toEqual([])
    const all = resolveDate(data, origin)
    expect(all[0].state).toBe('moved-out')
    expect(all[0].movedTo).toBe(target)
  })

  it('目标时间出现一次并标注来源', () => {
    const moved = activeOnly(resolveDate(data, target))
    expect(moved).toHaveLength(1)
    expect(moved[0].origin).toBe('moved-in')
    expect(moved[0].movedFrom).toBe(origin)
    expect(moved[0].startPeriod).toBe(5)
    expect(moved[0].room).toBe('B203')
  })

  it('下一节课程计算使用调整后的时间', () => {
    const view = computeNextClass(data, origin, '07:00')
    expect(view.kind).toBe('none-today') // 当天原本的课已调出
    expect(view.upcomingDate).toBe(addDays(FIRST_MONDAY, 14)) // 下一次是第 3 周周一的正常课
    const atTarget = computeNextClass(data, target, '14:10')
    expect(atTarget.kind).toBe('ongoing')
    expect(atTarget.primary?.courseName).toBe('高等数学 A')
  })

  it('一次性补课只在指定日期生效', () => {
    const makeup = emptyData()
    makeup.courses.push(course('c1', '高等数学 A'))
    makeup.oneOffs.push({ id: 'o1', courseId: 'c1', date: addDays(FIRST_MONDAY, 5), startPeriod: 1, endPeriod: 2, room: 'A101' })
    expect(names(makeup, addDays(FIRST_MONDAY, 5))).toEqual(['高等数学 A'])
    expect(names(makeup, addDays(FIRST_MONDAY, 12))).toEqual([])
  })
})

/* ---------------------------------------------------------------- A10 */
describe('A10 冲突检查', () => {
  it('同一天实际时间重叠会提示', () => {
    const data = emptyData()
    data.courses.push(course('c1', '大学英语'), course('c2', '程序设计基础'))
    data.slots.push(slot('s1', 'c1', 1, 3, 4, { kind: 'all' })) // 10:00-11:40
    data.slots.push(slot('s2', 'c2', 1, 4, 5, { kind: 'all' })) // 10:55-14:45
    expect(conflictsAmong(resolveDate(data, FIRST_MONDAY))).toHaveLength(1)
  })

  it('首尾相接不算冲突', () => {
    const data = emptyData()
    data.courses.push(course('c1', 'A 课'), course('c2', 'B 课'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' })) // 08:00-09:40
    data.slots.push(slot('s2', 'c2', 1, 3, 4, { kind: 'all' })) // 10:00-11:40
    expect(conflictsAmong(resolveDate(data, FIRST_MONDAY))).toHaveLength(0)
  })

  it('单周课与双周课没有共同周次时不冲突', () => {
    const data = emptyData()
    data.courses.push(course('c1', '大学物理'), course('c2', '体育'))
    data.slots.push(slot('s1', 'c1', 3, 5, 6, { kind: 'odd', from: 1, to: 15 }))
    data.slots.push(slot('s2', 'c2', 3, 5, 6, { kind: 'even', from: 2, to: 14 }))
    for (let week = 1; week <= 8; week++) {
      const wed = addDays(FIRST_MONDAY, (week - 1) * 7 + 2)
      expect(conflictsAmong(resolveDate(data, wed))).toHaveLength(0)
    }
  })

  it('已停课的课程不参与冲突判定', () => {
    const data = emptyData()
    data.courses.push(course('c1', 'A 课'), course('c2', 'B 课'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    data.slots.push(slot('s2', 'c2', 1, 1, 2, { kind: 'all' }))
    expect(conflictsAmong(resolveDate(data, FIRST_MONDAY))).toHaveLength(1)
    data.changes.push({ id: 'ch1', slotId: 's2', originalDate: FIRST_MONDAY, type: 'cancel' })
    expect(conflictsAmong(resolveDate(data, FIRST_MONDAY))).toHaveLength(0)
  })
})

/* ---------------------------------------------------------------- A11 */
describe('A11 重复导入', () => {
  const base = (() => {
    const data = emptyData()
    data.courses.push(course('c1', '大学英语', '李文静'))
    data.slots.push(slot('s1', 'c1', 2, 3, 4, { kind: 'all' }, 'C305'))
    return data
  })()

  it('完全相同的安排默认跳过', () => {
    const draft = entriesToDraft(
      [{ courseName: '大学英语', teacher: '李文静', room: 'C305', weekday: 2, startPeriod: 3, endPeriod: 4, weeksText: '1-16周' }],
      TOTAL_WEEKS,
    )
    const result = commitDraft(base, draft)
    expect(result.skipped).toBe(1)
    expect(result.added).toBe(0)
    expect(result.data.slots).toHaveLength(1)

    const issues = validateDraft(draft, base)
    expect(issues.some((i) => i.message.includes('自动跳过'))).toBe(true)
  })

  it('同一时间但信息不同的条目进入核对并被追加', () => {
    const draft = entriesToDraft(
      [{ courseName: '大学英语', teacher: '李文静', room: 'C999', weekday: 2, startPeriod: 3, endPeriod: 4, weeksText: '1-16周' }],
      TOTAL_WEEKS,
    )
    const issues = validateDraft(draft, base)
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('时间重叠'))).toBe(true)
    expect(requiredIssueCount(issues)).toBe(0) // 冲突是提示，不阻止保存
    expect(commitDraft(base, draft).added).toBe(1)
  })

  it('原始周次文本可解析出单双周', () => {
    expect(interpretWeeksText('1-16周', 16)).toEqual({ rule: { kind: 'range', from: 1, to: 16 }, confirmed: true })
    expect(interpretWeeksText('单周 1-15周', 16)).toEqual({ rule: { kind: 'odd', from: 1, to: 15 }, confirmed: true })
    expect(interpretWeeksText('双周2-14', 16)).toEqual({ rule: { kind: 'even', from: 2, to: 14 }, confirmed: true })
    expect(interpretWeeksText(undefined, 16).confirmed).toBe(false)
  })
})

/* ---------------------------------------------------------------- A13 */
describe('A13 备份恢复', () => {
  function full(): AppData {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A', '王敏'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'odd', from: 1, to: 15 }, 'A101'))
    data.changes.push({ id: 'ch1', slotId: 's1', originalDate: FIRST_MONDAY, type: 'cancel' })
    data.oneOffs.push({ id: 'o1', courseId: 'c1', date: addDays(FIRST_MONDAY, 5), startPeriod: 1, endPeriod: 2 })
    return data
  }

  it('周次与单次变更可完整恢复', () => {
    const backup = buildBackup(full())
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    expect(parsed.summary).toEqual({ semesterName: full().semester.name, courseCount: 1, slotCount: 1, changeCount: 2 })
    expect(parsed.backup!.data.slots[0].weeks).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
    expect(names(parsed.backup!.data, FIRST_MONDAY)).toEqual([]) // 停课记录一并恢复
  })

  it('无效文件被拒绝且带出原因', () => {
    expect(parseBackup('不是 JSON').error).toContain('JSON')
    expect(parseBackup('{"data":{}}').error).toContain('格式版本')
    expect(parseBackup('{"formatVersion":99,"data":{}}').error).toContain('高于当前支持')

    const broken = buildBackup(full())
    broken.data.slots[0].courseId = '不存在的课程'
    expect(parseBackup(JSON.stringify(broken)).error).toContain('找不到对应课程')

    const badPeriods = buildBackup(full())
    badPeriods.data.periods[0] = { period: 1, start: '10:00', end: '08:00' }
    expect(parseBackup(JSON.stringify(badPeriods)).error).toContain('开始时间必须早于结束时间')
  })
})

/* ---------------------------------------------------------------- A16 */
describe('A16 修改基础配置', () => {
  function sample(): AppData {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }, 'A101'))
    data.changes.push({ id: 'ch1', slotId: 's1', originalDate: addDays(FIRST_MONDAY, 7), type: 'cancel' })
    return data
  }

  it('缩短总周数时列出被裁剪的周次，需确认', () => {
    const data = sample()
    const report = analyzeConfigChange(data, {
      semester: { ...data.semester, totalWeeks: 10 },
      periods: data.periods,
    })
    const item = report.confirmable.find((i) => i.kind === 'week-out-of-range')
    expect(item).toBeDefined()
    expect(item!.detail).toContain('11')
    expect(trimWeeksToSemester(data, 10).slots[0].weeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('移除仍被引用的节次必须先修改课程', () => {
    const data = sample()
    const report = analyzeConfigChange(data, {
      semester: data.semester,
      periods: data.periods.filter((p) => p.period !== 2),
    })
    expect(report.blocking.some((i) => i.kind === 'period-missing')).toBe(true)
  })

  it('移动学期起点会提示日期整体移动，并拦住失去对应课程的变更', () => {
    const data = sample()
    const nextSemester = { ...data.semester, firstWeekMonday: addDays(FIRST_MONDAY, 7) }
    const report = analyzeConfigChange(data, { semester: nextSemester, periods: data.periods })
    expect(report.confirmable.some((i) => i.kind === 'dates-shifted')).toBe(true)
    expect(report.blocking).toHaveLength(0) // 停课日期仍是周一且在范围内

    // 起点挪到停课日期之后，该次课程不复存在
    const later = { ...data.semester, firstWeekMonday: addDays(FIRST_MONDAY, 21) }
    const blocked = analyzeConfigChange(data, { semester: later, periods: data.periods })
    expect(blocked.blocking.some((i) => i.kind === 'change-orphaned')).toBe(true)
  })

  it('编辑重复安排导致变更失配时能列出受影响记录', () => {
    const data = sample()
    const moved = { ...data.slots[0], weekday: 2 as const }
    expect(analyzeSlotEdit(data, [moved]).map((c) => c.id)).toEqual(['ch1'])
    expect(analyzeSlotEdit(data, [data.slots[0]])).toHaveLength(0)
    expect(analyzeSlotEdit(data, [], ['s1']).map((c) => c.id)).toEqual(['ch1'])
  })

  it('调课目标日期超出新学期范围时必须先处理', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    data.changes.push({
      id: 'ch1',
      slotId: 's1',
      originalDate: FIRST_MONDAY,
      type: 'move',
      targetDate: addDays(FIRST_MONDAY, 70),
    })
    const report = analyzeConfigChange(data, {
      semester: { ...data.semester, totalWeeks: 4 },
      periods: data.periods,
    })
    expect(report.blocking.some((i) => i.kind === 'change-out-of-range')).toBe(true)
  })
})
