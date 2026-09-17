import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JsonScheduleStore } from '../server/scheduleStore'
import { readRemoteSchedule, writeRemoteSchedule } from '../src/store/remote'
import { emptyData } from './fixtures'
import { WORKSPACE_VERSION } from '../src/types'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('轻量云端文件存储', () => {
  it('跨实例持久化课表、递增版本，并保留清空记录', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-schedule-'))
    temporaryDirectories.push(directory)
    const file = path.join(directory, 'schedule.json')
    const first = new JsonScheduleStore(file)
    const data = emptyData()
    data.semester.name = '持久化测试学期'

    const saved = await first.replace(data)
    expect(saved.revision).toBe(1)

    const changed = emptyData()
    changed.semester.name = '并发写入后的学期'
    const second = emptyData()
    second.semester.id = 'second-semester'
    second.semester.name = '第二学期'
    const [, concurrentSave] = await Promise.all([
      first.read(),
      first.replace({ workspaceVersion: WORKSPACE_VERSION, semesters: [changed, second] }),
    ])
    expect(concurrentSave.revision).toBe(2)
    expect((await first.read()).data?.semesters[0].semester.name).toBe('并发写入后的学期')
    expect((await first.read()).data?.semesters[1].semester.name).toBe('第二学期')

    const restarted = new JsonScheduleStore(file)
    const loaded = await restarted.read()
    expect(loaded.data?.semesters[0].semester.name).toBe('并发写入后的学期')
    expect(loaded.data?.semesters).toHaveLength(2)
    expect(loaded.revision).toBe(2)

    const cleared = await restarted.replace(null)
    expect(cleared).toMatchObject({ revision: 3, data: null })
    expect(await new JsonScheduleStore(file).read()).toMatchObject({ revision: 3, data: null })
  })

  it('损坏的持久化文件会明确失败，不会被静默替换', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-schedule-'))
    temporaryDirectories.push(directory)
    const file = path.join(directory, 'schedule.json')
    await fs.writeFile(file, '{"revision":1,"data":{"broken":true}}')
    await expect(new JsonScheduleStore(file).read()).rejects.toThrow()
  })
})

describe('浏览器同步客户端', () => {
  it('版本未变化时发送 ETag 并接受 304', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(readRemoteSchedule(7)).resolves.toEqual({ kind: 'not-modified' })
    expect(fetchMock).toHaveBeenCalledWith('/api/schedule', expect.objectContaining({
      headers: { 'If-None-Match': '"schedule-7"' },
    }))
  })

  it('上传完整课表并校验服务端返回的数据', async () => {
    const data = emptyData()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      revision: 3,
      updatedAt: '2026-09-17T00:00:00.000Z',
      data,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const saved = await writeRemoteSchedule(data)
    expect(saved.revision).toBe(3)
    const request = fetchMock.mock.calls[0][1]
    expect(request?.method).toBe('PUT')
    expect(JSON.parse(String(request?.body)).data.semester.name).toBe(data.semester.name)
  })

  it('拒绝结构损坏的云端课表', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      revision: 2,
      updatedAt: '2026-09-17T00:00:00.000Z',
      data: { broken: true },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    await expect(readRemoteSchedule()).rejects.toThrow('云端课表数据异常')
  })
})
