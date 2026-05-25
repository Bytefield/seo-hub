import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

function resolveDbPath(): string {
  // Allow override via env var (useful for dev/testing)
  if (process.env.SEO_HUB_DB) return process.env.SEO_HUB_DB

  // Windows: %APPDATA%\com.synio.seohub\synio-seo-hub.db
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appdata, 'com.synio.seohub', 'synio-seo-hub.db')
  }

  // Linux/macOS (dev): ~/.local/share/com.synio.seohub/synio-seo-hub.db
  return path.join(os.homedir(), '.local', 'share', 'com.synio.seohub', 'synio-seo-hub.db')
}

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const dbPath = resolveDbPath()

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `SEO Hub database not found at: ${dbPath}\n` +
      `Launch SYNIO SEO Hub at least once to initialize the database.\n` +
      `Or set SEO_HUB_DB=/path/to/synio-seo-hub.db`
    )
  }

  _db = new Database(dbPath, { readonly: true, fileMustExist: true })
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  return _db
}

// ── Typed row helpers ──────────────────────────────────────────────────────

export interface ProjectRow {
  id: number
  name: string
  description: string | null
  color: string
  icon: string
  is_active: number
  site_count: number
  created_at: string
}

export interface SiteRow {
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
  is_active: number
  last_audit_score: number | null
  last_audit_at: string | null
  created_at: string
}

export interface AuditRow {
  id: number
  site_id: number
  url: string
  canonical: string | null
  canonical_match: number | null
  title: string | null
  title_length: number | null
  meta_description: string | null
  meta_desc_length: number | null
  meta_robots: string | null
  h1_count: number | null
  h1_text: string | null
  hreflang_tags: string | null
  og_tags: string | null
  schema_types: string | null
  robots_txt: string | null
  llms_txt: number
  has_invalid_head: number
  raw_issues: string | null
  score: number | null
  crawled_at: string
}

export interface SnapshotRow {
  id: number
  site_id: number
  source: string
  data: string
  fetched_at: string
  expires_at: string | null
}

export interface CredentialRow {
  service: string
  label: string
  credential_type: string
  is_active: number
  last_tested: string | null
  last_error: string | null
}
