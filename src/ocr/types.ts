import type { Weekday } from '../types'
import type { ApiErrorCode, RuntimeMode } from '../shared/contract'

export type { RuntimeMode }

/** 识别服务返回的单条上课安排，字段允许缺失，由核对页处理（§5.3）。 */
export interface OcrEntry {
  courseName?: string
  teacher?: string
  room?: string
  weekday?: Weekday
  startPeriod?: number
  endPeriod?: number
  /** 原始周次文本，例如 "1-16周"、"单周"；图片未写时为 undefined。 */
  weeksText?: string
  /** 识别服务明确标记为不确定的字段名，用于突出提示。不展示置信度百分比。 */
  uncertainFields?: string[]
  /** 该条安排在截图中对应的原文，供用户逐条对照。服务未提供时为 undefined。 */
  sourceText?: string
}

export interface OcrResult {
  entries: OcrEntry[]
  mode: RuntimeMode
}

export type OcrErrorCode =
  | 'unconfigured'
  | 'timeout'
  | 'network'
  | 'rate-limited'
  | 'too-large'
  | 'unsupported-format'
  | 'unreadable'
  | 'empty'
  | 'unparsable'
  | 'invalid-upstream'
  | 'configuration-not-applied'
  | 'cancelled'

export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OcrError'
  }
}

export interface RecognizeOptions {
  signal: AbortSignal
}

/**
 * 识别服务适配器。
 * 首版通过应用自己的服务端调用图片理解服务；密钥只在服务端持有（§8.2）。
 * 换供应商时只需替换本接口的实现。
 */
export interface OcrProvider {
  readonly name: string
  recognize(file: File, options: RecognizeOptions): Promise<OcrResult>
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const RECOGNIZE_TIMEOUT_MINUTES = 5
export const RECOGNIZE_TIMEOUT_MS = RECOGNIZE_TIMEOUT_MINUTES * 60_000

/** 把服务端的错误码映射成前端分支。 */
export function mapApiErrorCode(code: ApiErrorCode): OcrErrorCode {
  switch (code) {
    case 'unconfigured':
      return 'unconfigured'
    case 'too-large':
      return 'too-large'
    case 'unsupported-format':
      return 'unsupported-format'
    case 'rate-limited':
      return 'rate-limited'
    case 'upstream-timeout':
      return 'timeout'
    case 'upstream-unavailable':
      return 'network'
    case 'empty-result':
      return 'empty'
    case 'cancelled':
      return 'cancelled'
    case 'upstream-invalid':
      return 'invalid-upstream'
    case 'invalid-request':
    case 'internal':
    default:
      return 'unparsable'
  }
}

export function describeOcrError(code: OcrErrorCode): { title: string; hint: string } {
  switch (code) {
    case 'unconfigured':
      return {
        title: '识别服务未配置',
        hint: '服务端还没有配置识别凭证，暂时无法识别截图。你可以手动添加课程，或联系部署者按 README 配置后重试。',
      }
    case 'timeout':
      return { title: '识别超时', hint: '等待已结束，可以重试，或直接手动添加课程。' }
    case 'network':
      return { title: '识别请求失败', hint: '可能是网络中断或服务暂时不可用，已有课表未受影响。' }
    case 'rate-limited':
      return { title: '请求过于频繁', hint: '识别服务有频率限制，请稍候再试，或先手动添加课程。' }
    case 'too-large':
      return { title: '图片过大', hint: '请选择不超过 10 MB 的图片。' }
    case 'unsupported-format':
      return { title: '格式不支持', hint: '请上传 JPG、PNG 或 WebP 格式的截图。' }
    case 'unreadable':
      return { title: '图片无法解析', hint: '请换一张清晰、完整的周课表截图重新上传。' }
    case 'invalid-upstream':
      return {
        title: '模型服务返回异常',
        hint: '请检查所选 API 格式、URL、API Key 和模型 ID，并确认该模型支持图片与结构化输出。',
      }
    case 'configuration-not-applied':
      return {
        title: '自定义模型配置未生效',
        hint: '应用服务端没有采用本次自定义配置。请重启最新版本的服务端，再重新识别；演示数据不会写入课表。',
      }
    case 'empty':
      return { title: '没有识别到课程', hint: '请换一张能看清星期和节次的完整周课表截图，或手动添加课程。' }
    case 'cancelled':
      return { title: '识别已取消', hint: '可以重新选择图片再试。' }
    case 'unparsable':
    default:
      return { title: '返回的数据无法解析', hint: '请重新上传，或手动添加课程。' }
  }
}
