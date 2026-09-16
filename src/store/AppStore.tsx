import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppData, DateStr, TimeStr } from '../types'
import { TIMEZONE, clockIn, todayIn } from '../core/datetime'
import { StorageError, clearData, isStorageAvailable, loadData, saveData } from './storage'

interface AppStoreValue {
  /** undefined 表示本浏览器尚未创建课表。 */
  data?: AppData
  storageAvailable: boolean
  /** 最近一次保存失败的信息；非空时页面必须提示未保存。 */
  saveError?: string
  /** 写入并持久化；返回是否成功。失败时内存中的数据仍然更新，避免用户丢失正在编辑的内容。 */
  commit: (next: AppData) => boolean
  update: (fn: (current: AppData) => AppData) => boolean
  reset: () => void
  dismissSaveError: () => void
}

const AppStoreContext = createContext<AppStoreValue | undefined>(undefined)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | undefined>(() => loadData())
  const [saveError, setSaveError] = useState<string | undefined>()
  const storageAvailable = useMemo(() => isStorageAvailable(), [])

  const commit = useCallback((next: AppData) => {
    setData(next)
    try {
      saveData(next)
      setSaveError(undefined)
      return true
    } catch (error) {
      setSaveError(error instanceof StorageError ? error.message : '保存失败，课表未写入本浏览器。')
      return false
    }
  }, [])

  const dataRef = useRef(data)
  dataRef.current = data

  const update = useCallback(
    (fn: (current: AppData) => AppData) => {
      const current = dataRef.current
      if (!current) return false
      return commit(fn(current))
    },
    [commit],
  )

  const reset = useCallback(() => {
    clearData()
    setData(undefined)
    setSaveError(undefined)
  }, [])

  const value = useMemo<AppStoreValue>(
    () => ({
      data,
      storageAvailable,
      saveError,
      commit,
      update,
      reset,
      dismissSaveError: () => setSaveError(undefined),
    }),
    [data, storageAvailable, saveError, commit, update, reset],
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
