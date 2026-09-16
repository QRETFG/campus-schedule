import { Banner } from './ui'
import { useServiceStatus } from '../store/ServiceStatus'
import { useAiConfig } from '../store/AiConfig'
import { Link } from 'react-router-dom'

/**
 * 明确区分三种运行状态：
 * live 不额外提示，demo 必须标明是演示数据，unconfigured / 不可达时引导手动录入。
 */
export default function ServiceModeBanner({ feature }: { feature: '识别' | '解析' }) {
  const service = useServiceStatus()
  const { loading, status, unreachable } = service
  const ai = useAiConfig()

  if (loading) {
    return <Banner tone="info" title={`正在检查${feature}服务状态`} />
  }
  if (unreachable) {
    return (
      <Banner tone="error" title={`无法连接${feature}服务`}>
        前端联系不上应用服务端。请确认服务端已启动（`npm run dev:api`），或先手动录入课程。
      </Banner>
    )
  }
  if (ai.preferences.source === 'custom') {
    if (!service.customSupported) {
      return (
        <Banner tone="error" title="应用服务端版本过旧或尚未重启">
          当前服务端没有声明支持前端自定义模型配置。请停止占用 8787 端口的旧进程并重启
          <code> npm run dev:api</code>，重启前不会接受识别结果。
        </Banner>
      )
    }
    if (!ai.ready) {
      return (
        <Banner tone="error" title="自定义模型配置不完整">
          请到 <Link to="/settings" className="font-medium underline">设置</Link> 补充 API URL、API Key 和模型 ID。
        </Banner>
      )
    }
    return (
      <Banner tone="info" title="正在使用自定义模型服务">
        {ai.preferences.format === 'openai-responses' ? 'OpenAI Responses API' : 'OpenAI Chat Completions API'}
        {' · '}{ai.preferences.model}。请求会经应用服务端转发到你配置的 URL。
      </Banner>
    )
  }
  if (status?.mode === 'unconfigured') {
    return (
      <Banner tone="error" title={`${feature}服务未配置`}>
        服务端没有配置模型凭证。你可以到 <Link to="/settings" className="font-medium underline">设置</Link>
        填写自己的 OpenAI 兼容接口，或按 README 配置服务端默认模型。
      </Banner>
    )
  }
  if (status?.mode === 'demo') {
    return (
      <Banner tone="warning" title="演示模式">
        服务端正运行在演示模式（<code>SCHEDULE_MODE=demo</code>），返回的是固定样例数据，
        <strong>不是对你这张图片/这条通知的真实{feature}结果</strong>。仅用于演示和测试流程。
      </Banner>
    )
  }
  return null
}
