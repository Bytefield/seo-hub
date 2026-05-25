import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, RefreshCw, AlertTriangle, Info, Copy, Check } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { fetchMcpData, getSiteSnapshots } from '../lib/tauri'

interface PsiOpportunity { id: string; title: string; displayValue: string; savingsMs: number }
interface PsiDiagnostic  { id: string; title: string; displayValue: string }
interface PsiMetrics {
  score: number
  lcp: number
  cls: number
  inp: number
  ttfb: number
  lcpElement?: string
  opportunities?: PsiOpportunity[]
  diagnostics?: PsiDiagnostic[]
}
interface PsiData { mobile: PsiMetrics; desktop: PsiMetrics; fetchedAt?: string }

// ── Score arc ──────────────────────────────────────────────────────────────────

function ScoreArc({ value, size = 100 }: { value: number | null; size?: number }) {
  const R = 36
  const cx = 50; const cy = 50
  const startAngle = -210; const endAngle = 30
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const arcPath = (start: number, end: number) => {
    const s = { x: cx + R * Math.cos(toRad(start)), y: cy + R * Math.sin(toRad(start)) }
    const e = { x: cx + R * Math.cos(toRad(end)),   y: cy + R * Math.sin(toRad(end))   }
    const large = end - start > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`
  }
  const pct   = value !== null ? Math.max(0, Math.min(100, value)) / 100 : 0
  const range = endAngle - startAngle
  const fillEnd = startAngle + range * pct
  const color = value === null ? 'var(--t3)' : value >= 90 ? 'var(--green)' : value >= 50 ? 'var(--yellow)' : 'var(--red)'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d={arcPath(startAngle, endAngle)} fill="none" stroke="var(--b2)" strokeWidth="8" strokeLinecap="round" />
      {value !== null && value > 0 && (
        <path d={arcPath(startAngle, fillEnd)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      )}
      <text x="50" y="54" textAnchor="middle" dominantBaseline="middle"
        fill={value !== null ? color : 'var(--t3)'}
        style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700 }}>
        {value !== null ? value : '–'}
      </text>
    </svg>
  )
}

// ── CWV status helpers ─────────────────────────────────────────────────────────

function cwvColor(label: string, value: number): string {
  if (label === 'LCP')  return value <= 2.5 ? 'var(--green)' : value <= 4.0  ? 'var(--yellow)' : 'var(--red)'
  if (label === 'CLS')  return value <= 0.1 ? 'var(--green)' : value <= 0.25 ? 'var(--yellow)' : 'var(--red)'
  if (label === 'INP')  return value <= 200 ? 'var(--green)' : value <= 500  ? 'var(--yellow)' : 'var(--red)'
  if (label === 'TTFB') return value <= 600 ? 'var(--green)' : value <= 1800 ? 'var(--yellow)' : 'var(--red)'
  return 'var(--t1)'
}

function savingsColor(ms: number): string {
  if (ms >= 500) return 'var(--red)'
  if (ms >= 200) return 'var(--yellow)'
  return 'var(--green)'
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), timeout)
    })
  }
  return { copied, copy }
}

// ── Diagnostics panel with copy ───────────────────────────────────────────────

function DiagnosticsPanel({ diagnostics }: { diagnostics: PsiDiagnostic[] }) {
  const { copied, copy } = useCopy()

  const allText = diagnostics
    .map(d => d.displayValue ? `${d.title} — ${d.displayValue}` : d.title)
    .join('\n')

  return (
    <div className="rounded-[var(--rl)] border" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--b1)' }}>
        <div>
          <div className="font-mono text-[12px] font-semibold text-[var(--t1)] uppercase tracking-wider">
            Diagnostics
          </div>
          <div className="font-mono text-[10px] text-[var(--t3)] mt-0.5">
            Additional information — no direct savings estimate
          </div>
        </div>
        <button
          onClick={() => copy(allText, 'all')}
          className="flex items-center gap-1 px-2 py-1 rounded font-mono text-[10px] transition-all hover:opacity-70 flex-shrink-0"
          style={{ background: 'var(--s2)', color: copied === 'all' ? 'var(--green)' : 'var(--t3)', border: '1px solid var(--b2)' }}
          title="Copy all diagnostics"
        >
          {copied === 'all' ? <Check size={9} /> : <Copy size={9} />}
          {copied === 'all' ? 'Copied' : 'Copy all'}
        </button>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--b1)' }}>
        {diagnostics.map(diag => {
          const rowText = diag.displayValue ? `${diag.title} — ${diag.displayValue}` : diag.title
          return (
            <div key={diag.id} className="flex items-center gap-3 px-4 py-3 group">
              <Info size={12} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[12px] text-[var(--t1)] truncate">{diag.title}</div>
                {diag.displayValue && (
                  <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5">{diag.displayValue}</div>
                )}
              </div>
              <button
                onClick={() => copy(rowText, diag.id)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                style={{ color: copied === diag.id ? 'var(--green)' : 'var(--t3)' }}
                title="Copy"
              >
                {copied === diag.id ? <Check size={10} /> : <Copy size={10} />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PsiDetail() {
  const { activeSiteId, setActiveNav } = useAppStore()
  const [device, setDevice]     = useState<'mobile' | 'desktop'>('mobile')
  const [data, setData]         = useState<PsiData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const loadSnapshot = useCallback(async () => {
    if (!activeSiteId) return
    try {
      const snaps = await getSiteSnapshots(activeSiteId)
      const psiSnap = snaps.find(s => s.source === 'psi')
      if (psiSnap) {
        const d = psiSnap.data as any
        if (d.mobile && d.desktop) {
          setData({ mobile: d.mobile, desktop: d.desktop })
          setFetchedAt(psiSnap.fetched_at)
        }
      }
    } catch (e) {
      // no snapshot yet — that's fine, user can refresh
    }
  }, [activeSiteId])

  useEffect(() => { loadSnapshot() }, [loadSnapshot])

  async function handleRefresh() {
    if (!activeSiteId) return
    setLoading(true)
    setError(null)
    try {
      const result = await fetchMcpData('psi', activeSiteId) as any
      if (result.mobile && result.desktop) {
        setData({ mobile: result.mobile, desktop: result.desktop })
        setFetchedAt(new Date().toISOString())
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  const metrics = data ? data[device] : null

  const cwvItems = metrics ? [
    { label: 'LCP',  value: metrics.lcp,  display: `${metrics.lcp}s`    },
    { label: 'CLS',  value: metrics.cls,  display: `${metrics.cls}`      },
    { label: 'INP',  value: metrics.inp,  display: `${metrics.inp}ms`    },
    { label: 'TTFB', value: metrics.ttfb, display: `${metrics.ttfb}ms`   },
  ] : []

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveNav('dashboard')}
          className="flex items-center gap-1.5 font-mono text-[12px] transition-opacity hover:opacity-70"
          style={{ color: 'var(--t3)' }}
        >
          <ArrowLeft size={13} /> Back
        </button>
        <div className="flex-1">
          <div className="font-mono text-[17px] font-semibold text-[var(--t1)] uppercase tracking-wider">
            PageSpeed Insights
          </div>
          <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5">
            Core Web Vitals · Lab data (Lighthouse)
            {fetchedAt && (
              <span className="ml-2 opacity-60">
                · {new Date(fetchedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading || !activeSiteId}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-[11px] transition-all hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--bdim)', color: 'var(--blue)', border: '1px solid rgba(56,189,248,0.2)' }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Running…' : 'Run PSI'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded font-mono text-[12px]"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {!data && !loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 font-mono text-[13px] text-[var(--t3)]">
          No PSI data yet. Click <span style={{ color: 'var(--blue)' }}>Run PSI</span> to fetch.
        </div>
      )}

      {data && (
        <>
          {/* Score + device toggle */}
          <div className="rounded-[var(--rl)] border p-5"
            style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
            <div className="flex items-start gap-6">
              <div className="flex flex-col items-center gap-2">
                <ScoreArc value={metrics?.score ?? null} size={110} />
                <div className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider">
                  Performance Score
                </div>
              </div>
              <div className="flex-1">
                <div className="flex gap-1 mb-4">
                  {(['mobile', 'desktop'] as const).map(d => (
                    <button key={d} onClick={() => setDevice(d)}
                      className="px-3 py-1 rounded font-mono text-[11px] uppercase tracking-wide transition-colors"
                      style={{
                        background: device === d ? 'rgba(56,189,248,0.15)' : 'transparent',
                        color:      device === d ? 'var(--blue)' : 'var(--t3)',
                        border:     device === d ? '1px solid rgba(56,189,248,0.3)' : '1px solid var(--b1)',
                      }}>{d}</button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {cwvItems.map(({ label, value, display }) => (
                    <div key={label} className="flex flex-col items-center py-3 rounded-[var(--r)]"
                      style={{ background: 'var(--s2)' }}>
                      <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider mb-1">{label}</span>
                      <span className="font-mono text-[16px] font-bold" style={{ color: cwvColor(label, value) }}>
                        {display}
                      </span>
                    </div>
                  ))}
                </div>
                {metrics?.lcpElement && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded font-mono text-[11px]"
                    style={{ background: 'var(--s2)', color: 'var(--t3)' }}>
                    <Info size={11} className="flex-shrink-0 mt-0.5" />
                    <span>LCP element: <code className="text-[var(--t1)]">{metrics.lcpElement}</code></span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Opportunities */}
          {metrics?.opportunities && metrics.opportunities.length > 0 && (
            <div className="rounded-[var(--rl)] border" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <div className="font-mono text-[12px] font-semibold text-[var(--t1)] uppercase tracking-wider">
                  Opportunities
                </div>
                <div className="font-mono text-[10px] text-[var(--t3)] mt-0.5">
                  Potential savings — sorted by impact
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--b1)' }}>
                {metrics.opportunities.map(opp => (
                  <div key={opp.id} className="flex items-center gap-3 px-4 py-3">
                    <AlertTriangle size={12} style={{ color: savingsColor(opp.savingsMs), flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[12px] text-[var(--t1)] truncate">{opp.title}</div>
                      {opp.displayValue && (
                        <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5">{opp.displayValue}</div>
                      )}
                    </div>
                    {opp.savingsMs > 0 && (
                      <div className="font-mono text-[12px] font-bold flex-shrink-0"
                        style={{ color: savingsColor(opp.savingsMs) }}>
                        −{opp.savingsMs >= 1000
                          ? `${(opp.savingsMs / 1000).toFixed(1)}s`
                          : `${opp.savingsMs}ms`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diagnostics */}
          {metrics?.diagnostics && metrics.diagnostics.length > 0 && (
            <DiagnosticsPanel diagnostics={metrics.diagnostics} />
          )}

          {metrics && !metrics.opportunities?.length && !metrics.diagnostics?.length && (
            <div className="font-mono text-[12px] text-[var(--t3)] text-center py-6">
              No issues found — refresh PSI to get audit data.
            </div>
          )}
        </>
      )}
    </div>
  )
}
