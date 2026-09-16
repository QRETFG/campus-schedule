import { useNavigate } from 'react-router-dom'
import { Button, Card } from '../components/ui'

export default function OnboardingPage() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-lg py-8">
      <Card className="text-center">
        <h1 className="text-2xl font-semibold text-slate-900">智能大学课表</h1>
        <p className="mt-3 text-base text-slate-700">导入课表，随时查看下一节课。</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          先设置学期和作息时间，再上传教务系统的课表截图，或者手动添加课程。课表保存在这台设备的浏览器里。
        </p>
        <div className="mt-7">
          <Button className="w-full sm:w-auto sm:px-8" onClick={() => navigate('/setup')}>
            创建我的课表
          </Button>
        </div>
      </Card>

      <ul className="mt-6 space-y-2 text-sm text-slate-600">
        <li>· 支持单双周、自定义周次和同一课程的多组上课安排。</li>
        <li>· 停课、换教室、调课只影响你指定的那一次。</li>
        <li>· 可以导出备份文件，换浏览器时恢复。</li>
      </ul>
    </div>
  )
}
