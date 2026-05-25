import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Maximize2, X } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  XAxis, YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { useAppStore } from '../store/appStore'
import { fetchGa4Timeseries, getSiteSnapshots } from '../lib/tauri'
import type { Ga4DataPoint, Snapshot } from '../lib/tauri'

const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)

const RANGES = [7, 30, 90, 365] as const
type Range = (typeof RANGES)[number]
const RANGE_LABELS: Record<Range, string> = { 7: '7d', 30: '30d', 90: '90d', 365: 'All' }

function fmtDate(d: string, range: Range): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  if (range <= 30) return `${dt.getMonth() + 1}/${dt.getDate()}`
  if (range <= 90) return dt.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  return dt.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="px-3 py-2 rounded font-mono text-[11px]"
      style={{
        background: 'var(--s1)',
        border: '1px solid var(--b2)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      <div className="text-[var(--t3)] mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          {p.name}: {p.value?.toLocaleString()}{unit ? ` ${unit}` : ''}
        </div>
      ))}
    </div>
  )
}

interface ChartCfg {
  id: string
  title: string
  subtitle: string
  // single-series or dual-series
  series: { key: keyof Ga4DataPoint; color: string; name: string }[]
  chartType: 'area' | 'line'
  unit?: string
  reversed?: boolean
}

const CHARTS: ChartCfg[] = [
  {
    id: 'sessions',
    title: 'Sessions',
    subtitle: 'total vs organic',
    chartType: 'area',
    series: [
      { key: 'sessions', color: 'var(--accent)', name: 'Sessions' },
      { key: 'organic',  color: 'var(--green)',  name: 'Organic'  },
    ],
  },
  {
    id: 'users',
    title: 'Users',
    subtitle: 'unique visitors',
    chartType: 'area',
    series: [{ key: 'users', color: 'var(--blue)', name: 'Users' }],
  },
  {
    id: 'engagement',
    title: 'Engagement Rate',
    subtitle: 'sessions >10s or 2+ pages',
    chartType: 'line',
    unit: '%',
    series: [{ key: 'engagementRate', color: 'var(--green)', name: 'Engagement' }],
  },
  {
    id: 'bounce',
    title: 'Bounce Rate',
    subtitle: 'lower is better',
    chartType: 'line',
    unit: '%',
    series: [{ key: 'bounceRate', color: 'var(--red)', name: 'Bounce' }],
  },
]

function ChartPanel({
  cfg, data, range, height = 180, instanceKey = '', onExpand,
}: {
  cfg: ChartCfg
  data: Ga4DataPoint[]
  range: Range
  height?: number
  instanceKey?: string
  onExpand?: () => void
}) {
  const tickFmt = (d: string) => fmtDate(d, range)
  const margin = { top: 6, right: 8, left: -22, bottom: 0 }
  const axisProps = {
    tick: { fill: 'var(--t3)', fontSize: 9, fontFamily: 'monospace' },
    tickLine: false as const,
    axisLine: false as const,
  }
  const showLegend = cfg.series.length > 1

  const inner =
    cfg.chartType === 'area' ? (
      <AreaChart data={data} margin={margin}>
        <defs>
          {cfg.series.map(s => (
            <linearGradient key={s.key} id={`ga4-grad-${s.key}-${instanceKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={s.color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0}    />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--b1)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={tickFmt} interval="preserveStartEnd" {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip content={<ChartTooltip unit={cfg.unit} />} />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--t3)' }}
            iconType="circle"
            iconSize={7}
          />
        )}
        {cfg.series.map(s => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key as string}
            name={s.name}
            stroke={s.color}
            fill={`url(#ga4-grad-${s.key}-${instanceKey})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </AreaChart>
    ) : (
      <LineChart data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--b1)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={tickFmt} interval="preserveStartEnd" {...axisProps} />
        <YAxis reversed={cfg.reversed} {...axisProps} />
        <Tooltip content={<ChartTooltip unit={cfg.unit} />} />
        {cfg.series.map(s => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key as string}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    )

  return (
    <div className="rounded-[var(--rl)] border overflow-hidden" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
      <div className="flex items-center justify-between px-4 h-11 border-b" style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[12px] font-semibold text-[var(--t1)]">{cfg.title}</span>
          <span className="font-mono text-[10px] text-[var(--t3)] truncate">{cfg.subtitle}</span>
        </div>
        {onExpand && (
          <button
            onClick={onExpand}
            className="ml-2 flex-shrink-0 p-1 rounded hover:bg-[var(--s3)] transition-colors"
            title="Expand fullscreen"
          >
            <Maximize2 size={11} style={{ color: 'var(--t3)' }} />
          </button>
        )}
      </div>
      <div className="px-2 py-3">
        <ResponsiveContainer width="100%" height={height}>
          {inner}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Clarity snapshot types ────────────────────────────────────────────────────

interface ClaritySnap {
  sessions: number
  bots: number
  users: number
  pagesPerSession: number
  rageclicks: number
  deadClicks: number
  quickBacks: number
  scriptErrors: number
  scrollDepth: number
  engageTime: number
  period: string
  byDevice: { device: string; sessions: number }[]
  topPages: { url: string; sessions: number }[]
  bySources: { source: string; sessions: number }[]
}

function parseClarity(snaps: Snapshot[]): ClaritySnap | null {
  const s = snaps.find(s => s.source === 'clarity')
  return s ? (s.data as unknown as ClaritySnap) : null
}

// ── Clarity section component ─────────────────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center py-2 px-3 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
      <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider mb-0.5">{label}</span>
      <span className="font-mono text-[14px] font-bold" style={{ color: color ?? 'var(--t1)' }}>{value}</span>
    </div>
  )
}

function ClaritySection({ c }: { c: ClaritySnap }) {
  const realSessions = c.sessions - (c.bots ?? 0)
  const topDevices = (c.byDevice ?? []).slice(0, 3)
  const topPages   = (c.topPages  ?? []).slice(0, 5)
  const topSources = (c.bySources ?? []).slice(0, 4)

  return (
    <div className="mt-6 flex flex-col gap-4">
      {/* Divider + label */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1" style={{ background: 'var(--b1)' }} />
        <span className="font-mono text-[10px] uppercase tracking-wider px-2" style={{ color: 'var(--t3)' }}>
          Microsoft Clarity · last {c.period ?? '3d'}
        </span>
        <div className="h-px flex-1" style={{ background: 'var(--b1)' }} />
      </div>

      {/* Main metrics */}
      <div className="grid grid-cols-4 gap-2">
        <StatBox label="Sessions (real)"  value={realSessions.toLocaleString()} color="var(--accent)" />
        <StatBox label="Scroll Depth"     value={`${c.scrollDepth}%`}
          color={c.scrollDepth >= 60 ? 'var(--green)' : 'var(--yellow)'} />
        <StatBox label="Engage Time"      value={`${c.engageTime}s`} color="var(--blue)" />
        <StatBox label="Pages / Session"  value={String(c.pagesPerSession)} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <StatBox label="Rage Clicks"      value={String(c.rageclicks)}
          color={c.rageclicks > 50 ? 'var(--red)' : c.rageclicks > 10 ? 'var(--yellow)' : 'var(--green)'} />
        <StatBox label="Dead Clicks"      value={String(c.deadClicks)}
          color={c.deadClicks > 100 ? 'var(--red)' : c.deadClicks > 30 ? 'var(--yellow)' : 'var(--green)'} />
        <StatBox label="Quick Backs"      value={String(c.quickBacks)}
          color={c.quickBacks > 20 ? 'var(--yellow)' : 'var(--green)'} />
        <StatBox label="Script Errors"    value={String(c.scriptErrors ?? 0)}
          color={(c.scriptErrors ?? 0) > 0 ? 'var(--yellow)' : 'var(--green)'} />
      </div>

      {/* Breakdowns row */}
      <div className="grid grid-cols-3 gap-3">

        {/* By device */}
        {topDevices.length > 0 && (
          <div className="rounded-[var(--rl)] border overflow-hidden" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
            <div className="px-3 py-2 border-b font-mono text-[10px] uppercase tracking-wider text-[var(--t3)]"
              style={{ borderColor: 'var(--b1)' }}>By Device</div>
            <div className="p-3 flex flex-col gap-1.5">
              {topDevices.map(d => {
                const pct = c.sessions > 0 ? Math.round(d.sessions / c.sessions * 100) : 0
                return (
                  <div key={d.device} className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--t2)] w-16 truncate">{d.device}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--s3)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                    </div>
                    <span className="font-mono text-[10px] text-[var(--t3)] w-8 text-right">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top pages */}
        {topPages.length > 0 && (
          <div className="rounded-[var(--rl)] border overflow-hidden" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
            <div className="px-3 py-2 border-b font-mono text-[10px] uppercase tracking-wider text-[var(--t3)]"
              style={{ borderColor: 'var(--b1)' }}>Top Pages</div>
            <div className="p-3 flex flex-col gap-1.5">
              {topPages.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-[var(--t3)] w-3">{i + 1}</span>
                  <span className="font-mono text-[11px] text-[var(--t2)] flex-1 truncate" title={p.url}>
                    {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--t3)]">{p.sessions.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By source */}
        {topSources.length > 0 && (
          <div className="rounded-[var(--rl)] border overflow-hidden" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
            <div className="px-3 py-2 border-b font-mono text-[10px] uppercase tracking-wider text-[var(--t3)]"
              style={{ borderColor: 'var(--b1)' }}>Traffic Sources</div>
            <div className="p-3 flex flex-col gap-1.5">
              {topSources.map(s => {
                const pct = c.sessions > 0 ? Math.round(s.sessions / c.sessions * 100) : 0
                return (
                  <div key={s.source} className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--t2)] w-16 truncate">{s.source || 'Direct'}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--s3)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--green)' }} />
                    </div>
                    <span className="font-mono text-[10px] text-[var(--t3)] w-8 text-right">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Ga4Detail() {
  const { sites, activeSiteId, setActiveNav } = useAppStore()
  const [range, setRange]     = useState<Range>(30)
  const [data, setData]       = useState<Ga4DataPoint[]>([])
  const [clarity, setClarity] = useState<ClaritySnap | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ChartCfg | null>(null)

  const site = sites.find(s => s.id === activeSiteId)

  const load = useCallback(async () => {
    const siteId = activeSiteId ?? 1
    setLoading(true)
    setError(null)
    try {
      const [result, snaps] = await Promise.all([
        fetchGa4Timeseries(siteId, range),
        getSiteSnapshots(siteId),
      ])
      setData(result)
      setClarity(parseClarity(snaps))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [activeSiteId, range])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex-1 overflow-y-auto p-6">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button
          onClick={() => setActiveNav('dashboard')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
          style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}
        >
          <ArrowLeft size={11} /> Back
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl text-[var(--t1)]">
            Google Analytics 4 <span style={{ color: 'var(--accent)' }}>Details</span>
          </h1>
          <p className="font-mono text-[11px] text-[var(--t3)]">
            {site ? site.domain : 'Select a site in the Sites page to view data'}
          </p>
        </div>

        {/* Range pills */}
        <div className="flex items-center gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="px-2.5 py-1 rounded font-mono text-[10px] uppercase transition-colors"
              style={{
                background: range === r ? 'var(--adim)' : 'transparent',
                color:      range === r ? 'var(--accent)' : 'var(--t3)',
                border:     range === r ? '1px solid rgba(249,115,22,0.3)' : '1px solid transparent',
              }}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>

        {IS_TAURI && (
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--accent)] disabled:opacity-50"
            style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-5 px-4 py-3 rounded-[var(--r)] border font-mono text-[12px]"
          style={{ background: 'var(--rdim)', borderColor: 'rgba(239,68,68,0.3)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* Chart grid */}
      {data.length === 0 && !loading ? (
        <div className="flex items-center justify-center h-64 font-mono text-[12px] text-[var(--t3)]">
          {IS_TAURI
            ? 'No GA4 data — select a site and click Refresh'
            : 'Generating mock data…'}
        </div>
      ) : loading && data.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            {CHARTS.map(cfg => (
              <ChartPanel
                key={cfg.id}
                cfg={cfg}
                data={data}
                range={range}
                instanceKey="grid"
                onExpand={() => setExpanded(cfg)}
              />
            ))}
          </div>
          {clarity && <ClaritySection c={clarity} />}
        </>
      )}

      {/* Fullscreen overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setExpanded(null)}
        >
          <div
            className="w-[82vw] max-w-5xl rounded-[var(--rl)] border overflow-hidden"
            style={{ background: 'var(--bg2)', borderColor: 'var(--b2)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 h-14 border-b" style={{ borderColor: 'var(--b1)' }}>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-[16px] text-[var(--t1)]">{expanded.title}</span>
                <span className="font-mono text-[11px] text-[var(--t3)]">{expanded.subtitle}</span>
              </div>
              <button
                onClick={() => setExpanded(null)}
                className="p-2 rounded hover:bg-[var(--s3)] transition-colors"
              >
                <X size={14} style={{ color: 'var(--t3)' }} />
              </button>
            </div>
            <div className="p-6">
              <ChartPanel cfg={expanded} data={data} range={range} height={400} instanceKey="fs" />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
