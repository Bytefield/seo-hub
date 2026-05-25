import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, RefreshCw, Maximize2, X } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  XAxis, YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useAppStore } from '../store/appStore'
import { fetchGscTimeseries, fetchBwtTimeseries, getSiteSnapshots } from '../lib/tauri'
import type { GscDataPoint, BwtDataPoint, Snapshot } from '../lib/tauri'

type VisSource = 'gsc' | 'bwt' | 'total'

interface BwtSnapshot {
  clicks: number; impressions: number; ctr: number; position: number; crawlErrors: number
  fetchedAt?: string
  keywords?: { keyword: string; clicks: number; impressions: number; ctr: number; position: number }[]
  seoErrors?: { titleErrors: number; descErrors: number; total: number }
}

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
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.value?.toLocaleString()}{unit ? ` ${unit}` : ''}
        </div>
      ))}
    </div>
  )
}

interface ChartCfg {
  id: string
  title: string
  subtitle: string
  dataKey: keyof GscDataPoint
  color: string
  chartType: 'area' | 'line'
  unit?: string
  reversed?: boolean
}

const CHARTS: ChartCfg[] = [
  { id: 'clicks',   title: 'Clicks',        subtitle: 'organic clicks from Google',    dataKey: 'clicks',      color: 'var(--accent)', chartType: 'area' },
  { id: 'impr',     title: 'Impressions',   subtitle: 'search appearances',             dataKey: 'impressions', color: 'var(--blue)',   chartType: 'area' },
  { id: 'ctr',      title: 'CTR',           subtitle: 'click-through rate',             dataKey: 'ctr',         color: 'var(--green)',  chartType: 'line', unit: '%' },
  { id: 'position', title: 'Avg Position',  subtitle: 'lower is better',                dataKey: 'position',    color: 'var(--yellow)', chartType: 'line', reversed: true },
]

const BWT_CHARTS: ChartCfg[] = [
  { id: 'bwt-clicks', title: 'Clicks',       subtitle: 'organic clicks from Bing',     dataKey: 'clicks',      color: 'var(--green)',  chartType: 'area' },
  { id: 'bwt-impr',   title: 'Impressions',  subtitle: 'Bing search appearances',      dataKey: 'impressions', color: 'var(--blue)',   chartType: 'area' },
  { id: 'bwt-ctr',    title: 'CTR',          subtitle: 'Bing click-through rate',      dataKey: 'ctr',         color: 'var(--accent)', chartType: 'line', unit: '%' },
  { id: 'bwt-pos',    title: 'Avg Position', subtitle: 'Bing ranking — lower is better', dataKey: 'position',  color: 'var(--yellow)', chartType: 'line', reversed: true },
]

function SummaryCards({ pts, color }: { pts: { clicks: number; impressions: number; ctr: number; position: number }[]; color: string }) {
  if (pts.length === 0) return null
  const totalClicks = pts.reduce((s, p) => s + p.clicks, 0)
  const totalImpr   = pts.reduce((s, p) => s + p.impressions, 0)
  const avgCtr      = pts.length ? pts.reduce((s, p) => s + p.ctr, 0) / pts.length : 0
  const avgPos      = pts.length ? pts.reduce((s, p) => s + p.position, 0) / pts.length : 0
  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {[
        { label: 'Total Clicks',      value: totalClicks.toLocaleString() },
        { label: 'Total Impressions', value: totalImpr.toLocaleString()   },
        { label: 'Avg CTR',           value: `${avgCtr.toFixed(1)}%`      },
        { label: 'Avg Position',      value: `#${avgPos.toFixed(1)}`      },
      ].map(({ label, value }) => (
        <div key={label} className="rounded-[var(--rl)] border p-3 flex flex-col gap-0.5"
          style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
          <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)]">{label}</div>
          <div className="font-mono text-[22px] font-bold" style={{ color }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function ChartPanel({
  cfg, data, range, height = 180, instanceKey = '', onExpand,
}: {
  cfg: ChartCfg
  data: GscDataPoint[]
  range: Range
  height?: number
  instanceKey?: string
  onExpand?: () => void
}) {
  const gradId = `gsc-grad-${cfg.id}-${instanceKey}`
  const tickFmt = (d: string) => fmtDate(d, range)
  const margin = { top: 6, right: 8, left: -22, bottom: 0 }
  const axisProps = {
    tick: { fill: 'var(--t3)', fontSize: 9, fontFamily: 'monospace' },
    tickLine: false as const,
    axisLine: false as const,
  }

  const inner =
    cfg.chartType === 'area' ? (
      <AreaChart data={data} margin={margin}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.28} />
            <stop offset="95%" stopColor={cfg.color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--b1)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={tickFmt} interval="preserveStartEnd" {...axisProps} />
        <YAxis reversed={cfg.reversed} {...axisProps} />
        <Tooltip content={<ChartTooltip unit={cfg.unit} />} />
        <Area
          type="monotone" dataKey={cfg.dataKey as string}
          stroke={cfg.color} fill={`url(#${gradId})`}
          strokeWidth={2} dot={false} activeDot={{ r: 3 }}
        />
      </AreaChart>
    ) : (
      <LineChart data={data} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--b1)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={tickFmt} interval="preserveStartEnd" {...axisProps} />
        <YAxis reversed={cfg.reversed} {...axisProps} />
        <Tooltip content={<ChartTooltip unit={cfg.unit} />} />
        <Line
          type="monotone" dataKey={cfg.dataKey as string}
          stroke={cfg.color} strokeWidth={2} dot={false} activeDot={{ r: 3 }}
        />
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

export default function GscDetail() {
  const { sites, activeSiteId, setActiveNav } = useAppStore()
  const [source, setSource]     = useState<VisSource>('gsc')
  const [range, setRange]       = useState<Range>(30)
  const [data, setData]         = useState<GscDataPoint[]>([])
  const [bwtData, setBwtData]   = useState<BwtDataPoint[]>([])
  const [bwt, setBwt]           = useState<BwtSnapshot | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ChartCfg | null>(null)

  const site = sites.find(s => s.id === activeSiteId)

  const load = useCallback(async () => {
    const siteId = activeSiteId ?? 1
    setLoading(true)
    setError(null)
    try {
      const [ts, bwtTs, snaps] = await Promise.all([
        fetchGscTimeseries(siteId, range),
        fetchBwtTimeseries(siteId, range),
        getSiteSnapshots(siteId),
      ])
      setData(ts)
      setBwtData(bwtTs)
      const bwtSnap = snaps.find((s: Snapshot) => s.source === 'bwt')
      if (bwtSnap) {
        const d = bwtSnap.data as any
        setBwt({
          clicks: d.clicks, impressions: d.impressions, ctr: d.ctr,
          position: d.position, crawlErrors: d.crawlErrors,
          fetchedAt: bwtSnap.fetched_at,
          keywords: d.keywords, seoErrors: d.seoErrors,
        })
      } else {
        setBwt(null)
      }
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
      <div className="flex flex-col gap-3 mb-6">
        {/* Row 1: back + title + refresh */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveNav('dashboard')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--blue)] hover:text-[var(--blue)]"
            style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}
          >
            <ArrowLeft size={11} /> Back
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="font-display text-xl text-[var(--t1)]">
              Search <span style={{ color: 'var(--blue)' }}>Performance</span>
            </h1>
            <p className="font-mono text-[11px] text-[var(--t3)]">
              {site ? site.domain : 'Select a site in the Sites page to view data'}
            </p>
          </div>

          {IS_TAURI && (
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--blue)] disabled:opacity-50"
              style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          )}
        </div>

        {/* Row 2: source toggle */}
        <div className="flex items-center gap-1.5 px-1">
          {([
            ['gsc',   'GSC',   'var(--accent)', 'var(--adim)', 'rgba(249,115,22,0.3)'],
            ['bwt',   'BWT',   'var(--green)',  'var(--gdim)', 'rgba(16,217,160,0.3)'],
            ['total', 'Total', 'var(--blue)',   'var(--bdim)', 'rgba(56,189,248,0.3)'],
          ] as const).map(([s, label, color, bg, border]) => (
            <button key={s} onClick={() => setSource(s)}
              className="px-3 py-1.5 rounded font-mono text-[11px] uppercase tracking-wide transition-colors"
              style={{
                background: source === s ? bg : 'var(--s2)',
                color:      source === s ? color : 'var(--t3)',
                border:     `1px solid ${source === s ? border : 'var(--b1)'}`,
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Row 3: range pills — only for GSC / Total */}
        {source !== 'bwt' && (
          <div className="flex items-center gap-1 px-1">
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className="px-2.5 py-1 rounded font-mono text-[10px] uppercase transition-colors"
                style={{
                  background: range === r ? 'var(--bdim)' : 'transparent',
                  color:      range === r ? 'var(--blue)'  : 'var(--t3)',
                  border:     range === r ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
                }}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
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

      {loading && data.length === 0 && bwtData.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--blue)' }} />
        </div>
      ) : (
        <>
          {/* GSC section */}
          {(source === 'gsc' || source === 'total') && (
            <div className={source === 'total' ? 'mb-8' : ''}>
              {source === 'total' && (
                <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[var(--t3)]">
                  Google Search Console
                </div>
              )}
              {data.length === 0 ? (
                <div className="flex items-center justify-center h-48 font-mono text-[12px] text-[var(--t3)]">
                  {IS_TAURI ? 'No GSC data — select a site and click Refresh' : 'Generating mock data…'}
                </div>
              ) : (
                <>
                  <SummaryCards pts={data} color="var(--accent)" />
                  <div className="grid grid-cols-2 gap-4">
                    {CHARTS.map(cfg => (
                      <ChartPanel key={cfg.id} cfg={cfg} data={data} range={range}
                        instanceKey="grid" onExpand={() => setExpanded(cfg)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* BWT section */}
          {(source === 'bwt' || source === 'total') && (
            <div>
              {source === 'total' && (
                <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[var(--t3)]">
                  Bing Webmaster Tools
                </div>
              )}
              {bwtData.length === 0 ? (
                <div className="flex items-center justify-center h-48 font-mono text-[12px] text-[var(--t3)]">
                  {IS_TAURI
                    ? 'No BWT history yet — Refresh a few times to build the timeseries'
                    : 'Generating mock data…'}
                </div>
              ) : (
                <>
                  <SummaryCards pts={bwtData} color="var(--green)" />
                  <div className="grid grid-cols-2 gap-4">
                    {BWT_CHARTS.map(cfg => (
                      <ChartPanel key={cfg.id} cfg={cfg} data={bwtData} range={range}
                        instanceKey="bwt" onExpand={() => setExpanded(cfg)} />
                    ))}
                  </div>
                </>
              )}

              {/* Crawl errors / SEO issues from latest snapshot */}
              {bwt && (
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="rounded-[var(--rl)] border p-4"
                    style={{ background: bwt.crawlErrors > 0 ? 'var(--rdim)' : 'var(--s1)', borderColor: bwt.crawlErrors > 0 ? 'rgba(239,68,68,0.3)' : 'var(--b1)' }}>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)] mb-1">Crawl Errors</div>
                    <div className="font-mono text-[20px] font-bold" style={{ color: bwt.crawlErrors > 0 ? 'var(--red)' : 'var(--green)' }}>{bwt.crawlErrors}</div>
                    <div className="font-mono text-[10px] text-[var(--t3)] mt-1">pages Bing cannot crawl</div>
                  </div>
                  {bwt.seoErrors && bwt.seoErrors.titleErrors > 0 && (
                    <div className="rounded-[var(--rl)] border p-4"
                      style={{ background: 'var(--ydim)', borderColor: 'rgba(245,158,11,0.3)' }}>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)] mb-1">Duplicate Titles</div>
                      <div className="font-mono text-[20px] font-bold text-[var(--yellow)]">{bwt.seoErrors.titleErrors}</div>
                      <div className="font-mono text-[10px] text-[var(--t3)] mt-1">pages affected</div>
                    </div>
                  )}
                  {bwt.seoErrors && bwt.seoErrors.descErrors > 0 && (
                    <div className="rounded-[var(--rl)] border p-4"
                      style={{ background: 'var(--ydim)', borderColor: 'rgba(245,158,11,0.3)' }}>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)] mb-1">Duplicate Descs.</div>
                      <div className="font-mono text-[20px] font-bold text-[var(--yellow)]">{bwt.seoErrors.descErrors}</div>
                      <div className="font-mono text-[10px] text-[var(--t3)] mt-1">pages affected</div>
                    </div>
                  )}
                  {bwt.fetchedAt && (
                    <div className="col-span-3 font-mono text-[10px] text-[var(--t3)] text-right">
                      Last snapshot {new Date(bwt.fetchedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
