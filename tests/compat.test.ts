import { describe, expect, it } from 'vitest'
import type { AppData } from '../src/types'
import { BACKUP_FORMAT_VERSION, SCHEMA_VERSION } from '../src/types'
import { FIRST_MONDAY, TOTAL_WEEKS, course, emptyData, slot } from './fixtures'
import { migrateData } from '../src/store/migrate'
import { parseBackup } from '../src/store/validate'
import { buildBackup } from '../src/store/storage'
import { activeOnly, resolveDate } from '../src/core/resolve'
import { addDays } from '../src/core/datetime'
import { computeNextClass } from '../src/core/nextClass'

/** 首版（v1）写出的数据：没有 schemaVersion，重复安排没有 rule 字段。 */
function legacyData(): AppData {
  const data = emptyData()
  data.courses.push(course('c1', '高等数学 A', '王敏'))
  data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'odd', from: 1, to: 15 }, 'A101'))
  data.changes.push({ id: 'ch1', slotId: 's1', originalDate: addDays(FIRST_MONDAY, 14), type: 'cancel' })
  data.oneOffs.push({ id: 'o1', courseId: 'c1', date: addDays(FIRST_MONDAY, 5), startPeriod: 1, endPeriod: 2 })

  const legacy = JSON.parse(JSON.stringify(data)) as AppData
  delete (legacy as { schemaVersion?: number }).schemaVersion
  for (const s of legacy.slots) delete (s as { rule?: unknown }).rule
  return legacy
}

describe('旧数据加载', () => {
  it('缺少 schemaVersion 的数据会补齐版本号', () => {
    const migrated = migrateData(legacyData())
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('缺少 rule 的重复安排会从实际周次反推等价规则', () => {
    const migrated = migrateData(legacyData())
    expect(migrated.slots[0].rule).toEqual({ kind: 'odd', from: 1, to: 15 })
    // 实际周次集合本身没有被改动
    expect(migrated.slots[0].weeks).toEqual([1, 3, 5, 7, 9, 11, 13, 15])
  })

  it('迁移后课表、单次变更和补课的行为不变', () => {
    const migrated = migrateData(legacyData())
    expect(activeOnly(resolveDate(migrated, FIRST_MONDAY)).map((i) => i.courseName)).toEqual(['高等数学 A'])
    // 第 3 周周一已停课
    expect(activeOnly(resolveDate(migrated, addDays(FIRST_MONDAY, 14)))).toHaveLength(0)
    // 补课仍然在
    expect(activeOnly(resolveDate(migrated, addDays(FIRST_MONDAY, 5)))).toHaveLength(1)
  })

  it('迁移后下一节课程计算不回归', () => {
    const migrated = migrateData(legacyData())
    const view = computeNextClass(migrated, FIRST_MONDAY, '07:30')
    expect(view.kind).toBe('upcoming-today')
    expect(view.primary?.courseName).toBe('高等数学 A')
  })

  it('结构损坏的撤销记录会被丢弃，不影响课表', () => {
    const broken = { ...legacyData(), lastBatch: { id: 1, entries: 'nope' } } as unknown as AppData
    const migrated = migrateData(broken)
    expect(migrated.lastBatch).toBeUndefined()
    expect(migrated.courses).toHaveLength(1)
  })

  it('已是当前版本的数据原样返回', () => {
    const current = migrateData(legacyData())
    expect(migrateData(current)).toBe(current)
  })
})

describe('备份兼容', () => {
  it('旧版 formatVersion 1 的备份仍可恢复并自动升级', () => {
    const legacy = {
      formatVersion: 1,
      exportedAt: '2026-09-01T00:00:00.000Z',
      data: legacyData(),
    }
    const parsed = parseBackup(JSON.stringify(legacy))
    expect(parsed.ok).toBe(true)
    expect(parsed.backup!.data.semesters[0].schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.backup!.data.semesters[0].slots[0].rule).toEqual({ kind: 'odd', from: 1, to: 15 })
    expect(parsed.summary).toMatchObject({ courseCount: 1, slotCount: 1, changeCount: 2 })
  })

  it('新版备份写出当前格式版本，且不包含撤销记录', () => {
    const data = emptyData()
    data.courses.push(course('c1', '高等数学 A'))
    data.slots.push(slot('s1', 'c1', 1, 1, 2, { kind: 'all' }))
    data.lastBatch = {
      id: 'b1',
      appliedAt: '2026-09-16T00:00:00.000Z',
      source: 'notice',
      entries: [{ kind: 'change', written: { id: 'x', slotId: 's1', originalDate: FIRST_MONDAY, type: 'cancel' } }],
    }

    const backup = buildBackup(data)
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(backup.data.semesters[0].lastBatch).toBeUndefined()
    expect(backup.data.semesters[0].schemaVersion).toBe(SCHEMA_VERSION)

    const roundTrip = parseBackup(JSON.stringify(backup))
    expect(roundTrip.ok).toBe(true)
    expect(roundTrip.backup!.data.semesters[0].slots[0].weeks).toHaveLength(TOTAL_WEEKS)
  })

  it('高于当前支持的格式版本被拒绝，不覆盖旧课表', () => {
    const parsed = parseBackup(JSON.stringify({ formatVersion: 99, data: legacyData() }))
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('高于当前支持')
  })

  it('结构不完整的备份被拒绝', () => {
    const broken = { formatVersion: 2, data: { ...legacyData(), slots: [{ id: 'x', courseId: '不存在' }] } }
    expect(parseBackup(JSON.stringify(broken)).ok).toBe(false)
  })
})
