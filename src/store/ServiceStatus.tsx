import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { HealthResponse } from '../shared/contract'
import { fetchServiceStatus } from '../ocr'
import { useAiConfig } from './AiConfig'

interface ServiceStatusValue {
  loading: boolean
  status?: HealthResponse
  /** 服务端不可达。此时不能假定已配置，页面应提示手动录入。 */
  unreachable: boolean
  customEnabled: boolean
  customReady: boolean
  /** 当前应用服务端是否支持前端逐请求覆盖模型配置。 */
  customSupported: boolean
  refresh: () => void
}

const ServiceStatusContext = createContext<ServiceStatusValue | undefined>(undefined)

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const ai = useAiConfig()
  const [status, setStatus] = useState<HealthResponse | undefined>()
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    fetchServiceStatus(controller.signal).then((result) => {
      if (cancelled) return
      setStatus(result)
      setLoading(false)
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [tick])

  const value = useMemo<ServiceStatusValue>(
    () => ({
      loading,
      status,
      unreachable: !loading && !status,
      customEnabled: ai.preferences.source === 'custom',
      customReady: ai.ready,
      customSupported: Boolean(status?.supportedClientFormats?.includes(ai.preferences.format)),
      refresh: () => setTick((t) => t + 1),
    }),
    [loading, status, ai.preferences.source, ai.preferences.format, ai.ready],
  )

  return <ServiceStatusContext.Provider value={value}>{children}</ServiceStatusContext.Provider>
}

export function useServiceStatus(): ServiceStatusValue {
  const value = useContext(ServiceStatusContext)
  if (!value) throw new Error('useServiceStatus 必须在 ServiceStatusProvider 内使用')
  return value
}

/** 识别/解析入口是否可用。 */
export function isServiceUsable(value: ServiceStatusValue): boolean {
  if (value.loading || value.unreachable) return false
  if (value.customEnabled) return value.customReady && value.customSupported
  return value.status?.mode !== 'unconfigured'
}
