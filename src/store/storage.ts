import type { AppData, Backup } from '../types'
import { BACKUP_FORMAT_VERSION, SCHEMA_VERSION } from '../types'
import { migrateData } from './migrate'
import { validateData } from './validate'
import { createInitialAppData } from './seed'

const STORAGE_KEY = 'smart-schedule.v1'
const INITIALIZED_KEY = 'smart-schedule.initialized.v1'

export class StorageError extends Error {}

/** 读取本地课表；数据损坏时不抛出，交由调用方走空状态。 */
export function loadData(): AppData | undefined {
  let raw: string | null = null
  let initialized = false
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
    initialized = window.localStorage.getItem(INITIALIZED_KEY) === '1'
  } catch {
    // 即使浏览器禁用了持久化，当前会话仍可使用默认课表。
    return createInitialAppData()
  }
  if (!raw) {
    if (initialized) return undefined
    const initial = createInitialAppData()
    try {
      saveData(initial)
    } catch {
      // AppStore 会另行提示存储不可用；默认课表仍可在内存中使用。
    }
    return initial
  }
  try {
    const parsed = JSON.parse(raw)
    if (validateData(parsed)) return undefined
    // 旧版本写入的数据在这里补齐新增字段后再交给页面使用。
    const migrated = migrateData(parsed as AppData)
    markInitialized()
    return migrated
  } catch {
    return undefined
  }
}

/** 保存失败时抛出，页面必须明确提示未保存（§8.1）。 */
export function saveData(data: AppData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION }))
    markInitialized()
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? '浏览器存储空间不足'
        : '浏览器拒绝写入本地存储'
    throw new StorageError(`${reason}，课表未保存。请导出备份，避免数据丢失。`)
  }
}

export function clearData(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    // 保留初始化标记：用户主动清空后不应在下次刷新时重新灌入默认课表。
    markInitialized()
  } catch {
    // 清除失败不影响当前页面继续使用。
  }
}

function markInitialized(): void {
  try {
    window.localStorage.setItem(INITIALIZED_KEY, '1')
  } catch {
    // 初始化标记是辅助信息，写入失败不应让已经成功保存的课表被判定为失败。
  }
}

export function isStorageAvailable(): boolean {
  try {
    const probe = '__schedule_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function buildBackup(data: AppData): Backup {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    // 撤销记录属于会话状态，不进备份。
    data: { ...data, schemaVersion: SCHEMA_VERSION, lastBatch: undefined },
  }
}

export function backupFileName(data: AppData): string {
  const safeName = data.semester.name.replace(/[\\/:*?"<>|\s]+/g, '-')
  const stamp = new Date().toISOString().slice(0, 10)
  return `课表备份-${safeName}-${stamp}.json`
}
