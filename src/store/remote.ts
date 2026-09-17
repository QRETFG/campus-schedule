import type { AppData } from '../types'
import { migrateData } from './migrate'
import { validateData } from './validate'

export interface RemoteScheduleRecord {
  revision: number
  updatedAt: string | null
  data: AppData | null
}

export type RemoteScheduleRead =
  | { kind: 'not-modified' }
  | { kind: 'record'; record: RemoteScheduleRecord }

export class ScheduleSyncError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ScheduleSyncError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: unknown } }
    return typeof body.error?.message === 'string' ? body.error.message : fallback
  } catch {
    return fallback
  }
}

async function parseRecord(response: Response): Promise<RemoteScheduleRecord> {
  const raw: unknown = await response.json()
  if (!isObject(raw) || !Number.isInteger(raw.revision) || Number(raw.revision) < 0) {
    throw new ScheduleSyncError('云端同步服务返回了无法识别的版本信息。')
  }
  if (raw.updatedAt !== null && typeof raw.updatedAt !== 'string') {
    throw new ScheduleSyncError('云端同步服务返回了无法识别的更新时间。')
  }
  if (raw.data !== null) {
    const problem = validateData(raw.data)
    if (problem) throw new ScheduleSyncError(`云端课表数据异常：${problem}`)
  }
  return {
    revision: Number(raw.revision),
    updatedAt: raw.updatedAt as string | null,
    data: raw.data === null ? null : migrateData(raw.data as AppData),
  }
}

/** revision 相同时服务端返回 304，轮询不会重复传输整份课表。 */
export async function readRemoteSchedule(revision?: number): Promise<RemoteScheduleRead> {
  const response = await fetch('/api/schedule', {
    cache: 'no-store',
    headers: revision === undefined ? undefined : { 'If-None-Match': `"schedule-${revision}"` },
  })
  if (response.status === 304) return { kind: 'not-modified' }
  if (!response.ok) {
    throw new ScheduleSyncError(
      await errorMessage(response, '无法读取云端课表。'),
      response.status,
    )
  }
  return { kind: 'record', record: await parseRecord(response) }
}

/** data=null 表示把主动清空同步到其他设备。 */
export async function writeRemoteSchedule(data: AppData | null): Promise<RemoteScheduleRecord> {
  const response = await fetch('/api/schedule', data === null
    ? { method: 'DELETE' }
    : {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data }),
      })
  if (!response.ok) {
    throw new ScheduleSyncError(
      await errorMessage(response, '无法保存云端课表。'),
      response.status,
    )
  }
  return parseRecord(response)
}
