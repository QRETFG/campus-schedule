import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { ApiErrorCode, NoticeCandidate, NoticeRequest, TimetableEntry } from '../src/shared/contract'
import { NoticeExtractionSchema, TimetableExtractionSchema } from '../src/shared/contract'
import type { RuntimeAiConfig } from './config'
import { config } from './config'

export class UpstreamError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'UpstreamError'
  }
}

let cachedAnthropic: { key: string; client: Anthropic } | undefined

function anthropicClient(ai: RuntimeAiConfig): Anthropic {
  const cacheKey = `${ai.baseUrl ?? ''}\u0000${ai.apiKey}`
  if (!cachedAnthropic || cachedAnthropic.key !== cacheKey) {
    cachedAnthropic = {
      key: cacheKey,
      client: new Anthropic({
        apiKey: ai.apiKey,
        ...(ai.baseUrl ? { baseURL: ai.baseUrl } : {}),
        maxRetries: 1,
      }),
    }
  }
  return cachedAnthropic.client
}

/** 把 SDK 或 fetch 抛出的错误收敛成前端能分别处理的错误码。 */
function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error
  if (error instanceof Anthropic.APIUserAbortError) {
    return new UpstreamError('cancelled', '请求已取消')
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new UpstreamError('upstream-timeout', '模型服务响应超时')
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new UpstreamError('upstream-invalid', 'API Key 无效或无权访问所选模型')
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new UpstreamError('rate-limited', '模型服务繁忙，请稍后再试')
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new UpstreamError('upstream-unavailable', '无法连接模型服务')
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    if (status >= 500) return new UpstreamError('upstream-unavailable', '模型服务暂时不可用')
    return new UpstreamError('upstream-invalid', '模型请求被拒绝，请检查 URL、模型 ID 和接口格式')
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new UpstreamError('cancelled', '请求已取消')
  }
  return new UpstreamError('internal', '模型调用出现未预期的问题')
}

interface CallOptions {
  signal: AbortSignal
  ai: RuntimeAiConfig
}

interface ImageInput {
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}

interface StructuredCall<T> {
  schema: z.ZodType<T>
  schemaName: string
  system: string
  userText: string
  image?: ImageInput
}

/** 三种上游协议最终都必须通过同一份 zod schema 校验。 */
async function parseStructured<T>(spec: StructuredCall<T>, options: CallOptions): Promise<T> {
  if (options.ai.format === 'anthropic') return parseAnthropic(spec, options)
  return parseOpenAi(spec, options)
}

async function parseAnthropic<T>(spec: StructuredCall<T>, { signal, ai }: CallOptions): Promise<T> {
  const content: Anthropic.MessageCreateParams['messages'][number]['content'] = spec.image
    ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: spec.image.mediaType,
            data: spec.image.data,
          },
        },
        { type: 'text', text: spec.userText },
      ]
    : spec.userText

  try {
    const response = await anthropicClient(ai).messages.parse(
      {
        model: ai.model,
        max_tokens: config.maxOutputTokens,
        system: spec.system,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: zodOutputFormat(spec.schema),
        },
        messages: [{ role: 'user', content }],
      },
      { signal, timeout: config.upstreamTimeoutMs },
    )
    if (response.stop_reason === 'refusal') {
      throw new UpstreamError('upstream-invalid', '模型服务拒绝处理这次请求')
    }
    if (response.stop_reason === 'max_tokens') {
      throw new UpstreamError('upstream-invalid', '模型输出超出长度上限，请缩小输入范围')
    }
    const parsed = response.parsed_output as T | null | undefined
    if (!parsed) throw new UpstreamError('upstream-invalid', '模型返回的数据无法解析')
    return spec.schema.parse(parsed)
  } catch (error) {
    throw toUpstreamError(error)
  }
}

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  // 部分兼容网关会拒绝顶层草案声明。
  delete json.$schema
  return json
}

function openAiEndpoint(ai: RuntimeAiConfig): string {
  const suffix = ai.format === 'openai-responses' ? '/responses' : '/chat/completions'
  const base = new URL(ai.baseUrl || 'https://api.openai.com/v1')
  let pathname = base.pathname.replace(/\/+$/, '')
  pathname = pathname.replace(/\/(responses|chat\/completions)$/, '')
  base.pathname = `${pathname}${suffix}`.replace(/\/{2,}/g, '/')
  return base.toString()
}

function openAiRequestBody<T>(spec: StructuredCall<T>, ai: RuntimeAiConfig): Record<string, unknown> {
  const schema = jsonSchemaFor(spec.schema)
  if (ai.format === 'openai-responses') {
    const content: Array<Record<string, unknown>> = []
    if (spec.image) {
      content.push({
        type: 'input_image',
        image_url: `data:${spec.image.mediaType};base64,${spec.image.data}`,
        detail: 'high',
      })
    }
    content.push({ type: 'input_text', text: spec.userText })
    return {
      model: ai.model,
      store: false,
      max_output_tokens: config.maxOutputTokens,
      instructions: spec.system,
      input: [{ role: 'user', content }],
      text: {
        format: { type: 'json_schema', name: spec.schemaName, strict: true, schema },
      },
    }
  }

  const userContent: Array<Record<string, unknown>> = []
  if (spec.image) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${spec.image.mediaType};base64,${spec.image.data}`,
        detail: 'high',
      },
    })
  }
  userContent.push({ type: 'text', text: spec.userText })
  return {
    model: ai.model,
    store: false,
    max_completion_tokens: config.maxOutputTokens,
    messages: [
      { role: 'system', content: spec.system },
      { role: 'user', content: userContent },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: spec.schemaName, strict: true, schema },
    },
  }
}

async function fetchOpenAi(endpoint: string, ai: RuntimeAiConfig, body: unknown, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()
  signal.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.upstreamTimeoutMs)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ai.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new UpstreamError('upstream-invalid', 'API Key 无效或无权访问所选模型')
      }
      if (response.status === 408 || response.status === 504) {
        throw new UpstreamError('upstream-timeout', '模型服务响应超时')
      }
      if (response.status === 429) {
        throw new UpstreamError('rate-limited', '模型服务触发限流，请稍后再试')
      }
      if (response.status >= 500) {
        throw new UpstreamError('upstream-unavailable', '模型服务暂时不可用')
      }
      throw new UpstreamError('upstream-invalid', '模型请求被拒绝，请检查 URL、模型 ID 和接口格式')
    }
    try {
      return await response.json()
    } catch {
      throw new UpstreamError('upstream-invalid', '模型服务没有返回有效 JSON')
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    if (timedOut) throw new UpstreamError('upstream-timeout', '模型服务响应超时')
    if (signal.aborted) throw new UpstreamError('cancelled', '请求已取消')
    throw new UpstreamError('upstream-unavailable', '无法连接自定义模型服务')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', forwardAbort)
  }
}

function responseText(body: unknown, format: RuntimeAiConfig['format']): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const value = body as Record<string, unknown>

  if (format === 'openai-chat-completions') {
    const choice = Array.isArray(value.choices) ? value.choices[0] : undefined
    if (!choice || typeof choice !== 'object') return undefined
    const message = (choice as Record<string, unknown>).message
    if (!message || typeof message !== 'object') return undefined
    const content = (message as Record<string, unknown>).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
            ? String((part as Record<string, unknown>).text)
            : '',
        )
        .join('')
    }
    return undefined
  }

  // 某些兼容实现会直接返回 output_text；官方 REST 返回 typed output 数组。
  if (typeof value.output_text === 'string') return value.output_text
  if (!Array.isArray(value.output)) return undefined
  const chunks: string[] = []
  for (const item of value.output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const record = part as Record<string, unknown>
      if (record.type === 'output_text' && typeof record.text === 'string') chunks.push(record.text)
    }
  }
  return chunks.join('') || undefined
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim()
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed
  try {
    return JSON.parse(unfenced)
  } catch {
    throw new UpstreamError('upstream-invalid', '模型返回的数据不是有效 JSON')
  }
}

async function parseOpenAi<T>(spec: StructuredCall<T>, { signal, ai }: CallOptions): Promise<T> {
  try {
    const body = await fetchOpenAi(openAiEndpoint(ai), ai, openAiRequestBody(spec, ai), signal)
    const record = body as Record<string, unknown>
    if (ai.format === 'openai-responses' && record.status === 'incomplete') {
      throw new UpstreamError('upstream-invalid', '模型输出不完整，可能已达到长度上限')
    }
    if (ai.format === 'openai-chat-completions') {
      const choice = Array.isArray(record.choices)
        ? (record.choices[0] as Record<string, unknown> | undefined)
        : undefined
      if (choice?.finish_reason === 'length') {
        throw new UpstreamError('upstream-invalid', '模型输出超出长度上限，请缩小输入范围')
      }
      const message = choice?.message as Record<string, unknown> | undefined
      if (message?.refusal) throw new UpstreamError('upstream-invalid', '模型服务拒绝处理这次请求')
    }
    const text = responseText(body, ai.format)
    if (!text) throw new UpstreamError('upstream-invalid', '模型响应中没有可解析的文本')
    const parsed = spec.schema.safeParse(parseJsonText(text))
    if (!parsed.success) throw new UpstreamError('upstream-invalid', '模型返回的数据不符合课表结构')
    return parsed.data
  } catch (error) {
    throw toUpstreamError(error)
  }
}

/* ---------------- 课表截图 ---------------- */

const TIMETABLE_SYSTEM = `你是大学课表截图解析工具，只输出截图上真实存在的信息。

规则：
1. 逐条输出上课安排。同一门课有多个上课时间时，分别输出多条，不要合并。
2. 星期用 1-7 表示，1 是周一，7 是周日。
3. 节次填截图上的节次编号。如果截图只给出上课时间而没有节次编号，根据行位置推断节次序号。
4. weeksText 必须是截图上原样出现的周次文字。截图没有写周次时填 null，绝对不要填 "1-16周" 之类的默认值。
5. 任何截图上没有的信息一律填 null，不要根据常识补全。
6. 自己不确定的字段名写进 uncertainFields。
7. sourceText 填该条安排在截图中对应的原始文字，便于用户逐条核对。
8. 只解析课表内容，忽略姓名、学号、页眉页脚等无关信息。
9. 截图里没有任何课程时，返回空的 entries 数组。`

export async function extractTimetable(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  periodCount: number,
  options: CallOptions,
): Promise<TimetableEntry[]> {
  const result = await parseStructured(
    {
      schema: TimetableExtractionSchema,
      schemaName: 'timetable_extraction',
      system: TIMETABLE_SYSTEM,
      userText: `解析这张周课表截图。当前作息表共 ${periodCount} 节，节次编号不应超过这个范围。`,
      image: { data: imageBase64, mediaType },
    },
    options,
  )
  return result.entries
}

/* ---------------- 调课通知 ---------------- */

const NOTICE_SYSTEM = `你是课表通知解析工具。把一条中文通知拆成结构化的候选变更项。

规则：
1. 一条通知可能包含多项变更，逐项输出。
2. kind 取值：cancel 停课、room 换教室、move 改期、makeup 补课、unknown 无法判断。
   同一门课「停课并补到另一时间」属于一项 move，不要拆成 cancel + makeup。
3. courseHint 原样保留通知里的课程称呼，例如「高数」。不要自行展开成全称，也不要判断它对应哪门课——课程匹配由后续程序完成。
4. originalDateText 和 targetDateText 原样保留通知里的日期表达，例如「本周四」「下周二」。
5. originalDate 和 targetDate 填你的初步解析（YYYY-MM-DD），以给定的通知发布日期为基准；不确定就填 null。后续程序会重新校验，你不必强行给出。
6. 通知里没提到的信息一律填 null，不要补全。
7. 不要把法定节假日调休当作课表调整。通知没有明说课表变动就不要输出该项。
8. sourceText 必须是通知原文里出现过的片段。
9. 通知里有互相矛盾、含糊或缺少关键信息的地方，写进 notes。
10. 通知里没有任何课表变更时，返回空的 items 数组。`

export async function extractNotice(
  request: NoticeRequest,
  options: CallOptions,
): Promise<NoticeCandidate[]> {
  const courseList = request.courses.length
    ? request.courses
        .map((course) => (course.teacher ? `- ${course.name}（${course.teacher}）` : `- ${course.name}`))
        .join('\n')
    : '（课表中还没有课程）'

  const userText = [
    `通知发布日期：${request.noticeDate}（相对日期以这一天为基准）`,
    `当前作息表共 ${request.periodCount} 节。`,
    '',
    '课表中已有的课程名（仅供你对齐称呼，不要据此断定匹配结果）：',
    courseList,
    '',
    '通知原文：',
    request.text,
  ].join('\n')

  const result = await parseStructured(
    {
      schema: NoticeExtractionSchema,
      schemaName: 'notice_extraction',
      system: NOTICE_SYSTEM,
      userText,
    },
    options,
  )
  return result.items
}
