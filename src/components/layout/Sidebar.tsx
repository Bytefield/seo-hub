import { LayoutDashboard, FolderOpen, Globe, Settings, ChevronLeft, Lock } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { lockApp } from '../../lib/tauri'
import clsx from 'clsx'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects',  label: 'Projects',  icon: FolderOpen },
  { id: 'sites',     label: 'Sites',     icon: Globe },
  { id: 'settings',  label: 'Settings',  icon: Settings },
]

export default function Sidebar() {
  const { activeNav, setActiveNav, sidebarCollapsed, setSidebarCollapsed,
          projects, sites, credentials, setUnlocked, activeProjectId } = useAppStore()

  const activeProject = projects.find(p => p.id === activeProjectId)
  const connectedMcps = credentials.filter(c => c.is_configured).length

  async function handleLock() {
    await lockApp()
    setUnlocked(false)
  }

  return (
    <aside
      className="relative flex flex-col border-r transition-all duration-200"
      style={{
        width: sidebarCollapsed ? '56px' : '220px',
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--b1)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 h-12 border-b" style={{ borderColor: 'var(--b1)' }}>
        <img
          src="/logo.png"
          alt="SYNIO"
          className="flex-shrink-0 w-7 h-7 object-contain"
        />
        {!sidebarCollapsed && (
          <span className="font-display text-[17px] text-[var(--t1)] anim-in">
            SYNIO <span className="text-[var(--accent)]">SEO</span>
          </span>
        )}
      </div>

      {/* Active project pill */}
      {!sidebarCollapsed && activeProject && (
        <div className="mx-3 mt-3 px-2.5 py-1.5 rounded-[var(--r)] border anim-in"
          style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
          <div className="font-mono text-[11px] text-[var(--t3)] tracking-wider uppercase">Active Project</div>
          <div className="text-[13px] font-medium text-[var(--t1)] truncate mt-0.5">{activeProject.name}</div>
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        {NAV.map(item => {
          const Icon = item.icon
          const active = activeNav === item.id
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={clsx(
                'group flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--r)] transition-all duration-150 w-full text-left',
                active
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--t3)] hover:text-[var(--t2)]'
              )}
              style={{
                background: active ? 'var(--adim)' : 'transparent',
                border: active ? '1px solid rgba(249,115,22,0.2)' : '1px solid transparent',
              }}
            >
              <Icon size={15} className="flex-shrink-0" />
              {!sidebarCollapsed && (
                <span className="font-medium text-[14px] tracking-wide anim-in">{item.label}</span>
              )}
              {/* Badge */}
              {!sidebarCollapsed && item.id === 'sites' && sites.length > 0 && (
                <span className="ml-auto font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--s3)', color: 'var(--t3)' }}>
                  {sites.length}
                </span>
              )}
              {!sidebarCollapsed && item.id === 'settings' && (
                <span className="ml-auto font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: connectedMcps === 6 ? 'var(--gdim)' : 'var(--ydim)',
                    color: connectedMcps === 6 ? 'var(--green)' : 'var(--yellow)',
                  }}>
                  {connectedMcps}/6
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom: lock + collapse */}
      <div className="px-2 pb-3 flex flex-col gap-1">
        <button
          onClick={handleLock}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--r)] w-full text-left transition-colors hover:text-[var(--red)]"
          style={{ color: 'var(--t3)' }}
        >
          <Lock size={14} className="flex-shrink-0" />
          {!sidebarCollapsed && <span className="text-[14px] font-medium">Lock</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="absolute -right-3 top-16 z-10 w-6 h-6 rounded-full flex items-center justify-center border transition-all hover:border-[var(--accent)]"
        style={{ background: 'var(--s2)', borderColor: 'var(--b2)', color: 'var(--t3)' }}
      >
        <ChevronLeft size={12} className={clsx('transition-transform', sidebarCollapsed && 'rotate-180')} />
      </button>
    </aside>
  )
}
