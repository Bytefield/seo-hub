import { useEffect, useState } from 'react'
import { isUnlocked, getUser, getProjects, getSites, getAllCredentialStatuses } from './lib/tauri'
import { useAppStore } from './store/appStore'
import Login from './pages/Login'
import Sidebar from './components/layout/Sidebar'
import Topbar from './components/layout/Topbar'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import Sites from './pages/Sites'
import Settings from './pages/Settings'
import GscDetail from './pages/GscDetail'
import Ga4Detail from './pages/Ga4Detail'
import KeywordsDetail from './pages/KeywordsDetail'
import ReportPage from './pages/ReportPage'
import PsiDetail from './pages/PsiDetail'

function AppShell() {
  const { activeNav, setActiveNav, setProjects, setSites, setCredentials, setUser } = useAppStore()
  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'credentials'>('general')

  async function loadAll() {
    try {
      const [projects, sites, creds, user] = await Promise.all([
        getProjects(),
        getSites(),
        getAllCredentialStatuses(),
        getUser(),
      ])
      setProjects(projects)
      setSites(sites)
      setCredentials(creds)
      setUser(user)

      // First-run: if no services configured (excluding playwright), go to credentials setup
      const needsSetup = creds.filter(c => c.service !== 'playwright' && c.is_configured).length === 0
      if (needsSetup) {
        setSettingsInitialTab('credentials')
        setActiveNav('settings')
      }
    } catch (e) {
      console.error('Failed to load data:', e)
    }
  }

  useEffect(() => { loadAll() }, [])

  const pages: Record<string, JSX.Element> = {
    dashboard:   <Dashboard />,
    projects:    <Projects />,
    sites:       <Sites />,
    settings:    <Settings initialTab={settingsInitialTab} />,
    'gsc-detail':      <GscDetail />,
    'ga4-detail':      <Ga4Detail />,
    'keywords-detail': <KeywordsDetail />,
    'psi-detail':      <PsiDetail />,
    'report':          <ReportPage />,
  }

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar onRefresh={loadAll} refreshing={false} />
        <main className="flex-1 overflow-hidden flex" style={{ background: 'var(--bg2)' }}>
          <div className="grid-bg-fine absolute inset-0 pointer-events-none z-0" />
          <div className="relative z-10 flex-1 flex overflow-hidden">
            {pages[activeNav] ?? <Dashboard />}
          </div>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const { isUnlocked: unlocked, setUnlocked, setUser } = useAppStore()

  useEffect(() => {
    // Check if app is already unlocked (no PIN)
    isUnlocked().then(async (ok) => {
      if (ok) {
        setUnlocked(true)
        const user = await getUser()
        setUser(user)
      }
    }).catch(() => {})
  }, [])

  if (!unlocked) return <Login />
  return <AppShell />
}
