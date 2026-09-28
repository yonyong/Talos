import { useEffect } from 'react'
import { ToastProvider } from './ui'
import { navigate, useRoute } from './router'
import { applySettings, loadSettings } from './settings'
import Landing from './pages/Landing'
import Download from './pages/Download'
import Login from './pages/Login'
import Console from './pages/Console'
import DocsCenter from './pages/DocsCenter'
import About from './pages/About'
import Contact from './pages/Contact'
import Guide from './pages/Guide'
import DocsLayout from './components/DocsLayout'

export default function App() {
  const route = useRoute()

  useEffect(() => applySettings(loadSettings()), [])

  // 旧链 #/app/guide 已被 parse 成 docs/guide；若地址栏仍是旧 hash，纠正一次
  useEffect(() => {
    if (route.view === 'docs' && route.doc === 'guide' && window.location.hash.startsWith('#/app/guide')) {
      navigate({ view: 'docs', doc: 'guide' }, true)
    }
  }, [route])

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
              setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }), 80)
            } else {
              window.scrollTo(0, 0)
            }
          }}
        />
      )}
      {route.view === 'docs' && !route.doc && <DocsCenter />}
      {route.view === 'docs' && route.doc === 'guide' && (
        <DocsLayout doc="guide" section={route.section}>
          <Guide section={route.section} />
        </DocsLayout>
      )}
      {route.view === 'about' && <About />}
      {route.view === 'contact' && <Contact />}
      {route.view === 'login' && (
        <Login
          onBack={() => navigate({ view: 'landing' })}
          onLogin={() => navigate({ view: 'app', page: loadSettings().homePage }, true)}
        />
      )}
      {route.view === 'app' && (
        <Console
          page={route.page}
          focus={route.focus}
          onLogout={() => navigate({ view: 'login' }, true)}
        />
      )}
    </ToastProvider>
  )
}
