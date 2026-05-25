import { useEffect, useState } from 'react'
import { Plus, Scan, AlertTriangle, Info, Globe, Trash2, ChevronDown, ChevronUp, Bot, Download, Eye, EyeOff } from 'lucide-react'
import { getSites, createSite, deleteSite, runDomAudit, getLastAudit, listGscSites, listBwtSites, detectGa4Property, saveSiteClarityToken, deleteSiteClarityToken, getSiteClarityStatus } from '../lib/tauri'
import type { Site, DomAudit, AuditIssue, GscSiteEntry } from '../lib/tauri'
import { useAppStore } from '../store/appStore'
import { buildSiteContext, openInClaude } from '../lib/exportContext'
import clsx from 'clsx'

function ScoreRing({ score }: { score: number }) {
  const r = 20; const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  const color = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : 'var(--red)'
  return (
    <svg width="52" height="52" className="score-ring -rotate-90">
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--b1)" strokeWidth="3" />
      <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1s ease' }} />
      <text x="26" y="26" textAnchor="middle" dominantBaseline="central"
        className="rotate-90" fill={color}
        style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 700, transform: 'rotate(90deg)', transformOrigin: '26px 26px' }}>
        {score}
      </text>
    </svg>
  )
}

function IssueRow({ issue }: { issue: AuditIssue }) {
  const [open, setOpen] = useState(false)
  const colors = {
    critical: { bg: 'var(--rdim)', border: 'rgba(244,63,94,0.2)', text: 'var(--red)', icon: AlertTriangle },
    warning:  { bg: 'var(--ydim)', border: 'rgba(245,158,11,0.2)', text: 'var(--yellow)', icon: AlertTriangle },
    info:     { bg: 'var(--bdim)', border: 'rgba(56,189,248,0.2)', text: 'var(--blue)', icon: Info },
  }
  const s = colors[issue.severity] ?? colors.info
  const Icon = s.icon
  return (
    <div className="rounded-[var(--r)] border overflow-hidden"
      style={{ background: s.bg, borderColor: s.border }}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left">
        <Icon size={12} className="flex-shrink-0 mt-0.5" style={{ color: s.text }} />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] font-medium" style={{ color: s.text }}>{issue.category}</div>
          <div className="font-mono text-[12px] text-[var(--t2)] mt-0.5">{issue.message}</div>
        </div>
        {open ? <ChevronUp size={12} className="flex-shrink-0 text-[var(--t3)]" /> : <ChevronDown size={12} className="flex-shrink-0 text-[var(--t3)]" />}
      </button>
      {open && (
        <div className="px-3 pb-2.5 ml-5">
          <div className="font-mono text-[11px] text-[var(--t3)] leading-relaxed">
            <span className="text-[var(--accent)]">Fix →</span> {issue.fix}
          </div>
        </div>
      )}
    </div>
  )
}

function AuditPanel({ site, audit, onRunAudit, running, error }: {
  site: Site; audit: DomAudit | null; onRunAudit: () => void; running: boolean; error?: string
}) {
  const crit = audit?.issues.filter(i => i.severity === 'critical').length ?? 0
  const warn = audit?.issues.filter(i => i.severity === 'warning').length ?? 0

  return (
    <div className="flex flex-col gap-3">
      {/* Run button */}
      <button onClick={onRunAudit} disabled={running}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-[var(--r)] border font-mono text-[12px] font-medium transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
        style={{ borderColor: 'var(--b2)', color: 'var(--t2)' }}>
        <Scan size={13} className={running ? 'animate-spin' : ''} />
        {running ? 'Scanning DOM…' : 'Run DOM Audit'}
      </button>

      {error && (
        <div className="font-mono text-[11px] px-3 py-2 rounded-[var(--r)]"
          style={{ background: 'var(--rdim)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {!audit && !running && !error && (
        <div className="text-center py-6 font-mono text-[12px] text-[var(--t3)]">
          No audit data — run a scan to extract DOM metadata
        </div>
      )}

      {audit && (
        <>
          {/* Score + summary */}
          <div className="flex items-center gap-4 p-4 rounded-[var(--rl)] border"
            style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
            <ScoreRing score={audit.score ?? 0} />
            <div className="flex-1">
              <div className="font-mono text-[11px] text-[var(--t3)] uppercase tracking-wider mb-1">DOM Score</div>
              <div className="flex gap-2">
                {crit > 0 && (
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded"
                    style={{ background: 'var(--rdim)', color: 'var(--red)' }}>
                    {crit} critical
                  </span>
                )}
                {warn > 0 && (
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded"
                    style={{ background: 'var(--ydim)', color: 'var(--yellow)' }}>
                    {warn} warnings
                  </span>
                )}
                {crit === 0 && warn === 0 && (
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded"
                    style={{ background: 'var(--gdim)', color: 'var(--green)' }}>
                    All good ✓
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-[var(--t3)] mt-1">
                Scanned {new Date(audit.crawled_at).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Key DOM nodes */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Canonical', value: audit.canonical ? '✓ Present' : '✗ Missing', ok: !!audit.canonical, detail: audit.canonical },
              { label: 'Title', value: audit.title ? `${audit.title_length} chars` : '✗ Missing', ok: !!audit.title && (audit.title_length ?? 0) >= 10 && (audit.title_length ?? 0) <= 60, detail: audit.title },
              { label: 'Meta Desc', value: audit.meta_description ? `${audit.meta_desc_length} chars` : '✗ Missing', ok: !!audit.meta_description, detail: audit.meta_description },
              { label: 'H1', value: audit.h1_count === 1 ? '✓ 1 found' : audit.h1_count === 0 ? '✗ Missing' : `⚠ ${audit.h1_count} found`, ok: audit.h1_count === 1, detail: audit.h1_text },
              { label: 'Meta Robots', value: audit.meta_robots ?? 'Not set (index)', ok: !audit.meta_robots?.includes('noindex'), detail: audit.meta_robots },
              { label: 'Schema', value: audit.schema_types?.length ? audit.schema_types.join(', ') : 'None', ok: (audit.schema_types?.length ?? 0) > 0, detail: null },
              { label: 'Hreflang', value: audit.hreflang_tags?.length ? `${audit.hreflang_tags.length} tags` : 'None', ok: true, detail: null },
              { label: 'llms.txt', value: audit.llms_txt ? '✓ Found' : '✗ Missing', ok: audit.llms_txt, detail: null },
            ].map(({ label, value, ok, detail }) => (
              <div key={label} className="p-2.5 rounded-[var(--r)] border"
                style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
                <div className="font-mono text-[10px] text-[var(--t3)] uppercase tracking-wider mb-1">{label}</div>
                <div className="font-mono text-[11px]" style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>
                  {value}
                </div>
                {detail && (
                  <div className="font-mono text-[10px] text-[var(--t3)] mt-0.5 truncate" title={detail}>
                    {detail}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Issues */}
          {audit.issues.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="font-mono text-[11px] tracking-wider uppercase text-[var(--t3)]">Issues</div>
              {audit.issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { sites, projects } = useAppStore()
  const [source, setSource] = useState<'gsc' | 'bwt'>('gsc')
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null)
  const [gscSites, setGscSites] = useState<GscSiteEntry[]>([])
  const [bwtSites, setBwtSites] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<Set<string>>(new Set())

  const existingDomains = new Set(sites.map(s => s.domain))

  function extractDomain(siteUrl: string): string {
    if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length)
    try { return new URL(siteUrl).hostname } catch { return siteUrl }
  }

  async function fetchSites() {
    setLoading(true); setError(''); setSelected(new Set()); setDone(new Set())
    try {
      if (source === 'gsc') setGscSites(await listGscSites())
      else setBwtSites(await listBwtSites())
    } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }

  useEffect(() => { fetchSites() }, [source])

  const siteUrls = source === 'gsc' ? gscSites.map(s => s.siteUrl) : bwtSites

  function toggle(url: string) {
    setSelected(prev => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n })
  }

  function selectAll() {
    setSelected(new Set(siteUrls.filter(u => !existingDomains.has(extractDomain(u)))))
  }

  async function handleImport() {
    if (!projectId || selected.size === 0) return
    setImporting(true)
    const imported = new Set<string>()
    for (const siteUrl of selected) {
      const domain = extractDomain(siteUrl)
      const url = siteUrl.startsWith('sc-domain:')
        ? `https://${domain}`
        : siteUrl.replace(/\/$/, '')
      try {
        const site = await createSite({
          project_id: projectId,
          name: domain,
          domain,
          url,
          gsc_property: source === 'gsc' ? siteUrl : undefined,
          bwt_property: source === 'bwt' ? siteUrl : undefined,
        })
        imported.add(domain)
        // Auto-detect GA4 property by matching data stream domain — ignore errors silently
        detectGa4Property(site.id).catch(() => {})
      } catch { /* skip duplicates */ }
    }
    setDone(imported)
    setImporting(false)
    if (imported.size > 0) { onImported(); onClose() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,8,11,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="anim-up w-full max-w-lg rounded-[var(--rl)] border overflow-hidden"
        style={{ background: 'var(--s1)', borderColor: 'var(--b2)' }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--b1)' }}>
          <div>
            <div className="font-display text-[17px] text-[var(--t1)]">Import Sites</div>
            <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5">Discover sites from your connected sources</div>
          </div>
          <button onClick={onClose} className="text-[var(--t3)] hover:text-[var(--t1)] text-lg">×</button>
        </div>

        <div className="px-6 pt-4 pb-3 flex items-center gap-3 border-b" style={{ borderColor: 'var(--b1)' }}>
          <div className="flex rounded-[var(--r)] overflow-hidden border" style={{ borderColor: 'var(--b2)' }}>
            {(['gsc', 'bwt'] as const).map(src => (
              <button key={src} onClick={() => setSource(src)}
                className="px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors"
                style={source === src
                  ? { background: 'var(--accent)', color: 'white' }
                  : { background: 'var(--s2)', color: 'var(--t3)' }}>
                {src === 'gsc' ? 'Search Console' : 'Bing Webmaster'}
              </button>
            ))}
          </div>
          <select value={projectId ?? ''} onChange={e => setProjectId(Number(e.target.value))}
            className="ml-auto px-3 py-1.5 rounded-[var(--r)] border font-mono text-[11px] outline-none"
            style={{ background: 'var(--s2)', borderColor: 'var(--b2)', color: 'var(--t2)' }}>
            <option value="">Assign to project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
        </div>

        <div className="px-6 py-4 overflow-y-auto max-h-64">
          {loading && <div className="font-mono text-[12px] text-[var(--t3)]">Fetching sites…</div>}
          {error && <div className="font-mono text-[11px] text-[var(--red)]">{error}</div>}
          {!loading && !error && siteUrls.length === 0 && (
            <div className="font-mono text-[12px] text-[var(--t3)]">No sites found for this source.</div>
          )}
          {!loading && siteUrls.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--t3)]">{siteUrls.length} sites found</span>
                <button onClick={selectAll} className="font-mono text-[10px] text-[var(--accent)]">Select new</button>
              </div>
              {siteUrls.map(url => {
                const domain = extractDomain(url)
                const exists = existingDomains.has(domain)
                const imported = done.has(domain)
                return (
                  <label key={url} className={clsx('flex items-center gap-3 py-2 cursor-pointer rounded', exists && 'opacity-40 cursor-default')}>
                    <input type="checkbox" checked={selected.has(url)} disabled={exists}
                      onChange={() => toggle(url)} className="rounded shrink-0" />
                    <div className="min-w-0">
                      <div className="font-mono text-[12px] text-[var(--t1)]">{domain}</div>
                      <div className="font-mono text-[10px] text-[var(--t3)] truncate">{url}</div>
                    </div>
                    {exists && <span className="ml-auto font-mono text-[10px] text-[var(--t3)] shrink-0">Already added</span>}
                    {imported && <span className="ml-auto font-mono text-[10px] shrink-0" style={{ color: 'var(--green)' }}>Imported ✓</span>}
                  </label>
                )
              })}
            </>
          )}
        </div>

        <div className="px-6 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-[var(--r)] border font-mono text-[12px] text-[var(--t2)]"
            style={{ borderColor: 'var(--b2)' }}>Close</button>
          <div className="flex-1 flex flex-col gap-1.5">
            {!projectId && (
              <p className="font-mono text-[10px] text-center" style={{ color: 'var(--yellow)' }}>
                Select a project above — create one in Projects if you don't have any yet
              </p>
            )}
            <button onClick={handleImport} disabled={importing || selected.size === 0 || !projectId}
              className="w-full py-2 rounded-[var(--r)] font-mono text-[12px] text-white font-medium disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              {importing ? 'Importing…' : `Import${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SiteModal({ projectId, onClose, onSave }: { projectId: number; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({ name: '', domain: '', url: '', gsc_property: '', ga4_property: '', bwt_property: '', clarity_project: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.name || !form.domain || !form.url) { setError('Name, domain and URL are required'); return }
    setSaving(true); setError('')
    try {
      await createSite({ project_id: projectId, ...form })
      onSave(); onClose()
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  const fields = [
    { k: 'name', label: 'Site Name', required: true, placeholder: 'e.g. MercadoHipotecas Main' },
    { k: 'domain', label: 'Domain', required: true, placeholder: 'mercadohipotecas.com' },
    { k: 'url', label: 'URL', required: true, placeholder: 'https://mercadohipotecas.com' },
    { k: 'gsc_property', label: 'GSC Property', required: false, placeholder: 'https://mercadohipotecas.com/' },
    { k: 'ga4_property', label: 'GA4 Property ID', required: false, placeholder: '123456789', hint: 'Numeric ID — not the G-XXXXXX measurement ID. Find it in GA4 Admin → Property Settings.' },
    { k: 'bwt_property', label: 'Bing Property', required: false, placeholder: 'https://mercadohipotecas.com/' },
    { k: 'clarity_project', label: 'Clarity Project ID', required: false, placeholder: 'abc123xyz', hint: 'Optional reference label. The API token (set in Credentials) identifies the project.' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,8,11,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="anim-up w-full max-w-lg rounded-[var(--rl)] border overflow-hidden"
        style={{ background: 'var(--s1)', borderColor: 'var(--b2)' }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--b1)' }}>
          <div>
            <div className="font-display text-[17px] text-[var(--t1)]">New Site</div>
            <div className="font-mono text-[11px] text-[var(--t3)] mt-0.5">Add a domain to track</div>
          </div>
          <button onClick={onClose} className="text-[var(--t3)] hover:text-[var(--t1)] text-lg">×</button>
        </div>
        <div className="px-6 py-5 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-2 gap-3">
            {fields.map(({ k, label, required, placeholder, hint }: { k: string; label: string; required: boolean; placeholder: string; hint?: string }) => (
              <div key={k} className={clsx('flex flex-col gap-1.5', k === 'name' || k === 'url' ? 'col-span-2' : '')}>
                <label className="font-mono text-[11px] uppercase tracking-wider text-[var(--t3)]">
                  {label} {required && <span className="text-[var(--accent)]">*</span>}
                </label>
                <input value={(form as any)[k]} onChange={e => set(k, e.target.value)}
                  placeholder={placeholder}
                  className="px-3 py-2 rounded-[var(--r)] border outline-none font-mono text-[12px] transition-colors"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--b2)', color: 'var(--t1)' }} />
                {hint && <span className="font-mono text-[10px] text-[var(--t3)] leading-tight">{hint}</span>}
              </div>
            ))}
          </div>
          {error && <div className="mt-3 font-mono text-[11px] text-[var(--red)]">{error}</div>}
        </div>
        <div className="px-6 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-[var(--r)] border font-mono text-[12px] text-[var(--t2)]"
            style={{ borderColor: 'var(--b2)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 rounded-[var(--r)] font-mono text-[12px] text-white font-medium"
            style={{ background: 'var(--accent)' }}>
            {saving ? 'Saving…' : 'Add Site'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClarityTokenRow({ siteId }: { siteId: number }) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getSiteClarityStatus(siteId).then(setConfigured).catch(() => setConfigured(false))
  }, [siteId])

  async function handleSave() {
    if (!token.trim()) return
    setSaving(true); setMsg('')
    try {
      await saveSiteClarityToken(siteId, token.trim())
      setConfigured(true); setToken(''); setMsg('Saved ✓')
    } catch (e) { setMsg(String(e)) }
    finally { setSaving(false); setTimeout(() => setMsg(''), 3000) }
  }

  async function handleDelete() {
    await deleteSiteClarityToken(siteId)
    setConfigured(false); setMsg('Removed')
    setTimeout(() => setMsg(''), 3000)
  }

  return (
    <div className="flex flex-col gap-2 pt-3 mt-3 border-t" style={{ borderColor: 'var(--b1)' }}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--t3)]">Clarity Token</span>
        {configured !== null && (
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: configured ? 'var(--gdim)' : 'var(--ydim)',
              color: configured ? 'var(--green)' : 'var(--yellow)',
            }}>
            {configured ? 'configured' : 'not set'}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder={configured ? '••••••••  (replace token)' : 'Paste Clarity Data Export token…'}
            className="w-full px-3 py-2 pr-8 rounded-[var(--r)] border outline-none font-mono text-[12px] transition-colors"
            style={{ background: 'var(--bg2)', borderColor: token ? 'var(--accent)' : 'var(--b2)', color: 'var(--t1)' }}
          />
          <button onClick={() => setShow(s => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t3)] hover:text-[var(--t2)]">
            {show ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        </div>
        <button onClick={handleSave} disabled={saving || !token.trim()}
          className="px-3 py-2 rounded-[var(--r)] font-mono text-[12px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--accent)' }}>
          {saving ? '…' : 'Save'}
        </button>
        {configured && (
          <button onClick={handleDelete}
            className="px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] transition-all hover:border-[var(--red)] hover:text-[var(--red)]"
            style={{ borderColor: 'var(--b2)', color: 'var(--t3)' }}>
            Remove
          </button>
        )}
      </div>
      {msg && (
        <span className="font-mono text-[11px]"
          style={{ color: msg.includes('✓') ? 'var(--green)' : msg === 'Removed' ? 'var(--t3)' : 'var(--red)' }}>
          {msg}
        </span>
      )}
      <span className="font-mono text-[10px] text-[var(--t3)] leading-snug">
        Clarity → Settings → Data Export → Generate new API token. Each project has its own token.
      </span>
    </div>
  )
}

export default function Sites() {
  const { sites, setSites, projects, activeProjectId, setActiveSite, credentials } = useAppStore()
  const [modal, setModal] = useState(false)
  const [importModal, setImportModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Site | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [audits, setAudits] = useState<Record<number, DomAudit | null>>({})
  const [running, setRunning] = useState<number | null>(null)
  const [auditError, setAuditError] = useState<Record<number, string>>({})
  const [filterProject, setFilterProject] = useState<number | null>(activeProjectId)
  const [exportStatus, setExportStatus] = useState<Record<number, 'copied' | 'opened' | null>>({})
  const [detectingGa4, setDetectingGa4] = useState<Record<number, boolean>>({})
  const [ga4DetectResult, setGa4DetectResult] = useState<Record<number, string>>({})

  async function load() {
    const data = await getSites(filterProject ?? undefined)
    setSites(data)
  }

  useEffect(() => { load() }, [filterProject])

  async function handleExpand(site: Site) {
    if (expanded === site.id) { setExpanded(null); return }
    setExpanded(site.id)
    setActiveSite(site.id)
    if (!audits[site.id]) {
      const audit = await getLastAudit(site.id)
      setAudits(a => ({ ...a, [site.id]: audit }))
    }
  }

  async function handleAudit(site: Site) {
    setRunning(site.id)
    setAuditError(e => ({ ...e, [site.id]: '' }))
    try {
      const audit = await runDomAudit(site.id, site.url)
      setAudits(a => ({ ...a, [site.id]: audit }))
      await load()
    } catch (e) {
      setAuditError(err => ({ ...err, [site.id]: String(e) }))
    } finally {
      setRunning(null)
    }
  }

  async function handleDelete(site: Site) {
    setConfirmDelete(site)
  }

  async function confirmDeleteSite() {
    if (!confirmDelete) return
    await deleteSite(confirmDelete.id)
    setConfirmDelete(null)
    await load()
  }

  async function handleDetectGa4(site: Site) {
    setDetectingGa4(d => ({ ...d, [site.id]: true }))
    setGa4DetectResult(r => ({ ...r, [site.id]: '' }))
    try {
      const match = await detectGa4Property(site.id)
      setGa4DetectResult(r => ({ ...r, [site.id]: `GA4: ${match.display_name} (${match.property_id}) ✓` }))
      await load()
    } catch (e) {
      setGa4DetectResult(r => ({ ...r, [site.id]: String(e) }))
    } finally {
      setDetectingGa4(d => ({ ...d, [site.id]: false }))
    }
  }

  async function handleExportToC(site: Site) {
    const audit = audits[site.id] ?? null
    const project = projects.find(p => p.id === site.project_id)
    const context = buildSiteContext(site, project, audit, credentials)
    const result = await openInClaude(context)
    setExportStatus(s => ({ ...s, [site.id]: result }))
    setTimeout(() => setExportStatus(s => ({ ...s, [site.id]: null })), 3000)
  }

  const filtered = filterProject ? sites.filter(s => s.project_id === filterProject) : sites

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl text-[var(--t1)]">
            Tracked <span className="text-[var(--accent)]">Sites</span>
          </h1>
          <p className="font-mono text-[12px] text-[var(--t3)] mt-1">{filtered.length} sites</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Project filter */}
          <select value={filterProject ?? ''} onChange={e => setFilterProject(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] outline-none"
            style={{ background: 'var(--s2)', borderColor: 'var(--b2)', color: 'var(--t2)' }}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
          <button onClick={() => setImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--r)] border font-mono text-[12px] text-[var(--t2)]"
            style={{ borderColor: 'var(--b2)' }}>
            <Download size={13} /> Import
          </button>
          <button onClick={() => setModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--r)] font-mono text-[12px] text-white"
            style={{ background: 'var(--accent)' }}>
            <Plus size={13} /> Add Site
          </button>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center py-20 gap-3 anim-up">
          <Globe size={32} className="text-[var(--t3)]" />
          <div className="font-display text-[17px] text-[var(--t2)]">No sites yet</div>
          <div className="font-mono text-[12px] text-[var(--t3)]">Add a site to start DOM audits and MCP analysis</div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((site, i) => {
          const isOpen = expanded === site.id
          const audit = audits[site.id]
          const isRunning = running === site.id
          return (
            <div key={site.id}
              className={clsx('rounded-[var(--rl)] border overflow-hidden anim-up transition-all', `anim-d${Math.min(i + 1, 6)}`)}
              style={{ background: 'var(--s1)', borderColor: isOpen ? 'var(--b2)' : 'var(--b1)' }}>
              {/* Site header row */}
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--s2)] transition-colors"
                onClick={() => handleExpand(site)}>
                <div className="w-8 h-8 rounded-[var(--r)] flex items-center justify-center flex-shrink-0 border"
                  style={{ background: 'var(--s3)', borderColor: 'var(--b1)' }}>
                  <Globe size={14} className="text-[var(--t3)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[14px] text-[var(--t1)]">{site.name}</span>
                    <span className="font-mono text-[11px] text-[var(--t3)]">{site.domain}</span>
                  </div>
                  <div className="font-mono text-[10px] text-[var(--t3)] mt-0.5 flex items-center gap-2">
                    <span>{site.project_name}</span>
                    {[site.gsc_property && 'GSC', site.ga4_property && 'GA4', site.bwt_property && 'BWT', site.clarity_project && 'Clarity']
                      .filter(Boolean).map(tag => (
                        <span key={tag} className="px-1.5 py-px rounded text-[8px]"
                          style={{ background: 'var(--s3)', color: 'var(--t3)' }}>{tag}</span>
                      ))}
                  </div>
                </div>
                {/* Score pill */}
                {site.last_audit_score !== null && (
                  <div className="font-mono text-[12px] font-bold px-2.5 py-1 rounded-full"
                    style={{
                      background: (site.last_audit_score ?? 0) >= 80 ? 'var(--gdim)' : (site.last_audit_score ?? 0) >= 60 ? 'var(--ydim)' : 'var(--rdim)',
                      color: (site.last_audit_score ?? 0) >= 80 ? 'var(--green)' : (site.last_audit_score ?? 0) >= 60 ? 'var(--yellow)' : 'var(--red)',
                    }}>
                    {site.last_audit_score}
                  </div>
                )}
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={e => { e.stopPropagation(); handleDelete(site) }}
                    className="p-1.5 rounded transition-colors hover:text-[var(--red)] text-[var(--t3)]">
                    <Trash2 size={12} />
                  </button>
                  {isOpen ? <ChevronUp size={14} className="text-[var(--t3)]" /> : <ChevronDown size={14} className="text-[var(--t3)]" />}
                </div>
              </div>

              {/* Expanded audit panel */}
              {isOpen && (
                <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--b1)' }}>
                  <div className="pt-4">
                    <AuditPanel
                      site={site}
                      audit={audit ?? null}
                      onRunAudit={() => handleAudit(site)}
                      running={isRunning}
                      error={auditError[site.id]}
                    />
                  </div>
                  <ClarityTokenRow siteId={site.id} />

                  <div className="mt-3 pt-3 border-t flex items-start justify-between gap-2" style={{ borderColor: 'var(--b1)' }}>
                    <div className="flex flex-col gap-1 min-w-0">
                      {!site.ga4_property && credentials.some(c => c.service === 'ga4' && c.is_configured) && (
                        <button
                          onClick={() => handleDetectGa4(site)}
                          disabled={detectingGa4[site.id]}
                          className="flex items-center gap-2 px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] font-medium transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                          style={{ borderColor: 'var(--b2)', color: 'var(--t2)' }}
                        >
                          <Scan size={12} className={detectingGa4[site.id] ? 'animate-spin' : ''} />
                          {detectingGa4[site.id] ? 'Detecting GA4…' : 'Auto-detect GA4'}
                        </button>
                      )}
                      {ga4DetectResult[site.id] && (
                        <div className="font-mono text-[11px] px-1" style={{
                          color: ga4DetectResult[site.id].includes('✓') ? 'var(--green)' : 'var(--red)'
                        }}>
                          {ga4DetectResult[site.id]}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleExportToC(site)}
                      className="flex items-center gap-2 px-3 py-2 rounded-[var(--r)] border font-mono text-[12px] font-medium transition-all hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      style={{ borderColor: 'var(--b2)', color: 'var(--t2)' }}
                    >
                      <Bot size={12} />
                      {exportStatus[site.id] === 'opened' ? 'Opened in Claude ✓'
                        : exportStatus[site.id] === 'copied' ? 'Copied to clipboard ✓'
                        : 'Open in Claude'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {importModal && (
        <ImportModal onClose={() => setImportModal(false)} onImported={load} />
      )}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(6,8,11,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="anim-up w-full max-w-sm rounded-[var(--rl)] border overflow-hidden"
            style={{ background: 'var(--s1)', borderColor: 'var(--b2)' }}>
            <div className="px-6 py-5">
              <div className="font-display text-[17px] text-[var(--t1)] mb-1">Delete site?</div>
              <div className="font-mono text-[12px] text-[var(--t2)]">
                <span className="text-[var(--t1)]">{confirmDelete.name}</span> — {confirmDelete.domain}
              </div>
              <div className="font-mono text-[11px] text-[var(--t3)] mt-1">This cannot be undone.</div>
            </div>
            <div className="px-6 pb-5 flex gap-2">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-[var(--r)] border font-mono text-[12px] text-[var(--t2)]"
                style={{ borderColor: 'var(--b2)' }}>Cancel</button>
              <button onClick={confirmDeleteSite}
                className="flex-1 py-2 rounded-[var(--r)] font-mono text-[12px] text-white font-medium"
                style={{ background: 'var(--red)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {modal && filterProject && (
        <SiteModal projectId={filterProject} onClose={() => setModal(false)} onSave={load} />
      )}
      {modal && !filterProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(6,8,11,0.85)' }}>
          <div className="p-6 rounded-[var(--rl)] border text-center" style={{ background: 'var(--s1)', borderColor: 'var(--b2)' }}>
            <div className="font-mono text-[13px] text-[var(--t2)] mb-3">Select a project first</div>
            <button onClick={() => setModal(false)} className="px-4 py-2 rounded font-mono text-[12px]"
              style={{ background: 'var(--accent)', color: 'white' }}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}
