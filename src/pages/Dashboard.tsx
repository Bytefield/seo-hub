import { useState, useRef, useEffect, useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Zap, Eye, MousePointer, ChevronDown, RefreshCw, Copy, Check, Bot, ArrowRight, FileText } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { fetchMcpData, getSiteSnapshots, getLastAudit } from '../lib/tauri'
import type { Snapshot, DomAudit } from '../lib/tauri'

const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)

// ── Live data types ────────────────────────────────────────────────────────────

interface GscKeyword { keyword: string; clicks: number; impressions: number; ctr: number; position: number }
interface GscData  { clicks: number; impressions: number; ctr: number; position: number; keywords?: GscKeyword[]; d: { clicks: number; impressions: number; ctr: number; position: number } }
interface Ga4Data  { sessions: number; organic: number; conversions: number; users: number; engagementRate: number; bounceRate: number; d: { sessions: number; organic: number; conversions: number; users: number; engagementRate: number; bounceRate: number } }
interface ClarityData { rageclicks: number; sessions: number; scrollDepth: number; engageTime: number; deadClicks: number; quickBacks: number; d: { rageclicks: number; sessions: number; scrollDepth: number; engageTime: number; deadClicks: number; quickBacks: number } }
interface PsiOpportunity { id: string; title: string; displayValue: string; savingsMs: number }
interface PsiDiagnostic  { id: string; title: string; displayValue: string }
interface PsiMetrics { lcp: number; cls: number; inp: number; ttfb: number; score: number; lcpElement?: string; opportunities?: PsiOpportunity[]; diagnostics?: PsiDiagnostic[] }
interface CwvData  { mobile: PsiMetrics; desktop: PsiMetrics }
interface BwtKeyword { keyword: string; clicks: number; impressions: number; ctr: number; position: number }
interface BwtData  { clicks: number; impressions: number; ctr: number; position: number; crawlErrors: number; keywords?: BwtKeyword[]; seoErrors?: { titleErrors: number; descErrors: number; total: number }; d: { clicks: number; impressions: number; ctr: number; position: number; crawlErrors: number } }
interface OprData  { pageRank: number; prDecimal: number; domainRank: string; domain: string }

interface McpData {
  gsc:     GscData     | null
  ga4:     Ga4Data     | null
  clarity: ClarityData | null
  cwv:     CwvData     | null
  bwt:     BwtData     | null
  opr:     OprData     | null
}

// Browser dev mock
const DEV_DATA: McpData = {
  gsc:     { clicks: 1840, impressions: 48200, ctr: 3.8, position: 14.2, keywords: [
    { keyword: 'hipoteca fija 2025',      position: 7,  clicks: 142, impressions: 2840, ctr: 5.0 },
    { keyword: 'simulador hipoteca',       position: 11, clicks: 98,  impressions: 3120, ctr: 3.1 },
    { keyword: 'mejores hipotecas españa', position: 14, clicks: 61,  impressions: 1890, ctr: 3.2 },
    { keyword: 'comparador hipotecas',     position: 16, clicks: 44,  impressions: 2100, ctr: 2.1 },
    { keyword: 'hipoteca variable',        position: 19, clicks: 28,  impressions: 980,  ctr: 2.9 },
  ], d: { clicks: 12, impressions: 8, ctr: 0.4, position: -1.2 } },
  ga4:     { sessions: 4210, organic: 2680, conversions: 142, users: 3890, engagementRate: 68, bounceRate: 32, d: { sessions: 15, organic: 8, conversions: 22, users: 11, engagementRate: 5, bounceRate: 3 } },
  clarity: { rageclicks: 234, sessions: 842, scrollDepth: 72, engageTime: 48, deadClicks: 156, quickBacks: 89, d: { rageclicks: 31, sessions: 12, scrollDepth: 8, engageTime: 6, deadClicks: -15, quickBacks: 24 } },
  cwv:     { mobile: { lcp: 3.1, cls: 0.07, inp: 168, ttfb: 820, score: 61 }, desktop: { lcp: 1.4, cls: 0.02, inp: 84, ttfb: 420, score: 88 } },
  bwt:     { clicks: 312, impressions: 8900, ctr: 3.5, position: 18.7, crawlErrors: 12,
    keywords: [
      { keyword: 'gastos notariales compraventa',     clicks: 18, impressions: 96,  ctr: 18.75, position: 2.1 },
      { keyword: 'calculadora subrogación hipoteca',  clicks: 1,  impressions: 4,   ctr: 25.0,  position: 1.5 },
      { keyword: 'hipotecas y euribor',               clicks: 0,  impressions: 85,  ctr: 0,     position: 8.2 },
      { keyword: 'simulador hipoteca variable',       clicks: 4,  impressions: 210, ctr: 1.9,   position: 11.4 },
    ],
    seoErrors: { titleErrors: 10, descErrors: 10, total: 20 },
    d: { clicks: -3, impressions: 5, ctr: 0.2, position: -0.8, crawlErrors: 12 } },
  opr:     { pageRank: 4, prDecimal: 3.96, domainRank: '125430', domain: 'example.com' },
}

const EMPTY_DATA: McpData = { gsc: null, ga4: null, clarity: null, cwv: null, bwt: null, opr: null }


// ── Metric registry ────────────────────────────────────────────────────────────
type SourceId = 'gsc' | 'ga4' | 'clarity' | 'cwv' | 'bwt'

const SOURCES: { id: SourceId; label: string; color: string; bg: string }[] = [
  { id: 'gsc',     label: 'GSC',     color: 'var(--blue)',   bg: 'var(--bdim)'  },
  { id: 'ga4',     label: 'GA4',     color: 'var(--accent)', bg: 'var(--adim)'  },
  { id: 'clarity', label: 'Clarity', color: 'var(--purple)', bg: 'var(--pdim)'  },
  { id: 'cwv',     label: 'PSI/CWV', color: 'var(--yellow)', bg: 'var(--ydim)'  },
  { id: 'bwt',     label: 'BWT',     color: 'var(--green)',  bg: 'var(--gdim)'  },
]

interface MetricDef {
  id: string
  label: string
  desc: string
  source: SourceId
  value: (d: McpData) => number | string
  delta: (d: McpData) => number
  deltaInvert?: boolean
  suffix?: string
}

const METRICS: MetricDef[] = [
  // ── GSC ──────────────────────────────────────────────────────────────────────
  { id: 'gsc-clicks', label: 'Clicks',      source: 'gsc', desc: 'Total organic clicks from Google Search. Users who clicked your result after seeing it.',
    value: d => d.gsc ? d.gsc.clicks.toLocaleString() : '--', delta: d => d.gsc?.d.clicks ?? 0, suffix: '%' },
  { id: 'gsc-impr',   label: 'Impressions', source: 'gsc', desc: 'Times your pages appeared in Google results, whether clicked or not.',
    value: d => d.gsc ? d.gsc.impressions.toLocaleString() : '--', delta: d => d.gsc?.d.impressions ?? 0, suffix: '%' },
  { id: 'gsc-ctr',    label: 'CTR',         source: 'gsc', desc: 'Click-through rate: % of impressions that became clicks. Industry avg ~3–5%.',
    value: d => d.gsc ? `${d.gsc.ctr}%` : '--', delta: d => d.gsc?.d.ctr ?? 0, suffix: 'pp' },
  { id: 'gsc-pos',    label: 'Avg Position', source: 'gsc', desc: 'Average ranking position across all queries. Lower is better.',
    value: d => d.gsc ? d.gsc.position : '--', delta: d => d.gsc?.d.position ?? 0, deltaInvert: true, suffix: 'pos' },

  // ── GA4 ──────────────────────────────────────────────────────────────────────
  { id: 'ga4-organic',  label: 'Organic Sessions', source: 'ga4', desc: 'Sessions attributed to organic search. Excludes paid, direct, and referral.',
    value: d => d.ga4 ? d.ga4.organic.toLocaleString() : '--', delta: d => d.ga4?.d.organic ?? 0, suffix: '%' },
  { id: 'ga4-sessions', label: 'Total Sessions',   source: 'ga4', desc: 'All sessions across every traffic channel.',
    value: d => d.ga4 ? d.ga4.sessions.toLocaleString() : '--', delta: d => d.ga4?.d.sessions ?? 0, suffix: '%' },
  { id: 'ga4-users',    label: 'Users',             source: 'ga4', desc: 'Unique users (new + returning) who visited the site.',
    value: d => d.ga4 ? d.ga4.users.toLocaleString() : '--', delta: d => d.ga4?.d.users ?? 0, suffix: '%' },
  { id: 'ga4-conv',     label: 'Conversions',       source: 'ga4', desc: 'Goal completions: form submissions, phone clicks, or custom events marked as conversions.',
    value: d => d.ga4 ? d.ga4.conversions : '--', delta: d => d.ga4?.d.conversions ?? 0, suffix: '%' },
  { id: 'ga4-engage',   label: 'Engagement Rate',   source: 'ga4', desc: 'Sessions lasting >10s, with a conversion, or 2+ page views. Replaces Bounce Rate in GA4.',
    value: d => d.ga4 ? `${d.ga4.engagementRate}%` : '--', delta: d => d.ga4?.d.engagementRate ?? 0, suffix: 'pp' },
  { id: 'ga4-bounce',   label: 'Bounce Rate',       source: 'ga4', desc: 'Sessions with no meaningful interaction. Lower is better.',
    value: d => d.ga4 ? `${d.ga4.bounceRate}%` : '--', delta: d => d.ga4?.d.bounceRate ?? 0, deltaInvert: true, suffix: 'pp' },

  // ── Clarity ───────────────────────────────────────────────────────────────────
  { id: 'clr-rage',     label: 'Rage Clicks',  source: 'clarity', desc: 'Rapid repeated clicks — strong signal of user frustration or a broken UI.',
    value: d => d.clarity ? d.clarity.rageclicks : '--', delta: d => d.clarity?.d.rageclicks ?? 0, deltaInvert: true, suffix: '%' },
  { id: 'clr-sessions', label: 'Sessions',     source: 'clarity', desc: 'Total recorded sessions in Clarity. Validate against GA4 session count.',
    value: d => d.clarity ? d.clarity.sessions.toLocaleString() : '--', delta: d => d.clarity?.d.sessions ?? 0, suffix: '%' },
  { id: 'clr-scroll',   label: 'Scroll Depth', source: 'clarity', desc: 'Average % of page scrolled per session. Higher = users reading more content.',
    value: d => d.clarity ? `${d.clarity.scrollDepth}%` : '--', delta: d => d.clarity?.d.scrollDepth ?? 0, suffix: 'pp' },
  { id: 'clr-engage',   label: 'Engage Time',  source: 'clarity', desc: 'Average active time per session (mouse moves, scrolls, clicks).',
    value: d => d.clarity ? `${d.clarity.engageTime}s` : '--', delta: d => d.clarity?.d.engageTime ?? 0, suffix: 's' },
  { id: 'clr-dead',     label: 'Dead Clicks',  source: 'clarity', desc: 'Clicks on non-interactive elements. Users expect something to be clickable.',
    value: d => d.clarity ? d.clarity.deadClicks : '--', delta: d => d.clarity?.d.deadClicks ?? 0, deltaInvert: true, suffix: '%' },
  { id: 'clr-qback',    label: 'Quick Backs',  source: 'clarity', desc: 'Users who navigated to a page and immediately went back.',
    value: d => d.clarity ? d.clarity.quickBacks : '--', delta: d => d.clarity?.d.quickBacks ?? 0, deltaInvert: true, suffix: '%' },

  // ── PSI / CWV ─────────────────────────────────────────────────────────────────
  { id: 'cwv-lcp',   label: 'LCP',        source: 'cwv', desc: 'Largest Contentful Paint: how long the biggest visible element takes to load. Target <2.5s.',
    value: d => d.cwv ? `${d.cwv.mobile.lcp}s` : '--', delta: d => 0, deltaInvert: true, suffix: 's' },
  { id: 'cwv-cls',   label: 'CLS',        source: 'cwv', desc: 'Cumulative Layout Shift: how much the page moves during load. Target <0.1.',
    value: d => d.cwv ? d.cwv.mobile.cls : '--', delta: d => 0, deltaInvert: true, suffix: '' },
  { id: 'cwv-inp',   label: 'INP',        source: 'cwv', desc: 'Interaction to Next Paint: delay between user input and visual response. Target <200ms.',
    value: d => d.cwv ? `${d.cwv.mobile.inp}ms` : '--', delta: d => 0, deltaInvert: true, suffix: 'ms' },
  { id: 'cwv-ttfb',  label: 'TTFB',       source: 'cwv', desc: 'Time to First Byte: server response time. Target <600ms.',
    value: d => d.cwv ? `${d.cwv.mobile.ttfb}ms` : '--', delta: d => 0, deltaInvert: true, suffix: 'ms' },
  { id: 'cwv-score', label: 'Perf Score', source: 'cwv', desc: 'PageSpeed Insights composite score (0–100). Combines LCP, CLS, INP, TTFB, FCP, SI.',
    value: d => d.cwv ? d.cwv.mobile.score : '--', delta: d => 0, suffix: 'pts' },

  // ── BWT ──────────────────────────────────────────────────────────────────────
  { id: 'bwt-clicks',  label: 'Clicks',       source: 'bwt', desc: 'Organic clicks from Bing Search. Bing often delivers higher-intent B2C traffic.',
    value: d => d.bwt ? d.bwt.clicks : '--', delta: d => d.bwt?.d.clicks ?? 0, suffix: '%' },
  { id: 'bwt-impr',   label: 'Impressions',   source: 'bwt', desc: 'Times your pages appeared in Bing results.',
    value: d => d.bwt ? d.bwt.impressions.toLocaleString() : '--', delta: d => d.bwt?.d.impressions ?? 0, suffix: '%' },
  { id: 'bwt-ctr',    label: 'CTR',           source: 'bwt', desc: 'Bing click-through rate. Compare with GSC — large gaps may indicate title/meta issues.',
    value: d => d.bwt ? `${d.bwt.ctr}%` : '--', delta: d => d.bwt?.d.ctr ?? 0, suffix: 'pp' },
  { id: 'bwt-pos',    label: 'Avg Position',  source: 'bwt', desc: 'Average Bing ranking. Pages often rank differently on Bing vs Google.',
    value: d => d.bwt ? d.bwt.position : '--', delta: d => d.bwt?.d.position ?? 0, deltaInvert: true, suffix: 'pos' },
  { id: 'bwt-errors', label: 'Crawl Errors',  source: 'bwt', desc: 'Pages Bing could not crawl. Unresolved errors suppress Bing indexation.',
    value: d => d.bwt ? d.bwt.crawlErrors : '--', delta: d => d.bwt?.d.crawlErrors ?? 0, deltaInvert: true, suffix: '%' },
]

// ── Dashlet persistence ────────────────────────────────────────────────────────
interface DashletConfig { metricId: string }

const DEFAULT_DASHLETS: DashletConfig[] = [
  { metricId: 'gsc-clicks'  },
  { metricId: 'ga4-organic' },
  { metricId: 'clr-rage'    },
  { metricId: 'cwv-lcp'     },
  { metricId: 'bwt-clicks'  },
]

const LS_KEY = 'seohub-dashlets'

function loadDashlets(): DashletConfig[] {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return DEFAULT_DASHLETS
}

// ── Source tab presets ─────────────────────────────────────────────────────────
type DashTab = 'custom' | 'gsc' | 'ga4' | 'clarity' | 'cwv' | 'bwt'

const DASH_TABS: { id: DashTab; label: string; color: string }[] = [
  { id: 'custom',  label: 'Custom',  color: 'var(--t2)'     },
  { id: 'gsc',     label: 'GSC',     color: 'var(--blue)'   },
  { id: 'ga4',     label: 'GA4',     color: 'var(--accent)' },
  { id: 'clarity', label: 'Clarity', color: 'var(--purple)' },
  { id: 'cwv',     label: 'PSI/CWV', color: 'var(--yellow)' },
  { id: 'bwt',     label: 'BWT',     color: 'var(--green)'  },
]

const TAB_PRESETS: Record<Exclude<DashTab, 'custom'>, string[]> = {
  gsc:     ['gsc-clicks', 'gsc-impr', 'gsc-ctr', 'gsc-pos'],
  ga4:     ['ga4-organic', 'ga4-users', 'ga4-conv', 'ga4-engage', 'ga4-bounce'],
  clarity: ['clr-rage', 'clr-dead', 'clr-qback', 'clr-scroll', 'clr-engage'],
  cwv:     ['cwv-lcp', 'cwv-cls', 'cwv-inp', 'cwv-ttfb', 'cwv-score'],
  bwt:     ['bwt-clicks', 'bwt-impr', 'bwt-ctr', 'bwt-pos', 'bwt-errors'],
}

// ── InfoTooltip ────────────────────────────────────────────────────────────────
function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="relative flex items-center group/tip">
      <button
        className="w-3.5 h-3.5 rounded-full flex items-center justify-center font-mono text-[8px] font-bold flex-shrink-0 cursor-default"
        style={{ background: 'var(--s3)', color: 'var(--t3)', border: '1px solid var(--b2)' }}
      >
        i
      </button>
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2.5 rounded-[var(--r)] border z-[100]
          invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100
          transition-opacity duration-150 pointer-events-none"
        style={{ background: 'var(--s1)', borderColor: 'var(--b2)', boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}
      >
        <p className="font-mono text-[10px] leading-relaxed" style={{ color: 'var(--t2)' }}>{text}</p>
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
          style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `5px solid var(--b2)` }} />
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Delta({ v, unit = '%', invert = false }: { v: number; unit?: string; invert?: boolean }) {
  if (v === 0) return <span className="text-[var(--t3)] flex items-center gap-1"><Minus size={10} /> stable</span>
  const isGood = invert ? v < 0 : v > 0
  return (
    <span className="flex items-center gap-1" style={{ color: isGood ? 'var(--green)' : 'var(--red)' }}>
      {v > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {v > 0 ? '+' : ''}{v}{unit ? ` ${unit}` : ''}
    </span>
  )
}

function ScoreArc({ value, color, size = 120 }: { value: number | null; color: string; size?: number }) {
  const r = size * 0.38; const cx = size / 2; const cy = size / 2
  const circumference = Math.PI * r
  const v = value ?? 0
  const offset = circumference - (v / 100) * circumference
  const startX = cx - r; const endX = cx + r
  return (
    <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`}>
      <path d={`M ${startX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${cy}`}
        fill="none" stroke="var(--b1)" strokeWidth="6" strokeLinecap="round" />
      <path d={`M ${startX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${cy}`}
        fill="none" stroke={value !== null ? color : 'var(--b2)'} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 1.2s ease' }} />
      <text x={cx} y={cy - 6} textAnchor="middle" fill={value !== null ? color : 'var(--t3)'}
        style={{ fontSize: `${size * 0.24}px`, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
        {value !== null ? value : '--'}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--t3)"
        style={{ fontSize: `${size * 0.11}px`, fontFamily: 'var(--font-mono)' }}>
        /100
      </text>
    </svg>
  )
}

function CwvBadge({ label, value, unit, thresholds, desc }: { label: string; value: number | null; unit: string; thresholds: [number, number]; desc: string }) {
  const hasData = value !== null
  const status = !hasData ? 'none' : value <= thresholds[0] ? 'good' : value <= thresholds[1] ? 'needs' : 'poor'
  const colors = { good: 'var(--green)', needs: 'var(--yellow)', poor: 'var(--red)', none: 'var(--t3)' }
  const bgs    = { good: 'var(--gdim)',  needs: 'var(--ydim)',   poor: 'var(--rdim)', none: 'var(--s2)' }
  return (
    <div className="flex flex-col items-center p-3 rounded-[var(--r)] border relative"
      style={{ background: bgs[status], borderColor: colors[status] + (hasData ? '44' : '33') }}>
      <div className="absolute top-2 right-2">
        <InfoTooltip text={desc} />
      </div>
      <div className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider mb-1">{label}</div>
      <div className="font-mono text-[22px] font-bold" style={{ color: colors[status] }}>{value ?? '--'}</div>
      <div className="font-mono text-[10px] text-[var(--t3)]">{unit}</div>
      {hasData && (
        <div className="mt-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase"
          style={{ background: colors[status] + '22', color: colors[status] }}>
          {status === 'good' ? 'Good' : status === 'needs' ? 'Needs Work' : 'Poor'}
        </div>
      )}
    </div>
  )
}

// ── Configurable Dashlet ───────────────────────────────────────────────────────
function ConfigurableDashlet({ config, index, onUpdate, lockedSource, liveData }: {
  config: DashletConfig
  index: number
  onUpdate: (i: number, c: DashletConfig) => void
  lockedSource?: SourceId
  liveData: McpData
}) {
  const [open, setOpen] = useState<'source' | 'metric' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const metric = METRICS.find(m => m.id === config.metricId)!
  const source = SOURCES.find(s => s.id === metric.source)!
  const sourceMetrics = METRICS.filter(m => m.source === (lockedSource ?? metric.source))

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectSource = (id: SourceId) => {
    const first = METRICS.find(m => m.source === id)!
    onUpdate(index, { metricId: first.id })
    setOpen(null)
  }

  const selectMetric = (metricId: string) => {
    onUpdate(index, { metricId })
    setOpen(null)
  }

  const val = metric.value(liveData)
  const dv  = metric.delta(liveData)

  return (
    <div ref={ref} className="rounded-[var(--r)] border p-3 relative" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>

      {/* Pickers */}
      <div className="flex items-center gap-1.5 mb-2 min-w-0">
        {!lockedSource && (
          <button
            onClick={() => setOpen(open === 'source' ? null : 'source')}
            className="flex items-center gap-1 font-mono text-[8px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-70 flex-shrink-0"
            style={{ background: source.bg, color: source.color, border: `1px solid ${source.color}33` }}
          >
            {source.label} <ChevronDown size={7} />
          </button>
        )}
        <button
          onClick={() => setOpen(open === 'metric' ? null : 'metric')}
          className="flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors hover:text-[var(--t1)] truncate min-w-0"
          style={{ color: 'var(--t3)' }}
        >
          <span className="truncate">{metric.label}</span> <ChevronDown size={8} className="flex-shrink-0" />
        </button>
        <div className="ml-auto flex-shrink-0">
          <InfoTooltip text={metric.desc} />
        </div>
      </div>

      <div className="font-mono text-[18px] font-bold text-[var(--t1)] truncate">{String(val)}</div>

      <div className="font-mono text-[11px] mt-1">
        {val === '--'
          ? <span className="text-[var(--t3)] text-[10px]">no data</span>
          : <Delta v={dv} unit={metric.suffix} invert={metric.deltaInvert} />
        }
      </div>

      {open === 'source' && !lockedSource && (
        <div className="absolute top-full left-0 mt-1 z-[200] rounded-[var(--r)] border overflow-hidden min-w-[130px]"
          style={{ background: 'var(--s1)', borderColor: 'var(--b2)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {SOURCES.map(s => (
            <button key={s.id} onClick={() => selectSource(s.id)}
              className="w-full text-left px-3 py-1.5 font-mono text-[11px] flex items-center gap-2 hover:bg-[var(--s3)] transition-colors"
              style={{ color: s.id === metric.source ? s.color : 'var(--t2)' }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              {s.label}
              {s.id === metric.source && <span className="ml-auto opacity-50 text-[8px]">✓</span>}
            </button>
          ))}
        </div>
      )}

      {open === 'metric' && (
        <div className="absolute top-full left-0 mt-1 z-[200] rounded-[var(--r)] border overflow-hidden min-w-[160px]"
          style={{ background: 'var(--s1)', borderColor: 'var(--b2)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {sourceMetrics.map(m => (
            <button key={m.id} onClick={() => selectMetric(m.id)}
              className="w-full text-left px-3 py-1.5 font-mono text-[11px] flex items-center hover:bg-[var(--s3)] transition-colors"
              style={{ color: m.id === config.metricId ? source.color : 'var(--t2)' }}>
              {m.label}
              {m.id === config.metricId && <span className="ml-auto opacity-50 text-[8px]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSnapshots(snaps: Snapshot[]): Partial<McpData> {
  const result: Partial<McpData> = {}
  for (const snap of snaps) {
    const d = snap.data as any
    if (snap.source === 'psi') {
      // Support both new { mobile, desktop } and legacy flat format
      if (d.mobile && d.desktop) {
        result.cwv = { mobile: d.mobile, desktop: d.desktop }
      } else {
        const m = { lcp: d.lcp, cls: d.cls, inp: d.inp, ttfb: d.ttfb, score: d.score }
        result.cwv = { mobile: m, desktop: m }
      }
    }
    if (snap.source === 'gsc') {
      result.gsc = { clicks: d.clicks, impressions: d.impressions, ctr: d.ctr, position: d.position, d: { clicks: 0, impressions: 0, ctr: 0, position: 0 } }
    }
    if (snap.source === 'ga4') {
      result.ga4 = { sessions: d.sessions, organic: d.organic, conversions: d.conversions, users: d.users, engagementRate: d.engagementRate, bounceRate: d.bounceRate, d: { sessions: 0, organic: 0, conversions: 0, users: 0, engagementRate: 0, bounceRate: 0 } }
    }
    if (snap.source === 'clarity') {
      result.clarity = { rageclicks: d.rageclicks, sessions: d.sessions, scrollDepth: d.scrollDepth, engageTime: d.engageTime, deadClicks: d.deadClicks, quickBacks: d.quickBacks, d: { rageclicks: 0, sessions: 0, scrollDepth: 0, engageTime: 0, deadClicks: 0, quickBacks: 0 } }
    }
    if (snap.source === 'bwt') {
      result.bwt = { clicks: d.clicks, impressions: d.impressions, ctr: d.ctr, position: d.position, crawlErrors: d.crawlErrors, keywords: d.keywords, seoErrors: d.seoErrors, d: { clicks: 0, impressions: 0, ctr: 0, position: 0, crawlErrors: 0 } }
    }
    if (snap.source === 'openpagerank') {
      result.opr = { pageRank: d.pageRank, prDecimal: d.prDecimal, domainRank: d.domainRank, domain: d.domain }
    }
  }
  return result
}

// ── Visibility score helper ────────────────────────────────────────────────────

function calcVisScore(pos: number, ctr: number): number {
  const base = pos <= 1 ? 100 : pos <= 3 ? 90 : pos <= 5 ? 80 : pos <= 10 ? 65 : pos <= 15 ? 50 : pos <= 20 ? 35 : 20
  const adj  = ctr >= 5 ? 5 : ctr >= 3 ? 0 : ctr >= 1 ? -5 : -10
  return Math.min(100, Math.max(0, base + adj))
}

// ── Priority actions derived from live data ────────────────────────────────────

interface Action {
  color: string
  icon: typeof AlertTriangle
  title: string
  desc: string
  src: string
  tag: string
}

function deriveActions(d: McpData, audit: DomAudit | null, kws: ({ source: 'gsc' | 'bwt' } & GscKeyword)[] = []): Action[] {
  const actions: Action[] = []

  if (d.cwv) {
    const m = d.cwv.mobile
    if (m.ttfb > 800)
      actions.push({ color: 'var(--red)',    icon: AlertTriangle, title: `TTFB ${m.ttfb}ms — Critical server response`, desc: 'Server response time exceeds 800ms. Check hosting, enable gzip/brotli, add CDN or caching layer.', src: 'PSI', tag: 'HIGH IMPACT' })
    else if (m.ttfb > 600)
      actions.push({ color: 'var(--yellow)', icon: AlertTriangle, title: `TTFB ${m.ttfb}ms — Slow server response`, desc: 'Server response time is above the 600ms target. Review hosting plan and enable caching.', src: 'PSI', tag: 'PERFORMANCE' })

    if (m.lcp > 4.0)
      actions.push({ color: 'var(--red)',    icon: AlertTriangle, title: `LCP ${m.lcp}s — Core Web Vitals failing`, desc: 'Largest Contentful Paint is in the "Poor" range (>4s). Optimize hero images, reduce render-blocking resources.', src: 'PSI', tag: 'HIGH IMPACT' })
    else if (m.lcp > 2.5)
      actions.push({ color: 'var(--yellow)', icon: AlertTriangle, title: `LCP ${m.lcp}s — Needs improvement`, desc: 'LCP is in the "Needs Improvement" range. Consider lazy loading, next-gen image formats (WebP/AVIF).', src: 'PSI', tag: 'CWV' })

    if (m.cls > 0.25)
      actions.push({ color: 'var(--red)',    icon: AlertTriangle, title: `CLS ${m.cls} — Layout shift critical`, desc: 'Cumulative Layout Shift is in the "Poor" range. Set explicit dimensions on images and ads.', src: 'PSI', tag: 'HIGH IMPACT' })
    else if (m.cls > 0.1)
      actions.push({ color: 'var(--yellow)', icon: AlertTriangle, title: `CLS ${m.cls} — Layout shift detected`, desc: 'Elements are shifting during load. Reserve space for dynamic content and web fonts.', src: 'PSI', tag: 'CWV' })

    if (m.inp > 500)
      actions.push({ color: 'var(--red)',    icon: Zap,           title: `INP ${m.inp}ms — Interaction latency critical`, desc: 'Page interactions are very slow. Reduce JavaScript execution time and long tasks.', src: 'PSI', tag: 'HIGH IMPACT' })
    else if (m.inp > 200)
      actions.push({ color: 'var(--yellow)', icon: Zap,           title: `INP ${m.inp}ms — Slow interactions`, desc: 'Interaction to Next Paint exceeds 200ms target. Profile and optimize event handlers.', src: 'PSI', tag: 'CWV' })
  }

  if (d.gsc) {
    if (d.gsc.impressions > 500 && d.gsc.ctr < 2.0)
      actions.push({ color: 'var(--accent)', icon: TrendingUp, title: `CTR ${d.gsc.ctr}% — Low click-through rate`, desc: `${d.gsc.impressions.toLocaleString()} impressions with only ${d.gsc.ctr}% CTR. Rewrite title tags and meta descriptions to be more compelling.`, src: 'GSC', tag: 'QUICK WIN' })
    if (d.gsc.position > 10 && d.gsc.impressions > 1000)
      actions.push({ color: 'var(--accent)', icon: TrendingUp, title: `Avg position ${d.gsc.position} — Page 2 opportunity`, desc: `${d.gsc.impressions.toLocaleString()} impressions but average rank is ${d.gsc.position}. Improve content depth and internal linking to break into page 1.`, src: 'GSC', tag: 'QUICK WIN' })
  }

  if (d.ga4) {
    if (d.ga4.bounceRate > 70)
      actions.push({ color: 'var(--red)',    icon: TrendingDown, title: `Bounce rate ${d.ga4.bounceRate}% — High exit rate`, desc: 'More than 70% of users leave without interacting. Review landing page relevance and load speed.', src: 'GA4', tag: 'UX' })
    else if (d.ga4.bounceRate > 55)
      actions.push({ color: 'var(--yellow)', icon: TrendingDown, title: `Bounce rate ${d.ga4.bounceRate}% — Above average`, desc: 'Bounce rate is above 55%. Check if content matches user intent and CTA visibility.', src: 'GA4', tag: 'UX' })
  }

  if (d.clarity) {
    if (d.clarity.rageclicks > 50)
      actions.push({ color: 'var(--yellow)', icon: MousePointer, title: `${d.clarity.rageclicks} rage clicks detected`, desc: 'Users are rage-clicking elements. Check for broken buttons, unresponsive links, or missing feedback on actions.', src: 'Clarity', tag: 'UX FIX' })
    if (d.clarity.deadClicks > 100)
      actions.push({ color: 'var(--yellow)', icon: MousePointer, title: `${d.clarity.deadClicks} dead clicks`, desc: 'Users clicking on non-interactive elements. Review layout — some elements may look clickable but aren\'t.', src: 'Clarity', tag: 'UX FIX' })
  }

  if (audit) {
    if (!audit.llms_txt)
      actions.push({ color: 'var(--accent)', icon: Bot, title: 'Missing llms.txt — not AI crawler ready', desc: 'AI agents (ChatGPT, Perplexity, Copilot) use llms.txt to understand what content to index. Create /llms.txt at the site root with a plain-text summary of your content.', src: 'Audit', tag: 'AI VISIBILITY' })
    if ((audit.schema_types?.length ?? 0) === 0)
      actions.push({ color: 'var(--accent)', icon: Bot, title: 'No structured data (Schema.org)', desc: 'No JSON-LD or microdata found. Add Schema markup (Article, Product, FAQPage, etc.) to improve AI and rich-snippet eligibility.', src: 'Audit', tag: 'AI VISIBILITY' })
  }

  // Keyword opportunities
  const qwins = kws.filter(k => k.position >= 5 && k.position <= 20 && k.impressions > 200)
  if (qwins.length > 0) {
    const top = qwins[0]
    actions.push({ color: 'var(--accent)', icon: TrendingUp,
      title: `${qwins.length} keyword${qwins.length > 1 ? 's' : ''} near page 1 — optimization opportunity`,
      desc: `"${top.keyword}" ranks #${Math.round(top.position)} with ${top.impressions.toLocaleString()} impressions. Deepen content, improve internal linking and align H1/title to break into the top 10.`,
      src: top.source === 'bwt' ? 'BWT' : 'GSC', tag: 'QUICK WIN' })
  }

  const zeroClicks = kws.filter(k => k.impressions > 50 && k.clicks === 0)
  if (zeroClicks.length > 0) {
    const top = zeroClicks[0]
    actions.push({ color: 'var(--yellow)', icon: Eye,
      title: `${zeroClicks.length} keyword${zeroClicks.length > 1 ? 's' : ''} with impressions but 0 clicks`,
      desc: `"${top.keyword}" appears ${top.impressions.toLocaleString()} times in search results but gets no clicks. Rewrite title tags and meta descriptions to match search intent and increase CTR.`,
      src: top.source === 'bwt' ? 'BWT' : 'GSC', tag: 'CTR FIX' })
  }

  return actions
}

function NoKeywordsHint() {
  const [show, setShow] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5 justify-center relative">
      No keywords with clicks in the last 30 days
      <span
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full cursor-pointer"
        style={{ background: 'var(--s3)', color: 'var(--t3)' }}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <Eye size={9} />
      </span>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-[var(--r)] border text-left z-50 anim-up"
          style={{ background: 'var(--s1)', borderColor: 'var(--b2)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          <div className="font-mono text-[11px] text-[var(--t2)] leading-relaxed">
            GSC's <span style={{ color: 'var(--accent)' }}>searchAnalytics</span> API only returns keywords that received at least <span style={{ color: 'var(--accent)' }}>1 click</span> in the period. Keywords with impressions but zero clicks are not included in the response.
          </div>
          <div className="font-mono text-[10px] text-[var(--t3)] mt-2">
            If the site has traffic, try refreshing again in a few days.
          </div>
        </div>
      )}
    </span>
  )
}

function ActionCard({ color, Icon, title, desc, src, tag }: {
  color: string; Icon: typeof AlertTriangle; title: string; desc: string; src: string; tag: string
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(`${title}\n\n${desc}\n\nSource: ${src} · ${tag}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-start gap-3 p-4 rounded-[var(--rl)] border transition-all hover:border-opacity-60 group"
      style={{ background: 'var(--s1)', borderColor: color + '44' }}>
      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: color + '18' }}>
        <Icon size={13} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[14px] text-[var(--t1)] mb-1">{title}</div>
        <div className="font-mono text-[11px] text-[var(--t2)] leading-relaxed">{desc}</div>
        <div className="flex items-center gap-2 mt-2">
          <span className="font-mono text-[10px] text-[var(--t3)]">({src})</span>
          <span className="font-mono text-[8px] px-1.5 py-0.5 rounded font-bold"
            style={{ background: color + '18', color }}>
            {tag}
          </span>
          <button onClick={handleCopy}
            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px]"
            style={{ color: copied ? 'var(--green)' : 'var(--t3)' }}
            title="Copy to clipboard">
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Site selector dropdown ─────────────────────────────────────────────────────

function SiteDropdown({ sites, value, onChange }: {
  sites: { id: number; domain: string }[]
  value: number | null
  onChange: (id: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = sites.find(s => s.id === value)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--accent)]"
        style={{ background: 'var(--s2)', borderColor: open ? 'var(--accent)' : 'var(--b2)', color: selected ? 'var(--t1)' : 'var(--t3)', minWidth: '160px' }}
      >
        <span className="flex-1 text-left truncate">{selected ? selected.domain : 'Select site…'}</span>
        <ChevronDown size={10} className="flex-shrink-0 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--t3)' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-[var(--r)] border overflow-hidden z-50 anim-up"
          style={{ background: 'var(--s1)', borderColor: 'var(--b2)', minWidth: '100%', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
        >
          {sites.map(s => (
            <button key={s.id} onClick={() => { onChange(s.id); setOpen(false) }}
              className="w-full flex items-center px-3 py-2 font-mono text-[11px] text-left transition-colors hover:bg-[var(--s3)]"
              style={{ color: s.id === value ? 'var(--accent)' : 'var(--t1)', background: s.id === value ? 'var(--adim)' : 'transparent' }}
            >
              {s.domain}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { projects, sites, activeProjectId, activeSiteId, credentials, setActiveNav, setActiveSite } = useAppStore()
  const [kwTab, setKwTab] = useState<'quickwins' | 'all' | 'oportunidades'>('all')
  const [dashlets, setDashlets] = useState<DashletConfig[]>(loadDashlets)
  const [sourceTab, setSourceTab] = useState<DashTab>(
    () => (localStorage.getItem('seohub-dashtab') as DashTab) ?? 'custom'
  )
  const [tabDashlets, setTabDashlets] = useState<Partial<Record<DashTab, DashletConfig[]>>>({})
  const [liveData, setLiveData] = useState<McpData>(IS_TAURI ? EMPTY_DATA : DEV_DATA)
  const [audit, setAudit] = useState<DomAudit | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [psiDevice, setPsiDevice] = useState<'mobile' | 'desktop'>('mobile')
  const [copyAllDone, setCopyAllDone] = useState(false)
  const [visSource, setVisSource] = useState<'gsc' | 'bwt' | 'total'>('gsc')

  function handleCopyAll() {
    const text = actions.map(a => `[${a.tag}] ${a.title}\n${a.desc}\nSource: ${a.src}`).join('\n\n')
    navigator.clipboard.writeText(text)
    setCopyAllDone(true)
    setTimeout(() => setCopyAllDone(false), 2000)
  }

  const activeProject = projects.find(p => p.id === activeProjectId)
  const activeSite = sites.find(s => s.id === activeSiteId)
  // Merge GSC + BWT keywords; prefer GSC when same keyword appears in both
  const allKeywords: ({ source: 'gsc' | 'bwt' } & GscKeyword)[] = (() => {
    const gsc = (liveData.gsc?.keywords ?? []).map(k => ({ ...k, source: 'gsc' as const }))
    const gscSet = new Set(gsc.map(k => k.keyword.toLowerCase()))
    const bwt = (liveData.bwt?.keywords ?? [])
      .filter(k => !gscSet.has(k.keyword.toLowerCase()))
      .map(k => ({ ...k, source: 'bwt' as const }))
    return [...gsc, ...bwt].sort((a, b) => b.impressions - a.impressions)
  })()
  const quickWins      = allKeywords.filter(k => k.position >= 5 && k.position <= 20 && k.impressions > 500)
  const oportunidades  = allKeywords.filter(k => k.impressions > 20 && k.clicks === 0)
  const keywords       = kwTab === 'quickwins' ? quickWins : kwTab === 'oportunidades' ? oportunidades : allKeywords
  const actions     = deriveActions(liveData, audit, allKeywords)

  // Scores derived from live data (or null when no data)
  const psiMetrics = liveData.cwv ? liveData.cwv[psiDevice] : null
  const scoresTechnical: number | null = psiMetrics?.score ?? null

  const scoresVisibility: number | null = (() => {
    if (visSource === 'gsc') return liveData.gsc ? calcVisScore(liveData.gsc.position, liveData.gsc.ctr) : null
    if (visSource === 'bwt') return liveData.bwt ? calcVisScore(liveData.bwt.position, liveData.bwt.ctr) : null
    const scores = [
      liveData.gsc ? calcVisScore(liveData.gsc.position, liveData.gsc.ctr) : null,
      liveData.bwt ? calcVisScore(liveData.bwt.position, liveData.bwt.ctr) : null,
    ].filter((s): s is number => s !== null)
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  })()

  const scoresAuthority: number | null = liveData.opr
    ? Math.min(100, Math.round(liveData.opr.prDecimal * 10))
    : null

  const scoresExperience: number | null = liveData.ga4 ? (() => {
    let s = liveData.ga4.engagementRate
    if (liveData.ga4.bounceRate > 70) s -= 20
    else if (liveData.ga4.bounceRate > 55) s -= 10
    if (liveData.clarity && liveData.clarity.rageclicks > 50) s -= 10
    return Math.min(100, Math.max(0, Math.round(s)))
  })() : null

  // Load snapshots + last audit when activeSiteId changes
  useEffect(() => {
    if (!activeSiteId || !IS_TAURI) return
    getSiteSnapshots(activeSiteId).then(snaps => setLiveData({ ...EMPTY_DATA, ...parseSnapshots(snaps) })).catch(() => {})
    getLastAudit(activeSiteId).then(setAudit).catch(() => {})
  }, [activeSiteId])

  async function handleRefresh(source: 'psi' | 'bwt' | 'gsc' | 'ga4' | 'clarity' | 'opr' | 'all') {
    if (!activeSiteId) {
      setRefreshError('Select a site in the Sites page first.')
      setTimeout(() => setRefreshError(null), 4000)
      return
    }
    setRefreshError(null)

    const configuredSources = credentials
      .filter(c => c.is_configured && c.service !== 'playwright')
      .map(c => c.service as 'psi' | 'bwt' | 'gsc' | 'ga4' | 'clarity' | 'opr')

    const sources = source === 'all' ? configuredSources : [source]
    const errors: string[] = []

    for (const src of sources) {
      setRefreshing(src)
      try {
        await fetchMcpData(src, activeSiteId)
      } catch (e) {
        errors.push(`${src.toUpperCase()}: ${String(e)}`)
      }
    }

    setRefreshing(null)
    const snaps = await getSiteSnapshots(activeSiteId)
    setLiveData({ ...EMPTY_DATA, ...parseSnapshots(snaps) })

    if (errors.length > 0) {
      setRefreshError(errors.join(' · '))
      setTimeout(() => setRefreshError(null), 8000)
    }
  }

  const activeDashlets: DashletConfig[] =
    sourceTab === 'custom'
      ? dashlets
      : (tabDashlets[sourceTab] ?? TAB_PRESETS[sourceTab].map(id => ({ metricId: id })))

  const lockedSource: SourceId | undefined =
    sourceTab === 'custom' ? undefined : sourceTab as SourceId

  const handleTabChange = (t: DashTab) => {
    if (t !== 'custom' && !tabDashlets[t]) {
      setTabDashlets(prev => ({ ...prev, [t]: TAB_PRESETS[t as Exclude<DashTab, 'custom'>].map(id => ({ metricId: id })) }))
    }
    localStorage.setItem('seohub-dashtab', t)
    setSourceTab(t)
  }

  const updateDashlet = (i: number, config: DashletConfig) => {
    if (sourceTab === 'custom') {
      setDashlets(prev => {
        const next = prev.map((d, idx) => idx === i ? config : d)
        try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    } else {
      setTabDashlets(prev => ({
        ...prev,
        [sourceTab]: activeDashlets.map((d, idx) => idx === i ? config : d),
      }))
    }
  }

  const hasAnyData = Object.values(liveData).some(v => v !== null)

  const psiConfigured = credentials.find(c => c.service === 'psi')?.is_configured ?? false
  const configuredCount = credentials.filter(c => c.service !== 'playwright' && c.is_configured).length
  const showSetupBanner = IS_TAURI && configuredCount === 0

  return (
    <div className="flex-1 overflow-y-auto p-6">

      {/* Setup banner — shown when no credentials are configured */}
      {showSetupBanner && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-[var(--rl)] border"
          style={{ background: 'var(--adim)', borderColor: 'rgba(249,115,22,0.3)' }}>
          <AlertTriangle size={15} className="text-[var(--accent)] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-mono text-[12px] text-[var(--t1)] font-medium">No API keys configured — data sources are inactive.</span>
            <span className="font-mono text-[11px] text-[var(--t3)] ml-2">Add at least a PSI key to start pulling real data.</span>
          </div>
          <button
            onClick={() => setActiveNav('settings')}
            className="flex-shrink-0 px-3 py-1.5 rounded-[var(--r)] font-mono text-[12px] font-medium text-white transition-all hover:opacity-90"
            style={{ background: 'var(--accent)' }}>
            Configure Keys
          </button>
        </div>
      )}

      {/* PSI-only nudge — shown when PSI specifically is missing but others may be set */}
      {IS_TAURI && !showSetupBanner && !psiConfigured && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-[var(--rl)] border"
          style={{ background: 'var(--ydim)', borderColor: 'rgba(245,158,11,0.2)' }}>
          <AlertTriangle size={14} className="text-[var(--yellow)] flex-shrink-0" />
          <span className="font-mono text-[11px] text-[var(--t2)] flex-1">PSI / Core Web Vitals key missing — performance scores unavailable.</span>
          <button
            onClick={() => setActiveNav('settings')}
            className="flex-shrink-0 px-3 py-1.5 rounded-[var(--r)] font-mono text-[11px] border transition-all hover:border-[var(--yellow)] hover:text-[var(--yellow)]"
            style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}>
            Add PSI Key
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl text-[var(--t1)]">
            {activeSite
              ? <><span className="text-[var(--accent)]">{activeSite.domain}</span></>
              : activeProject
              ? <><span className="text-[var(--accent)]">{activeProject.name}</span></>
              : <>SEO <span className="text-[var(--accent)]">Overview</span></>
            }
          </h1>
          <p className="font-mono text-[12px] text-[var(--t3)] mt-1">
            {activeSite ? activeSite.url : `All sources · ${sites.length} sites tracked`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshError && (
            <span className="font-mono text-[11px] text-[var(--red)] max-w-[200px] text-right">{refreshError}</span>
          )}
          {/* Site selector */}
          <SiteDropdown
            sites={sites}
            value={activeSiteId}
            onChange={id => {
              setActiveSite(id)
              setLiveData(EMPTY_DATA)
              if (id) getSiteSnapshots(id).then(snaps => setLiveData({ ...EMPTY_DATA, ...parseSnapshots(snaps) })).catch(() => {})
            }}
          />
          {IS_TAURI && (
            <button
              onClick={() => handleRefresh('all')}
              disabled={refreshing !== null || !activeSiteId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
              style={{ borderColor: 'var(--b2)', color: 'var(--t2)' }}
            >
              <RefreshCw size={11} className={refreshing !== null ? 'animate-spin' : ''} />
              {refreshing !== null ? `Fetching ${refreshing.toUpperCase()}…` : 'Refresh All'}
            </button>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
            style={{ background: hasAnyData ? 'var(--gdim)' : 'var(--s2)', borderColor: hasAnyData ? 'rgba(16,217,160,0.2)' : 'var(--b1)' }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: hasAnyData ? 'var(--green)' : 'var(--t3)', animation: hasAnyData ? 'blink 2s infinite' : 'none' }} />
            <span className="font-mono text-[10px]" style={{ color: hasAnyData ? 'var(--green)' : 'var(--t3)' }}>
              {IS_TAURI ? (hasAnyData ? 'LIVE DATA' : 'NO DATA') : 'DEV MOCK'}
            </span>
          </div>
        </div>
      </div>

      {/* No-data prompt (Tauri only, no site selected) */}
      {IS_TAURI && !hasAnyData && (
        <div className="mb-5 px-4 py-3 rounded-[var(--r)] border font-mono text-[12px] text-[var(--t3)]"
          style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
          {activeSiteId
            ? 'No data yet — click Refresh All to fetch data from configured sources.'
            : 'Select a site above, then click Refresh All to load data.'}
        </div>
      )}

      {/* ZONE CARDS */}
      <div className="grid grid-cols-4 gap-4 mb-5">

        {/* PSI — PageSpeed Insights */}
        <div className="rounded-[var(--rl)] border anim-up anim-d1"
          style={{ background: 'var(--s1)', borderColor: 'var(--b1)', borderTopColor: 'var(--blue)', borderTopWidth: 2 }}>
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--b1)' }}>
            <div>
              <div className="font-mono text-[14px] uppercase tracking-wider font-semibold text-[var(--t1)]">PageSpeed Insights</div>
              <div className="flex items-center gap-0.5 mt-1.5">
                {(['mobile', 'desktop'] as const).map(d => (
                  <button key={d} onClick={() => setPsiDevice(d)}
                    className="px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide transition-colors"
                    style={{
                      background: psiDevice === d ? 'rgba(56,189,248,0.15)' : 'transparent',
                      color:      psiDevice === d ? 'var(--blue)' : 'var(--t3)',
                      border:     psiDevice === d ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
                    }}>{d}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="px-4 py-4 flex flex-col items-center gap-3">
            <ScoreArc value={scoresTechnical} color="var(--blue)" size={90} />
            <div className="w-full grid grid-cols-2 gap-x-3 gap-y-2">
              {psiMetrics ? [
                { label: 'LCP',  value: `${psiMetrics.lcp}s`,   thr: [2.5, 4]     },
                { label: 'CLS',  value: `${psiMetrics.cls}`,    thr: [0.1, 0.25]  },
                { label: 'INP',  value: `${psiMetrics.inp}ms`,  thr: [200, 500]   },
                { label: 'TTFB', value: `${psiMetrics.ttfb}ms`, thr: [600, 1800]  },
              ].map(({ label, value, thr }) => {
                const raw = parseFloat(value)
                const st = raw <= thr[0] ? 'var(--green)' : raw <= thr[1] ? 'var(--yellow)' : 'var(--red)'
                return (
                  <div key={label} className="flex flex-col items-center py-1.5 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
                    <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider">{label}</span>
                    <span className="font-mono text-[15px] font-bold" style={{ color: st }}>{value}</span>
                  </div>
                )
              }) : <div className="col-span-2 font-mono text-[12px] text-[var(--t3)]">No data</div>}
            </div>
          </div>
          <div className="border-t" style={{ borderColor: 'var(--b1)' }}>
            <button
              onClick={() => setActiveNav('psi-detail')}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 font-mono text-[11px] transition-all hover:opacity-70 rounded-b-[var(--rl)]"
              style={{ color: 'var(--blue)' }}
            >
              View Details <ArrowRight size={10} />
            </button>
          </div>
        </div>

        {/* Visibility — GSC + BWT */}
        <div className="rounded-[var(--rl)] border anim-up anim-d2"
          style={{ background: 'var(--s1)', borderColor: 'var(--b1)', borderTopColor: 'var(--accent)', borderTopWidth: 2 }}>
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--b1)' }}>
            <div>
              <div className="font-mono text-[14px] uppercase tracking-wider font-semibold text-[var(--t1)]">Visibility</div>
              <div className="flex items-center gap-0.5 mt-1.5">
                {([
                  ['gsc',   'GSC',   'var(--accent)', 'var(--adim)', 'rgba(249,115,22,0.3)'],
                  ['bwt',   'BWT',   'var(--green)',  'var(--gdim)', 'rgba(16,217,160,0.3)'],
                  ['total', 'Total', 'var(--blue)',   'var(--bdim)', 'rgba(56,189,248,0.3)'],
                ] as const).map(([s, label, color, bg, border]) => (
                  <button key={s} onClick={() => setVisSource(s)}
                    className="px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide transition-colors"
                    style={{
                      background: visSource === s ? bg : 'transparent',
                      color:      visSource === s ? color : 'var(--t3)',
                      border:     visSource === s ? `1px solid ${border}` : '1px solid transparent',
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="px-4 py-4 flex flex-col items-center gap-3">
            <ScoreArc
              value={scoresVisibility}
              color={visSource === 'bwt' ? 'var(--green)' : visSource === 'total' ? 'var(--blue)' : 'var(--accent)'}
              size={90}
            />
            <div className="w-full grid grid-cols-2 gap-x-3 gap-y-2">
              {(() => {
                const color = visSource === 'bwt' ? 'var(--green)' : visSource === 'total' ? 'var(--blue)' : 'var(--accent)'
                let items: { label: string; value: string }[] | null = null
                if (visSource === 'gsc' && liveData.gsc) {
                  items = [
                    { label: 'Position', value: `#${liveData.gsc.position}` },
                    { label: 'CTR',      value: `${liveData.gsc.ctr}%` },
                    { label: 'Clicks',   value: liveData.gsc.clicks.toLocaleString() },
                    { label: 'Impr.',    value: liveData.gsc.impressions.toLocaleString() },
                  ]
                } else if (visSource === 'bwt' && liveData.bwt) {
                  items = [
                    { label: 'Position', value: `#${liveData.bwt.position}` },
                    { label: 'CTR',      value: `${liveData.bwt.ctr}%` },
                    { label: 'Clicks',   value: liveData.bwt.clicks.toLocaleString() },
                    { label: 'Impr.',    value: liveData.bwt.impressions.toLocaleString() },
                  ]
                } else if (visSource === 'total' && (liveData.gsc || liveData.bwt)) {
                  const totalClicks = (liveData.gsc?.clicks ?? 0) + (liveData.bwt?.clicks ?? 0)
                  const totalImpr   = (liveData.gsc?.impressions ?? 0) + (liveData.bwt?.impressions ?? 0)
                  const ctrs = [liveData.gsc?.ctr, liveData.bwt?.ctr].filter((v): v is number => v != null)
                  const poss = [liveData.gsc?.position, liveData.bwt?.position].filter((v): v is number => v != null)
                  items = [
                    { label: 'Avg Pos.',  value: poss.length ? `#${(poss.reduce((a,b)=>a+b,0)/poss.length).toFixed(1)}` : '—' },
                    { label: 'Avg CTR',   value: ctrs.length ? `${(ctrs.reduce((a,b)=>a+b,0)/ctrs.length).toFixed(1)}%` : '—' },
                    { label: 'Clicks',    value: totalClicks.toLocaleString() },
                    { label: 'Impr.',     value: totalImpr.toLocaleString() },
                  ]
                }
                return items ? items.map(({ label, value }) => (
                  <div key={label} className="flex flex-col items-center py-1.5 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
                    <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider">{label}</span>
                    <span className="font-mono text-[15px] font-bold" style={{ color }}>{value}</span>
                  </div>
                )) : <div className="col-span-2 font-mono text-[12px] text-[var(--t3)]">No data</div>
              })()}
            </div>
          </div>
          <div className="border-t" style={{ borderColor: 'var(--b1)' }}>
            <button
              onClick={() => setActiveNav('gsc-detail')}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 font-mono text-[11px] transition-all hover:opacity-70 rounded-b-[var(--rl)]"
              style={{ color: 'var(--accent)' }}
            >
              View Details <ArrowRight size={10} />
            </button>
          </div>
        </div>

        {/* Authority — OpenPageRank */}
        <div className="rounded-[var(--rl)] border anim-up anim-d3"
          style={{ background: 'var(--s1)', borderColor: 'var(--b1)', borderTopColor: 'var(--yellow)', borderTopWidth: 2 }}>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--b1)' }}>
            <div>
              <div className="font-mono text-[14px] uppercase tracking-wider font-semibold text-[var(--t1)]">Authority</div>
              <div className="font-mono text-[11px] text-[var(--t3)] mt-1.5">Open PageRank</div>
            </div>
          </div>
          <div className="px-4 py-4 flex flex-col items-center gap-3">
            <ScoreArc value={scoresAuthority} color="var(--yellow)" size={90} />
            <div className="w-full grid grid-cols-2 gap-x-3 gap-y-2">
              {liveData.opr ? [
                { label: 'PageRank',    value: `${liveData.opr.pageRank} / 10` },
                { label: 'PR Score',    value: `${liveData.opr.prDecimal}`     },
                { label: 'Domain Rank', value: `#${Number(liveData.opr.domainRank).toLocaleString()}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center py-1.5 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
                  <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider">{label}</span>
                  <span className="font-mono text-[15px] font-bold text-[var(--yellow)]">{value}</span>
                </div>
              )) : <div className="col-span-2 font-mono text-[12px] text-[var(--t3)]">No data</div>}
            </div>
          </div>
          <div className="border-t" style={{ borderColor: 'var(--b1)', height: '41px' }} />
        </div>

        {/* Experience — GA4 + Clarity */}
        <div className="rounded-[var(--rl)] border anim-up anim-d4"
          style={{ background: 'var(--s1)', borderColor: 'var(--b1)', borderTopColor: 'var(--green)', borderTopWidth: 2 }}>
          <div className="px-4 py-3 border-b flex items-center" style={{ borderColor: 'var(--b1)' }}>
            <div>
              <div className="font-mono text-[14px] uppercase tracking-wider font-semibold text-[var(--t1)]">Experience</div>
              <div className="font-mono text-[11px] text-[var(--t3)] mt-1.5">GA4 + Clarity · 30d</div>
            </div>
          </div>
          <div className="px-4 py-4 flex flex-col items-center gap-3">
            <ScoreArc value={scoresExperience} color="var(--green)" size={90} />
            <div className="w-full grid grid-cols-2 gap-x-3 gap-y-2">
              {liveData.ga4 ? [
                { label: 'Organic',  value: liveData.ga4.organic.toLocaleString()                    },
                { label: 'Bounce',   value: `${liveData.ga4.bounceRate}%`                            },
                { label: 'Engage',   value: `${liveData.ga4.engagementRate}%`                        },
                { label: 'Rage clk', value: liveData.clarity ? String(liveData.clarity.rageclicks) : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center py-1.5 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
                  <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider">{label}</span>
                  <span className="font-mono text-[15px] font-bold text-[var(--green)]">{value}</span>
                </div>
              )) : <div className="col-span-2 font-mono text-[12px] text-[var(--t3)]">No data</div>}
            </div>
          </div>
          <div className="border-t" style={{ borderColor: 'var(--b1)' }}>
            <button
              onClick={() => setActiveNav('ga4-detail')}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 font-mono text-[11px] transition-all hover:opacity-70 rounded-b-[var(--rl)]"
              style={{ color: 'var(--green)' }}
            >
              View Details <ArrowRight size={10} />
            </button>
          </div>
        </div>

      </div>

      {/* MAIN PANELS */}
      <div className="grid grid-cols-3 gap-4 mb-5 anim-up anim-d4">

        {/* Keywords */}
        <div className="rounded-[var(--rl)] border overflow-hidden flex flex-col"
          style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
          {/* Header */}
          <div className="px-4 h-14 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: 'var(--b1)' }}>
            <div className="min-w-0">
              <div className="font-mono text-[14px] uppercase tracking-wider font-semibold text-[var(--t1)]">Keywords</div>
              <div className="font-mono text-[11px] text-[var(--t3)]">{allKeywords.length} total · GSC + BWT</div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {([
                ['all',          'All',      undefined,        'All keywords sorted by impressions'],
                ['quickwins',    '⚡ Wins',  'var(--adim)',    'Pos 5–20, >500 impr. — one tweak away from page 1'],
                ['oportunidades','🎯 Oport.','var(--rdim)',    'Impressions > 20, 0 clicks — title needs work'],
              ] as const).map(([t, label, activeBg, title]) => (
                <button key={t} onClick={() => setKwTab(t)} title={title}
                  className="px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wide transition-colors whitespace-nowrap"
                  style={{
                    background: kwTab === t ? (activeBg ?? 'var(--adim)') : 'transparent',
                    color:      kwTab === t ? (t === 'oportunidades' ? 'var(--red)' : 'var(--accent)') : 'var(--t3)',
                    border:     kwTab === t ? `1px solid ${t === 'oportunidades' ? 'rgba(244,63,94,0.25)' : 'rgba(249,115,22,0.25)'}` : '1px solid transparent',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Keyword list — all, scrollable */}
          <div className="flex-1 overflow-y-auto">
            {keywords.length === 0 ? (
              <div className="px-4 py-8 text-center font-mono text-[12px] text-[var(--t3)]">
                {!liveData.gsc && !liveData.bwt
                  ? 'Refresh GSC or BWT data to load keywords'
                  : allKeywords.length === 0
                  ? <NoKeywordsHint />
                  : kwTab === 'oportunidades'
                  ? 'No queries with >20 impr. and 0 clicks'
                  : 'No quick wins found'}
              </div>
            ) : (
              <table className="w-full">
                <tbody>
                  {keywords.map((kw, i) => {
                    const posColor = kw.position <= 10 ? 'var(--green)' : kw.position <= 20 ? 'var(--yellow)' : 'var(--red)'
                    const posBg    = kw.position <= 10 ? 'var(--gdim)'  : kw.position <= 20 ? 'var(--ydim)'   : 'var(--rdim)'
                    return (
                      <tr key={i} className="hover:bg-[var(--s2)] transition-colors border-b" style={{ borderColor: 'rgba(28,43,56,0.6)' }}>
                        <td className="pl-4 py-2.5 w-6 font-mono text-[10px] text-[var(--t3)]">{i + 1}</td>
                        <td className="px-2 py-2.5 font-medium text-[12px] text-[var(--t1)] max-w-0 truncate" title={kw.keyword} style={{ width: '99%' }}>{kw.keyword}</td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: kw.source === 'bwt' ? 'var(--gdim)' : 'var(--bdim)', color: kw.source === 'bwt' ? 'var(--green)' : 'var(--blue)' }}>
                            {kw.source === 'bwt' ? 'BWT' : 'GSC'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded font-bold"
                            style={{ background: posBg, color: posColor }}>
                            #{Math.round(kw.position)}
                          </span>
                        </td>
                        <td className="pr-4 py-2.5 font-mono text-[11px] text-[var(--t3)] text-right whitespace-nowrap">
                          {kw.impressions.toLocaleString()} impr
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

        </div>

        {/* Right panel: AI Visibility + Clarity */}
        <div className="flex flex-col gap-3">

          {/* AI Signals */}
          <div className="flex-1 rounded-[var(--rl)] border overflow-hidden flex flex-col"
            style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
            <div className="px-4 h-14 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: 'var(--b1)' }}>
              <div>
                <div className="font-mono text-[14px] uppercase tracking-wider font-semibold text-[var(--t1)]">AI Signals</div>
                <div className="font-mono text-[11px] text-[var(--t3)]">Readiness · Bing · GSC</div>
              </div>
              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: 'var(--pdim)', color: 'var(--purple)' }}>BETA</span>
            </div>
            <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1">

            {/* A: AI Readiness from DOM audit */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)] mb-2">AI Readiness</div>
              {audit ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: 'llms.txt',  ok: audit.llms_txt,                           hint: 'Tells AI crawlers what to index' },
                    { label: 'Schema',    ok: (audit.schema_types?.length ?? 0) > 0,    hint: audit.schema_types?.join(', ') || 'No structured data found' },
                    { label: 'Canonical', ok: !!audit.canonical,                         hint: audit.canonical || 'Missing canonical tag' },
                    { label: 'No noindex',ok: !audit.meta_robots?.includes('noindex'),   hint: audit.meta_robots ?? 'Not set (indexable)' },
                  ].map(({ label, ok, hint }) => (
                    <div key={label} title={hint}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-[var(--r)] border cursor-default"
                      style={{ background: 'var(--s2)', borderColor: ok ? 'rgba(16,217,160,0.2)' : 'rgba(244,63,94,0.2)' }}>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: ok ? 'var(--green)' : 'var(--red)' }} />
                      <span className="font-mono text-[10px]" style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>{label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="font-mono text-[11px] text-[var(--t3)]">Run DOM audit in Sites to see readiness signals</div>
              )}
            </div>

            {/* B: Bing / Copilot proxy */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)] mb-2">Bing · Copilot Proxy</div>
              {liveData.bwt ? (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-3">
                    {[
                      { label: 'Clicks',  value: liveData.bwt.clicks },
                      { label: 'Impr.',   value: liveData.bwt.impressions.toLocaleString() },
                      { label: 'Avg Pos', value: liveData.bwt.position },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex-1 text-center px-2 py-1.5 rounded-[var(--r)]"
                        style={{ background: 'var(--s2)' }}>
                        <div className="font-mono text-[12px] font-bold text-[var(--t1)]">{value}</div>
                        <div className="font-mono text-[8px] text-[var(--t3)]">{label}</div>
                      </div>
                    ))}
                  </div>
                  {liveData.bwt.keywords && liveData.bwt.keywords.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {liveData.bwt.keywords.slice(0, 3).map(kw => (
                        <div key={kw.keyword} className="flex items-center justify-between px-2 py-1 rounded-[var(--r)]"
                          style={{ background: 'var(--s2)' }}>
                          <span className="font-mono text-[10px] text-[var(--t2)] truncate flex-1 mr-2">{kw.keyword}</span>
                          <span className="font-mono text-[10px] flex-shrink-0 flex items-center gap-1.5">
                            <span style={{ color: kw.clicks === 0 ? 'var(--red)' : 'var(--t3)' }}>{kw.clicks}cl</span>
                            <span className="font-bold" style={{ color: kw.position <= 3 ? 'var(--green)' : kw.position <= 10 ? 'var(--yellow)' : 'var(--t3)' }}>#{Math.round(kw.position)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {liveData.bwt.seoErrors && liveData.bwt.seoErrors.total > 0 && (
                    <div className="flex flex-col gap-1">
                      {liveData.bwt.seoErrors.titleErrors > 0 && (
                        <div className="font-mono text-[10px] px-2 py-1 rounded-[var(--r)]" style={{ background: 'var(--ydim)', color: 'var(--yellow)' }}>
                          ⚠ {liveData.bwt.seoErrors.titleErrors} pages with duplicate titles
                        </div>
                      )}
                      {liveData.bwt.seoErrors.descErrors > 0 && (
                        <div className="font-mono text-[10px] px-2 py-1 rounded-[var(--r)]" style={{ background: 'var(--ydim)', color: 'var(--yellow)' }}>
                          ⚠ {liveData.bwt.seoErrors.descErrors} pages with duplicate meta descriptions
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="font-mono text-[11px] text-[var(--t3)]">Refresh BWT to see Bing Copilot data</div>
              )}
            </div>

            {/* C: GSC top positions — AI Overview candidates */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)] mb-2">AI Overview Candidates</div>
              {(() => {
                const topKw = (liveData.gsc?.keywords ?? []).filter(k => k.position <= 10).slice(0, 4)
                return topKw.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {topKw.map(kw => (
                      <div key={kw.keyword} className="flex items-center justify-between px-2 py-1 rounded-[var(--r)]"
                        style={{ background: 'var(--s2)' }}>
                        <span className="font-mono text-[10px] text-[var(--t2)] truncate flex-1 mr-2">{kw.keyword}</span>
                        <span className="font-mono text-[10px] font-bold flex-shrink-0"
                          style={{ color: kw.position <= 3 ? 'var(--green)' : 'var(--yellow)' }}>
                          #{Math.round(kw.position)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="font-mono text-[11px] text-[var(--t3)]">
                    {liveData.gsc ? 'No keywords in top 10' : 'Refresh GSC to see candidates'}
                  </div>
                )
              })()}
            </div>
          </div>{/* end content */}
          </div>{/* end AI Signals card */}

        </div>

        {/* Priority Actions */}
        <div className="rounded-[var(--rl)] border overflow-hidden flex flex-col"
          style={{
            background: actions.length === 0 ? 'var(--s1)'
              : actions.some(a => a.tag === 'HIGH IMPACT') ? 'rgba(239,68,68,0.04)'
              : actions.some(a => a.color === 'var(--yellow)') ? 'rgba(245,158,11,0.04)'
              : 'var(--s1)',
            borderColor: actions.length === 0 ? 'var(--b1)'
              : actions.some(a => a.tag === 'HIGH IMPACT') ? 'rgba(239,68,68,0.25)'
              : actions.some(a => a.color === 'var(--yellow)') ? 'rgba(245,158,11,0.2)'
              : 'var(--b1)',
          }}>
          <div className="flex items-center justify-between px-4 h-14 border-b flex-shrink-0" style={{ borderColor: 'inherit' }}>
            <div className="min-w-0">
              <div className="font-mono text-[14px] uppercase tracking-wider font-semibold text-[var(--t1)]">Priority Actions</div>
              <div className="font-mono text-[11px]"
                style={{ color: actions.length === 0 ? 'var(--t3)' : 'var(--red)' }}>
                {actions.length === 0 ? 'No issues detected' : `${actions.length} found`}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setActiveNav('report')} title="Generate Report"
                className="flex items-center justify-center w-7 h-7 rounded-[var(--r)] border transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
                style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}>
                <FileText size={12} />
              </button>
              {actions.length > 0 && (
                <button onClick={handleCopyAll} title={copyAllDone ? 'Copied!' : 'Copy all actions'}
                  className="flex items-center justify-center w-7 h-7 rounded-[var(--r)] border transition-all hover:border-[var(--accent)]"
                  style={{ borderColor: 'var(--b2)', color: copyAllDone ? 'var(--green)' : 'var(--t3)' }}>
                  {copyAllDone ? <Check size={12} /> : <Copy size={12} />}
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {actions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center font-mono text-[12px] text-[var(--t3)] text-center p-4">
                {Object.values(liveData).some(v => v !== null)
                  ? '✓ No issues detected'
                  : 'Refresh data to generate actions'}
              </div>
            ) : (
              actions.map(({ color, icon: Icon, title, desc, src, tag }, i) => (
                <ActionCard key={i} color={color} Icon={Icon} title={title} desc={desc} src={src} tag={tag} />
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  )
}
