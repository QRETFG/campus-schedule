import type {
  ApiError,
  HealthResponse,
  NoticeRequest,
  NoticeResponse,
  OcrResponse,
  RuntimeMode,
  TimetableEntry,
} from '../shared/contract'
import type { Weekday } from '../types'
import type { OcrEntry, OcrProvider, OcrResult } from './types'
import { OcrError, mapApiErrorCode } from './types'
import { aiRequestHeaders, readClientAiConfig } from '../store/AiConfig'
import type { ClientAiConfig } from '../shared/contract'

/** 前端只访问应用自己的接口，不直接接触识别服务和密钥。 */
const API_BASE = '/api'

async function readError(response: Response): Promise<OcrError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const parsed = body as Partial<ApiError> | undefined
  const code = parsed?.error?.code
  if (code) {
    return new OcrError(mapApiErrorCode(code), parsed!.error!.message)
  }
  if (response.status === 429) return new OcrError('rate-limited', '请求过于频繁')
  if (response.status === 503) return new OcrError('unconfigured', '识别服务未配置')
  return new OcrError('network', `识别服务返回了 ${response.status}`)
}

function assertCustomExecution(
  body: Pick<OcrResponse, 'mode' | 'execution'> | Pick<NoticeResponse, 'mode' | 'execution'>,
  requested: ClientAiConfig | undefined,
): void {
  if (!requested) return
  const execution = body.execution
  if (
    body.mode !== 'live' ||
    !execution ||
    execution.source !== 'client' ||
    execution.apiFormat !== requested.format ||
    execution.model !== requested.model
  ) {
    throw new OcrError('configuration-not-applied', '自定义模型配置未被应用服务端采用')
  }
}

/** 读取服务端运行模式；失败时按「服务不可达」处理，不猜测为已配置。 */
export async function fetchServiceStatus(signal?: AbortSignal): Promise<HealthResponse | undefined> {
  try {
    const response = await fetch(`${API_BASE}/health`, { signal })
    if (!response.ok) return undefined
    return (await response.json()) as HealthResponse
  } catch {
    return undefined
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new OcrError('unreadable', '无法读取所选图片'))
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function toWeekday(value: number | null): Weekday | undefined {
  if (value === null || !Number.isInteger(value) || value < 1 || value > 7) return undefined
  return value as Weekday
}

function toText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function toPeriod(value: number | null): number | undefined {
  if (value === null || !Number.isInteger(value) || value < 1) return undefined
  return value
}

/**
 * 服务端返回值 → 核对页使用的草稿条目。
 * null 表示图片上没有这个信息，映射成 undefined 由核对页提示补充，不在这里补默认值。
 */
export function mapTimetableEntry(entry: TimetableEntry): OcrEntry {
  return {
    courseName: toText(entry.courseName),
    teacher: toText(entry.teacher),
    room: toText(entry.room),
    weekday: toWeekday(entry.weekday),
    startPeriod: toPeriod(entry.startPeriod),
    endPeriod: toPeriod(entry.endPeriod),
    weeksText: toText(entry.weeksText),
    uncertainFields: Array.isArray(entry.uncertainFields) ? [...entry.uncertainFields] : [],
    sourceText: toText(entry.sourceText),
  }
}

export function createHttpProvider(periodCount: () => number): OcrProvider {
  return {
    name: '课表识别服务',
    async recognize(file, { signal }): Promise<OcrResult> {
      if (signal.aborted) throw new OcrError('cancelled', '识别已取消')
      let customHeaders: Record<string, string>
      const requestedCustom = readClientAiConfig()
      try {
        customHeaders = aiRequestHeaders()
      } catch {
        throw new OcrError('unconfigured', '自定义模型配置不完整')
      }
      const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp'
      const imageBase64 = await fileToBase64(file)
      // 读取图片期间可能已经超时或被取消，此时不再发出请求。
      if (signal.aborted) throw new OcrError('cancelled', '识别已取消')

      let response: Response
      try {
        response = await fetch(`${API_BASE}/ocr/timetable`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...customHeaders },
          body: JSON.stringify({ imageBase64, mediaType, periodCount: periodCount() }),
          signal,
        })
      } catch (error) {
        if (signal.aborted) throw new OcrError('cancelled', '识别已取消')
        throw new OcrError('network', '无法连接识别服务')
      }

      // 请求返回后再确认一次：迟到的结果不能覆盖已经取消的草稿。
      if (signal.aborted) throw new OcrError('cancelled', '识别已取消')
      if (!response.ok) throw await readError(response)

      let body: OcrResponse
      try {
        body = (await response.json()) as OcrResponse
      } catch {
        throw new OcrError('unparsable', '识别服务返回的数据无法解析')
      }
      if (!body || !Array.isArray(body.entries)) {
        throw new OcrError('unparsable', '识别服务返回的数据无法解析')
      }
      assertCustomExecution(body, requestedCustom)
      if (!body.entries.length) {
        throw new OcrError('empty', '截图中没有找到课程')
      }
      return { entries: body.entries.map(mapTimetableEntry), mode: body.mode as RuntimeMode }
    },
  }
}

/* ---------------- 通知解析 ---------------- */

export async function parseNotice(
  request: NoticeRequest,
  signal?: AbortSignal,
): Promise<NoticeResponse> {
  let customHeaders: Record<string, string>
  const requestedCustom = readClientAiConfig()
  try {
    customHeaders = aiRequestHeaders()
  } catch {
    throw new OcrError('unconfigured', '自定义模型配置不完整')
  }
  let response: Response
  try {
    response = await fetch(`${API_BASE}/notice/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...customHeaders },
      body: JSON.stringify(request),
      signal,
    })
  } catch {
    if (signal?.aborted) throw new OcrError('cancelled', '解析已取消')
    throw new OcrError('network', '无法连接解析服务')
  }
  if (!response.ok) throw await readError(response)
  try {
    const body = (await response.json()) as NoticeResponse
    if (!body || !Array.isArray(body.items)) {
      throw new OcrError('unparsable', '解析服务返回的数据无法解析')
    }
    assertCustomExecution(body, requestedCustom)
    return body
  } catch (error) {
    if (error instanceof OcrError) throw error
    throw new OcrError('unparsable', '解析服务返回的数据无法解析')
  }
}
