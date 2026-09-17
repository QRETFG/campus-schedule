import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppData, DateStr, ScheduleWorkspace, TimeStr } from '../types'
import { TIMEZONE, clockIn, todayIn } from '../core/datetime'
import {
  StorageError,
  clearWorkspace,
  isStorageAvailable,
  loadActiveSemesterId,
  loadSyncMetadata,
  loadWorkspace,
  markSyncComplete,
  markSyncPending,
  saveActiveSemesterId,
  saveWorkspace,
} from './storage'
import { ScheduleSyncError, readRemoteSchedule, writeRemoteSchedule } from './remote'
import { createWorkspace, defaultSemesterId } from './workspace'

export type ScheduleSyncState = 'connecting' | 'saving' | 'synced' | 'offline'

export interface ScheduleSyncInfo {
  state: ScheduleSyncState
  lastSyncedAt?: string
  error?: string
}

interface AppStoreValue {
  /** undefined 表示本浏览器尚未创建课表。 */
  data?: AppData
  /** 需要同步和备份的全部学期。 */
  workspace?: ScheduleWorkspace
  activeSemesterId?: string
  storageAvailable: boolean
  /** 最近一次保存失败的信息；非空时页面必须提示未保存。 */
  saveError?: string
  /** 当前设备与部署实例共享课表的同步状态。 */
  sync: ScheduleSyncInfo
  syncNow: () => void
  /** 写入并持久化；返回是否成功。失败时内存中的数据仍然更新，避免用户丢失正在编辑的内容。 */
  commit: (next: AppData) => boolean
  update: (fn: (current: AppData) => AppData) => boolean
  addSemester: (next: AppData) => boolean
  switchSemester: (semesterId: string) => boolean
  removeSemester: (semesterId: string) => boolean
  replaceWorkspace: (next: ScheduleWorkspace) => boolean
  reset: () => void
  dismissSaveError: () => void
}

const AppStoreContext = createContext<AppStoreValue | undefined>(undefined)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [initialWorkspace] = useState(loadWorkspace)
  const [workspace, setWorkspace] = useState<ScheduleWorkspace | undefined>(initialWorkspace)
  const [activeSemesterId, setActiveSemesterId] = useState<string | undefined>(() => {
    if (!initialWorkspace) return undefined
    const saved = loadActiveSemesterId()
    return saved && initialWorkspace.semesters.some((item) => item.semester.id === saved)
      ? saved
      : defaultSemesterId(initialWorkspace)
  })
  const [saveError, setSaveError] = useState<string | undefined>()
  const [sync, setSync] = useState<ScheduleSyncInfo>({ state: 'connecting' })
  const [initialSyncMetadata] = useState(loadSyncMetadata)
  const storageAvailable = useMemo(() => isStorageAvailable(), [])

  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  const activeSemesterIdRef = useRef(activeSemesterId)
  activeSemesterIdRef.current = activeSemesterId
  const data = workspace?.semesters.find((item) => item.semester.id === activeSemesterId)
  const revisionRef = useRef<number | undefined>(initialSyncMetadata.revision)
  const pendingRef = useRef<{ data: ScheduleWorkspace | null } | undefined>(
    initialSyncMetadata.pending ? { data: initialWorkspace ?? null } : undefined,
  )
  const inFlightRef = useRef<Promise<void> | undefined>()

  const applyRemote = useCallback((next: ScheduleWorkspace | null) => {
    workspaceRef.current = next ?? undefined
    setWorkspace(next ?? undefined)
    const currentId = activeSemesterIdRef.current
    const nextActiveId = next
      ? currentId && next.semesters.some((item) => item.semester.id === currentId)
        ? currentId
        : defaultSemesterId(next)
      : undefined
    activeSemesterIdRef.current = nextActiveId
    setActiveSemesterId(nextActiveId)
    if (nextActiveId) saveActiveSemesterId(nextActiveId)
    try {
      if (next) saveWorkspace(next)
      else clearWorkspace()
      setSaveError(undefined)
    } catch (error) {
      setSaveError(error instanceof StorageError ? error.message : '云端课表已读取，但无法保存本机副本。')
    }
  }, [])

  const synchronize = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current
    let completed = false

    const operation = (async () => {
      try {
        while (true) {
          const pending = pendingRef.current
          if (pending) {
            setSync((current) => ({ ...current, state: 'saving', error: undefined }))
            const saved = await writeRemoteSchedule(pending.data)
            revisionRef.current = saved.revision
            if (pendingRef.current === pending) pendingRef.current = undefined
            markSyncComplete(saved.revision)
            setSync({ state: 'synced', lastSyncedAt: saved.updatedAt ?? undefined })
            // 保存期间又有新修改时，继续按产生顺序保存最新快照。
            if (pendingRef.current) continue
            completed = true
            return
          }

          const result = await readRemoteSchedule(revisionRef.current)
          if (result.kind === 'not-modified') {
            if (revisionRef.current !== undefined) markSyncComplete(revisionRef.current)
            setSync((current) => ({ ...current, state: 'synced', error: undefined }))
            completed = true
            return
          }

          // 拉取期间发生了本机修改时，本机待保存内容优先进入下一轮。
          if (pendingRef.current) continue
          const remote = result.record
          revisionRef.current = remote.revision

          if (remote.revision === 0) {
            // 全新服务器以当前设备的本地课表完成首次初始化。
            const local = workspaceRef.current
            if (local) {
              pendingRef.current = { data: local }
              continue
            }
          } else {
            applyRemote(remote.data)
            markSyncComplete(remote.revision)
          }

          setSync({ state: 'synced', lastSyncedAt: remote.updatedAt ?? undefined })
          completed = true
          return
        }
      } catch (error) {
        setSync((current) => ({
          ...current,
          state: 'offline',
          error: error instanceof ScheduleSyncError ? error.message : '无法连接云端同步服务，本机修改将在稍后重试。',
        }))
      }
    })()

    inFlightRef.current = operation.finally(() => {
      inFlightRef.current = undefined
      // 极小概率下修改恰好发生在同步循环退出时，补发一次而不等待轮询。
      if (completed && pendingRef.current) window.setTimeout(() => void synchronize(), 0)
    })
    return inFlightRef.current
  }, [applyRemote])

  const queueRemoteWrite = useCallback((next: ScheduleWorkspace | null) => {
    pendingRef.current = { data: next }
    markSyncPending(revisionRef.current)
    void synchronize()
  }, [synchronize])

  const saveLocalWorkspace = useCallback((next: ScheduleWorkspace, nextActiveId: string): boolean => {
    workspaceRef.current = next
    activeSemesterIdRef.current = nextActiveId
    setWorkspace(next)
    setActiveSemesterId(nextActiveId)
    saveActiveSemesterId(nextActiveId)
    queueRemoteWrite(next)
    try {
      saveWorkspace(next)
      setSaveError(undefined)
      return true
    } catch (error) {
      setSaveError(error instanceof StorageError ? error.message : '保存失败，课表未写入本浏览器。')
      return false
    }
  }, [queueRemoteWrite])

  const commit = useCallback((next: AppData) => {
    const current = workspaceRef.current
    if (!current) return saveLocalWorkspace(createWorkspace(next), next.semester.id)

    const activeId = activeSemesterIdRef.current
    const index = current.semesters.findIndex((item) => item.semester.id === activeId)
    const semesters = index < 0
      ? [...current.semesters, next]
      : current.semesters.map((item, itemIndex) => itemIndex === index ? next : item)
    return saveLocalWorkspace({ ...current, semesters }, next.semester.id)
  }, [saveLocalWorkspace])

  const update = useCallback(
    (fn: (current: AppData) => AppData) => {
      const currentWorkspace = workspaceRef.current
      const current = currentWorkspace?.semesters.find(
        (item) => item.semester.id === activeSemesterIdRef.current,
      )
      if (!current) return false
      return commit(fn(current))
    },
    [commit],
  )

  const addSemester = useCallback((next: AppData) => {
    const current = workspaceRef.current
    if (!current) return saveLocalWorkspace(createWorkspace(next), next.semester.id)
    if (current.semesters.some((item) => item.semester.id === next.semester.id)) {
      setSaveError('新学期标识与已有学期重复，请重新创建。')
      return false
    }
    return saveLocalWorkspace(
      { ...current, semesters: [...current.semesters, next] },
      next.semester.id,
    )
  }, [saveLocalWorkspace])

  const switchSemester = useCallback((semesterId: string) => {
    const current = workspaceRef.current
    if (!current?.semesters.some((item) => item.semester.id === semesterId)) return false
    activeSemesterIdRef.current = semesterId
    setActiveSemesterId(semesterId)
    saveActiveSemesterId(semesterId)
    return true
  }, [])

  const removeSemester = useCallback((semesterId: string) => {
    const current = workspaceRef.current
    if (!current || current.semesters.length <= 1) return false
    const semesters = current.semesters.filter((item) => item.semester.id !== semesterId)
    if (semesters.length === current.semesters.length) return false
    const reduced = { ...current, semesters }
    const currentActive = activeSemesterIdRef.current
    const nextActive = currentActive !== semesterId && semesters.some((item) => item.semester.id === currentActive)
      ? currentActive!
      : defaultSemesterId(reduced)!
    return saveLocalWorkspace(reduced, nextActive)
  }, [saveLocalWorkspace])

  const replaceWorkspace = useCallback((next: ScheduleWorkspace) => {
    const nextActive = defaultSemesterId(next)
    if (!nextActive) return false
    return saveLocalWorkspace(next, nextActive)
  }, [saveLocalWorkspace])

  const reset = useCallback(() => {
    clearWorkspace()
    workspaceRef.current = undefined
    activeSemesterIdRef.current = undefined
    setWorkspace(undefined)
    setActiveSemesterId(undefined)
    setSaveError(undefined)
    queueRemoteWrite(null)
  }, [queueRemoteWrite])

  useEffect(() => {
    void synchronize()
    const timer = window.setInterval(() => void synchronize(), 30_000)
    const onFocus = () => void synchronize()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void synchronize()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [synchronize])

  const value = useMemo<AppStoreValue>(
    () => ({
      data,
      workspace,
      activeSemesterId,
      storageAvailable,
      saveError,
      sync,
      syncNow: () => void synchronize(),
      commit,
      update,
      addSemester,
      switchSemester,
      removeSemester,
      replaceWorkspace,
      reset,
      dismissSaveError: () => setSaveError(undefined),
    }),
    [data, workspace, activeSemesterId, storageAvailable, saveError, sync, synchronize, commit, update, addSemester, switchSemester, removeSemester, replaceWorkspace, reset],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext)
  if (!value) throw new Error('useAppStore 必须在 AppStoreProvider 内使用')
  return value
}

/** 已确认存在课表时使用，省去每个页面判空。 */
export function useAppData(): AppData & { store: AppStoreValue } {
  const store = useAppStore()
  if (!store.data) throw new Error('当前没有课表数据')
  return { ...store.data, store }
}

/* ---------- 当前时刻 ---------- */

interface Clock {
  today: DateStr
  now: TimeStr
}

const ClockContext = createContext<Clock>({ today: todayIn(), now: clockIn() })

/**
 * 页面保持打开或重新回到前台时更新当前日期与时间（§6.1）。
 * 每 30 秒轮询一次，足以让「正在上课」与「下一节」及时切换。
 */
export function ClockProvider({ children, timezone = TIMEZONE }: { children: ReactNode; timezone?: string }) {
  const read = useCallback(
    (): Clock => ({ today: todayIn(timezone), now: clockIn(timezone) }),
    [timezone],
  )
  const [clock, setClock] = useState<Clock>(read)

  useEffect(() => {
    const tick = () => {
      setClock((prev) => {
        const next = read()
        return prev.today === next.today && prev.now === next.now ? prev : next
      })
    }
    const timer = window.setInterval(tick, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)
    tick()
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tick)
    }
  }, [read])

  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>
}

export function useClock(): Clock {
  return useContext(ClockContext)
}
