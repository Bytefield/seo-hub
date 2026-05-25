import { useState, useEffect } from 'react'
import { ArrowLeft, Copy, Check, FileText, TrendingUp, Users, Globe, Zap, Shield, Search, AlertTriangle, Info } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { getSiteSnapshots, getLastAudit } from '../lib/tauri'
import type { Snapshot, DomAudit } from '../lib/tauri'

const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)

// ── Data types ────────────────────────────────────────────────────────────────

interface GscKeyword { keyword: string; clicks: number; impressions: number; ctr: number; position: number }
interface GscData  { clicks: number; impressions: number; ctr: number; position: number; keywords?: GscKeyword[] }
interface BwtKeyword { keyword: string; clicks: number; impressions: number; ctr: number; position: number }
interface BwtData  { clicks: number; impressions: number; ctr: number; position: number; crawlErrors: number; keywords?: BwtKeyword[] }
interface Ga4Data  { sessions: number; organic: number; conversions: number; users: number; engagementRate: number; bounceRate: number }
interface ClarityData { rageclicks: number; sessions: number; scrollDepth: number; engageTime: number; deadClicks: number; quickBacks: number }
interface PsiMetrics { lcp: number; cls: number; inp: number; ttfb: number; score: number }
interface CwvData  { mobile: PsiMetrics; desktop: PsiMetrics }
interface OprData  { pageRank: number; prDecimal: number; domainRank: string; domain: string }

interface LiveData { gsc: GscData|null; bwt: BwtData|null; ga4: Ga4Data|null; clarity: ClarityData|null; cwv: CwvData|null; opr: OprData|null }

function parseSnaps(snaps: Snapshot[]): LiveData {
  const r: LiveData = { gsc: null, bwt: null, ga4: null, clarity: null, cwv: null, opr: null }
  for (const s of snaps) {
    const d = s.data as any
    if (s.source === 'gsc')              r.gsc     = d
    else if (s.source === 'bwt')         r.bwt     = d
    else if (s.source === 'ga4')         r.ga4     = d
    else if (s.source === 'clarity')     r.clarity = d
    else if (s.source === 'psi')         r.cwv     = d
    else if (s.source === 'openpagerank') r.opr    = d
  }
  return r
}

// ── Markdown formatters (used only for clipboard copy) ────────────────────────

function fmtSearch(gsc: GscData | null, bwt: BwtData | null): string {
  const lines = ['## Search Performance (last 30 days)', '']
  if (gsc) lines.push('Google Search Console:', `  Clicks: ${gsc.clicks.toLocaleString()} | Impressions: ${gsc.impressions.toLocaleString()} | CTR: ${gsc.ctr}% | Avg Position: ${gsc.position}`, '')
  if (bwt) lines.push('Bing Webmaster Tools:', `  Clicks: ${bwt.clicks.toLocaleString()} | Impressions: ${bwt.impressions.toLocaleString()} | CTR: ${bwt.ctr}% | Avg Position: ${bwt.position}`, '')
  if (!gsc && !bwt) lines.push('No data available.')
  return lines.join('\n')
}

function fmtKeywords(gsc: GscData | null, bwt: BwtData | null): string {
  const gscKw = (gsc?.keywords ?? []).map(k => ({ ...k, source: 'GSC' }))
  const gscSet = new Set(gscKw.map(k => k.keyword.toLowerCase()))
  const bwtKw = (bwt?.keywords ?? []).filter(k => !gscSet.has(k.keyword.toLowerCase())).map(k => ({ ...k, source: 'BWT' }))
  const all = [...gscKw, ...bwtKw].sort((a, b) => b.impressions - a.impressions).slice(0, 15)
  const lines = ['## Top Keywords (GSC + BWT · top 15 by impressions)', '']
  if (!all.length) { lines.push('No keyword data available.'); return lines.join('\n') }
  lines.push('Keyword | Source | Position | Clicks | Impressions | CTR', '--------|--------|----------|--------|-------------|----')
  for (const k of all) lines.push(`${k.keyword} | ${k.source} | #${k.position} | ${k.clicks} | ${k.impressions.toLocaleString()} | ${k.ctr}%`)
  return lines.join('\n')
}

function fmtGa4(ga4: Ga4Data | null): string {
  if (!ga4) return '## Organic Traffic (GA4)\n\nNo data available.'
  return ['## Organic Traffic (GA4 · last 30 days)', '', `Sessions: ${ga4.sessions.toLocaleString()} | Organic: ${ga4.organic.toLocaleString()} | Users: ${ga4.users.toLocaleString()}`, `Engagement Rate: ${ga4.engagementRate}% | Bounce Rate: ${ga4.bounceRate}% | Conversions: ${ga4.conversions}`].join('\n')
}

function fmtClarity(c: ClarityData | null): string {
  if (!c) return '## User Behavior (Clarity)\n\nNo data available.'
  return ['## User Behavior (Clarity · last 3 days)', '', `Sessions: ${c.sessions.toLocaleString()} | Scroll Depth: ${c.scrollDepth}% | Engage Time: ${c.engageTime}s`, `Rage Clicks: ${c.rageclicks} | Dead Clicks: ${c.deadClicks} | Quick Backs: ${c.quickBacks}`].join('\n')
}

function fmtCwv(cwv: CwvData | null): string {
  if (!cwv) return '## Core Web Vitals (PSI)\n\nNo data available.'
  const rate = (v: number, good: number, needs: number) => v <= good ? '✓ GOOD' : v <= needs ? '⚠ NEEDS WORK' : '🔴 POOR'
  const m = cwv.mobile
  return ['## Core Web Vitals (PageSpeed Insights · Mobile)', '', `Score: ${m.score}/100`, `LCP:  ${m.lcp}s   ${rate(m.lcp, 2.5, 4.0)}`, `CLS:  ${m.cls}    ${rate(m.cls, 0.1, 0.25)}`, `INP:  ${m.inp}ms  ${rate(m.inp, 200, 500)}`, `TTFB: ${m.ttfb}ms ${m.ttfb <= 800 ? '✓ GOOD' : '⚠ NEEDS WORK'}`].join('\n')
}

function fmtOpr(opr: OprData | null): string {
  if (!opr) return '## Domain Authority (OpenPageRank)\n\nNo data available.'
  return ['## Domain Authority (OpenPageRank)', '', `Domain: ${opr.domain}`, `Page Rank: ${opr.pageRank}/10 (${opr.prDecimal})`, `Global Rank: ${opr.domainRank || 'N/A'}`].join('\n')
}

function fmtAudit(audit: DomAudit | null): string {
  if (!audit) return '## DOM Audit\n\nNo audit data. Run an audit from the Dashboard.'
  const lines = ['## DOM Audit', '', `Score: ${audit.score ?? 'n/a'}/100 | Audited: ${new Date(audit.crawled_at).toLocaleDateString('es-ES')}`, '']
  lines.push(`Title: "${audit.title ?? 'MISSING'}" (${audit.title_length ?? 0} chars)`)
  lines.push(`Meta desc: ${audit.meta_description ? `${audit.meta_desc_length} chars` : 'MISSING'}`)
  lines.push(`H1: ${audit.h1_count ?? 0} — "${audit.h1_text ?? ''}"`)
  lines.push(`Canonical: ${audit.canonical ?? 'MISSING'} ${audit.canonical_match ? '✓' : '⚠ mismatch'}`)
  lines.push(`Schema: ${audit.schema_types?.join(', ') || 'none'}`)
  lines.push(`llms.txt: ${audit.llms_txt ? '✓ present' : '✗ missing'}`)
  if (audit.issues?.length) {
    lines.push('', 'Issues:')
    audit.issues.slice(0, 10).forEach(i => lines.push(`  [${i.severity.toUpperCase()}] [${i.category}] ${i.message}`))
    if (audit.issues.length > 10) lines.push(`  … and ${audit.issues.length - 10} more`)
  }
  return lines.join('\n')
}

function fmtActions(d: LiveData, audit: DomAudit | null): string {
  const actions: string[] = []
  if (d.cwv) {
    const m = d.cwv.mobile
    if (m.ttfb > 800) actions.push(`🔴 [PSI] TTFB ${m.ttfb}ms — Critical server response`)
    else if (m.ttfb > 600) actions.push(`🟡 [PSI] TTFB ${m.ttfb}ms — Slow server response`)
    if (m.lcp > 4.0) actions.push(`🔴 [PSI] LCP ${m.lcp}s — Core Web Vitals failing`)
    else if (m.lcp > 2.5) actions.push(`🟡 [PSI] LCP ${m.lcp}s — Needs improvement`)
    if (m.cls > 0.25) actions.push(`🔴 [PSI] CLS ${m.cls} — Layout shift critical`)
    else if (m.cls > 0.1) actions.push(`🟡 [PSI] CLS ${m.cls} — Layout shift detected`)
    if (m.inp > 500) actions.push(`🔴 [PSI] INP ${m.inp}ms — Interaction latency critical`)
    else if (m.inp > 200) actions.push(`🟡 [PSI] INP ${m.inp}ms — Slow interactions`)
  }
  if (d.gsc) {
    if (d.gsc.impressions > 500 && d.gsc.ctr < 2.0) actions.push(`🟠 [GSC] CTR ${d.gsc.ctr}% — Low click-through rate (${d.gsc.impressions.toLocaleString()} impressions)`)
    if (d.gsc.position > 10 && d.gsc.impressions > 1000) actions.push(`🟠 [GSC] Avg position ${d.gsc.position} — Page 2, ${d.gsc.impressions.toLocaleString()} impressions`)
  }
  if (d.ga4) {
    if (d.ga4.bounceRate > 70) actions.push(`🔴 [GA4] Bounce rate ${d.ga4.bounceRate}% — High exit rate`)
    else if (d.ga4.bounceRate > 55) actions.push(`🟡 [GA4] Bounce rate ${d.ga4.bounceRate}% — Above average`)
  }
  if (d.clarity) {
    if (d.clarity.rageclicks > 50) actions.push(`🟡 [Clarity] ${d.clarity.rageclicks} rage clicks detected`)
    if (d.clarity.deadClicks > 100) actions.push(`🟡 [Clarity] ${d.clarity.deadClicks} dead clicks`)
  }
  if (audit) {
    if (!audit.llms_txt) actions.push('🟠 [Audit] Missing llms.txt — not AI crawler ready')
    if ((audit.schema_types?.length ?? 0) === 0) actions.push('🟠 [Audit] No structured data (Schema.org)')
  }
  if (!actions.length) return '## Priority Actions\n\n✓ No critical issues found.'
  return ['## Priority Actions', '', ...actions].join('\n')
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) })
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-[11px] transition-colors flex-shrink-0"
      style={{ background: done ? 'var(--gdim)' : 'var(--s2)', color: done ? 'var(--green)' : 'var(--t3)', border: '1px solid var(--b1)' }}>
      {done ? <Check size={10} /> : <Copy size={10} />}
      {done ? 'Copied!' : label}
    </button>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center py-2 px-3 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
      <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider mb-0.5">{label}</span>
      <span className="font-mono text-[15px] font-bold" style={{ color: color ?? 'var(--t1)' }}>{value}</span>
    </div>
  )
}

function NoData() {
  return <div className="py-6 text-center font-mono text-[12px] text-[var(--t3)]">No data available</div>
}

// ── Visual section renderers ──────────────────────────────────────────────────

function SearchPerf({ gsc, bwt }: { gsc: GscData|null; bwt: BwtData|null }) {
  if (!gsc && !bwt) return <NoData />
  return (
    <div className="flex flex-col gap-3">
      {gsc && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--accent)] mb-2">Google Search Console · 30d</div>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Clicks"       value={gsc.clicks.toLocaleString()} color="var(--accent)" />
            <Stat label="Impressions"  value={gsc.impressions.toLocaleString()} />
            <Stat label="CTR"          value={`${gsc.ctr}%`} color={gsc.ctr >= 3 ? 'var(--green)' : gsc.ctr >= 1.5 ? 'var(--yellow)' : 'var(--red)'} />
            <Stat label="Avg Position" value={`#${gsc.position}`} color={gsc.position <= 10 ? 'var(--green)' : gsc.position <= 20 ? 'var(--yellow)' : 'var(--red)'} />
          </div>
        </div>
      )}
      {bwt && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--green)] mb-2">Bing Webmaster Tools · 30d</div>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Clicks"       value={bwt.clicks.toLocaleString()} color="var(--green)" />
            <Stat label="Impressions"  value={bwt.impressions.toLocaleString()} />
            <Stat label="CTR"          value={`${bwt.ctr}%`} color={bwt.ctr >= 3 ? 'var(--green)' : bwt.ctr >= 1.5 ? 'var(--yellow)' : 'var(--red)'} />
            <Stat label="Avg Position" value={`#${bwt.position}`} color={bwt.position <= 10 ? 'var(--green)' : bwt.position <= 20 ? 'var(--yellow)' : 'var(--red)'} />
          </div>
        </div>
      )}
    </div>
  )
}

function KeywordsTable({ gsc, bwt }: { gsc: GscData|null; bwt: BwtData|null }) {
  const gscKw = (gsc?.keywords ?? []).map(k => ({ ...k, source: 'GSC' as const }))
  const gscSet = new Set(gscKw.map(k => k.keyword.toLowerCase()))
  const bwtKw = (bwt?.keywords ?? []).filter(k => !gscSet.has(k.keyword.toLowerCase())).map(k => ({ ...k, source: 'BWT' as const }))
  const all = [...gscKw, ...bwtKw].sort((a, b) => b.impressions - a.impressions).slice(0, 15)
  if (!all.length) return <NoData />
  return (
    <table className="w-full">
      <thead>
        <tr style={{ borderBottom: '1px solid var(--b1)' }}>
          {['#', 'Keyword', 'Src', 'Position', 'Clicks', 'Impressions', 'CTR'].map(h => (
            <th key={h} className="pb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--t3)] text-left px-2 first:pl-0">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {all.map((k, i) => {
          const posColor = k.position <= 10 ? 'var(--green)' : k.position <= 20 ? 'var(--yellow)' : 'var(--red)'
          const posBg    = k.position <= 10 ? 'var(--gdim)'  : k.position <= 20 ? 'var(--ydim)'   : 'var(--rdim)'
          return (
            <tr key={i} className="border-b hover:bg-[var(--s2)] transition-colors" style={{ borderColor: 'rgba(28,43,56,0.5)' }}>
              <td className="py-2 pr-2 font-mono text-[10px] text-[var(--t3)]">{i + 1}</td>
              <td className="px-2 py-2 font-medium text-[12px] text-[var(--t1)] max-w-0 truncate" style={{ maxWidth: 200 }} title={k.keyword}>{k.keyword}</td>
              <td className="px-2 py-2">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: k.source === 'BWT' ? 'var(--gdim)' : 'var(--bdim)', color: k.source === 'BWT' ? 'var(--green)' : 'var(--blue)' }}>
                  {k.source}
                </span>
              </td>
              <td className="px-2 py-2">
                <span className="font-mono text-[11px] px-2 py-0.5 rounded font-bold" style={{ background: posBg, color: posColor }}>
                  #{Math.round(k.position)}
                </span>
              </td>
              <td className="px-2 py-2 font-mono text-[12px] text-[var(--t2)]">{k.clicks.toLocaleString()}</td>
              <td className="px-2 py-2 font-mono text-[12px] text-[var(--t2)]">{k.impressions.toLocaleString()}</td>
              <td className="px-2 py-2 font-mono text-[12px] text-[var(--t2)]">{k.ctr}%</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Ga4Card({ ga4 }: { ga4: Ga4Data|null }) {
  if (!ga4) return <NoData />
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Sessions"       value={ga4.sessions.toLocaleString()} />
      <Stat label="Organic"        value={ga4.organic.toLocaleString()} color="var(--green)" />
      <Stat label="Users"          value={ga4.users.toLocaleString()} />
      <Stat label="Engagement"     value={`${ga4.engagementRate}%`} color={ga4.engagementRate >= 60 ? 'var(--green)' : ga4.engagementRate >= 40 ? 'var(--yellow)' : 'var(--red)'} />
      <Stat label="Bounce Rate"    value={`${ga4.bounceRate}%`}     color={ga4.bounceRate <= 40 ? 'var(--green)' : ga4.bounceRate <= 60 ? 'var(--yellow)' : 'var(--red)'} />
      <Stat label="Conversions"    value={String(ga4.conversions)} color="var(--accent)" />
    </div>
  )
}

function ClarityCard({ c }: { c: ClarityData|null }) {
  if (!c) return <NoData />
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Sessions"    value={c.sessions.toLocaleString()} />
      <Stat label="Scroll Depth" value={`${c.scrollDepth}%`}  color={c.scrollDepth >= 60 ? 'var(--green)' : 'var(--yellow)'} />
      <Stat label="Engage Time" value={`${c.engageTime}s`} color="var(--blue)" />
      <Stat label="Rage Clicks" value={String(c.rageclicks)} color={c.rageclicks > 50 ? 'var(--red)' : c.rageclicks > 10 ? 'var(--yellow)' : 'var(--green)'} />
      <Stat label="Dead Clicks" value={String(c.deadClicks)} color={c.deadClicks > 100 ? 'var(--red)' : c.deadClicks > 30 ? 'var(--yellow)' : 'var(--green)'} />
      <Stat label="Quick Backs" value={String(c.quickBacks)} color={c.quickBacks > 20 ? 'var(--yellow)' : 'var(--green)'} />
    </div>
  )
}

const CWV_INFO: Record<string, string> = {
  Score: 'Overall performance score from Google PageSpeed Insights (0–100). 90+ is Good, 50–89 Needs Improvement, below 50 is Poor.',
  LCP:   'Largest Contentful Paint — time until the largest visible element loads. Good: ≤2.5s | Needs work: ≤4s | Poor: >4s.',
  CLS:   'Cumulative Layout Shift — measures visual stability; how much the page jumps as it loads. Good: ≤0.1 | Needs work: ≤0.25 | Poor: >0.25.',
  INP:   'Interaction to Next Paint — responsiveness to user interactions (clicks, taps, keys). Good: ≤200ms | Needs work: ≤500ms | Poor: >500ms.',
  TTFB:  'Time To First Byte — server response speed, from request to first byte received. Good: ≤800ms | Needs work: >800ms.',
}

function CwvCard({ cwv }: { cwv: CwvData|null }) {
  if (!cwv) return <NoData />
  const m = cwv.mobile
  const metrics = [
    { label: 'Score', value: `${m.score}/100`, color: m.score >= 90 ? 'var(--green)' : m.score >= 50 ? 'var(--yellow)' : 'var(--red)', thr: null },
    { label: 'LCP',   value: `${m.lcp}s`,      color: m.lcp <= 2.5 ? 'var(--green)' : m.lcp <= 4 ? 'var(--yellow)' : 'var(--red)',   thr: '≤2.5s' },
    { label: 'CLS',   value: String(m.cls),     color: m.cls <= 0.1 ? 'var(--green)' : m.cls <= 0.25 ? 'var(--yellow)' : 'var(--red)', thr: '≤0.1' },
    { label: 'INP',   value: `${m.inp}ms`,      color: m.inp <= 200 ? 'var(--green)' : m.inp <= 500 ? 'var(--yellow)' : 'var(--red)',  thr: '≤200ms' },
    { label: 'TTFB',  value: `${m.ttfb}ms`,     color: m.ttfb <= 800 ? 'var(--green)' : 'var(--yellow)',                               thr: '≤800ms' },
  ]
  return (
    <div>
      <div className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider mb-2">Mobile · PageSpeed Insights</div>
      <div className="grid grid-cols-5 gap-2">
        {metrics.map(({ label, value, color, thr }) => (
          <div key={label} className="flex flex-col items-center py-2 px-2 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider">{label}</span>
              <span title={CWV_INFO[label]} className="cursor-help" style={{ color: 'var(--t3)', lineHeight: 0 }}>
                <Info size={9} />
              </span>
            </div>
            <span className="font-mono text-[14px] font-bold mt-0.5" style={{ color }}>{value}</span>
            {thr && <span className="font-mono text-[8px] text-[var(--t3)] mt-0.5">{thr}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function OprCard({ opr }: { opr: OprData|null }) {
  if (!opr) return <NoData />
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Page Rank"    value={`${opr.pageRank}/10`}  color="var(--yellow)" />
      <Stat label="PR Score"     value={String(opr.prDecimal)} />
      <Stat label="Global Rank"  value={opr.domainRank ? `#${Number(opr.domainRank).toLocaleString()}` : 'N/A'} />
    </div>
  )
}

function AuditCard({ audit }: { audit: DomAudit|null }) {
  if (!audit) return <NoData />
  const checks = [
    { label: 'Title',     ok: !!audit.title,            detail: audit.title ? `${audit.title_length} chars` : 'MISSING' },
    { label: 'Meta Desc', ok: !!audit.meta_description,  detail: audit.meta_description ? `${audit.meta_desc_length} chars` : 'MISSING' },
    { label: 'H1',        ok: (audit.h1_count ?? 0) === 1, detail: audit.h1_text ?? 'MISSING' },
    { label: 'Canonical', ok: !!audit.canonical && audit.canonical_match, detail: audit.canonical ?? 'MISSING' },
    { label: 'Schema',    ok: (audit.schema_types?.length ?? 0) > 0, detail: audit.schema_types?.join(', ') || 'none' },
    { label: 'llms.txt',  ok: !!audit.llms_txt,          detail: audit.llms_txt ? 'present' : 'missing' },
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center py-2 px-4 rounded-[var(--r)]" style={{ background: 'var(--s2)' }}>
          <span className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider">Score</span>
          <span className="font-mono text-[20px] font-bold" style={{ color: (audit.score ?? 0) >= 80 ? 'var(--green)' : (audit.score ?? 0) >= 50 ? 'var(--yellow)' : 'var(--red)' }}>{audit.score ?? '—'}</span>
          <span className="font-mono text-[8px] text-[var(--t3)]">/100</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 flex-1">
          {checks.map(({ label, ok, detail }) => (
            <div key={label} title={detail}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-[var(--r)] border cursor-default"
              style={{ background: 'var(--s2)', borderColor: ok ? 'rgba(16,217,160,0.2)' : 'rgba(244,63,94,0.2)' }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ok ? 'var(--green)' : 'var(--red)' }} />
              <span className="font-mono text-[10px] truncate" style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
      {audit.issues && audit.issues.length > 0 && (
        <div className="flex flex-col gap-1">
          {audit.issues.slice(0, 8).map((issue, i) => {
            const color = issue.severity === 'critical' ? 'var(--red)' : issue.severity === 'warning' ? 'var(--yellow)' : 'var(--blue)'
            const bg    = issue.severity === 'critical' ? 'var(--rdim)' : issue.severity === 'warning' ? 'var(--ydim)' : 'var(--bdim)'
            return (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-[var(--r)]" style={{ background: bg }}>
                <span className="font-mono text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 uppercase" style={{ background: color, color: 'var(--bg)' }}>{issue.severity}</span>
                <span className="font-mono text-[11px]" style={{ color }}>{issue.message}</span>
              </div>
            )
          })}
          {audit.issues.length > 8 && <div className="font-mono text-[11px] text-[var(--t3)] px-1">+{audit.issues.length - 8} more issues</div>}
        </div>
      )}
    </div>
  )
}

function ActionsCard({ d, audit }: { d: LiveData; audit: DomAudit|null }) {
  const items: { color: string; bg: string; tag: string; text: string }[] = []
  if (d.cwv) {
    const m = d.cwv.mobile
    if (m.ttfb > 800) items.push({ color: 'var(--red)', bg: 'var(--rdim)', tag: 'PSI', text: `TTFB ${m.ttfb}ms — Critical server response time` })
    else if (m.ttfb > 600) items.push({ color: 'var(--yellow)', bg: 'var(--ydim)', tag: 'PSI', text: `TTFB ${m.ttfb}ms — Slow server response` })
    if (m.lcp > 4.0) items.push({ color: 'var(--red)', bg: 'var(--rdim)', tag: 'PSI', text: `LCP ${m.lcp}s — Core Web Vitals failing` })
    else if (m.lcp > 2.5) items.push({ color: 'var(--yellow)', bg: 'var(--ydim)', tag: 'PSI', text: `LCP ${m.lcp}s — Needs improvement` })
    if (m.cls > 0.25) items.push({ color: 'var(--red)', bg: 'var(--rdim)', tag: 'PSI', text: `CLS ${m.cls} — Layout shift critical` })
    else if (m.cls > 0.1) items.push({ color: 'var(--yellow)', bg: 'var(--ydim)', tag: 'PSI', text: `CLS ${m.cls} — Layout shift detected` })
    if (m.inp > 500) items.push({ color: 'var(--red)', bg: 'var(--rdim)', tag: 'PSI', text: `INP ${m.inp}ms — Interaction latency critical` })
    else if (m.inp > 200) items.push({ color: 'var(--yellow)', bg: 'var(--ydim)', tag: 'PSI', text: `INP ${m.inp}ms — Slow interactions` })
  }
  if (d.gsc) {
    if (d.gsc.impressions > 500 && d.gsc.ctr < 2.0) items.push({ color: 'var(--accent)', bg: 'var(--adim)', tag: 'GSC', text: `CTR ${d.gsc.ctr}% — Low click-through rate (${d.gsc.impressions.toLocaleString()} impressions)` })
    if (d.gsc.position > 10 && d.gsc.impressions > 1000) items.push({ color: 'var(--accent)', bg: 'var(--adim)', tag: 'GSC', text: `Avg position ${d.gsc.position} — Page 2, ${d.gsc.impressions.toLocaleString()} impressions` })
  }
  if (d.ga4) {
    if (d.ga4.bounceRate > 70) items.push({ color: 'var(--red)', bg: 'var(--rdim)', tag: 'GA4', text: `Bounce rate ${d.ga4.bounceRate}% — High exit rate` })
    else if (d.ga4.bounceRate > 55) items.push({ color: 'var(--yellow)', bg: 'var(--ydim)', tag: 'GA4', text: `Bounce rate ${d.ga4.bounceRate}% — Above average` })
  }
  if (d.clarity) {
    if (d.clarity.rageclicks > 50) items.push({ color: 'var(--yellow)', bg: 'var(--ydim)', tag: 'Clarity', text: `${d.clarity.rageclicks} rage clicks detected` })
    if (d.clarity.deadClicks > 100) items.push({ color: 'var(--yellow)', bg: 'var(--ydim)', tag: 'Clarity', text: `${d.clarity.deadClicks} dead clicks` })
  }
  if (audit) {
    if (!audit.llms_txt) items.push({ color: 'var(--accent)', bg: 'var(--adim)', tag: 'Audit', text: 'Missing llms.txt — not AI crawler ready' })
    if ((audit.schema_types?.length ?? 0) === 0) items.push({ color: 'var(--accent)', bg: 'var(--adim)', tag: 'Audit', text: 'No structured data (Schema.org)' })
  }
  if (!items.length) return <div className="py-4 font-mono text-[12px] text-[var(--green)]">✓ No critical issues found</div>
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--r)]" style={{ background: item.bg }}>
          <span className="font-mono text-[8px] px-1.5 py-0.5 rounded flex-shrink-0 uppercase font-bold" style={{ background: item.color, color: 'var(--bg)' }}>{item.tag}</span>
          <span className="font-mono text-[12px]" style={{ color: item.color }}>{item.text}</span>
        </div>
      ))}
    </div>
  )
}

// ── Report card wrapper ───────────────────────────────────────────────────────

function ReportCard({ title, icon: Icon, copyText, children }: {
  title: string
  icon: React.ElementType
  copyText: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[var(--rl)] border overflow-hidden" style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
      <div className="flex items-center justify-between px-4 h-12 border-b" style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-2">
          <Icon size={13} style={{ color: 'var(--accent)' }} />
          <span className="font-mono text-[13px] uppercase tracking-wider font-semibold text-[var(--t1)]">{title}</span>
        </div>
        <CopyBtn text={copyText} label="Copy for Claude" />
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { sites, activeSiteId, setActiveNav } = useAppStore()
  const site = sites.find(s => s.id === activeSiteId)
  const [live, setLive] = useState<LiveData>({ gsc: null, bwt: null, ga4: null, clarity: null, cwv: null, opr: null })
  const [audit, setAudit] = useState<DomAudit | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeSiteId || !IS_TAURI) { setLoading(false); return }
    Promise.all([
      getSiteSnapshots(activeSiteId).then(snaps => setLive(parseSnaps(snaps))),
      getLastAudit(activeSiteId).then(setAudit).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [activeSiteId])

  const allText = [
    `# SEO Report — ${site?.domain ?? 'Site'}`,
    `Generated: ${new Date().toLocaleString('es-ES')}`,
    '',
    fmtSearch(live.gsc, live.bwt),
    fmtKeywords(live.gsc, live.bwt),
    fmtGa4(live.ga4),
    fmtClarity(live.clarity),
    fmtCwv(live.cwv),
    fmtOpr(live.opr),
    fmtAudit(audit),
    fmtActions(live, audit),
  ].join('\n\n')

  return (
    <div className="p-6 max-w-4xl mx-auto overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveNav('dashboard')}
            className="flex items-center gap-1.5 font-mono text-[12px] px-3 py-1.5 rounded transition-colors"
            style={{ background: 'var(--s2)', color: 'var(--t3)', border: '1px solid var(--b1)' }}>
            <ArrowLeft size={11} /> Back
          </button>
          <div>
            <h1 className="font-mono text-[17px] uppercase tracking-wider font-semibold text-[var(--t1)] flex items-center gap-2">
              <FileText size={14} style={{ color: 'var(--accent)' }} />
              SEO Report
            </h1>
            {site && <div className="font-mono text-[12px] text-[var(--t3)] mt-0.5">{site.domain} · {new Date().toLocaleDateString('es-ES')}</div>}
          </div>
        </div>
        <CopyBtn text={allText} label="Copy All for Claude" />
      </div>

      {loading ? (
        <div className="text-center py-16 font-mono text-[12px] text-[var(--t3)]">Loading report data…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <ReportCard title="Search Performance" icon={Search} copyText={fmtSearch(live.gsc, live.bwt)}>
            <SearchPerf gsc={live.gsc} bwt={live.bwt} />
          </ReportCard>
          <ReportCard title="Top Keywords" icon={TrendingUp} copyText={fmtKeywords(live.gsc, live.bwt)}>
            <KeywordsTable gsc={live.gsc} bwt={live.bwt} />
          </ReportCard>
          <ReportCard title="Organic Traffic" icon={Users} copyText={fmtGa4(live.ga4)}>
            <Ga4Card ga4={live.ga4} />
          </ReportCard>
          <ReportCard title="User Behavior" icon={Globe} copyText={fmtClarity(live.clarity)}>
            <ClarityCard c={live.clarity} />
          </ReportCard>
          <ReportCard title="Core Web Vitals" icon={Zap} copyText={fmtCwv(live.cwv)}>
            <CwvCard cwv={live.cwv} />
          </ReportCard>
          <ReportCard title="Domain Authority" icon={Shield} copyText={fmtOpr(live.opr)}>
            <OprCard opr={live.opr} />
          </ReportCard>
          <ReportCard title="DOM Audit" icon={Search} copyText={fmtAudit(audit)}>
            <AuditCard audit={audit} />
          </ReportCard>
          <ReportCard title="Priority Actions" icon={AlertTriangle} copyText={fmtActions(live, audit)}>
            <ActionsCard d={live} audit={audit} />
          </ReportCard>
        </div>
      )}
    </div>
  )
}
