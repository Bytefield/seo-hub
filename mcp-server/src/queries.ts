import { getDb, type ProjectRow, type SiteRow, type AuditRow, type SnapshotRow, type CredentialRow } from './db.js'

export function listProjects(): ProjectRow[] {
  return getDb().prepare(`
    SELECT p.id, p.name, p.description, p.color, p.icon, p.is_active,
           COUNT(s.id) AS site_count, p.created_at
    FROM projects p
    LEFT JOIN sites s ON s.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all() as ProjectRow[]
}

export function listSites(projectId?: number): SiteRow[] {
  const base = `
    SELECT s.id, s.project_id, p.name AS project_name,
           s.name, s.domain, s.url,
           s.gsc_property, s.ga4_property, s.bwt_property, s.clarity_project,
           s.notes, s.is_active,
           da.score AS last_audit_score, da.crawled_at AS last_audit_at,
           s.created_at
    FROM sites s
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN (
      SELECT site_id, score, crawled_at
      FROM dom_audits
      WHERE id IN (SELECT MAX(id) FROM dom_audits GROUP BY site_id)
    ) da ON da.site_id = s.id
  `
  if (projectId !== undefined) {
    return getDb().prepare(base + ' WHERE s.project_id = ? ORDER BY s.created_at DESC')
      .all(projectId) as SiteRow[]
  }
  return getDb().prepare(base + ' ORDER BY s.created_at DESC').all() as SiteRow[]
}

export function getSiteByDomain(domain: string): SiteRow | null {
  return getDb().prepare(`
    SELECT s.id, s.project_id, p.name AS project_name,
           s.name, s.domain, s.url,
           s.gsc_property, s.ga4_property, s.bwt_property, s.clarity_project,
           s.notes, s.is_active,
           da.score AS last_audit_score, da.crawled_at AS last_audit_at,
           s.created_at
    FROM sites s
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN (
      SELECT site_id, score, crawled_at
      FROM dom_audits
      WHERE id IN (SELECT MAX(id) FROM dom_audits GROUP BY site_id)
    ) da ON da.site_id = s.id
    WHERE s.domain = ? OR s.domain = ?
  `).get(domain, domain.replace(/^www\./, '')) as SiteRow | null
}

export function getLastAudit(siteId: number): AuditRow | null {
  return getDb().prepare(`
    SELECT * FROM dom_audits
    WHERE site_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(siteId) as AuditRow | null
}

export function getAuditHistory(siteId: number, limit = 10): AuditRow[] {
  return getDb().prepare(`
    SELECT * FROM dom_audits
    WHERE site_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(siteId, limit) as AuditRow[]
}

export function getSnapshot(siteId: number, source: string): SnapshotRow | null {
  return getDb().prepare(`
    SELECT * FROM mcp_snapshots
    WHERE site_id = ? AND source = ?
    ORDER BY fetched_at DESC LIMIT 1
  `).get(siteId, source) as SnapshotRow | null
}

export function getAllSnapshots(siteId: number): SnapshotRow[] {
  return getDb().prepare(`
    SELECT * FROM mcp_snapshots
    WHERE site_id = ?
    ORDER BY source, fetched_at DESC
  `).all(siteId) as SnapshotRow[]
}

export function getCredentials(): CredentialRow[] {
  return getDb().prepare(`
    SELECT service, label, credential_type, is_active, last_tested, last_error
    FROM credentials
  `).all() as CredentialRow[]
}

export function searchSites(query: string): SiteRow[] {
  const q = `%${query}%`
  return getDb().prepare(`
    SELECT s.id, s.project_id, p.name AS project_name,
           s.name, s.domain, s.url,
           s.gsc_property, s.ga4_property, s.bwt_property, s.clarity_project,
           s.notes, s.is_active,
           da.score AS last_audit_score, da.crawled_at AS last_audit_at,
           s.created_at
    FROM sites s
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN (
      SELECT site_id, score, crawled_at
      FROM dom_audits
      WHERE id IN (SELECT MAX(id) FROM dom_audits GROUP BY site_id)
    ) da ON da.site_id = s.id
    WHERE s.domain LIKE ? OR s.name LIKE ? OR p.name LIKE ?
    ORDER BY s.domain
  `).all(q, q, q) as SiteRow[]
}
