import { invoke as tauriInvoke } from '@tauri-apps/api/core'

// ── Types (mirror Rust models) ─────────────────────────────────────────────

export interface User {
  id: number
  name: string
  has_pin: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  name: string
  description: string | null
  color: string
  icon: string
  is_active: boolean
  site_count: number
  created_at: string
  updated_at: string
}

export interface Site {
  id: number
  project_id: number
  project_name: string
  name: string
  domain: string
  url: string
  gsc_property: string | null
  ga4_property: string | null
  bwt_property: string | null
  clarity_project: string | null
  notes: string | null
  is_active: boolean
  last_audit_score: number | null
  last_audit_at: string | null
  created_at: string
  updated_at: string
}

export interface CredentialStatus {
  service: string
  label: string
  credential_type: string
  is_configured: boolean
  is_active: boolean
  last_tested: string | null
  last_error: string | null
  file_path: string | null
  docs_url: string
}

export interface AuditIssue {
  severity: 'critical' | 'warning' | 'info'
  category: string
  message: string
  fix: string
}

export interface DomAudit {
  id: number
  site_id: number
  url: string
  canonical: string | null
  canonical_match: boolean | null
  title: string | null
  title_length: number | null
  meta_description: string | null
  meta_desc_length: number | null
  meta_robots: string | null
  h1_count: number | null
  h1_text: string | null
  hreflang_tags: Array<{ lang: string; href: string }> | null
  og_tags: Record<string, string> | null
  schema_types: string[] | null
  robots_txt: string | null
  llms_txt: boolean
  has_invalid_head: boolean
  issues: AuditIssue[]
  score: number | null
  crawled_at: string
}

export interface GscSiteEntry {
  siteUrl: string
  permissionLevel: string
}

export interface Ga4PropertyMatch {
  property_id: string
  display_name: string
}

export interface TestResult {
  success: boolean
  message: string
  latency_ms: number | null
}

export interface Snapshot {
  source: string
  data: Record<string, unknown>
  fetched_at: string
}

export interface GscDataPoint {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface Ga4DataPoint {
  date: string
  sessions: number
  users: number
  conversions: number
  engagementRate: number
  bounceRate: number
  organic: number
}

export interface BwtDataPoint {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

// ── Browser mock mode ──────────────────────────────────────────────────────
// When running outside Tauri (npm run dev in browser), invoke() calls are
// intercepted and return realistic mock data so the UI can be developed/tested.

const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)

const MOCK_USER: User = {
  id: 1, name: 'Admin', has_pin: false,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}

const MOCK_PROJECTS: Project[] = [
  { id: 1, name: 'MercadoHipotecas', description: 'Portal hipotecas España', color: '#f97316', icon: '🏠', is_active: true, site_count: 2, created_at: '2026-01-15T10:00:00Z', updated_at: '2026-03-01T10:00:00Z' },
  { id: 2, name: 'SYNIO', description: 'Asistente de voz IA', color: '#38bdf8', icon: '🚀', is_active: true, site_count: 1, created_at: '2026-02-01T10:00:00Z', updated_at: '2026-03-10T10:00:00Z' },
]

const MOCK_SITES: Site[] = [
  { id: 1, project_id: 1, project_name: 'MercadoHipotecas', name: 'Main site', domain: 'mercadohipotecas.com', url: 'https://mercadohipotecas.com', gsc_property: 'sc-domain:mercadohipotecas.com', ga4_property: 'G-XXXXXXXX', bwt_property: null, clarity_project: null, notes: null, is_active: true, last_audit_score: 74, last_audit_at: '2026-03-18T09:00:00Z', created_at: '2026-01-15T10:00:00Z', updated_at: '2026-03-18T09:00:00Z' },
  { id: 2, project_id: 1, project_name: 'MercadoHipotecas', name: 'Blog', domain: 'blog.mercadohipotecas.com', url: 'https://blog.mercadohipotecas.com', gsc_property: null, ga4_property: null, bwt_property: null, clarity_project: null, notes: null, is_active: true, last_audit_score: null, last_audit_at: null, created_at: '2026-02-10T10:00:00Z', updated_at: '2026-02-10T10:00:00Z' },
  { id: 3, project_id: 2, project_name: 'SYNIO', name: 'Landing', domain: 'synio.ai', url: 'https://synio.ai', gsc_property: null, ga4_property: null, bwt_property: null, clarity_project: null, notes: null, is_active: true, last_audit_score: 61, last_audit_at: '2026-03-15T08:00:00Z', created_at: '2026-02-01T10:00:00Z', updated_at: '2026-03-15T08:00:00Z' },
]

const MOCK_CREDENTIALS: CredentialStatus[] = [
  { service: 'gsc',       label: 'Google Search Console', credential_type: 'oauth_token',          is_configured: true,  is_active: true,  last_tested: '2026-03-18T08:00:00Z', last_error: null, file_path: null, docs_url: 'https://search.google.com/search-console' },
  { service: 'ga4',       label: 'Google Analytics 4',    credential_type: 'service_account_path', is_configured: true,  is_active: true,  last_tested: '2026-03-18T08:00:00Z', last_error: null, file_path: '/home/user/ga4-service-account.json', docs_url: 'https://analytics.google.com' },
  { service: 'bwt',       label: 'Bing Webmaster Tools',  credential_type: 'api_key',              is_configured: false, is_active: false, last_tested: null,                   last_error: null, file_path: null, docs_url: 'https://www.bing.com/webmasters' },
  { service: 'clarity',   label: 'Microsoft Clarity',     credential_type: 'api_key',              is_configured: false, is_active: false, last_tested: null,                   last_error: null, file_path: null, docs_url: 'https://clarity.microsoft.com' },
  { service: 'psi',       label: 'PageSpeed Insights',    credential_type: 'api_key',              is_configured: true,  is_active: true,  last_tested: '2026-03-18T08:00:00Z', last_error: null, file_path: null, docs_url: 'https://developers.google.com/speed/pagespeed/insights/' },
  { service: 'playwright',label: 'Playwright DOM Audit',  credential_type: 'none',                 is_configured: true,  is_active: true,  last_tested: null,                   last_error: null, file_path: null, docs_url: 'https://playwright.dev' },
]

function _genGscTimeseries(days: number): GscDataPoint[] {
  const result: GscDataPoint[] = []
  const base = new Date('2026-03-21')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    const wave = Math.sin((days - i) / days * Math.PI * 2) * 0.15
    const noise = 0.85 + ((i * 7919 + 13) % 100) / 333
    const clicks = Math.round(55 * (1 + wave) * noise)
    const impressions = Math.round(clicks * 22 + ((i * 6271) % 200))
    result.push({
      date: d.toISOString().split('T')[0],
      clicks,
      impressions,
      ctr: Math.round((clicks / impressions * 100) * 10) / 10,
      position: Math.round((14 + ((i * 3137) % 60) / 30 - 1) * 10) / 10,
    })
  }
  return result
}

function _genBwtTimeseries(days: number): BwtDataPoint[] {
  const result: BwtDataPoint[] = []
  const base = new Date('2026-03-21')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    const wave  = Math.sin((days - i) / days * Math.PI * 2) * 0.12
    const noise = 0.85 + ((i * 4127 + 11) % 100) / 333
    const clicks = Math.round(10 * (1 + wave) * noise)
    const impressions = Math.round(clicks * 28 + ((i * 3971) % 150))
    result.push({
      date: d.toISOString().split('T')[0],
      clicks,
      impressions,
      ctr:      Math.round((clicks / impressions * 100) * 10) / 10,
      position: Math.round((18 + ((i * 2713) % 40) / 10 - 2) * 10) / 10,
    })
  }
  return result
}

function _genGa4Timeseries(days: number): Ga4DataPoint[] {
  const result: Ga4DataPoint[] = []
  const base = new Date('2026-03-21')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    const wave = Math.sin((days - i) / days * Math.PI * 2) * 0.12
    const noise = 0.85 + ((i * 5323 + 7) % 100) / 333
    const sessions = Math.round(140 * (1 + wave) * noise)
    const organic  = Math.round(sessions * 0.62)
    const users    = Math.round(sessions * 0.91)
    result.push({
      date: d.toISOString().split('T')[0],
      sessions,
      organic,
      users,
      conversions: Math.round(sessions * 0.034),
      engagementRate: Math.round((64 + ((i * 2711) % 120) / 10) * 10) / 10,
      bounceRate:     Math.round((31 + ((i * 1973) % 80) / 10)  * 10) / 10,
    })
  }
  return result
}

// Mock state (in-memory for browser dev)
let _projects = [...MOCK_PROJECTS]
let _sites = [...MOCK_SITES]
let _credentials = [...MOCK_CREDENTIALS]
let _unlocked = false

type InvokeArgs = Record<string, unknown>

async function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  if (IS_TAURI) return tauriInvoke<T>(cmd, args)
  await new Promise(r => setTimeout(r, 80)) // simulate latency
  return mockHandler<T>(cmd, args)
}

function _mockAuth<T>(cmd: string, args?: InvokeArgs): T {
  switch (cmd) {
    case 'is_unlocked': return _unlocked as T
    case 'get_user':    return MOCK_USER as T
    case 'update_user': return { ...MOCK_USER, name: args?.name as string } as T
    case 'verify_pin':  return true as T
    case 'set_pin':     return undefined as T
    case 'remove_pin':  return undefined as T
    case 'lock_app':    _unlocked = false; return undefined as T
    default:            throw new Error(`_mockAuth: unknown cmd ${cmd}`)
  }
}

function _mockProjects<T>(cmd: string, args?: InvokeArgs): T {
  switch (cmd) {
    case 'get_projects': return _projects as T
    case 'create_project': {
      const p = args?.payload as Partial<Project>
      const proj: Project = { id: Date.now(), name: p.name ?? '', description: p.description ?? null, color: p.color ?? '#f97316', icon: p.icon ?? '🌐', is_active: true, site_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      _projects = [proj, ..._projects]
      return proj as T
    }
    case 'update_project': {
      const p = args?.payload as Partial<Project>
      _projects = _projects.map(x => x.id === args?.id ? { ...x, ...p, updated_at: new Date().toISOString() } : x)
      return _projects.find(x => x.id === args?.id) as T
    }
    case 'delete_project': _projects = _projects.filter(x => x.id !== args?.id); return undefined as T
    default:               throw new Error(`_mockProjects: unknown cmd ${cmd}`)
  }
}

function _mockSites<T>(cmd: string, args?: InvokeArgs): T {
  switch (cmd) {
    case 'get_sites': {
      const pid = args?.projectId as number | null
      return (pid ? _sites.filter(s => s.project_id === pid) : _sites) as T
    }
    case 'create_site': {
      const p = args?.payload as Partial<Site>
      const proj = _projects.find(x => x.id === p.project_id)
      const site: Site = { id: Date.now(), project_id: p.project_id!, project_name: proj?.name ?? '', name: p.name ?? '', domain: p.domain ?? '', url: p.url ?? '', gsc_property: p.gsc_property ?? null, ga4_property: p.ga4_property ?? null, bwt_property: p.bwt_property ?? null, clarity_project: p.clarity_project ?? null, notes: p.notes ?? null, is_active: true, last_audit_score: null, last_audit_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      _sites = [site, ..._sites]
      return site as T
    }
    case 'update_site': _sites = _sites.map(x => x.id === args?.id ? { ...x, ...(args?.payload as object), updated_at: new Date().toISOString() } : x); return undefined as T
    case 'delete_site': _sites = _sites.filter(x => x.id !== args?.id); return undefined as T
    default:            throw new Error(`_mockSites: unknown cmd ${cmd}`)
  }
}

function _mockCredentials<T>(cmd: string, args?: InvokeArgs): T {
  switch (cmd) {
    case 'get_all_credential_statuses': return _credentials as T
    case 'save_credential': {
      const p = args?.payload as { service: string; secret: string }
      _credentials = _credentials.map(c => c.service === p.service ? { ...c, is_configured: true, is_active: true, last_tested: new Date().toISOString() } : c)
      return _credentials.find(c => c.service === p.service) as T
    }
    case 'delete_credential':     _credentials = _credentials.map(c => c.service === args?.service ? { ...c, is_configured: false, is_active: false, last_tested: null } : c); return undefined as T
    case 'test_credential':        return { success: true, message: 'Mock connection OK', latency_ms: 142 } as T
    case 'import_service_account': return 'mock-sa@project.iam.gserviceaccount.com' as T
    case 'list_gsc_sites': return [
      { siteUrl: 'sc-domain:mercadohipotecas.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://blog.mercadohipotecas.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:synio.ai', permissionLevel: 'siteFullUser' },
    ] as T
    case 'list_bwt_sites':        return ['https://mercadohipotecas.com/', 'https://synio.ai/'] as T
    case 'detect_ga4_property':   return { property_id: '123456789', display_name: 'Mock GA4 Property' } as T
    default:                       throw new Error(`_mockCredentials: unknown cmd ${cmd}`)
  }
}

function _mockData<T>(cmd: string, args?: InvokeArgs): T {
  switch (cmd) {
    case 'fetch_gsc_timeseries': return _genGscTimeseries((args?.days as number) ?? 30) as T
    case 'fetch_ga4_timeseries': return _genGa4Timeseries((args?.days as number) ?? 30) as T
    case 'fetch_bwt_timeseries': return _genBwtTimeseries((args?.days as number) ?? 30) as T
    case 'run_dom_audit':        return null as T
    case 'get_last_audit':       return null as T
    case 'fetch_mcp_data':       throw new Error(`MCP '${args?.source}' not configured in browser mode`)
    case 'get_site_snapshots':   return [] as T
    default:                     throw new Error(`_mockData: unknown cmd ${cmd}`)
  }
}

const AUTH_CMDS      = new Set(['is_unlocked', 'get_user', 'update_user', 'verify_pin', 'set_pin', 'remove_pin', 'lock_app'])
const PROJECT_CMDS   = new Set(['get_projects', 'create_project', 'update_project', 'delete_project'])
const SITE_CMDS      = new Set(['get_sites', 'create_site', 'update_site', 'delete_site'])
const CREDENTIAL_CMDS = new Set(['get_all_credential_statuses', 'save_credential', 'delete_credential', 'test_credential', 'import_service_account', 'list_gsc_sites', 'list_bwt_sites', 'detect_ga4_property'])
const DATA_CMDS      = new Set(['fetch_gsc_timeseries', 'fetch_ga4_timeseries', 'fetch_bwt_timeseries', 'run_dom_audit', 'get_last_audit', 'fetch_mcp_data', 'get_site_snapshots'])

function mockHandler<T>(cmd: string, args?: InvokeArgs): T {
  if (AUTH_CMDS.has(cmd))       return _mockAuth<T>(cmd, args)
  if (PROJECT_CMDS.has(cmd))    return _mockProjects<T>(cmd, args)
  if (SITE_CMDS.has(cmd))       return _mockSites<T>(cmd, args)
  if (CREDENTIAL_CMDS.has(cmd)) return _mockCredentials<T>(cmd, args)
  if (DATA_CMDS.has(cmd))       return _mockData<T>(cmd, args)
  throw new Error(`Unknown command: ${cmd}`)
}

// ── Auth ───────────────────────────────────────────────────────────────────

export const getUser = () => invoke<User>('get_user')
export const updateUser = (name: string) => invoke<User>('update_user', { name })
export const setPin = (pin: string) => invoke<void>('set_pin', { pin })
export const removePin = (pin: string) => invoke<void>('remove_pin', { pin })
export const verifyPin = (pin: string) => invoke<boolean>('verify_pin', { pin })
export const lockApp = () => invoke<void>('lock_app')
export const isUnlocked = () => invoke<boolean>('is_unlocked')

// ── Projects ───────────────────────────────────────────────────────────────

export const getProjects = () => invoke<Project[]>('get_projects')

export const createProject = (payload: {
  name: string
  description?: string
  color?: string
  icon?: string
}) => invoke<Project>('create_project', { payload })

export const updateProject = (
  id: number,
  payload: Partial<Pick<Project, 'name' | 'description' | 'color' | 'icon' | 'is_active'>>
) => invoke<Project>('update_project', { id, payload })

export const deleteProject = (id: number) =>
  invoke<void>('delete_project', { id })

// ── Sites ──────────────────────────────────────────────────────────────────

export const getSites = (projectId?: number) =>
  invoke<Site[]>('get_sites', { projectId: projectId ?? null })

export const createSite = (payload: {
  project_id: number
  name: string
  domain: string
  url: string
  gsc_property?: string
  ga4_property?: string
  bwt_property?: string
  clarity_project?: string
  notes?: string
}) => invoke<Site>('create_site', { payload })

export const updateSite = (id: number, payload: Partial<Omit<Site, 'id' | 'project_id' | 'project_name' | 'created_at' | 'updated_at'>>) =>
  invoke<void>('update_site', { id, payload })

export const deleteSite = (id: number) =>
  invoke<void>('delete_site', { id })

// ── Credentials ────────────────────────────────────────────────────────────

export const getAllCredentialStatuses = () =>
  invoke<CredentialStatus[]>('get_all_credential_statuses')

export const saveCredential = (payload: {
  service: string
  secret: string
  file_path?: string
}) => invoke<CredentialStatus>('save_credential', { payload })

export const deleteCredential = (service: string) =>
  invoke<void>('delete_credential', { service })

export const testCredential = (service: string) =>
  invoke<TestResult>('test_credential', { service })

export const importServiceAccount = (service: string, content: string) =>
  invoke<string>('import_service_account', { service, content })

// ── DOM Audit ──────────────────────────────────────────────────────────────

export const runDomAudit = (siteId: number, url: string) =>
  invoke<DomAudit>('run_dom_audit', { siteId, url })

export const getLastAudit = (siteId: number) =>
  invoke<DomAudit | null>('get_last_audit', { siteId })

// ── MCP ────────────────────────────────────────────────────────────────────

export const fetchMcpData = (source: string, siteId: number, params?: unknown) =>
  invoke<Record<string, unknown>>('fetch_mcp_data', { source, siteId, params: params ?? null })

export const getSiteSnapshots = (siteId: number) =>
  invoke<Snapshot[]>('get_site_snapshots', { siteId })

export const debugClarity = () =>
  invoke<Record<string, unknown>>('debug_clarity')

export const getClarityUsage = (siteId: number) =>
  invoke<{ requests_used: number; limit: number; remaining: number; can_fetch: boolean; last_fetched_at: string | null }>('get_clarity_usage', { siteId })

// ── Per-site Clarity token ───────────────────────────────────────────────────
export const saveSiteClarityToken = (siteId: number, token: string) =>
  invoke<void>('save_site_clarity_token', { siteId, token })

export const deleteSiteClarityToken = (siteId: number) =>
  invoke<void>('delete_site_clarity_token', { siteId })

export const getSiteClarityStatus = (siteId: number) =>
  invoke<boolean>('get_site_clarity_status', { siteId })

// ── Site discovery ──────────────────────────────────────────────────────────

export const listGscSites = () =>
  invoke<GscSiteEntry[]>('list_gsc_sites')

export const listBwtSites = () =>
  invoke<string[]>('list_bwt_sites')

export const debugBwt = (siteId: number) =>
  invoke<Record<string, unknown>>('debug_bwt', { siteId })

export const detectGa4Property = (siteId: number) =>
  invoke<Ga4PropertyMatch>('detect_ga4_property', { siteId })

// ── Timeseries ─────────────────────────────────────────────────────────────────

export const fetchGscTimeseries = (siteId: number, days: number) =>
  invoke<GscDataPoint[]>('fetch_gsc_timeseries', { siteId, days })

export const fetchGa4Timeseries = (siteId: number, days: number) =>
  invoke<Ga4DataPoint[]>('fetch_ga4_timeseries', { siteId, days })

export const fetchBwtTimeseries = (siteId: number, days: number) =>
  invoke<BwtDataPoint[]>('fetch_bwt_timeseries', { siteId, days })
