import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Backup } from '../types'
import { Banner, Button, Card, ConfirmDialog, PageTitle, inputClass } from '../components/ui'
import { useAppStore, useClock } from '../store/AppStore'
import { backupFileName, buildBackup } from '../store/storage'
import { parseBackup } from '../store/validate'
import type { ParseResult } from '../store/validate'
import { fullDateLabel } from '../core/datetime'
import { semesterPhaseOf, teachingWeekOf } from '../core/weeks'
import { DEFAULT_AI_PREFERENCES, useAiConfig } from '../store/AiConfig'
import type { AiPreferences } from '../store/AiConfig'
import { useServiceStatus } from '../store/ServiceStatus'

export default function SettingsPage() {
  const { data, commit, storageAvailable, sync, syncNow } = useAppStore()
  const { today } = useClock()
  const ai = useAiConfig()
  const service = useServiceStatus()
  const fileRef = useRef<HTMLInputElement>(null)

  const [candidate, setCandidate] = useState<ParseResult | undefined>()
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()
  const [aiForm, setAiForm] = useState<AiPreferences>(() => ai.preferences)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [aiFeedback, setAiFeedback] = useState<{ tone: 'success' | 'error'; text: string } | undefined>()

  const { semester, periods, courses, slots, changes, oneOffs } = data!
  const phase = semesterPhaseOf(semester, today)

  const exportBackup = () => {
    const backup = buildBackup(data!)
    downloadJson(backup, backupFileName(data!))
    setNotice('备份文件已开始下载。')
  }

  const pickFile = async (file: File | undefined) => {
    setNotice(undefined)
    if (!file) return
    try {
      const text = await file.text()
      setCandidate(parseBackup(text))
    } catch {
      setCandidate({ ok: false, error: '无法读取这个文件。' })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const restore = () => {
    if (!candidate?.ok || !candidate.backup) return
    // 整份替换；失败时 commit 会在顶部给出未保存提示，数据不会半途写入。
    commit(candidate.backup.data)
    setCandidate(undefined)
    setConfirmRestore(false)
    setNotice('已用备份文件替换当前课表。')
  }

  const saveAi = () => {
    const result = ai.save(aiForm, apiKeyInput)
    if (!result.ok) {
      setAiFeedback({ tone: 'error', text: result.error ?? '无法保存模型配置。' })
      return
    }
    // 保存后立即清空表单中的密钥；后续只显示“当前会话已保存”的状态。
    setApiKeyInput('')
    setAiFeedback({
      tone: 'success',
      text: aiForm.source === 'custom' ? '自定义模型配置已启用。' : '已改用服务端默认配置。',
    })
  }

  const clearAi = () => {
    ai.clear()
    setAiForm(DEFAULT_AI_PREFERENCES)
    setApiKeyInput('')
    setAiFeedback({ tone: 'success', text: '自定义配置和当前会话中的 API Key 已清除。' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle>设置与备份</PageTitle>

      {notice ? <Banner tone="success">{notice}</Banner> : null}

      <Card>
        <h2 className="text-sm font-medium text-slate-800">智能服务</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          可以使用部署者提供的默认模型，也可以只在当前浏览器中配置 OpenAI 兼容服务。
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">配置来源</span>
            <select
              className={inputClass}
              value={aiForm.source}
              onChange={(event) =>
                setAiForm((current) => ({ ...current, source: event.target.value as AiPreferences['source'] }))
              }
            >
              <option value="server">使用服务端默认配置</option>
              <option value="custom">使用我的自定义配置</option>
            </select>
          </label>

          {aiForm.source === 'server' ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              {service.loading
                ? '正在读取服务端配置…'
                : service.unreachable
                  ? '当前无法连接应用服务端。'
                  : service.status?.mode === 'live'
                    ? `${service.status.provider} · ${service.status.model ?? '未提供模型 ID'}`
                    : service.status?.mode === 'demo'
                      ? '服务端处于演示模式。'
                      : '服务端尚未配置模型凭证。'}
            </div>
          ) : (
            <>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">API 格式</span>
                <select
                  className={inputClass}
                  value={aiForm.format}
                  onChange={(event) =>
                    setAiForm((current) => ({ ...current, format: event.target.value as AiPreferences['format'] }))
                  }
                >
                  <option value="openai-responses">OpenAI Responses API</option>
                  <option value="openai-chat-completions">OpenAI Chat Completions API</option>
                </select>
              </label>

              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">API URL</span>
                <input
                  className={inputClass}
                  type="url"
                  inputMode="url"
                  value={aiForm.baseUrl}
                  onChange={(event) => setAiForm((current) => ({ ...current, baseUrl: event.target.value }))}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                />
                <span className="mt-1 block text-xs text-slate-500">
                  可填以 <code>/v1</code> 结尾的基础地址，也可填对应格式的完整端点。
                </span>
              </label>

              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">模型 ID</span>
                <input
                  className={inputClass}
                  value={aiForm.model}
                  onChange={(event) => setAiForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="例如 gpt-5.5"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <label className="block text-sm text-slate-700">
                <span className="mb-1 flex items-center justify-between gap-2 font-medium">
                  <span>API Key</span>
                  <span className="text-xs font-normal text-slate-500">
                    {ai.hasApiKey ? '当前会话已保存' : '尚未保存'}
                  </span>
                </span>
                <input
                  className={inputClass}
                  type="password"
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder={ai.hasApiKey ? '已保存；留空表示不更换' : '输入 API Key'}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                  密钥不会明文回显，只保存在当前标签页会话中，不进入课表、备份或服务端存储。
                </span>
              </label>

              <Banner tone="warning" title="请只使用你信任的 API URL">
                识别时，API Key、课表截图或通知文字会经应用服务端转发到这个地址。
              </Banner>
            </>
          )}

          {aiFeedback ? <Banner tone={aiFeedback.tone}>{aiFeedback.text}</Banner> : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveAi}>保存智能服务配置</Button>
            {(ai.preferences.source === 'custom' || ai.hasApiKey) ? (
              <Button variant="secondary" onClick={clearAi}>清除自定义配置</Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-medium text-slate-800">学期信息</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Row label="学期名称" value={semester.name} />
          <Row label="第 1 教学周的周一" value={fullDateLabel(semester.firstWeekMonday)} />
          <Row label="学期总周数" value={`${semester.totalWeeks} 周`} />
          <Row
            label="当前教学周"
            value={
              phase === 'during'
                ? `第 ${teachingWeekOf(semester, today)} 周`
                : phase === 'before'
                  ? '学期尚未开始'
                  : '学期已结束'
            }
          />
          <Row label="每天节次" value={`${periods.length} 节 · ${periods[0]?.start} 起`} />
          <Row label="时区" value={`${semester.timezone}（页面时间与课程判断统一使用）`} />
        </dl>
        <div className="mt-4">
          <Link to="/setup">
            <Button variant="secondary">修改学期与作息时间</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-medium text-slate-800">课表数据</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Row label="课程" value={`${courses.length} 门`} />
          <Row label="重复上课安排" value={`${slots.length} 组`} />
          <Row label="单次调整" value={`${changes.length} 条`} />
          <Row label="一次性补课" value={`${oneOffs.length} 次`} />
          <Row
            label="云端同步"
            value={
              sync.state === 'synced'
                ? sync.lastSyncedAt
                  ? `已同步 · ${new Date(sync.lastSyncedAt).toLocaleString('zh-CN')}`
                  : '已同步'
                : sync.state === 'saving'
                  ? '正在保存…'
                  : sync.state === 'connecting'
                    ? '正在连接…'
                    : '等待重试'
            }
          />
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          课表会保存到此部署的云端存储，并在浏览器保留本机副本。其他设备打开同一地址后会自动读取最新内容。
          {!storageAvailable ? '当前浏览器无法保存本机副本，但云端同步仍会继续尝试。' : ''}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={exportBackup}>导出备份文件</Button>
          <Button variant="secondary" onClick={syncNow} disabled={sync.state === 'connecting' || sync.state === 'saving'}>
            立即同步
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-medium text-slate-800">恢复备份</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          恢复采用整份替换：备份文件中的学期、课程、上课安排和单次变更会替换当前课表。建议先导出当前数据。
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            选择备份文件
          </Button>
          <Button variant="ghost" onClick={exportBackup}>
            先导出当前备份
          </Button>
        </div>

        {candidate && !candidate.ok ? (
          <div className="mt-4">
            <Banner tone="error" title="这个备份文件无法恢复">
              <p>{candidate.error}</p>
              <p className="mt-1 text-xs">当前课表没有任何改动。</p>
            </Banner>
          </div>
        ) : null}

        {candidate?.ok && candidate.summary ? (
          <div className="mt-4 rounded-lg border border-slate-300 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-900">备份文件内容</p>
            <dl className="mt-2 space-y-1 text-sm">
              <Row label="学期" value={candidate.summary.semesterName} />
              <Row label="课程数量" value={`${candidate.summary.courseCount} 门`} />
              <Row label="上课安排" value={`${candidate.summary.slotCount} 组`} />
              <Row label="变更与补课" value={`${candidate.summary.changeCount} 条`} />
              {candidate.backup?.exportedAt ? (
                <Row label="导出时间" value={new Date(candidate.backup.exportedAt).toLocaleString('zh-CN')} />
              ) : null}
            </dl>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => setConfirmRestore(true)}>用这份备份替换当前课表</Button>
              <Button variant="secondary" onClick={() => setCandidate(undefined)}>
                取消
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-sm font-medium text-slate-800">关于识别与隐私</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600">
          <li>
            · 当前识别服务：{ai.preferences.source === 'custom'
              ? `${ai.preferences.format === 'openai-responses' ? 'OpenAI Responses API' : 'OpenAI Chat Completions API'} · ${ai.preferences.model || '模型未填写'}`
              : service.status?.provider ?? '服务端默认配置'}。只有你点击「开始识别」时才会发送图片。
          </li>
          <li>· 原图只用于本次核对，不写入课表，也不包含在备份文件中。</li>
          <li>· 课表不公开，也不提供分享链接。</li>
          <li>· 网页关闭后无法可靠提醒，首版不提供课前通知。</li>
        </ul>
      </Card>

      <ConfirmDialog
        open={confirmRestore}
        title="确认替换当前课表？"
        confirmLabel="替换"
        danger
        onConfirm={restore}
        onCancel={() => setConfirmRestore(false)}
      >
        <p>
          当前的 {courses.length} 门课程、{slots.length} 组安排和 {changes.length + oneOffs.length} 条变更将被
          备份文件中的内容整份替换，此操作不可撤销。
        </p>
        <p>如果还没导出当前数据，请先取消并导出备份。</p>
      </ConfirmDialog>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-600">{label}</dt>
      <dd className="min-w-0 text-right text-slate-900">{value}</dd>
    </div>
  )
}

function downloadJson(backup: Backup, fileName: string) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 给浏览器留出发起下载的时间再释放。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
