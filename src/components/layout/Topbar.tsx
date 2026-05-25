import { RefreshCw, Minus, Square, X, Sun, Moon } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { format } from 'date-fns'
import { useState, useEffect } from 'react'

const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)

async function winAction(action: 'minimize' | 'maximize' | 'close') {
  if (!IS_TAURI) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  if (action === 'minimize') win.minimize()
  else if (action === 'maximize') win.toggleMaximize()
  else win.close()
}

const NAV_LABELS: Record<string, string> = {
  dashboard:   'Dashboard',
  projects:    'Projects',
  sites:       'Sites',
  credentials: 'Credentials',
  settings:    'Settings',
}

export default function Topbar({ onRefresh, refreshing }: { onRefresh?: () => void; refreshing?: boolean }) {
  const { activeNav, credentials, activeSiteId, sites, theme, setTheme } = useAppStore()
  const totalMcps     = credentials.length
  const connectedMcps = credentials.filter(c => c.is_configured).length
  const activeSite = sites.find(s => s.id === activeSiteId)
  const [now, setNow] = useState(new Date())

  // Apply stored theme on mount
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <header
      className="drag-region flex items-center h-11 border-b flex-shrink-0"
      style={{ background: 'var(--topbar-bg)', borderColor: 'var(--b1)', backdropFilter: 'blur(12px)' }}
    >
      {/* Breadcrumb */}
      <div className="no-drag flex items-center gap-2 px-4 flex-1 min-w-0">
        <span className="font-mono text-[11px] text-[var(--t3)] tracking-[0.15em] uppercase">
          {NAV_LABELS[activeNav] ?? activeNav}
        </span>
        {activeSite && (
          <>
            <span className="text-[var(--b2)]">/</span>
            <span className="font-mono text-[11px] text-[var(--accent)]">{activeSite.domain}</span>
          </>
        )}
      </div>

      {/* Center status */}
      <div className="no-drag flex items-center gap-3">
        {/* MCP health */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
          style={{
            background: connectedMcps === totalMcps ? 'var(--gdim)' : 'var(--ydim)',
            borderColor: connectedMcps === totalMcps ? 'rgba(16,217,160,0.2)' : 'rgba(245,158,11,0.2)',
          }}>
          <div className="w-1.5 h-1.5 rounded-full"
            style={{
              background: connectedMcps === totalMcps ? 'var(--green)' : 'var(--yellow)',
              animation: 'blink 2s infinite',
            }} />
          <span className="font-mono text-[10px]"
            style={{ color: connectedMcps === totalMcps ? 'var(--green)' : 'var(--yellow)' }}>
            {connectedMcps}/{totalMcps} MCP
          </span>
        </div>

        {/* Timestamp */}
        <span className="font-mono text-[10px] text-[var(--t3)]">
          {format(now, 'HH:mm:ss')}
        </span>

        {/* Refresh */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center justify-center w-7 h-7 rounded-[var(--r)] border transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
            style={{ background: 'var(--s2)', borderColor: 'var(--b1)', color: 'var(--t3)' }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="no-drag w-7 h-7 flex items-center justify-center rounded-[var(--r)] border transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] ml-3"
        style={{ background: 'var(--s2)', borderColor: 'var(--b1)', color: 'var(--t3)' }}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
      </button>

      {/* Window controls (Tauri custom titlebar) */}
      <div className="flex items-center ml-4 mr-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button onClick={() => winAction('minimize')}
          className="no-drag w-8 h-8 flex items-center justify-center transition-colors hover:bg-[var(--s3)]"
          style={{ color: 'var(--t3)', WebkitAppRegion: 'no-drag' } as any}>
          <Minus size={12} />
        </button>
        <button onClick={() => winAction('maximize')}
          className="no-drag w-8 h-8 flex items-center justify-center transition-colors hover:bg-[var(--s3)]"
          style={{ color: 'var(--t3)', WebkitAppRegion: 'no-drag' } as any}>
          <Square size={11} />
        </button>
        <button onClick={() => winAction('close')}
          className="no-drag w-8 h-8 flex items-center justify-center rounded-tr transition-colors hover:bg-[var(--red)] hover:text-white"
          style={{ color: 'var(--t3)', WebkitAppRegion: 'no-drag' } as any}>
          <X size={13} />
        </button>
      </div>
    </header>
  )
}
