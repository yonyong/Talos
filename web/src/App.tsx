import { useState } from 'react'
import { ToastProvider } from './ui'
import Landing from './pages/Landing'
import Download from './pages/Download'
import Login from './pages/Login'
import Console from './pages/Console'

type View = 'landing' | 'download' | 'login' | 'app'

export default function App() {
  const [view, setView] = useState<View>('landing')

  return (
    <ToastProvider>
      {view === 'landing' && (
        <Landing
          onEnter={() => setView('login')}
          onDownload={() => { setView('download'); window.scrollTo(0, 0) }}
        />
      )}
      {view === 'download' && <Download onBack={() => setView('landing')} />}
      {view === 'login' && (
        <Login
          onBack={() => setView('landing')}
          onLogin={() => setView('app')}
        />
      )}
      {view === 'app' && <Console onLogout={() => setView('landing')} />}
    </ToastProvider>
  )
}
