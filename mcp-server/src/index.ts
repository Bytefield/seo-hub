import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  listProjects, listSites, getSiteByDomain,
  getLastAudit, getAuditHistory, getSnapshot,
  getAllSnapshots, getCredentials, searchSites,
} from './queries.js'

const server = new McpServer({
  name: 'synio-seo-hub',
  version: '0.1.0',
})

// ── seo_list_projects ──────────────────────────────────────────────────────

server.tool(
  'seo_list_projects',
  'List all SEO projects with site counts and metadata',
  {},
  async () => {
    const projects = listProjects()
    const text = projects.map(p =>
      `• ${p.icon} ${p.name} (id:${p.id}) — ${p.site_count} site${p.site_count !== 1 ? 's' : ''}` +
      (p.description ? ` — ${p.description}` : '')
    ).join('\n')
    return { content: [{ type: 'text', text: `${projects.length} projects:\n\n${text}` }] }
  }
)

// ── seo_list_sites ─────────────────────────────────────────────────────────

server.tool(
  'seo_list_sites',
  'List all tracked sites, optionally filtered by project_id',
  { project_id: z.number().optional().describe('Filter by project ID') },
  async ({ project_id }) => {
    const sites = listSites(project_id)
    const text = sites.map(s => {
      const score = s.last_audit_score !== null ? ` | score: ${s.last_audit_score}/100` : ''
      const auditAge = s.last_audit_at
        ? ` | audited: ${new Date(s.last_audit_at).toLocaleDateString('es-ES')}`
        : ' | never audited'
      return `• ${s.domain} [${s.project_name}]${score}${auditAge}`
    }).join('\n')
    return { content: [{ type: 'text', text: `${sites.length} sites:\n\n${text}` }] }
  }
)

// ── seo_get_site ───────────────────────────────────────────────────────────

server.tool(
  'seo_get_site',
  'Get full details for a site by domain including latest audit score and all MCP snapshot sources',
  { domain: z.string().describe('Domain, e.g. mercadohipotecas.com') },
  async ({ domain }) => {
    const site = getSiteByDomain(domain)
    if (!site) return { content: [{ type: 'text', text: `Site not found: ${domain}` }] }

    const snapshots = getAllSnapshots(site.id)
    const audit = getLastAudit(site.id)

    const lines = [
      `## ${site.domain}`,
      `Project: ${site.project_name} | URL: ${site.url}`,
      `DOM Score: ${audit?.score ?? 'n/a'}/100`,
      '',
      '### MCP Sources',
      ...(['gsc','ga4','bwt','clarity','psi'].map(src => {
        const snap = snapshots.find(s => s.source === src)
        return snap
          ? `✓ ${src.toUpperCase()} — fetched ${new Date(snap.fetched_at).toLocaleDateString('es-ES')}`
          : `✗ ${src.toUpperCase()} — no data`
      })),
      '',
      '### Properties',
      `GSC: ${site.gsc_property ?? 'not set'}`,
      `GA4: ${site.ga4_property ?? 'not set'}`,
      `BWT: ${site.bwt_property ?? 'not set'}`,
      `Clarity: ${site.clarity_project ?? 'not set'}`,
    ]
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }
)

// ── seo_get_audit ──────────────────────────────────────────────────────────

server.tool(
  'seo_get_audit',
  'Get the latest DOM audit for a site: title, meta, canonical, h1, schema, issues, score',
  { domain: z.string().describe('Domain to audit') },
  async ({ domain }) => {
    const site = getSiteByDomain(domain)
    if (!site) return { content: [{ type: 'text', text: `Site not found: ${domain}` }] }

    const audit = getLastAudit(site.id)
    if (!audit) return { content: [{ type: 'text', text: `No audit found for ${domain}. Run a DOM audit from the app first.` }] }

    const issues = audit.raw_issues ? JSON.parse(audit.raw_issues) as Array<{ severity: string; category: string; message: string; fix: string }> : []
    const critical = issues.filter(i => i.severity === 'critical')
    const warnings = issues.filter(i => i.severity === 'warning')

    const lines = [
      `## DOM Audit — ${domain}`,
      `Score: ${audit.score ?? 'n/a'}/100 | Crawled: ${new Date(audit.crawled_at).toLocaleString('es-ES')}`,
      '',
      `**Title:** ${audit.title ?? 'missing'} (${audit.title_length ?? 0} chars)`,
      `**Meta desc:** ${audit.meta_description ? `${audit.meta_desc_length} chars` : 'missing'}`,
      `**Canonical:** ${audit.canonical ?? 'missing'} ${audit.canonical_match ? '✓' : '⚠ mismatch'}`,
      `**H1:** ${audit.h1_count ?? 0} found — "${audit.h1_text ?? ''}"`,
      `**Meta robots:** ${audit.meta_robots ?? 'not set'}`,
      `**Schema types:** ${audit.schema_types ? JSON.parse(audit.schema_types).join(', ') : 'none'}`,
      `**llms.txt:** ${audit.llms_txt ? 'present' : 'missing'}`,
      `**Invalid head:** ${audit.has_invalid_head ? 'YES ⚠' : 'no'}`,
      '',
      `### Issues (${critical.length} critical, ${warnings.length} warnings)`,
      ...critical.map(i => `🔴 [${i.category}] ${i.message}\n   Fix: ${i.fix}`),
      ...warnings.map(i => `🟡 [${i.category}] ${i.message}\n   Fix: ${i.fix}`),
    ]
    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }
)

// ── seo_get_snapshot ───────────────────────────────────────────────────────

server.tool(
  'seo_get_snapshot',
  'Get cached MCP data for a site. source: gsc | ga4 | bwt | clarity | psi',
  {
    domain: z.string().describe('Domain'),
    source: z.enum(['gsc', 'ga4', 'bwt', 'clarity', 'psi']).describe('Data source'),
  },
  async ({ domain, source }) => {
    const site = getSiteByDomain(domain)
    if (!site) return { content: [{ type: 'text', text: `Site not found: ${domain}` }] }

    const snap = getSnapshot(site.id, source)
    if (!snap) return { content: [{ type: 'text', text: `No ${source.toUpperCase()} data for ${domain}. Fetch it from the dashboard first.` }] }

    const data = JSON.parse(snap.data)
    const header = `## ${source.toUpperCase()} — ${domain}\nFetched: ${new Date(snap.fetched_at).toLocaleString('es-ES')}\n\n`
    return { content: [{ type: 'text', text: header + JSON.stringify(data, null, 2) }] }
  }
)

// ── seo_audit_history ──────────────────────────────────────────────────────

server.tool(
  'seo_audit_history',
  'Get the last N DOM audit scores for a site to see score evolution over time',
  {
    domain: z.string(),
    limit: z.number().min(1).max(30).default(10),
  },
  async ({ domain, limit }) => {
    const site = getSiteByDomain(domain)
    if (!site) return { content: [{ type: 'text', text: `Site not found: ${domain}` }] }

    const history = getAuditHistory(site.id, limit)
    if (!history.length) return { content: [{ type: 'text', text: `No audit history for ${domain}` }] }

    const rows = history.map(a =>
      `${new Date(a.crawled_at).toLocaleDateString('es-ES')}  score: ${a.score ?? 'n/a'}/100`
    ).join('\n')
    return { content: [{ type: 'text', text: `Audit history — ${domain}:\n\n${rows}` }] }
  }
)

// ── seo_credentials_status ─────────────────────────────────────────────────

server.tool(
  'seo_credentials_status',
  'Check which MCP credentials are configured in the SEO Hub',
  {},
  async () => {
    const creds = getCredentials()
    const lines = creds.map(c => {
      const status = c.is_active ? '✓ connected' : '✗ not configured'
      const err = c.last_error ? ` — ERROR: ${c.last_error}` : ''
      return `${status}  ${c.label} (${c.service})${err}`
    })
    return { content: [{ type: 'text', text: `MCP credential status:\n\n${lines.join('\n')}` }] }
  }
)

// ── seo_search ─────────────────────────────────────────────────────────────

server.tool(
  'seo_search',
  'Search sites by domain, name, or project name',
  { query: z.string().describe('Search term') },
  async ({ query }) => {
    const sites = searchSites(query)
    if (!sites.length) return { content: [{ type: 'text', text: `No sites found matching "${query}"` }] }
    const text = sites.map(s => `• ${s.domain} — ${s.project_name} (score: ${s.last_audit_score ?? 'n/a'})`).join('\n')
    return { content: [{ type: 'text', text: `${sites.length} result(s) for "${query}":\n\n${text}` }] }
  }
)

// ── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
