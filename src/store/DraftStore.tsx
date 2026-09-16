import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DraftEntry } from '../core/draft'
import type { RuntimeMode } from '../shared/contract'

interface DraftSession {
  entries: DraftEntry[]
  /** 原图预览地址，只用于本次核对，不进入课表或备份（§7）。 */
  previewUrl?: string
  fileName?: string
  /** 这批草稿来自真实识别还是演示模式，核对页需要标明。 */
  mode?: RuntimeMode
}

interface DraftStoreValue {
  session?: DraftSession
  start: (session: DraftSession) => void
  setEntries: (entries: DraftEntry[]) => void
  clear: () => void
}

const DraftContext = createContext<DraftStoreValue | undefined>(undefined)

export function DraftProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DraftSession | undefined>()

  const clear = useCallback(() => {
    setSession((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return undefined
    })
  }, [])

  const start = useCallback((next: DraftSession) => {
    setSession((prev) => {
      if (prev?.previewUrl && prev.previewUrl !== next.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return next
    })
  }, [])

  const setEntries = useCallback((entries: DraftEntry[]) => {
    setSession((prev) => (prev ? { ...prev, entries } : prev))
  }, [])

  const value = useMemo(() => ({ session, start, setEntries, clear }), [session, start, setEntries, clear])
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>
}

export function useDraft(): DraftStoreValue {
  const value = useContext(DraftContext)
  if (!value) throw new Error('useDraft 必须在 DraftProvider 内使用')
  return value
}
