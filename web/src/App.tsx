import { useEffect, useState } from 'react'
import { ToastProvider } from './ui'
import { navigate, useRoute } from './router'
import { applySettings, applyUserProfile, loadSettings } from './settings'
import { AUTH_EVENT, clearAuth, isLoggedIn } from './auth'
import { fetchMe } from './api'
import Landing from './pages/Landing'
import Download from './pages/Download'
import Login from './pages/Login'
import Console from './pages/Console'

export default function App() {
  // 视图由 hash 决定：刷新、前进后退、直接粘链接都能落到同一页
  const route = useRoute()

  const [authed, setAuthed] = useState(() => isLoggedIn())
  /** 登录态是否已确认：本地有 token ≠ token 还有效，未确认前不渲染控制台 */
  const [authChecked, setAuthChecked] = useState(() => !isLoggedIn())

  // 启动即应用本地偏好（主题色 / 界面密度）
  useEffect(() => applySettings(loadSettings()), [])

  /**
   * 启动校验一次登录态。
   * 服务端会话是内存态的，重启后旧 token 一律失效 —— 不校验的话会带着废 token
   * 把控制台所有接口打成一片 401，而页面上只会显示一堆「暂无数据」。
   */
  useEffect(() => {
    if (!isLoggedIn()) return
    let alive = true
    fetchMe()
      .then((u) => {
        if (!alive) return
        applyUserProfile(u)
        setAuthed(true)
      })
      .catch(() => {
        if (!alive) return
        clearAuth()
        setAuthed(false)
      })
      .finally(() => { if (alive) setAuthChecked(true) })
    return () => { alive = false }
  }, [])

  // 登录 / 退出登录都会广播，这里以本地凭据为准同步，避免各处自己记状态
  useEffect(() => {
    const h = () => setAuthed(isLoggedIn())
    window.addEventListener(AUTH_EVENT, h)
    return () => window.removeEventListener(AUTH_EVENT, h)
  }, [])

  // 未登录却停在控制台路由（手输 URL、令牌过期）→ 退回登录页，且不留历史
  useEffect(() => {
    if (authChecked && !authed && route.view === 'app') {
      navigate({ view: 'login' }, true)
    }
  }, [authChecked, authed, route.view])

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
        !authChecked || !authed
          ? <div className="boot-splash">正在校验登录态…</div>
          : (
            <Console
              page={route.page}
              focus={route.focus}
              // 退出登录 → 登录页（replace，不留历史）
              onLogout={() => navigate({ view: 'login' }, true)}
            />
          )
      )}
    </ToastProvider>
  )
}
