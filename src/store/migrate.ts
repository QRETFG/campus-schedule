import type { AppData, AppliedBatch, RecurringSlot } from '../types'
import { SCHEMA_VERSION } from '../types'
import { inferRule } from '../core/weeks'

/**
 * 旧数据迁移。
 *
 * v1（首版）→ v2：新增 schemaVersion 与 lastBatch。
 * 两者都是可选字段，因此 v1 数据结构上仍然合法，这里只补默认值并修复历史遗留：
 *  - 早期写入的重复安排可能缺少 rule，从实际周次集合反推一个等价规则；
 *  - 结构不完整的 lastBatch 直接丢弃，撤销入口不可用总好过错误回滚。
 */
export function migrateData(input: AppData): AppData {
  const version = typeof input.schemaVersion === 'number' ? input.schemaVersion : 1
  if (version >= SCHEMA_VERSION && input.slots.every(hasRule)) {
    return input.lastBatch && !isValidBatch(input.lastBatch)
      ? { ...input, lastBatch: undefined }
      : input
  }

  const totalWeeks = input.semester.totalWeeks
  const slots: RecurringSlot[] = input.slots.map((slot) =>
    hasRule(slot) ? slot : { ...slot, rule: inferRule(slot.weeks, totalWeeks) },
  )

  return {
    ...input,
    schemaVersion: SCHEMA_VERSION,
    slots,
    lastBatch: input.lastBatch && isValidBatch(input.lastBatch) ? input.lastBatch : undefined,
  }
}

function hasRule(slot: RecurringSlot): boolean {
  return Boolean(slot.rule && typeof slot.rule.kind === 'string')
}

function isValidBatch(batch: AppliedBatch): boolean {
  if (!batch || typeof batch.id !== 'string' || !Array.isArray(batch.entries)) return false
  return batch.entries.every(
    (entry) =>
      (entry.kind === 'change' || entry.kind === 'oneoff') &&
      entry.written != null &&
      typeof (entry.written as { id?: unknown }).id === 'string',
  )
}
