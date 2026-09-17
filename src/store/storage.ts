import type { AppData, Backup, ScheduleWorkspace } from '../types'
import { BACKUP_FORMAT_VERSION, SCHEMA_VERSION, WORKSPACE_VERSION } from '../types'
import { validateWorkspace } from './validate'
import { createInitialAppData } from './seed'
import { createWorkspace, defaultSemesterId, isWorkspace, migrateWorkspace } from './workspace'

const STORAGE_KEY = 'smart-schedule.v1'
const INITIALIZED_KEY = 'smart-schedule.initialized.v1'
const SYNC_META_KEY = 'smart-schedule.sync.v1'
const ACTIVE_SEMESTER_KEY = 'smart-schedule.active-semester.v1'

export interface LocalSyncMetadata {
  revision?: number
  pending: boolean
}

export class StorageError extends Error {}

/** 读取本地全部学期；旧版单学期数据会在内存中自动升级。 */
export function loadWorkspace(): ScheduleWorkspace | undefined {
  let raw: string | null = null
  let initialized = false
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
    initialized = window.localStorage.getItem(INITIALIZED_KEY) === '1'
  } catch {
    // 即使浏览器禁用了持久化，当前会话仍可使用默认课表。
    return createWorkspace(createInitialAppData())
  }
  if (!raw) {
    if (initialized) return undefined
    const initial = createWorkspace(createInitialAppData())
    try {
      saveWorkspace(initial)
    } catch {
      // AppStore 会另行提示存储不可用；默认课表仍可在内存中使用。
    }
    return initial
  }
  try {
    const parsed = JSON.parse(raw)
    if (validateWorkspace(parsed)) return undefined
    // 旧版的单学期数据和学期内部旧字段都在这里升级。
    const migrated = migrateWorkspace(parsed as AppData | ScheduleWorkspace)
    markInitialized()
    return migrated
  } catch {
    return undefined
  }
}

/** 保存失败时抛出，页面必须明确提示未保存（§8.1）。 */
export function saveWorkspace(workspace: ScheduleWorkspace): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspaceVersion: WORKSPACE_VERSION,
      semesters: workspace.semesters.map((data) => ({ ...data, schemaVersion: SCHEMA_VERSION })),
    }))
    markInitialized()
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? '浏览器存储空间不足'
        : '浏览器拒绝写入本地存储'
    throw new StorageError(`${reason}，课表未保存。请导出备份，避免数据丢失。`)
  }
}

export function clearWorkspace(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(ACTIVE_SEMESTER_KEY)
    // 保留初始化标记：用户主动清空后不应在下次刷新时重新灌入默认课表。
    markInitialized()
  } catch {
    // 清除失败不影响当前页面继续使用。
  }
}

export function loadActiveSemesterId(): string | undefined {
  try {
    return window.localStorage.getItem(ACTIVE_SEMESTER_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function saveActiveSemesterId(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_SEMESTER_KEY, id)
  } catch {
    // 当前会话仍然可以切换；刷新后回到日期最接近的学期。
  }
}

/** 以下三个单学期接口保留给旧调用方和数据兼容测试。 */
export function loadData(): AppData | undefined {
  const workspace = loadWorkspace()
  if (!workspace) return undefined
  const preferred = loadActiveSemesterId()
  const id = preferred && workspace.semesters.some((item) => item.semester.id === preferred)
    ? preferred
    : defaultSemesterId(workspace)
  return workspace.semesters.find((item) => item.semester.id === id)
}

export function saveData(data: AppData): void {
  saveWorkspace(createWorkspace(data))
  saveActiveSemesterId(data.semester.id)
}

export function clearData(): void {
  clearWorkspace()
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

/** 保存同步游标与离线待上传标记，避免页面刷新后丢掉尚未上传的修改。 */
export function loadSyncMetadata(): LocalSyncMetadata {
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY)
    if (!raw) return { pending: false }
    const parsed = JSON.parse(raw) as Partial<LocalSyncMetadata>
    return {
      revision: Number.isInteger(parsed.revision) && Number(parsed.revision) >= 0
        ? Number(parsed.revision)
        : undefined,
      pending: parsed.pending === true,
    }
  } catch {
    return { pending: false }
  }
}

export function markSyncPending(revision?: number): void {
  saveSyncMetadata({ revision, pending: true })
}

export function markSyncComplete(revision: number): void {
  saveSyncMetadata({ revision, pending: false })
}

function saveSyncMetadata(metadata: LocalSyncMetadata): void {
  try {
    window.localStorage.setItem(SYNC_META_KEY, JSON.stringify(metadata))
  } catch {
    // 同步仍可在当前页面内继续；这里只是跨刷新恢复所需的辅助游标。
  }
}

export function buildBackup(input: AppData | ScheduleWorkspace): Backup {
  const workspace = isWorkspace(input) ? input : createWorkspace(input)
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      workspaceVersion: WORKSPACE_VERSION,
      // 撤销记录属于会话状态，不进备份。
      semesters: workspace.semesters.map((data) => ({
        ...data,
        schemaVersion: SCHEMA_VERSION,
        lastBatch: undefined,
      })),
    },
  }
}

export function backupFileName(workspace: ScheduleWorkspace): string {
  const label = workspace.semesters.length === 1
    ? workspace.semesters[0].semester.name
    : `全部-${workspace.semesters.length}-个学期`
  const safeName = label.replace(/[\\/:*?"<>|\s]+/g, '-')
  const stamp = new Date().toISOString().slice(0, 10)
  return `课表备份-${safeName}-${stamp}.json`
}
