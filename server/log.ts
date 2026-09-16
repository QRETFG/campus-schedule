/**
 * 结构化日志。
 * 只记录调用元信息（路由、耗时、条目数、错误码），
 * 不记录密钥、原图、通知原文或完整课表内容。
 */

const REDACTED = '[redacted]'
const SENSITIVE_KEYS = /^(imagebase64|image|apikey|authorization|text|notice|entries|items|courses)$/i

function safeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.test(key)) return REDACTED
  if (typeof value === 'string' && value.length > 120) return `${value.slice(0, 40)}…[${value.length} chars]`
  return value
}

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = safeValue(key, value)
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...safe }))
}

/** 上游错误可能带回请求内容，这里只保留类型与状态码。 */
export function describeError(error: unknown): { name: string; status?: number } {
  if (error && typeof error === 'object') {
    const name = (error as { name?: string }).name ?? 'Error'
    const status = (error as { status?: number }).status
    return typeof status === 'number' ? { name, status } : { name }
  }
  return { name: 'Error' }
}
