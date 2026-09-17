import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppData } from '../src/types'
import { migrateData } from '../src/store/migrate'
import { validateData } from '../src/store/validate'

export interface StoredSchedule {
  revision: number
  updatedAt: string | null
  data: AppData | null
}

export interface ScheduleRepository {
  read(): Promise<StoredSchedule>
  replace(data: AppData | null): Promise<StoredSchedule>
}

const EMPTY_SCHEDULE: StoredSchedule = { revision: 0, updatedAt: null, data: null }

function cloneRecord(record: StoredSchedule): StoredSchedule {
  return JSON.parse(JSON.stringify(record)) as StoredSchedule
}

/**
 * 单用户部署使用的轻量文件存储。
 * 写入先落到同目录临时文件再原子替换，避免进程中断留下半份 JSON。
 */
export class JsonScheduleStore implements ScheduleRepository {
  private loaded = false
  private loading: Promise<void> | undefined
  private current: StoredSchedule = EMPTY_SCHEDULE
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async read(): Promise<StoredSchedule> {
    await this.queue
    await this.loadOnce()
    return cloneRecord(this.current)
  }

  async replace(data: AppData | null): Promise<StoredSchedule> {
    let result: StoredSchedule | undefined
    const operation = this.queue.then(async () => {
      await this.loadOnce()
      const next: StoredSchedule = {
        revision: this.current.revision + 1,
        updatedAt: new Date().toISOString(),
        data: data ? migrateData(data) : null,
      }
      await this.writeAtomically(next)
      this.current = next
      result = cloneRecord(next)
    })
    // 单次写入失败不能让后续写入永远卡在 rejected promise 上。
    this.queue = operation.then(() => undefined, () => undefined)
    await operation
    return result!
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return
    if (this.loading) return this.loading
    this.loading = this.loadFromDisk()
    try {
      await this.loading
    } finally {
      this.loading = undefined
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredSchedule>
      if (!Number.isInteger(parsed.revision) || Number(parsed.revision) < 1) {
        throw new Error('云端课表版本号无效')
      }
      if (typeof parsed.updatedAt !== 'string' || Number.isNaN(Date.parse(parsed.updatedAt))) {
        throw new Error('云端课表更新时间无效')
      }
      if (parsed.data !== null) {
        const problem = validateData(parsed.data)
        if (problem) throw new Error(`云端课表数据损坏：${problem}`)
      }
      this.current = {
        revision: Number(parsed.revision),
        updatedAt: parsed.updatedAt,
        data: parsed.data ? migrateData(parsed.data) : null,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.current = EMPTY_SCHEDULE
    }
    this.loaded = true
  }

  private async writeAtomically(record: StoredSchedule): Promise<void> {
    const directory = path.dirname(this.filePath)
    await fs.mkdir(directory, { recursive: true })
    const temporary = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`,
    )
    try {
      await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await fs.rename(temporary, this.filePath)
    } finally {
      await fs.unlink(temporary).catch(() => undefined)
    }
  }
}
