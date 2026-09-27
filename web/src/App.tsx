import { useEffect } from 'react'
import { ToastProvider } from './ui'
import { navigate, useRoute } from './router'
import { applySettings, loadSettings } from './settings'
import Landing from './pages/Landing'
import Download from './pages/Download'
import Login from './pages/Login'
import Console from './pages/Console'

export default function App() {
  // 视图由 hash 决定：刷新、前进后退、直接粘链接都能落到同一页
  const route = useRoute()

  // 启动即应用本地偏好（主题色 / 界面密度）
  useEffect(() => applySettings(loadSettings()), [])

  return (
    <ToastProvider>
      {route.view === 'landing' && (
        <Landing
          onEnter={() => navigate({ view: 'login' })}
          onDownload={() => { navigate({ view: 'download' }); window.scrollTo(0, 0) }}
        />
      )}
      {route.view === 'download' && (
        <Download
          onBack={(anchor) => {
            navigate({ view: 'landing' })
            if (anchor) {
              // 等官网渲染完成后再滚到对应区块（架构/核心能力/安全）
              setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }), 80)
            } else {
              window.scrollTo(0, 0)
            }
          }}
        />
      )}
      {route.view === 'login' && (
        <Login
          onBack={() => navigate({ view: 'landing' })}
          // 登录后 replace，避免回退键又回到登录页；落地页取「设置」里的默认页
          onLogin={() => navigate({ view: 'app', page: loadSettings().homePage }, true)}
        />
      )}
      {route.view === 'app' && (
        <Console
          page={route.page}
          focus={route.focus}
          // 退出登录 → 登录页（replace，不留历史）
          onLogout={() => navigate({ view: 'login' }, true)}
        />
      )}
    </ToastProvider>
  )
}
