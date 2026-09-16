import type { AiApiFormat, ClientAiConfig, RuntimeMode } from '../src/shared/contract'

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/** 10 MB，与前端上传限制一致。 */
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024

function apiFormatFromEnv(): AiApiFormat {
  const raw = (process.env.SCHEDULE_API_FORMAT ?? '').trim().toLowerCase()
  if (raw === 'openai-responses' || raw === 'openai-chat-completions' || raw === 'anthropic') {
    return raw
  }
  // 保持旧配置兼容：只配置 ANTHROPIC_API_KEY 的部署仍自动使用 Anthropic。
  if (process.env.OPENAI_API_KEY?.trim()) return 'openai-responses'
  return 'anthropic'
}

const apiFormat = apiFormatFromEnv()

export interface RuntimeAiConfig {
  format: AiApiFormat
  apiKey: string
  baseUrl?: string
  model: string
}

export const config = {
  port: intFromEnv('PORT', 8787),

  /**
   * SCHEDULE_MODE=demo 时强制演示模式，返回固定样例并在响应中标明。
   * 未设置时：有密钥走 live，没有则 unconfigured。
   * 生产模式缺配置绝不静默返回样例。
   */
  requestedMode: (process.env.SCHEDULE_MODE ?? '').trim().toLowerCase(),

  /** 服务端默认上游；密钥不下发给前端，也不写入日志。 */
  apiFormat,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL?.trim() || undefined,
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  openaiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
  model:
    process.env.SCHEDULE_MODEL?.trim() ||
    (apiFormat === 'anthropic' ? 'claude-opus-5' : 'gpt-5.5'),

  maxImageBytes: intFromEnv('SCHEDULE_MAX_IMAGE_BYTES', DEFAULT_MAX_IMAGE_BYTES),
  maxNoticeChars: intFromEnv('SCHEDULE_MAX_NOTICE_CHARS', 4000),

  /** 每个来源 IP 每分钟允许的识别 / 解析请求数。 */
  requestsPerMinute: intFromEnv('SCHEDULE_RATE_LIMIT_PER_MINUTE', 10),
  /** 同时在途的上游请求上限，避免突发流量打满配额。 */
  maxConcurrentUpstream: intFromEnv('SCHEDULE_MAX_CONCURRENT', 4),
  /** 单次上游调用的超时时间，略短于前端 5 分钟的整体等待上限。 */
  upstreamTimeoutMs: intFromEnv('SCHEDULE_UPSTREAM_TIMEOUT_MS', 270_000),
  /** 单次调用的输出上限，兼作费用上限的一部分。 */
  maxOutputTokens: intFromEnv('SCHEDULE_MAX_OUTPUT_TOKENS', 8000),

  /** 生产构建产物目录；存在时由本服务一并托管。 */
  staticDir: process.env.SCHEDULE_STATIC_DIR?.trim() || 'dist',
} as const

export function resolveMode(): RuntimeMode {
  if (config.requestedMode === 'demo') return 'demo'
  if (config.requestedMode === 'live') return resolveServerAiConfig() ? 'live' : 'unconfigured'
  return resolveServerAiConfig() ? 'live' : 'unconfigured'
}

export function resolveServerAiConfig(): RuntimeAiConfig | undefined {
  if (config.apiFormat === 'anthropic') {
    if (!config.anthropicApiKey) return undefined
    return {
      format: 'anthropic',
      apiKey: config.anthropicApiKey,
      baseUrl: config.anthropicBaseUrl,
      model: config.model,
    }
  }
  if (!config.openaiApiKey) return undefined
  return {
    format: config.apiFormat,
    apiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl,
    model: config.model,
  }
}

export function fromClientAiConfig(value: ClientAiConfig): RuntimeAiConfig {
  return {
    format: value.format,
    apiKey: value.apiKey,
    baseUrl: value.baseUrl,
    model: value.model,
  }
}

export function providerLabel(format: AiApiFormat): string {
  switch (format) {
    case 'openai-responses':
      return 'OpenAI Responses API'
    case 'openai-chat-completions':
      return 'OpenAI Chat Completions API'
    case 'anthropic':
    default:
      return 'Anthropic Claude'
  }
}

export const acceptedMediaTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
