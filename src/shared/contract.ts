/**
 * 前后端共享的接口契约。
 *
 * 服务端用这里的 zod schema 做出参校验和结构化输出定义；
 * 前端只做 `import type`，zod 不会进入浏览器产物。
 */
import { z } from 'zod'

/* ---------------- 运行模式 ---------------- */

/**
 * live        —— 已配置真实识别服务。
 * demo        —— 显式开启的演示模式，返回固定样例，界面必须标明。
 * unconfigured—— 缺少配置，接口拒绝识别请求，界面引导手动录入。
 */
export const RuntimeModeSchema = z.enum(['live', 'demo', 'unconfigured'])
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>

/**
 * 上游模型接口格式。OpenAI 同时保留 Responses 与 Chat Completions 两种协议，
 * Anthropic 用于兼容项目原有的服务端配置。
 */
export const AiApiFormatSchema = z.enum([
  'anthropic',
  'openai-responses',
  'openai-chat-completions',
])
export type AiApiFormat = z.infer<typeof AiApiFormatSchema>

/** 前端逐次请求携带的自定义 OpenAI 配置，不会进入课表数据或备份。 */
export const ClientAiConfigSchema = z
  .object({
    format: z.enum(['openai-responses', 'openai-chat-completions']),
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .url()
      .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), '只支持 HTTP 或 HTTPS 地址')
      .refine((value) => {
        const url = new URL(value)
        return !url.username && !url.password
      }, 'URL 不能包含用户名或密码'),
    apiKey: z.string().trim().min(1).max(4096),
    model: z.string().trim().min(1).max(200),
  })
  .strict()
export type ClientAiConfig = z.infer<typeof ClientAiConfigSchema>

export const AiExecutionMetaSchema = z.object({
  /** server=服务端默认配置，client=本次请求的前端自定义配置，demo=固定演示数据。 */
  source: z.enum(['server', 'client', 'demo']),
  apiFormat: AiApiFormatSchema.nullable(),
  model: z.string().nullable(),
})
export type AiExecutionMeta = z.infer<typeof AiExecutionMetaSchema>

export const HealthResponseSchema = z.object({
  mode: RuntimeModeSchema,
  /** 仅在 live 模式下返回，便于排查；不含密钥。 */
  model: z.string().nullable(),
  provider: z.string(),
  apiFormat: AiApiFormatSchema.nullable(),
  supportedClientFormats: z.array(z.enum(['openai-responses', 'openai-chat-completions'])),
  limits: z.object({
    maxImageBytes: z.number(),
    acceptedMediaTypes: z.array(z.string()),
    maxNoticeChars: z.number(),
    requestsPerMinute: z.number(),
  }),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

/* ---------------- 统一错误体 ---------------- */

export const ApiErrorCodeSchema = z.enum([
  'unconfigured',
  'too-large',
  'unsupported-format',
  'invalid-request',
  'rate-limited',
  'upstream-unavailable',
  'upstream-timeout',
  'upstream-invalid',
  'empty-result',
  'cancelled',
  'internal',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
  }),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

/* ---------------- 截图识别 ---------------- */

/**
 * 模型返回的一条上课安排。
 * 所有可缺字段都用 nullable 而非 optional：结构化输出要求字段必填，
 * 模型必须显式给出 null 表示「图片上没有这个信息」，避免自行补全。
 */
export const TimetableEntrySchema = z.object({
  courseName: z.string().nullable().describe('课程名称，图片上没有就填 null'),
  teacher: z.string().nullable().describe('教师姓名，没有就填 null'),
  room: z.string().nullable().describe('教室，没有就填 null'),
  weekday: z
    .number()
    .int()
    .min(1)
    .max(7)
    .nullable()
    .describe('星期，1 表示周一，7 表示周日；无法确定填 null'),
  startPeriod: z.number().int().min(1).max(30).nullable().describe('开始节次；无法确定填 null'),
  endPeriod: z.number().int().min(1).max(30).nullable().describe('结束节次；无法确定填 null'),
  weeksText: z
    .string()
    .nullable()
    .describe('图片上原样出现的周次文本，例如 "1-16周"、"单周"；图片没写周次必须填 null，不要猜测'),
  uncertainFields: z
    .array(z.enum(['courseName', 'teacher', 'room', 'weekday', 'period', 'weeks']))
    .describe('你识别得不够确定的字段名，没有就填空数组'),
  sourceText: z
    .string()
    .nullable()
    .describe('这条安排在图片中对应的原始文字，用于用户核对；无法给出填 null'),
})
export type TimetableEntry = z.infer<typeof TimetableEntrySchema>

/** 模型的结构化输出。 */
export const TimetableExtractionSchema = z.object({
  entries: z.array(TimetableEntrySchema),
})
export type TimetableExtraction = z.infer<typeof TimetableExtractionSchema>

export const OcrRequestSchema = z.object({
  /** 不含 data URI 前缀的 base64 图片数据。 */
  imageBase64: z.string().min(1),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** 当前作息表的节次总数，帮助模型判断节次编号范围。 */
  periodCount: z.number().int().min(1).max(16),
})
export type OcrRequest = z.infer<typeof OcrRequestSchema>

export const OcrResponseSchema = z.object({
  mode: RuntimeModeSchema,
  execution: AiExecutionMetaSchema,
  entries: z.array(TimetableEntrySchema),
})
export type OcrResponse = z.infer<typeof OcrResponseSchema>

/* ---------------- 通知解析 ---------------- */

export const NoticeItemKindSchema = z.enum(['cancel', 'room', 'move', 'makeup', 'unknown'])
export type NoticeItemKind = z.infer<typeof NoticeItemKindSchema>

/**
 * 模型从通知里提取的一项候选变更。
 *
 * 模型只负责理解文本：给出课程称呼、日期表达和它的初步解析。
 * 课程匹配、日期校验、冲突检查和写入全部由前端的确定性代码完成。
 */
export const NoticeCandidateSchema = z.object({
  kind: NoticeItemKindSchema.describe(
    'cancel=停课，room=换教室，move=改期，makeup=补课，unknown=无法判断',
  ),
  courseHint: z
    .string()
    .nullable()
    .describe('通知里提到的课程称呼，原样保留，例如 "高数"；没提到填 null'),
  originalDateText: z
    .string()
    .nullable()
    .describe('通知里描述原上课日期的原文，例如 "本周四"；没提到填 null'),
  originalDate: z
    .string()
    .nullable()
    .describe('你对原日期的初步解析，YYYY-MM-DD；不确定填 null。前端会重新校验'),
  originalPeriodStart: z.number().int().min(1).max(30).nullable(),
  originalPeriodEnd: z.number().int().min(1).max(30).nullable(),
  targetDateText: z
    .string()
    .nullable()
    .describe('通知里描述目标日期的原文，例如 "下周二"；没提到填 null'),
  targetDate: z.string().nullable().describe('你对目标日期的初步解析，YYYY-MM-DD；不确定填 null'),
  targetPeriodStart: z.number().int().min(1).max(30).nullable(),
  targetPeriodEnd: z.number().int().min(1).max(30).nullable(),
  room: z.string().nullable().describe('通知里提到的新教室；没提到填 null'),
  sourceText: z.string().describe('这项变更对应的通知原文片段，必须是原文中出现过的内容'),
  notes: z
    .string()
    .nullable()
    .describe('通知里自相矛盾或含糊的地方，用一句中文说明；没有填 null'),
})
export type NoticeCandidate = z.infer<typeof NoticeCandidateSchema>

export const NoticeExtractionSchema = z.object({
  items: z.array(NoticeCandidateSchema),
})
export type NoticeExtraction = z.infer<typeof NoticeExtractionSchema>

/** 发给服务端的课表上下文，只取匹配所需的最小信息。 */
export const NoticeCourseContextSchema = z.object({
  name: z.string(),
  teacher: z.string().nullable(),
})
export type NoticeCourseContext = z.infer<typeof NoticeCourseContextSchema>

export const NoticeRequestSchema = z.object({
  text: z.string().min(1),
  /** 通知发布日期，相对日期以它为基准。 */
  noticeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 课程名清单，用于帮助模型对齐简称。不包含上课安排、教室和历史数据。 */
  courses: z.array(NoticeCourseContextSchema).max(80),
  periodCount: z.number().int().min(1).max(16),
})
export type NoticeRequest = z.infer<typeof NoticeRequestSchema>

export const NoticeResponseSchema = z.object({
  mode: RuntimeModeSchema,
  execution: AiExecutionMetaSchema,
  items: z.array(NoticeCandidateSchema),
})
export type NoticeResponse = z.infer<typeof NoticeResponseSchema>
