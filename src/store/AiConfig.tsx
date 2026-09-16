import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ClientAiConfig } from '../shared/contract'
import { AI_CONFIG_HEADERS } from '../shared/aiHeaders'

export type ClientOpenAiFormat = ClientAiConfig['format']
export type AiConfigSource = 'server' | 'custom'

export interface AiPreferences {
  source: AiConfigSource
  format: ClientOpenAiFormat
  baseUrl: string
  model: string
}

const PREFERENCES_KEY = 'smart-schedule:ai-preferences:v1'
const API_KEY_SESSION_KEY = 'smart-schedule:ai-api-key:v1'

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  source: 'server',
  format: 'openai-responses',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
}

let memoryPreferences = DEFAULT_AI_PREFERENCES
let memoryApiKey = ''

function usableStorage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window[kind]
  } catch {
    return undefined
  }
}

function isFormat(value: unknown): value is ClientOpenAiFormat {
  return value === 'openai-responses' || value === 'openai-chat-completions'
}

export function readAiPreferences(): AiPreferences {
  const storage = usableStorage('localStorage')
  if (!storage) return memoryPreferences
  try {
    const stored = storage.getItem(PREFERENCES_KEY)
    if (!stored) {
      memoryPreferences = DEFAULT_AI_PREFERENCES
      return memoryPreferences
    }
    const raw = JSON.parse(stored) as Partial<AiPreferences> | null
    if (!raw) return DEFAULT_AI_PREFERENCES
    const next: AiPreferences = {
      source: raw.source === 'custom' ? 'custom' : 'server',
      format: isFormat(raw.format) ? raw.format : DEFAULT_AI_PREFERENCES.format,
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : DEFAULT_AI_PREFERENCES.baseUrl,
      model: typeof raw.model === 'string' ? raw.model : '',
    }
    memoryPreferences = next
    return next
  } catch {
    return memoryPreferences
  }
}

export function readSessionApiKey(): string {
  const storage = usableStorage('sessionStorage')
  if (!storage) return memoryApiKey
  try {
    memoryApiKey = storage.getItem(API_KEY_SESSION_KEY) ?? ''
  } catch {
    // 使用当前页面内存中的值。
  }
  return memoryApiKey
}

export function validateAiPreferences(value: AiPreferences, apiKey: string): string | undefined {
  if (value.source === 'server') return undefined
  if (!isFormat(value.format)) return '请选择 OpenAI 接口格式。'
  if (!value.baseUrl.trim()) return '请填写 API URL。'
  try {
    const url = new URL(value.baseUrl.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'API URL 只支持 HTTP 或 HTTPS。'
    if (url.username || url.password) return 'API URL 不能包含用户名或密码。'
  } catch {
    return 'API URL 格式不正确。'
  }
  if (!value.model.trim()) return '请填写模型 ID。'
  if (!apiKey.trim()) return '请填写 API Key。'
  return undefined
}

export function readClientAiConfig(): ClientAiConfig | undefined {
  const preferences = readAiPreferences()
  if (preferences.source !== 'custom') return undefined
  const apiKey = readSessionApiKey()
  if (validateAiPreferences(preferences, apiKey)) return undefined
  return {
    format: preferences.format,
    baseUrl: preferences.baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: preferences.model.trim(),
  }
}

export function customAiIsReady(preferences = readAiPreferences()): boolean {
  return preferences.source === 'custom' && !validateAiPreferences(preferences, readSessionApiKey())
}

/** 每次调用前即时读取；API Key 不进入课表 store，也不会被备份导出。 */
export function aiRequestHeaders(): Record<string, string> {
  const preferences = readAiPreferences()
  if (preferences.source !== 'custom') return {}
  const custom = readClientAiConfig()
  if (!custom) throw new Error('CUSTOM_AI_CONFIG_INCOMPLETE')
  return {
    [AI_CONFIG_HEADERS.format]: custom.format,
    [AI_CONFIG_HEADERS.baseUrl]: custom.baseUrl,
    [AI_CONFIG_HEADERS.apiKey]: custom.apiKey,
    [AI_CONFIG_HEADERS.model]: custom.model,
  }
}

interface SaveResult {
  ok: boolean
  error?: string
}

interface AiConfigValue {
  preferences: AiPreferences
  hasApiKey: boolean
  ready: boolean
  save: (preferences: AiPreferences, newApiKey?: string) => SaveResult
  clear: () => void
}

const AiConfigContext = createContext<AiConfigValue | undefined>(undefined)

export function AiConfigProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AiPreferences>(() => readAiPreferences())
  const [hasApiKey, setHasApiKey] = useState(() => Boolean(readSessionApiKey()))

  const value = useMemo<AiConfigValue>(() => {
    const save = (next: AiPreferences, newApiKey = ''): SaveResult => {
      const previousKey = readSessionApiKey()
      const currentKey = newApiKey.trim() || previousKey
      const normalized: AiPreferences = {
        ...next,
        baseUrl: next.baseUrl.trim(),
        model: next.model.trim(),
      }
      const error = validateAiPreferences(normalized, currentKey)
      if (error) return { ok: false, error }

      const preferenceStorage = usableStorage('localStorage')
      const keyStorage = usableStorage('sessionStorage')
      try {
        // 先写会话密钥，再写非敏感偏好，避免密钥写入失败时留下半份启用配置。
        if (normalized.source === 'custom') {
          keyStorage?.setItem(API_KEY_SESSION_KEY, currentKey)
        } else {
          keyStorage?.removeItem(API_KEY_SESSION_KEY)
        }
        preferenceStorage?.setItem(PREFERENCES_KEY, JSON.stringify(normalized))
      } catch {
        try {
          if (previousKey) keyStorage?.setItem(API_KEY_SESSION_KEY, previousKey)
          else keyStorage?.removeItem(API_KEY_SESSION_KEY)
        } catch {
          // 返回失败即可；浏览器已经拒绝会话存储操作。
        }
        return { ok: false, error: '浏览器无法保存智能服务配置。' }
      }
      memoryPreferences = normalized
      memoryApiKey = normalized.source === 'custom' ? currentKey : ''
      setPreferences(normalized)
      setHasApiKey(Boolean(memoryApiKey))
      return { ok: true }
    }

    const clear = () => {
      memoryPreferences = DEFAULT_AI_PREFERENCES
      memoryApiKey = ''
      try {
        usableStorage('localStorage')?.removeItem(PREFERENCES_KEY)
        usableStorage('sessionStorage')?.removeItem(API_KEY_SESSION_KEY)
      } catch {
        // 内存状态仍会立即清除。
      }
      setPreferences(DEFAULT_AI_PREFERENCES)
      setHasApiKey(false)
    }

    return {
      preferences,
      hasApiKey,
      ready: customAiIsReady(preferences),
      save,
      clear,
    }
  }, [preferences, hasApiKey])

  return <AiConfigContext.Provider value={value}>{children}</AiConfigContext.Provider>
}

export function useAiConfig(): AiConfigValue {
  const value = useContext(AiConfigContext)
  if (!value) throw new Error('useAiConfig 必须在 AiConfigProvider 内使用')
  return value
}
