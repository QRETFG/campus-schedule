import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import type { AiExecutionMeta, ApiErrorCode, HealthResponse, OcrResponse, NoticeResponse, RuntimeMode } from '../src/shared/contract'
import { ClientAiConfigSchema, NoticeRequestSchema, OcrRequestSchema } from '../src/shared/contract'
import { AI_CONFIG_HEADERS } from '../src/shared/aiHeaders'
import {
  acceptedMediaTypes,
  config,
  fromClientAiConfig,
  providerLabel,
  resolveMode,
  resolveServerAiConfig,
} from './config'
import type { RuntimeAiConfig } from './config'
import { DEMO_TIMETABLE, demoNotice } from './demo'
import { UpstreamError, extractNotice, extractTimetable } from './extract'
import { describeError, logEvent } from './log'
import { ConcurrencyGate, clientKey, takeToken } from './rateLimit'

export function createApp() {
  const app = express()
  app.set('trust proxy', true)
  // base64 会把 10 MB 图片撑到约 13.4 MB，留出余量后仍有硬上限。
  app.use(express.json({ limit: Math.ceil((config.maxImageBytes * 4) / 3) + 256 * 1024 }))

  const gate = new ConcurrencyGate(config.maxConcurrentUpstream)

  const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
    unconfigured: 503,
    'too-large': 413,
    'unsupported-format': 415,
    'invalid-request': 400,
    'rate-limited': 429,
    'upstream-unavailable': 502,
    'upstream-timeout': 504,
    'upstream-invalid': 502,
    'empty-result': 422,
    cancelled: 499,
    internal: 500,
  }

  function fail(res: Response, code: ApiErrorCode, message: string): void {
    if (res.headersSent) return
    res.status(STATUS_BY_CODE[code]).json({ error: { code, message } })
  }

  /** 前端据此决定走真实识别、演示模式，还是提示未配置。 */
  app.get('/api/health', (_req, res) => {
    const mode = resolveMode()
    const ai = resolveServerAiConfig()
    const body: HealthResponse = {
      mode,
      model: mode === 'live' ? config.model : null,
      provider: mode === 'demo' ? '演示模式（固定样例）' : ai ? providerLabel(ai.format) : '未配置',
      apiFormat: mode === 'live' && ai ? ai.format : null,
      supportedClientFormats: ['openai-responses', 'openai-chat-completions'],
      limits: {
        maxImageBytes: config.maxImageBytes,
        acceptedMediaTypes: [...acceptedMediaTypes],
        maxNoticeChars: config.maxNoticeChars,
        requestsPerMinute: config.requestsPerMinute,
      },
    }
    res.json(body)
  })

  /**
   * 前端自定义配置只在当前请求中使用。四个 header 必须同时存在，API Key
   * 不会写入日志、课表数据、备份或服务端存储。
   */
  function requestAiConfig(req: Request): { ok: true; value?: RuntimeAiConfig } | { ok: false } {
    const raw = {
      format: req.get(AI_CONFIG_HEADERS.format),
      baseUrl: req.get(AI_CONFIG_HEADERS.baseUrl),
      apiKey: req.get(AI_CONFIG_HEADERS.apiKey),
      model: req.get(AI_CONFIG_HEADERS.model),
    }
    if (!Object.values(raw).some((value) => value !== undefined)) return { ok: true }
    const parsed = ClientAiConfigSchema.safeParse(raw)
    if (!parsed.success) return { ok: false }
    return { ok: true, value: fromClientAiConfig(parsed.data) }
  }

  function executionMeta(mode: RuntimeMode, custom: boolean, ai?: RuntimeAiConfig): AiExecutionMeta {
    if (mode === 'demo') return { source: 'demo', apiFormat: null, model: null }
    return {
      source: custom ? 'client' : 'server',
      apiFormat: ai?.format ?? null,
      model: ai?.model ?? null,
    }
  }

  /**
   * 把请求中止传播到上游：客户端断开或取消时 abort，
   * 同时保证迟到的上游结果不会再写回响应。
   */
  function requestSignal(req: Request, res: Response): AbortSignal {
    const controller = new AbortController()
    req.on('aborted', () => controller.abort())
    // IncomingMessage 的 close 在请求体正常读完后也可能触发，不能据此取消上游。
    // 只有响应连接在写完前关闭，才说明浏览器真的离开或主动取消。
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    return controller.signal
  }

  /** 频率限制对所有模式生效，保护端点本身。 */
  function rateGuard(req: Request, res: Response): boolean {
    const decision = takeToken(clientKey(req), config.requestsPerMinute)
    if (decision.allowed) return true
    res.setHeader('Retry-After', String(decision.retryAfterSeconds))
    fail(res, 'rate-limited', `请求过于频繁，请 ${decision.retryAfterSeconds} 秒后再试。`)
    return false
  }

  /** 并发闸门只约束真正会打到上游的调用。 */
  function upstreamGuard(res: Response): boolean {
    if (gate.tryAcquire()) return true
    res.setHeader('Retry-After', '5')
    fail(res, 'rate-limited', '识别服务正忙，请稍后再试。')
    return false
  }

  app.post('/api/ocr/timetable', async (req, res) => {
    const startedAt = Date.now()

    if (!rateGuard(req, res)) return

    const parsed = OcrRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      fail(res, 'invalid-request', '请求参数不正确。')
      return
    }
    const { imageBase64, mediaType, periodCount } = parsed.data

    // base64 长度反推原始字节数，避免只信任前端的大小校验。
    const approxBytes = Math.floor((imageBase64.length * 3) / 4)
    if (approxBytes > config.maxImageBytes) {
      fail(res, 'too-large', `图片超过 ${Math.round(config.maxImageBytes / 1024 / 1024)} MB 上限。`)
      return
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
      fail(res, 'invalid-request', '图片数据格式不正确。')
      return
    }
    if (!isMagicMatching(imageBase64, mediaType)) {
      fail(res, 'unsupported-format', '图片内容与声明的格式不一致，请重新选择。')
      return
    }

    const customAi = requestAiConfig(req)
    if (!customAi.ok) {
      fail(res, 'invalid-request', '自定义模型配置不完整，请检查接口格式、URL、API Key 和模型 ID。')
      return
    }
    const mode = customAi.value ? 'live' : resolveMode()
    const ai = customAi.value ?? resolveServerAiConfig()

    if (mode === 'demo') {
      const body: OcrResponse = { mode, execution: executionMeta(mode, false), entries: DEMO_TIMETABLE }
      logEvent('ocr.demo', { entries: body.entries.length, ms: Date.now() - startedAt })
      res.json(body)
      return
    }

    if (mode === 'unconfigured' || !ai) {
      fail(res, 'unconfigured', '识别服务未配置，请在设置页填写自定义模型配置，或在服务端设置凭证。')
      return
    }

    if (!upstreamGuard(res)) return
    try {
      const entries = await extractTimetable(imageBase64, mediaType, periodCount, {
        signal: requestSignal(req, res),
        ai,
      })
      if (!entries.length) {
        fail(res, 'empty-result', '截图里没有找到课程。')
        return
      }
      const body: OcrResponse = { mode, execution: executionMeta(mode, Boolean(customAi.value), ai), entries }
      // 只记录条目数与耗时，不记录原图或识别内容。
      logEvent('ocr.ok', { entries: entries.length, ms: Date.now() - startedAt })
      if (!res.headersSent) res.json(body)
    } catch (error) {
      const upstream = error instanceof UpstreamError ? error : new UpstreamError('internal', '识别失败')
      logEvent('ocr.fail', { code: upstream.code, ms: Date.now() - startedAt, ...describeError(error) })
      if (upstream.code === 'cancelled') {
        // 客户端已经走了，不必再写响应。
        if (!res.headersSent) res.status(499).end()
        return
      }
      fail(res, upstream.code, upstream.message)
    } finally {
      gate.release()
    }
  })

  app.post('/api/notice/parse', async (req, res) => {
    const startedAt = Date.now()

    if (!rateGuard(req, res)) return

    const parsed = NoticeRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      fail(res, 'invalid-request', '请求参数不正确。')
      return
    }
    if (parsed.data.text.length > config.maxNoticeChars) {
      fail(res, 'too-large', `通知文本超过 ${config.maxNoticeChars} 字上限，请只粘贴与课表有关的部分。`)
      return
    }

    const customAi = requestAiConfig(req)
    if (!customAi.ok) {
      fail(res, 'invalid-request', '自定义模型配置不完整，请检查接口格式、URL、API Key 和模型 ID。')
      return
    }
    const mode = customAi.value ? 'live' : resolveMode()
    const ai = customAi.value ?? resolveServerAiConfig()

    if (mode === 'demo') {
      const items = demoNotice(parsed.data.text)
      logEvent('notice.demo', { items: items.length, ms: Date.now() - startedAt })
      const body: NoticeResponse = { mode, execution: executionMeta(mode, false), items }
      res.json(body)
      return
    }

    if (mode === 'unconfigured' || !ai) {
      fail(res, 'unconfigured', '解析服务未配置，请在设置页填写自定义模型配置，或在服务端设置凭证。')
      return
    }

    if (!upstreamGuard(res)) return
    try {
      const items = await extractNotice(parsed.data, { signal: requestSignal(req, res), ai })
      const body: NoticeResponse = { mode, execution: executionMeta(mode, Boolean(customAi.value), ai), items }
      logEvent('notice.ok', { items: items.length, ms: Date.now() - startedAt })
      if (!res.headersSent) res.json(body)
    } catch (error) {
      const upstream = error instanceof UpstreamError ? error : new UpstreamError('internal', '解析失败')
      logEvent('notice.fail', { code: upstream.code, ms: Date.now() - startedAt, ...describeError(error) })
      if (upstream.code === 'cancelled') {
        if (!res.headersSent) res.status(499).end()
        return
      }
      fail(res, upstream.code, upstream.message)
    } finally {
      gate.release()
    }
  })

  // 生产模式下一并托管前端构建产物。
  const staticDir = path.resolve(process.cwd(), config.staticDir)
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir))
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  /**
   * 兜底错误处理：body-parser 在请求体过大或不是合法 JSON 时会抛错，
   * 默认返回 HTML 错误页，前端就拿不到具体原因了，这里统一转成结构化错误。
   */
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error)
      return
    }
    const type = (error as { type?: string } | undefined)?.type
    if (type === 'entity.too.large') {
      logEvent('request.too-large')
      fail(res, 'too-large', `请求体超过上限，图片不能超过 ${Math.round(config.maxImageBytes / 1024 / 1024)} MB。`)
      return
    }
    if (type === 'entity.parse.failed' || type === 'encoding.unsupported') {
      fail(res, 'invalid-request', '请求内容不是有效的 JSON。')
      return
    }
    logEvent('request.error', describeError(error))
    fail(res, 'internal', '服务端出现未预期的问题。')
  })

  return app
}

/** 校验 base64 前缀的文件魔数，防止改扩展名绕过格式限制。 */
export function isMagicMatching(imageBase64: string, mediaType: string): boolean {
  const head = Buffer.from(imageBase64.slice(0, 64), 'base64')
  if (head.length < 12) return false
  if (mediaType === 'image/png') {
    return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  }
  if (mediaType === 'image/jpeg') {
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  }
  if (mediaType === 'image/webp') {
    return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}

const isEntrypoint = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`
if (isEntrypoint) {
  const app = createApp()
  app.listen(config.port, () => {
    logEvent('server.start', {
      port: config.port,
      mode: resolveMode(),
      apiFormat: resolveMode() === 'live' ? config.apiFormat : null,
      model: resolveMode() === 'live' ? config.model : null,
    })
  })
}
