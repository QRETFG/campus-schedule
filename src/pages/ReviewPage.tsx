import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WeekRule, Weekday } from '../types'
import { Banner, Button, Card, ConfirmDialog, PageTitle, inputClass, useUnsavedGuard } from '../components/ui'
import WeekRuleEditor from '../components/WeekRuleEditor'
import ServiceModeBanner from '../components/ServiceModeBanner'
import { useAppStore } from '../store/AppStore'
import { useDraft } from '../store/DraftStore'
import type { DraftEntry, DraftIssue, IssueCategory } from '../core/draft'
import {
  ISSUE_CATEGORY_LABEL,
  applyBatchWeeks,
  commitDraft,
  countByCategory,
  previewBatchWeeks,
  requiredIssueCount,
  sortEntriesForReview,
  validateDraft,
} from '../core/draft'
import { newId } from '../store/defaults'
import { weekdayLabel } from '../core/datetime'
import { describeWeeks, expandWeekRule } from '../core/weeks'

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
const CATEGORY_ORDER: IssueCategory[] = ['format', 'missing', 'uncertain', 'conflict', 'duplicate']

export default function ReviewPage() {
  const { data, commit } = useAppStore()
  const { session, setEntries, clear } = useDraft()
  const navigate = useNavigate()

  const [showOriginal, setShowOriginal] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number } | undefined>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchRule, setBatchRule] = useState<WeekRule>({ kind: 'all' })
  const [order, setOrder] = useState<string[]>([])

  const entries = useMemo(() => session?.entries ?? [], [session])
  const issues = useMemo(() => (session ? validateDraft(entries, data!) : []), [entries, data, session])
  const requiredCount = requiredIssueCount(issues)
  const warningCount = issues.length - requiredCount
  const liveEntries = entries.filter((e) => !e.removed)
  const categoryCounts = useMemo(() => countByCategory(issues), [issues])

  // 展示顺序在进入页面时按问题严重程度排一次，之后保持稳定，避免编辑时条目跳动。
  useEffect(() => {
    if (!session) return
    setOrder((prev) => {
      const known = new Set(prev)
      const appended = entries.filter((e) => !known.has(e.id)).map((e) => e.id)
      if (!prev.length) {
        return sortEntriesForReview(entries, validateDraft(entries, data!)).map((e) => e.id)
      }
      return appended.length ? [...prev, ...appended] : prev
    })
  }, [session, entries, data])

  useUnsavedGuard(Boolean(session) && !result)

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>没有待核对的识别结果</PageTitle>
        <Banner tone="info">
          识别结果只保留在当前页面会话中。请重新上传截图，或直接手动添加课程。
        </Banner>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => navigate('/import')}>去上传截图</Button>
          <Button variant="secondary" onClick={() => navigate('/courses/new')}>
            手动添加课程
          </Button>
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle>已保存到课表</PageTitle>
        <Banner tone="success" title={`新增 ${result.added} 条上课安排`}>
          {result.skipped
            ? `其中 ${result.skipped} 条与课表中已有的安排完全相同，已自动跳过。`
            : '识别结果已写入本浏览器的课表。'}
        </Banner>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              clear()
              navigate('/')
            }}
          >
            查看课表
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              clear()
              navigate('/import')
            }}
          >
            再导入一张
          </Button>
        </div>
      </div>
    )
  }

  const ordered = order.length
    ? (order.map((id) => entries.find((e) => e.id === id)).filter(Boolean) as DraftEntry[])
    : entries

  const patch = (id: string, changes: Partial<DraftEntry>) => {
    setEntries(entries.map((e) => (e.id === id ? { ...e, ...changes } : e)))
  }

  const addEntry = () => {
    setEntries([
      ...entries,
      {
        id: newId('draft'),
        courseName: '',
        teacher: '',
        room: '',
        weekday: 1,
        startPeriod: 1,
        endPeriod: 2,
        rule: { kind: 'all' },
        weeksConfirmed: true,
        uncertainFields: [],
        removed: false,
      },
    ])
  }

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const batchPreview = previewBatchWeeks(entries, selected, batchRule, data!.semester.totalWeeks)
  const applyBatch = () => {
    setEntries(applyBatchWeeks(entries, selected, batchRule))
    setSelected(new Set())
  }

  const save = () => {
    const outcome = commitDraft(data!, entries)
    if (commit(outcome.data)) {
      setResult({ added: outcome.added, skipped: outcome.skipped })
    }
    setConfirmSave(false)
  }

  return (
    <div>
      <PageTitle hint="识别结果是草稿，确认后才会写入课表。请重点核对星期、节次、周次和教室。">
        核对识别结果
      </PageTitle>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* 原图：电脑端并排，手机端可展开 */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card className="p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-800">原始截图</h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  className="min-h-9 px-2.5 text-xs"
                  onClick={() => setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))}
                  disabled={zoom <= 1}
                  aria-label="缩小原图"
                >
                  −
                </Button>
                <span className="w-12 text-center text-xs tabular-nums text-slate-600">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="secondary"
                  className="min-h-9 px-2.5 text-xs"
                  onClick={() => setZoom((z) => Math.min(4, Number((z + 0.5).toFixed(1))))}
                  disabled={zoom >= 4}
                  aria-label="放大原图"
                >
                  ＋
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-9 text-xs lg:hidden"
                  onClick={() => setShowOriginal((v) => !v)}
                  aria-expanded={showOriginal}
                >
                  {showOriginal ? '收起' : '展开'}
                </Button>
              </div>
            </div>
            <div className={`mt-2 ${showOriginal ? 'block' : 'hidden'} lg:block`}>
              {session.previewUrl ? (
                <div className="scroll-x max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
                  <img
                    src={session.previewUrl}
                    alt="识别所用的课表截图"
                    style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
                    className="block"
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-500">原图预览不可用。</p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                放大后可以左右拖动查看细节。识别服务没有提供可靠的区域坐标，这里不做框选定位，
                每条安排下方给出对应的原文，请据此与截图逐条对照。原图只用于本次核对，不写入课表或备份。
              </p>
            </div>
          </Card>

          <Card className="mt-3 p-3">
            <h2 className="text-sm font-medium text-slate-800">整周排布预览</h2>
            <DraftPreview entries={liveEntries} totalWeeks={data!.semester.totalWeeks} />
          </Card>
        </aside>

        <div className="space-y-3">
          {session.mode === 'demo' ? <ServiceModeBanner feature="识别" /> : null}

          {requiredCount ? (
            <Banner tone="error" title={`还有 ${requiredCount} 处必须修改的问题`}>
              课程名称、星期、起止节次和周次必须填写正确才能保存。
            </Banner>
          ) : (
            <Banner tone="success" title="必填项都已填写">
              保存前请再核对一遍星期、节次、周次和教室。
            </Banner>
          )}

          {issues.length ? (
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_ORDER.filter((c) => categoryCounts[c] > 0).map((category) => (
                <span
                  key={category}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${categoryStyle(category)}`}
                >
                  {ISSUE_CATEGORY_LABEL[category]} {categoryCounts[category]}
                </span>
              ))}
              {warningCount ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  其中 {warningCount} 处可确认后保留
                </span>
              ) : null}
            </div>
          ) : null}

          {/* 批量设置周次 */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-800">
                批量设置周次
                <span className="ml-2 text-xs font-normal text-slate-500">
                  已选 {selected.size} / {liveEntries.length} 条
                </span>
              </h2>
              <div className="flex gap-1.5">
                <Button
                  variant="secondary"
                  className="min-h-9 text-xs"
                  onClick={() => setSelected(new Set(liveEntries.map((e) => e.id)))}
                >
                  全选
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-9 text-xs"
                  onClick={() => setSelected(new Set())}
                  disabled={!selected.size}
                >
                  取消选择
                </Button>
              </div>
            </div>

            {selected.size ? (
              <>
                <WeekRuleEditor
                  rule={batchRule}
                  totalWeeks={data!.semester.totalWeeks}
                  idPrefix="batch"
                  onChange={setBatchRule}
                />
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <p className="text-xs font-medium text-slate-700">
                    应用后将影响下面 {batchPreview.rows.length} 条，其他条目不变：
                  </p>
                  <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
                    {batchPreview.rows.map((row) => (
                      <li key={row.entryId} className="text-xs text-slate-700">
                        · {row.courseName}：
                        <span className={row.changed ? 'text-slate-500 line-through' : 'text-slate-500'}>
                          {row.before}
                        </span>
                        {row.changed ? <span className="ml-1 font-medium text-slate-900">→ {row.after}</span> : <span className="ml-1 text-slate-400">（不变）</span>}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  className="w-full"
                  onClick={applyBatch}
                  disabled={batchPreview.errors.length > 0 || !batchPreview.rows.length}
                >
                  应用到选中的 {batchPreview.rows.length} 条
                </Button>
              </>
            ) : (
              <p className="text-xs text-slate-500">
                勾选下面的条目后，可以一次给它们设置相同的上课周次。应用前会先列出受影响的条目。
              </p>
            )}
          </Card>

          <ul className="space-y-3">
            {ordered.map((entry) =>
              entry.removed ? (
                <li key={entry.id}>
                  <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <span>已删除「{entry.courseName || '未命名课程'}」</span>
                    <Button
                      variant="ghost"
                      className="min-h-9 text-xs"
                      onClick={() => patch(entry.id, { removed: false })}
                    >
                      撤销删除
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={entry.id}>
                  <EntryEditor
                    entry={entry}
                    totalWeeks={data!.semester.totalWeeks}
                    periods={data!.periods.map((p) => p.period)}
                    issues={issues.filter((i) => i.entryId === entry.id)}
                    selected={selected.has(entry.id)}
                    onToggleSelected={() => toggleSelected(entry.id)}
                    onChange={(changes) => patch(entry.id, changes)}
                    onRemove={() => patch(entry.id, { removed: true })}
                  />
                </li>
              ),
            )}
          </ul>

          <Button variant="secondary" className="w-full" onClick={addEntry}>
            ＋ 补充遗漏的课程
          </Button>

          <div className="sticky bottom-16 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-slate-800">{liveEntries.length} 条上课安排</p>
              <p className="text-xs text-slate-600">
                {requiredCount ? `${requiredCount} 处必须修改` : '可以保存'}
                {warningCount ? ` · ${warningCount} 处待确认` : ''}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setConfirmLeave(true)}>
              放弃
            </Button>
            <Button onClick={() => setConfirmSave(true)} disabled={requiredCount > 0 || !liveEntries.length}>
              确认保存
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSave}
        title="确认写入课表"
        confirmLabel="写入课表"
        onConfirm={save}
        onCancel={() => setConfirmSave(false)}
      >
        <p>将把 {liveEntries.length} 条上课安排追加到「{data!.semester.name}」。</p>
        <p>保存前请确认星期、节次、周次和教室都已核对。完全相同的安排会自动跳过。</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmLeave}
        title="放弃这次识别结果？"
        confirmLabel="放弃"
        danger
        onConfirm={() => {
          clear()
          navigate('/')
        }}
        onCancel={() => setConfirmLeave(false)}
      >
        <p>核对中的内容不会保存，已有课表不受影响。</p>
      </ConfirmDialog>
    </div>
  )
}

function categoryStyle(category: IssueCategory): string {
  switch (category) {
    case 'format':
    case 'missing':
      return 'bg-rose-100 text-rose-800'
    case 'conflict':
      return 'bg-amber-100 text-amber-900'
    case 'uncertain':
      return 'bg-sky-100 text-sky-900'
    case 'duplicate':
    default:
      return 'bg-slate-200 text-slate-800'
  }
}

function EntryEditor({
  entry,
  totalWeeks,
  periods,
  issues,
  selected,
  onToggleSelected,
  onChange,
  onRemove,
}: {
  entry: DraftEntry
  totalWeeks: number
  periods: number[]
  issues: DraftIssue[]
  selected: boolean
  onToggleSelected: () => void
  onChange: (changes: Partial<DraftEntry>) => void
  onRemove: () => void
}) {
  const errorOf = (field: DraftIssue['field']) =>
    issues.find((i) => i.field === field && i.severity === 'required')?.message
  const warnings = issues.filter((i) => i.severity === 'warning')
  const hasRequired = issues.some((i) => i.severity === 'required')

  return (
    <Card className={hasRequired ? 'border-rose-300' : warnings.length ? 'border-amber-300' : ''}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="h-4 w-4 rounded border-slate-400"
          />
          选中以批量设置周次
        </label>
        <Button variant="ghost" className="min-h-9 text-xs text-rose-700" onClick={onRemove}>
          删除这条
        </Button>
      </div>

      {entry.sourceText ? (
        <p className="mb-3 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-600">
          <span className="mr-1 font-semibold text-slate-700">截图原文</span>
          {entry.sourceText}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            课程名称 <span className="text-rose-600">*</span>
          </span>
          <input
            value={entry.courseName}
            onChange={(e) => onChange({ courseName: e.target.value })}
            className={inputClass}
            placeholder="例如 高等数学 A"
          />
          {errorOf('courseName') ? (
            <span className="mt-1 block text-xs font-medium text-rose-700">{errorOf('courseName')}</span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">教师</span>
          <input
            value={entry.teacher}
            onChange={(e) => onChange({ teacher: e.target.value })}
            className={inputClass}
            placeholder="可留空"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">教室</span>
          <input
            value={entry.room}
            onChange={(e) => onChange({ room: e.target.value })}
            className={inputClass}
            placeholder="留空显示「教室待补充」"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            星期 <span className="text-rose-600">*</span>
          </span>
          <select
            value={entry.weekday ?? ''}
            onChange={(e) => onChange({ weekday: Number(e.target.value) as Weekday })}
            className={inputClass}
          >
            <option value="">请选择</option>
            {WEEKDAYS.map((w) => (
              <option key={w} value={w}>
                {weekdayLabel(w)}
              </option>
            ))}
          </select>
          {errorOf('weekday') ? (
            <span className="mt-1 block text-xs font-medium text-rose-700">{errorOf('weekday')}</span>
          ) : null}
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-700">
            起止节次 <span className="text-rose-600">*</span>
          </span>
          <div className="flex items-center gap-1.5">
            <select
              value={entry.startPeriod ?? ''}
              aria-label="起始节次"
              onChange={(e) => onChange({ startPeriod: Number(e.target.value) })}
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
              value={entry.endPeriod ?? ''}
              aria-label="结束节次"
              onChange={(e) => onChange({ endPeriod: Number(e.target.value) })}
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
          {errorOf('period') ? (
            <span className="mt-1 block text-xs font-medium text-rose-700">{errorOf('period')}</span>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            上课周次 <span className="text-rose-600">*</span>
          </span>
          {!entry.weeksConfirmed ? (
            <div className="mb-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2">
              <p className="text-xs font-medium text-amber-900">
                周次待确认：截图上没有识别到这条课程的周次，需要你确认后才能保存。
              </p>
              <Button
                variant="secondary"
                className="mt-2 min-h-9 text-xs"
                onClick={() => onChange({ rule: { kind: 'all' }, weeksConfirmed: true })}
              >
                设为全学期
              </Button>
            </div>
          ) : null}
          <WeekRuleEditor
            rule={entry.rule}
            totalWeeks={totalWeeks}
            idPrefix={entry.id}
            onChange={(rule) => onChange({ rule, weeksConfirmed: true })}
          />
          {errorOf('weeks') && entry.weeksConfirmed ? (
            <span className="mt-1 block text-xs font-medium text-rose-700">{errorOf('weeks')}</span>
          ) : null}
        </div>
      </div>

      {warnings.length ? (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
          {warnings.map((w, i) => (
            <li key={`${w.message}-${i}`} className="text-xs text-amber-800">
              <span className={`mr-1 rounded px-1.5 py-0.5 font-semibold ${categoryStyle(w.category)}`}>
                {ISSUE_CATEGORY_LABEL[w.category]}
              </span>
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

/** 整周排布预览：让用户在保存前看清这批安排落在哪些格子上。 */
function DraftPreview({ entries, totalWeeks }: { entries: DraftEntry[]; totalWeeks: number }) {
  const byDay = new Map<number, DraftEntry[]>()
  for (const entry of entries) {
    if (!entry.weekday) continue
    const list = byDay.get(entry.weekday) ?? []
    list.push(entry)
    byDay.set(entry.weekday, list)
  }

  return (
    <ul className="mt-2 space-y-2">
      {WEEKDAYS.map((weekday) => {
        const list = (byDay.get(weekday) ?? []).sort((a, b) => (a.startPeriod ?? 0) - (b.startPeriod ?? 0))
        return (
          <li key={weekday} className="flex gap-2 text-xs">
            <span className="w-8 shrink-0 pt-0.5 font-medium text-slate-600">{weekdayLabel(weekday)}</span>
            <div className="min-w-0 flex-1">
              {list.length ? (
                <ul className="space-y-1">
                  {list.map((entry) => (
                    <li key={entry.id} className="truncate text-slate-700">
                      {entry.courseName || '未命名课程'}
                      <span className="text-slate-500">
                        {' '}
                        第 {entry.startPeriod ?? '?'}-{entry.endPeriod ?? '?'} 节 ·{' '}
                        {entry.weeksConfirmed
                          ? describeWeeks(expandWeekRule(entry.rule, totalWeeks).weeks, totalWeeks)
                          : '周次待确认'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-slate-400">无</span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
