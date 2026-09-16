import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banner, Button, Card, PageTitle, useUnsavedGuard } from '../components/ui'
import ServiceModeBanner from '../components/ServiceModeBanner'
import { useAppStore } from '../store/AppStore'
import { useDraft } from '../store/DraftStore'
import { isServiceUsable, useServiceStatus } from '../store/ServiceStatus'
import { useAiConfig } from '../store/AiConfig'
import { entriesToDraft } from '../core/draft'
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  OcrError,
  RECOGNIZE_TIMEOUT_MINUTES,
  describeOcrError,
  recognizeWithTimeout,
  setPeriodCount,
} from '../ocr'
import type { OcrErrorCode } from '../ocr'

type Status = 'idle' | 'running' | 'failed'

export default function ImportPage() {
  const { data } = useAppStore()
  const draft = useDraft()
  const navigate = useNavigate()
  const service = useServiceStatus()
  const ai = useAiConfig()
  const serviceUsable = isServiceUsable(service)
  const serviceName = ai.preferences.source === 'custom'
    ? ai.preferences.format === 'openai-responses'
      ? 'OpenAI Responses API'
      : 'OpenAI Chat Completions API'
    : service.status?.mode === 'demo'
      ? '演示样例'
      : service.status?.provider ?? '课表识别服务'

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | undefined>()
  const [pickError, setPickError] = useState<string | undefined>()
  const [status, setStatus] = useState<Status>('idle')
  const [failure, setFailure] = useState<OcrErrorCode | undefined>()
  const [dragOver, setDragOver] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 识别期间离开页面会中断任务；首版不提供后台任务或跨页面恢复（§5.2）。
  useUnsavedGuard(status === 'running')

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const pick = (chosen: File | undefined) => {
    setFailure(undefined)
    if (!chosen) return
    if (!ACCEPTED_TYPES.includes(chosen.type)) {
      setPickError('只支持 JPG、PNG、WebP 格式的图片，请重新选择。')
      return
    }
    if (chosen.size > MAX_UPLOAD_BYTES) {
      const mb = (chosen.size / 1024 / 1024).toFixed(1)
      setPickError(`图片大小 ${mb} MB，超过 10 MB 上限，请重新选择或压缩后上传。`)
      return
    }
    setPickError(undefined)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(chosen)
    setPreviewUrl(URL.createObjectURL(chosen))
  }

  const removeFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(undefined)
    setFailure(undefined)
    if (inputRef.current) inputRef.current.value = ''
  }

  const start = async () => {
    if (!file || status === 'running') return
    // 让服务端知道节次编号范围，避免模型给出超出作息表的节次。
    setPeriodCount(data!.periods.length)
    setStatus('running')
    setFailure(undefined)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const result = await recognizeWithTimeout(file, controller.signal)
      const entries = entriesToDraft(result.entries, data!.semester.totalWeeks)
      // 原图仅用于本次核对，交给核对页展示后即随会话结束（§7）。
      draft.start({ entries, previewUrl, fileName: file.name, mode: result.mode })
      setPreviewUrl(undefined) // 所有权移交草稿会话，避免在此处释放
      setStatus('idle')
      navigate('/review')
    } catch (error) {
      setStatus('failed')
      setFailure(error instanceof OcrError ? error.code : 'network')
    } finally {
      abortRef.current = null
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setStatus('idle')
  }

  const failureInfo = failure ? describeOcrError(failure) : undefined

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle hint="上传教务系统的周课表截图，识别结果需要你核对后才会写入课表。">导入课表</PageTitle>

      <div className="mb-4">
        <ServiceModeBanner feature="识别" />
      </div>

      <Card className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        {!file ? (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              pick(e.dataTransfer.files?.[0])
            }}
            className={`rounded-xl border-2 border-dashed px-5 py-10 text-center transition-colors ${
              dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'
            }`}
          >
            <p className="text-sm font-medium text-slate-800">选择一张周课表截图</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-slate-600">
              请上传清晰、完整、能看清星期和节次的截图。建议先裁掉姓名、学号等无关信息。
            </p>
            <div className="mt-4">
              <Button onClick={() => inputRef.current?.click()}>选择图片</Button>
            </div>
            <p className="mt-3 hidden text-xs text-slate-500 sm:block">也可以把图片拖到这里</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {previewUrl ? (
                <img src={previewUrl} alt="待识别的课表截图预览" className="mx-auto max-h-80 w-auto" />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-xs text-slate-600">
                {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
              <Button
                variant="secondary"
                className="min-h-9 text-xs"
                onClick={removeFile}
                disabled={status === 'running'}
              >
                重新选择
              </Button>
            </div>
          </div>
        )}

        {pickError ? <Banner tone="error">{pickError}</Banner> : null}

        {status === 'running' ? (
          <Banner
            tone="info"
            title="正在识别，请不要离开本页"
            action={
              <Button variant="secondary" className="min-h-9 shrink-0 text-xs" onClick={cancel}>
                取消
              </Button>
            }
          >
            正在把截图发送到应用服务端，由它调用「{serviceName}」处理。识别期间离开或关闭页面会中断任务，
            首版不支持后台继续。最长等待 {RECOGNIZE_TIMEOUT_MINUTES} 分钟；取消后服务端会一并中止上游调用。
          </Banner>
        ) : null}

        {failureInfo ? (
          <Banner tone="error" title={failureInfo.title}>
            <p>{failureInfo.hint}</p>
            <p className="mt-1 text-xs opacity-90">已有课表没有任何改动。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-9 text-xs" onClick={start} disabled={!file}>
                重试
              </Button>
              <Button variant="ghost" className="min-h-9 text-xs" onClick={() => navigate('/courses/new')}>
                手动添加课程
              </Button>
            </div>
          </Banner>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button onClick={start} disabled={!file || status === 'running' || !serviceUsable}>
            {status === 'running' ? '识别中…' : '开始识别'}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/courses/new')} disabled={status === 'running'}>
            手动添加课程
          </Button>
        </div>
      </Card>

      <div className="mt-4 space-y-3">
        <Banner tone="info" title="关于图片处理">
          <ul className="mt-1 space-y-1 text-xs leading-relaxed">
            <li>· 点击「开始识别」后，图片会先发到应用自己的服务端，再由服务端转给识别服务处理，不会公开你的课表。</li>
            <li>
              · {ai.preferences.source === 'custom'
                ? '自定义 API Key 只保存在当前标签页会话中，请求时经应用服务端转发；服务端不会持久化。'
                : '默认服务的识别凭证只保存在服务端，不会下发到浏览器。'}
              服务端不落盘原图，也不在日志里记录图片或课表内容。
            </li>
            <li>· 建议先裁掉姓名、学号等与课表无关的信息。</li>
            <li>· 原图只用于本次核对，不会写入课表，也不包含在备份文件中。</li>
          </ul>
        </Banner>
        <p className="text-xs leading-relaxed text-slate-500">
          首版优先支持「星期为列、节次为行、课程内容以文本呈现」的周课表截图。PDF、Excel、手写课表和复杂版式暂不在支持范围内，遇到这些情况请手动添加课程。
        </p>
      </div>
    </div>
  )
}
