import type { OcrResult } from './types'
import { OcrError, RECOGNIZE_TIMEOUT_MS } from './types'
import { createHttpProvider } from './client'

export * from './types'
export { fetchServiceStatus, parseNotice, mapTimetableEntry } from './client'

/** 当前节次数量由调用方在识别前提供，帮助服务端约束节次编号范围。 */
let currentPeriodCount = 12

export function setPeriodCount(count: number): void {
  if (Number.isInteger(count) && count >= 1 && count <= 16) currentPeriodCount = count
}

/** 当前使用的识别适配器。换供应商时替换这里的实现即可。 */
export const activeProvider = createHttpProvider(() => currentPeriodCount)

/**
 * 超过 5 分钟结束等待（§5.2）。
 * 超时或用户取消后会中止请求，服务端据此中止上游调用；
 * 迟到的结果不会再回到调用方。
 */
export async function recognizeWithTimeout(
  file: File,
  externalSignal?: AbortSignal,
): Promise<OcrResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, RECOGNIZE_TIMEOUT_MS)
  const forward = () => controller.abort()
  externalSignal?.addEventListener('abort', forward, { once: true })

  try {
    return await activeProvider.recognize(file, { signal: controller.signal })
  } catch (error) {
    if (timedOut) throw new OcrError('timeout', '识别超时')
    if (externalSignal?.aborted) throw new OcrError('cancelled', '识别已取消')
    if (error instanceof OcrError) throw error
    throw new OcrError('network', '识别请求失败')
  } finally {
    window.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', forward)
  }
}
