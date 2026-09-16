import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AppStoreProvider, ClockProvider, useAppStore } from './store/AppStore'
import { DraftProvider } from './store/DraftStore'
import { ServiceStatusProvider } from './store/ServiceStatus'
import { AiConfigProvider } from './store/AiConfig'
import { Banner } from './components/ui'
import HomePage from './pages/HomePage'
import OnboardingPage from './pages/OnboardingPage'
import SemesterSetupPage from './pages/SemesterSetupPage'
import ImportPage from './pages/ImportPage'
import ReviewPage from './pages/ReviewPage'
import CoursesPage from './pages/CoursesPage'
import CourseEditorPage from './pages/CourseEditorPage'
import CourseDetailPage from './pages/CourseDetailPage'
import AdjustOncePage from './pages/AdjustOncePage'
import SettingsPage from './pages/SettingsPage'
import NoticePage from './pages/NoticePage'

const NAV = [
  { to: '/', label: '课表', exact: true },
  { to: '/courses', label: '课程' },
  { to: '/import', label: '导入' },
  { to: '/notice', label: '通知' },
  { to: '/settings', label: '设置' },
]

function Shell({ children }: { children: ReactNode }) {
  const { data, saveError, dismissSaveError, storageAvailable } = useAppStore()
  const location = useLocation()
  const showNav = Boolean(data) && location.pathname !== '/setup'

  return (
    <div className="min-h-dvh pb-20 sm:pb-0">
      {showNav ? (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur sm:static sm:border-b sm:border-t-0">
          <ul className="mx-auto flex max-w-5xl">
            {NAV.map((item) => (
              <li key={item.to} className="flex-1 sm:flex-none">
                <NavLink
                  to={item.to}
                  end={item.exact}
                  className={({ isActive }) =>
                    `flex min-h-14 items-center justify-center px-4 text-sm font-medium transition-colors sm:min-h-12 ${
                      isActive
                        ? 'text-indigo-700 sm:border-b-2 sm:border-indigo-600'
                        : 'text-slate-600 hover:text-slate-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <main className="mx-auto max-w-5xl px-4 py-5">
        {!storageAvailable ? (
          <div className="mb-4">
            <Banner tone="error" title="本浏览器无法保存课表">
              浏览器禁用了本地存储（可能处于隐私模式）。你仍然可以使用课表，但刷新后数据会丢失，请及时导出备份。
            </Banner>
          </div>
        ) : null}
        {saveError ? (
          <div className="mb-4">
            <Banner
              tone="error"
              title="课表未保存"
              action={
                <button
                  type="button"
                  onClick={dismissSaveError}
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium underline"
                >
                  知道了
                </button>
              }
            >
              {saveError}
            </Banner>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  )
}

/** 没有课表时统一引导到创建流程。 */
function RequireData({ children }: { children: ReactNode }) {
  const { data } = useAppStore()
  if (!data) return <Navigate to="/welcome" replace />
  return <>{children}</>
}

function Router() {
  const { data } = useAppStore()
  return (
    <Shell>
      <Routes>
        <Route path="/welcome" element={data ? <Navigate to="/" replace /> : <OnboardingPage />} />
        <Route path="/setup" element={<SemesterSetupPage />} />
        <Route path="/" element={<RequireData><HomePage /></RequireData>} />
        <Route path="/import" element={<RequireData><ImportPage /></RequireData>} />
        <Route path="/review" element={<RequireData><ReviewPage /></RequireData>} />
        <Route path="/courses" element={<RequireData><CoursesPage /></RequireData>} />
        <Route path="/courses/new" element={<RequireData><CourseEditorPage /></RequireData>} />
        <Route path="/courses/:courseId" element={<RequireData><CourseDetailPage /></RequireData>} />
        <Route path="/courses/:courseId/edit" element={<RequireData><CourseEditorPage /></RequireData>} />
        <Route path="/notice" element={<RequireData><NoticePage /></RequireData>} />
        <Route path="/adjust" element={<RequireData><AdjustOncePage /></RequireData>} />
        <Route path="/settings" element={<RequireData><SettingsPage /></RequireData>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <AppStoreProvider>
      <ClockProvider>
        <AiConfigProvider>
          <ServiceStatusProvider>
            <DraftProvider>
              <Router />
            </DraftProvider>
          </ServiceStatusProvider>
        </AiConfigProvider>
      </ClockProvider>
    </AppStoreProvider>
  )
}
