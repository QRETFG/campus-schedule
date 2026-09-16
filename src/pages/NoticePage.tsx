import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AppliedBatch, Course, DateStr, RecurringSlot } from '../types'
import { Banner, Button, Card, ConfirmDialog, PageTitle, inputClass, useUnsavedGuard } from '../components/ui'
import ServiceModeBanner from '../components/ServiceModeBanner'
import { useAppStore, useClock } from '../store/AppStore'
import { isServiceUsable, useServiceStatus } from '../store/ServiceStatus'
import type { NoticeDraftItem, NoticeDraftKind, NoticeDraftView } from '../core/notice'
import {
  KIND_LABEL,
  applyNoticeBatch,
  buildNoticeViews,
  candidatesToDrafts,
  slotsOnDate,
  summarizeBatch,
  undoNoticeBatch,
} from '../core/notice'
import { OcrError, describeOcrError, parseNotice } from '../ocr'
import type { OcrErrorCode } from '../ocr'
import { fullDateLabel, isValidDate, weekdayLabel } from '../core/datetime'
import { slotLabel } from '../core/resolve'

type Stage = 'input' | 'review' | 'done'

const KINDS: NoticeDraftKind[] = ['cancel', 'room', 'move', 'makeup']

export default function NoticePage() {
  const { data, commit } = useAppStore()
  const { today } = useClock()
  const navigate = useNavigate()
  const service = useServiceStatus()
  const serviceUsable = isServiceUsable(service)

  const [stage, setStage] = useState<Stage>('input')
  const [text, setText] = useState('')
  const [noticeDate, setNoticeDate] = useState<DateStr>(today)
  const [parsing, setParsing] = useState(false)
  const [failure, setFailure] = useState<OcrErrorCode | undefined>()
  const [items, setItems] = useState<NoticeDraftItem[]>([])
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<AppliedBatch | undefined>()
  const [undoReport, setUndoReport] = useState<{ undone: number; skipped: string[] } | undefined>()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const views = useMemo(
    () => (stage === 'review' ? buildNoticeViews(items, data!) : []),
    [stage, items, data],
  )
  const included = views.filter((v) => !v.item.excluded)
  const blockingCount = included.reduce(
    (sum, view) => sum + view.issues.filter((i) => i.severity === 'required').length,
    0,
  )
  const warningCount = included.reduce(
    (sum, view) => sum + view.issues.filter((i) => i.severity === 'warning').length,
    0,
  )

  useUnsavedGuard(stage === 'review' && included.length > 0)

  const parse = async () => {
    if (!text.trim() || parsing) return
    setParsing(true)
    setFailure(undefined)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await parseNotice(
        {
          text: text.trim(),
          noticeDate,
          // 只上传课程名与教师，帮助模型对齐简称；不上传上课安排、教室和历史数据。
          courses: data!.courses.map((c) => ({ name: c.name, teacher: c.teacher ?? null })),
          periodCount: data!.periods.length,
        },
        controller.signal,
      )
      const drafts = candidatesToDrafts(response.items, data!, noticeDate)
      setItems(drafts)
      setStage('review')
    } catch (error) {
      setFailure(error instanceof OcrError ? error.code : 'network')
    } finally {
      setParsing(false)
      abortRef.current = null
    }
  }

  const patch = (id: string, changes: Partial<NoticeDraftItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  }

  const apply = () => {
    if (applying) return
    setApplying(true)
    // 基于当前课表重新校验，草稿过期或有必填问题时整批不写入。
    const outcome = applyNoticeBatch(data!, items)
    if (!outcome.ok || !outcome.data || !outcome.batch) {
      setApplying(false)
      return
    }
    if (commit(outcome.data)) {
      setApplied(outcome.batch)
      setItems([])
      setStage('done')
    }
    setApplying(false)
  }

  const undo = () => {
    const batch = applied ?? data!.lastBatch
    if (!batch) return
    const outcome = undoNoticeBatch(data!, batch)
    if (commit(outcome.data)) {
      setUndoReport({ undone: outcome.undone, skipped: outcome.skipped.map((s) => s.reason) })
      setApplied(undefined)
    }
  }

  const failureInfo = failure ? describeOcrError(failure) : undefined
  const pendingBatch = data!.lastBatch

  /* ---------------- 应用结果 ---------------- */
  if (stage === 'done') {
    const batch = applied ?? pendingBatch
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>调课已应用</PageTitle>

        {undoReport ? (
          <div className="space-y-3">
            <Banner tone={undoReport.undone ? 'success' : 'warning'} title={`已撤销 ${undoReport.undone} 项`}>
              {undoReport.skipped.length ? (
                <>
                  <p>以下记录在应用之后被改动过，已按你的修改保留，没有被覆盖：</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {undoReport.skipped.map((reason, i) => (
                      <li key={i}>· {reason}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>课表已恢复到应用这批变更之前的状态。</p>
              )}
            </Banner>
            <div className="flex gap-2">
              <Button onClick={() => navigate('/')}>查看课表</Button>
              <Button variant="secondary" onClick={() => resetAll()}>
                再导入一条通知
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Banner tone="success" title={`已写入 ${batch?.entries.length ?? 0} 项变更`}>
              <ul className="mt-1 space-y-0.5 text-xs">
                {batch ? summarizeBatch(batch, data!).map((line, i) => <li key={i}>· {line}</li>) : null}
              </ul>
            </Banner>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate('/')}>查看课表</Button>
              <Button variant="secondary" onClick={undo} disabled={!batch}>
                撤销这批变更
              </Button>
              <Button variant="ghost" onClick={() => resetAll()}>
                再导入一条通知
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              撤销只针对这一批变更。如果你之后又手动改过其中某条，撤销会跳过它并明确告诉你，不会覆盖你的修改。
            </p>
          </div>
        )}
      </div>
    )
  }

  function resetAll() {
    setStage('input')
    setText('')
    setItems([])
    setApplied(undefined)
    setUndoReport(undefined)
    setFailure(undefined)
  }

  /* ---------------- 核对草稿 ---------------- */
  if (stage === 'review') {
    return (
      <div className="mx-auto max-w-3xl">
        <PageTitle hint="下面是从通知里解析出的变更草稿。确认无误后才会写入课表。">
          核对调课草稿
        </PageTitle>

        <div className="space-y-3">
          <ServiceModeBanner feature="解析" />

          {!items.length ? (
            <Banner tone="warning" title="没有从这条通知里解析出课表变更">
              可能是通知里没有明确的停课、调课或补课信息。你可以修改文字后重试，或直接手动调整课程。
            </Banner>
          ) : blockingCount ? (
            <Banner tone="error" title={`还有 ${blockingCount} 处需要你补充或选择`}>
              课程匹配、日期和节次必须确定后才能应用。取消某一项也可以跳过它。
            </Banner>
          ) : (
            <Banner tone="success" title="所有必填项都已确定">
              应用前请再核对一遍每一项的原安排和变更后的时间。
            </Banner>
          )}
          {warningCount ? (
            <Banner tone="warning" title={`${warningCount} 处需要确认`}>
              推算出的日期和时间冲突都属于提示，确认无误后仍然可以应用。
            </Banner>
          ) : null}

          <ul className="space-y-3">
            {views.map((view) => (
              <li key={view.item.id}>
                <NoticeItemCard
                  view={view}
                  periods={data!.periods.map((p) => p.period)}
                  courseOptions={data!.courses}
                  onChange={(changes) => patch(view.item.id, changes)}
                  slotOptionsFor={(courseId, date) =>
                    courseId && date ? slotsOnDate(data!, courseId, date) : []
                  }
                />
              </li>
            ))}
          </ul>

          <div className="sticky bottom-16 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-slate-800">将应用 {included.length} 项变更</p>
              <p className="text-xs text-slate-600">
                {blockingCount ? `${blockingCount} 处待补充` : '可以应用'}
                {warningCount ? ` · ${warningCount} 处待确认` : ''}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setConfirmDiscard(true)}>
              放弃
            </Button>
            <Button onClick={apply} disabled={applying || blockingCount > 0 || !included.length}>
              {applying ? '应用中…' : '全部应用'}
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            这批变更会一次性写入：任何一项失败都不会留下半份数据。应用后可以撤销。
          </p>
        </div>

        <ConfirmDialog
          open={confirmDiscard}
          title="放弃这批调课草稿？"
          confirmLabel="放弃"
          danger
          onConfirm={() => {
            setConfirmDiscard(false)
            resetAll()
          }}
          onCancel={() => setConfirmDiscard(false)}
        >
          <p>草稿不会保存，已有课表不受影响。</p>
        </ConfirmDialog>
      </div>
    )
  }

  /* ---------------- 输入 ---------------- */
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle hint="把班级群里的调课通知粘贴进来，解析成可确认的调课草稿。确认前不会改动课表。">
        导入调课通知
      </PageTitle>

      <div className="mb-4">
        <ServiceModeBanner feature="解析" />
      </div>

      {pendingBatch && !applied ? (
        <div className="mb-4">
          <Banner
            tone="info"
            title="上一批通知变更还可以撤销"
            action={
              <Button variant="secondary" className="min-h-9 shrink-0 text-xs" onClick={() => setStage('done')}>
                查看
              </Button>
            }
          >
            最近应用了 {pendingBatch.entries.length} 项变更。
          </Banner>
        </div>
      ) : null}

      <Card className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-800">
            通知发布日期 <span className="text-rose-600">*</span>
          </span>
          <input
            type="date"
            value={noticeDate}
            onChange={(e) => setNoticeDate(e.target.value)}
            className={`${inputClass} max-w-52`}
          />
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">
            通知里的「本周四」「下周二」这类相对日期，都按这一天所在的周来计算。如果是补发的旧通知，请改成它实际发布的日期。
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-800">
            通知原文 <span className="text-rose-600">*</span>
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={service.status?.limits.maxNoticeChars ?? 4000}
            className={`${inputClass} min-h-32 resize-y py-2 leading-relaxed`}
            placeholder="例如：本周四高数停课，补到下周二第 5-6 节，教室改为 B203。"
          />
          <span className="mt-1 block text-xs text-slate-500">
            {text.length} / {service.status?.limits.maxNoticeChars ?? 4000} 字。只粘贴与课表有关的部分即可。
          </span>
        </label>

        {failureInfo ? (
          <Banner tone="error" title={failureInfo.title}>
            <p>{failureInfo.hint}</p>
            <p className="mt-1 text-xs opacity-90">已有课表没有任何改动。</p>
          </Banner>
        ) : null}

        {!isValidDate(noticeDate) ? <Banner tone="error">请选择有效的通知发布日期。</Banner> : null}

        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button onClick={parse} disabled={!text.trim() || parsing || !serviceUsable || !isValidDate(noticeDate)}>
            {parsing ? '解析中…' : '解析通知'}
          </Button>
          <Link to="/courses">
            <Button variant="secondary">手动调整课程</Button>
          </Link>
        </div>
      </Card>

      <div className="mt-4 space-y-2 text-xs leading-relaxed text-slate-500">
        <p>· 支持停课、换教室、改期和补课，一条通知包含多项变更也可以。</p>
        <p>· 解析结果只是草稿，课程匹配、日期和冲突都由本机的课表规则重新核对，确认后才写入。</p>
        <p>· 法定节假日调休不会被自动当成课表调整，需要通知里写明。</p>
        <p>· 发给解析服务的只有通知原文和课程名清单，不包含你的完整课表。</p>
      </div>
    </div>
  )
}

/* ---------------- 单项草稿 ---------------- */

function NoticeItemCard({
  view,
  periods,
  courseOptions,
  onChange,
  slotOptionsFor,
}: {
  view: NoticeDraftView
  periods: number[]
  courseOptions: Course[]
  onChange: (changes: Partial<NoticeDraftItem>) => void
  slotOptionsFor: (courseId?: string, date?: DateStr) => RecurringSlot[]
}) {
  const { item, courseCandidates, issues, preview } = view
  const excluded = item.excluded
  const required = issues.filter((i) => i.severity === 'required')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const slotOptions = slotOptionsFor(item.courseId, item.originalDate)

  const errorOf = (field: string) => required.find((i) => i.field === field)?.message
  const needsOriginal = item.kind === 'cancel' || item.kind === 'room' || item.kind === 'move'
  const needsTarget = item.kind === 'move' || item.kind === 'makeup'

  return (
    <Card
      className={
        excluded
          ? 'border-dashed bg-slate-50 opacity-70'
          : required.length
            ? 'border-rose-300'
            : warnings.length
              ? 'border-amber-300'
              : ''
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {KIND_LABEL[item.kind]}
        </span>
        <Button
          variant="ghost"
          className="min-h-9 text-xs"
          onClick={() => onChange({ excluded: !excluded })}
        >
          {excluded ? '重新加入' : '取消这一项'}
        </Button>
      </div>

      <p className="mb-3 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-600">
        <span className="mr-1 font-semibold text-slate-700">通知原文</span>
        {item.sourceText}
      </p>

      {item.notes ? (
        <p className="mb-3 text-xs text-amber-800">
          <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold">需留意</span>
          {item.notes}
        </p>
      ) : null}

      {/* 变更前后对照 */}
      <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 p-2.5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-slate-500">原安排</p>
          {preview.before ? (
            <p className="mt-0.5 text-sm text-slate-800">
              {fullDateLabel(preview.before.date)}
              <br />第 {preview.before.week} 教学周 · {preview.before.periods} · {preview.before.room}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-slate-400">{needsOriginal ? '待确定' : '（补课没有原安排）'}</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">变更后</p>
          {item.kind === 'cancel' ? (
            <p className="mt-0.5 text-sm font-medium text-rose-700">这次不上课</p>
          ) : preview.after ? (
            <p className="mt-0.5 text-sm text-slate-800">
              {fullDateLabel(preview.after.date)}
              <br />第 {preview.after.week} 教学周 · {preview.after.periods} · {preview.after.room}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-slate-400">待确定</p>
          )}
        </div>
      </div>

      {!excluded ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">变更类型</span>
            <select
              value={item.kind === 'unknown' ? '' : item.kind}
              onChange={(e) => onChange({ kind: (e.target.value || 'unknown') as NoticeDraftKind })}
              className={inputClass}
            >
              <option value="">请选择</option>
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </select>
            {errorOf('kind') ? <FieldError message={errorOf('kind')!} /> : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              课程{item.courseHint ? `（通知里写的是「${item.courseHint}」）` : ''}
            </span>
            <select
              value={item.courseId ?? ''}
              onChange={(e) => onChange({ courseId: e.target.value || undefined, slotId: undefined })}
              className={inputClass}
            >
              <option value="">请选择课程</option>
              {courseCandidates.length ? (
                <optgroup label="可能匹配">
                  {courseCandidates.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                      {course.teacher ? ` · ${course.teacher}` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="全部课程">
                {courseOptions.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                    {course.teacher ? ` · ${course.teacher}` : ''}
                  </option>
                ))}
              </optgroup>
            </select>
            {errorOf('course') ? <FieldError message={errorOf('course')!} /> : null}
          </label>

          {needsOriginal ? (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">
                  原上课日期{item.originalDateText ? `（原文：${item.originalDateText}）` : ''}
                </span>
                <input
                  type="date"
                  value={item.originalDate ?? ''}
                  onChange={(e) => onChange({ originalDate: e.target.value || undefined, slotId: undefined })}
                  className={inputClass}
                />
                {item.originalDateBasis ? (
                  <span className="mt-1 block text-xs text-slate-500">{item.originalDateBasis}</span>
                ) : null}
                {errorOf('originalDate') ? <FieldError message={errorOf('originalDate')!} /> : null}
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">这一天的哪节课</span>
                <select
                  value={item.slotId ?? ''}
                  onChange={(e) => onChange({ slotId: e.target.value || undefined })}
                  className={inputClass}
                  disabled={!slotOptions.length}
                >
                  <option value="">{slotOptions.length ? '请选择' : '这一天没有可选的课'}</option>
                  {slotOptions.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {weekdayLabel(slot.weekday)} {slotLabel(slot)} · {slot.room || '教室待补充'}
                    </option>
                  ))}
                </select>
                {errorOf('slot') ? <FieldError message={errorOf('slot')!} /> : null}
              </label>
            </>
          ) : null}

          {needsTarget ? (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">
                  变更后日期{item.targetDateText ? `（原文：${item.targetDateText}）` : ''}
                </span>
                <input
                  type="date"
                  value={item.targetDate ?? ''}
                  onChange={(e) => onChange({ targetDate: e.target.value || undefined })}
                  className={inputClass}
                />
                {item.targetDateBasis ? (
                  <span className="mt-1 block text-xs text-slate-500">{item.targetDateBasis}</span>
                ) : null}
                {errorOf('targetDate') ? <FieldError message={errorOf('targetDate')!} /> : null}
              </label>

              <div>
                <span className="mb-1 block text-xs font-medium text-slate-700">变更后节次</span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={item.targetStartPeriod ?? ''}
                    aria-label="变更后起始节次"
                    onChange={(e) => onChange({ targetStartPeriod: Number(e.target.value) || undefined })}
                    className={`${inputClass} w-auto`}
                  >
                    <option value="">起</option>
                    {periods.map((p) => (
                      <option key={p} value={p}>
                        第 {p} 节
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-slate-500">至</span>
                  <select
                    value={item.targetEndPeriod ?? ''}
                    aria-label="变更后结束节次"
                    onChange={(e) => onChange({ targetEndPeriod: Number(e.target.value) || undefined })}
                    className={`${inputClass} w-auto`}
                  >
                    <option value="">止</option>
                    {periods.map((p) => (
                      <option key={p} value={p}>
                        第 {p} 节
                      </option>
                    ))}
                  </select>
                </div>
                {errorOf('period') ? <FieldError message={errorOf('period')!} /> : null}
              </div>
            </>
          ) : null}

          {item.kind !== 'cancel' ? (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-700">教室</span>
              <input
                value={item.room ?? ''}
                onChange={(e) => onChange({ room: e.target.value })}
                className={inputClass}
                placeholder={item.kind === 'room' ? '例如 B203' : '留空表示沿用原教室'}
              />
              {errorOf('room') ? <FieldError message={errorOf('room')!} /> : null}
            </label>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500">这一项已取消，应用时会跳过。</p>
      )}

      {!excluded && (required.length || warnings.length) ? (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
          {required
            .filter((i) => i.field === 'item')
            .map((issue, i) => (
              <li key={`r${i}`} className="text-xs font-medium text-rose-700">
                <span className="mr-1 rounded bg-rose-100 px-1.5 py-0.5 font-semibold">必须处理</span>
                {issue.message}
              </li>
            ))}
          {warnings.map((issue, i) => (
            <li key={`w${i}`} className="text-xs text-amber-800">
              <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold">待确认</span>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

function FieldError({ message }: { message: string }) {
  return <span className="mt-1 block text-xs font-medium text-rose-700">{message}</span>
}
