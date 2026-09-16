import type { Request } from 'express'

interface Bucket {
  count: number
  resetAt: number
}

const WINDOW_MS = 60_000
const buckets = new Map<string, Bucket>()

/** 定期清理过期桶，避免长期运行时内存增长。 */
function sweep(now: number): void {
  if (buckets.size < 512) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function clientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim()
  return req.ip ?? 'unknown'
}

export interface RateDecision {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}

/** 固定窗口计数，够用且没有额外依赖。 */
export function takeToken(key: string, limitPerMinute: number, now = Date.now()): RateDecision {
  sweep(now)
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, retryAfterSeconds: 0, remaining: limitPerMinute - 1 }
  }
  if (bucket.count >= limitPerMinute) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      remaining: 0,
    }
  }
  bucket.count += 1
  return { allowed: true, retryAfterSeconds: 0, remaining: limitPerMinute - bucket.count }
}

/** 仅供测试重置状态。 */
export function resetRateLimit(): void {
  buckets.clear()
}

/** 在途上游请求的并发闸门。 */
export class ConcurrencyGate {
  private active = 0
  constructor(private readonly max: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.max) return false
    this.active += 1
    return true
  }

  release(): void {
    this.active = Math.max(0, this.active - 1)
  }
}
