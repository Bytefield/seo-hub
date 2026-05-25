# SEO Hub — Architecture & Data Model

## Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Rust (Tauri 2.0)
- **Database**: SQLite via `rusqlite` (local, `~/.seo-hub/seo-hub.db`)
- **Credentials**: OS Keychain via `keyring` crate (Windows Credential Manager)
- **MCP Servers**: spawned as child processes from Rust

## Project Structure
```
seo-hub-tauri/
├── src/                          # React frontend
│   ├── components/
│   │   ├── layout/               # Sidebar, Topbar, Layout
│   │   ├── ui/                   # Button, Input, Badge, Card, Table
│   │   ├── projects/             # ProjectCard, ProjectForm
│   │   ├── sites/                # SiteCard, SiteForm, DomAudit
│   │   ├── credentials/          # CredentialForm, CredentialStatus
│   │   └── dashboard/            # ScoreCard, MetricsRow, CWVRow, HeatmapPanel
│   ├── pages/
│   │   ├── Dashboard.tsx         # Main hub — all MCP data converged
│   │   ├── Projects.tsx          # Project list + CRUD
│   │   ├── Sites.tsx             # Sites per project + DOM audit
│   │   ├── Credentials.tsx       # MCP credential management
│   │   ├── Settings.tsx          # App settings, user profile
│   │   └── Login.tsx             # PIN/password lock screen
│   ├── hooks/
│   │   ├── useProjects.ts
│   │   ├── useSites.ts
│   │   ├── useCredentials.ts
│   │   └── useMcpData.ts         # Unified MCP data fetcher
│   ├── store/
│   │   └── appStore.ts           # Zustand global state
│   └── lib/
│       ├── tauri.ts              # invoke() wrappers typed
│       └── utils.ts
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # Tauri builder + command registration
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   ├── migrations.rs     # SQLite schema + migrations
│   │   │   └── queries.rs        # All SQL queries
│   │   ├── models/
│   │   │   ├── mod.rs
│   │   │   ├── user.rs
│   │   │   ├── project.rs
│   │   │   ├── site.rs
│   │   │   └── credential.rs
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── auth.rs           # Login, PIN verify
│   │       ├── projects.rs       # CRUD projects
│   │       ├── sites.rs          # CRUD sites + DOM audit
│   │       ├── credentials.rs    # Save/get/delete keys via keyring
│   │       ├── mcp.rs            # Spawn MCP servers, call tools
│   │       └── dom_audit.rs      # Playwright DOM analysis
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

## Data Model (SQLite)

### users
Single row — the local user profile.
```sql
CREATE TABLE users (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  name        TEXT NOT NULL DEFAULT 'Admin',
  pin_hash    TEXT,                    -- bcrypt hash of PIN (optional lock)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### projects
Groups of sites. Like a "client" or "brand".
```sql
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT DEFAULT '#f97316',  -- accent color for UI
  icon        TEXT DEFAULT '🌐',
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### sites
Each site belongs to a project. One site = one domain.
```sql
CREATE TABLE sites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,          -- e.g. "mercadohipotecas.com"
  url           TEXT NOT NULL,          -- e.g. "https://mercadohipotecas.com"
  gsc_property  TEXT,                   -- GSC property URL (can differ from domain)
  ga4_property  TEXT,                   -- GA4 property ID
  bwt_property  TEXT,                   -- Bing property URL
  clarity_project TEXT,                 -- Clarity project ID
  notes         TEXT,
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(domain)
);
```

### credentials
One row per MCP service. Secret values go to OS keychain — only metadata here.
```sql
CREATE TABLE credentials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  service      TEXT NOT NULL,    -- 'gsc' | 'bwt' | 'ga4' | 'clarity' | 'psi' | 'playwright'
  label        TEXT NOT NULL,    -- human name, e.g. "GSC — mercadohipotecas"
  key_ref      TEXT NOT NULL,    -- keychain entry name (never the raw secret)
  credential_type TEXT NOT NULL, -- 'api_key' | 'oauth_token' | 'service_account_path' | 'none'
  file_path    TEXT,             -- for GA4 service account JSON path
  is_active    INTEGER DEFAULT 1,
  last_tested  TEXT,             -- last successful connection test
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(service)
);
```

### site_credentials (junction — site can override project-level creds)
```sql
CREATE TABLE site_credentials (
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  PRIMARY KEY (site_id, credential_id)
);
```

### dom_audits
Cached results from Playwright DOM analysis.
```sql
CREATE TABLE dom_audits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  canonical       TEXT,
  canonical_match INTEGER,              -- 1 if canonical == url
  title           TEXT,
  title_length    INTEGER,
  meta_description TEXT,
  meta_desc_length INTEGER,
  meta_robots     TEXT,
  h1_count        INTEGER,
  h1_text         TEXT,                 -- first H1
  hreflang_tags   TEXT,                 -- JSON array
  og_tags         TEXT,                 -- JSON object
  schema_types    TEXT,                 -- JSON array of @type values
  robots_txt      TEXT,                 -- raw robots.txt content
  llms_txt        INTEGER DEFAULT 0,    -- 1 if /llms.txt exists
  has_invalid_head INTEGER DEFAULT 0,
  raw_issues      TEXT,                 -- JSON array of issues found
  score           INTEGER,              -- 0-100 computed DOM score
  crawled_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### mcp_snapshots
Cached MCP data per site (avoid hammering APIs every open).
```sql
CREATE TABLE mcp_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,  -- 'gsc' | 'bwt' | 'ga4' | 'clarity' | 'psi'
  data        TEXT NOT NULL,  -- JSON blob
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT            -- null = never cache, datetime = auto-refresh
);
```

## Security Model

### Credentials Flow
```
User inputs API key → Rust command → OS Keychain (keyring crate)
                                          ↓
Frontend requests key → Rust reads keychain → spawns MCP with env var
                                          ↓
                     Key NEVER touches frontend JS / SQLite
```

### PIN Lock (optional)
- User sets a 4-6 digit PIN on first launch
- bcrypt hash stored in `users.pin_hash`
- App locks after configurable idle time
- PIN verified in Rust before any command executes

### DB Path
- Windows: `C:\Users\{user}\AppData\Roaming\seo-hub\seo-hub.db`
- Tauri handles path via `app_data_dir()`

## MCP Credential Map

| Service | credential_type | Where secret lives |
|---------|-----------------|-------------------|
| GSC | `oauth_token` | Keychain (token file path) |
| BWT | `api_key` | Keychain |
| GA4 | `service_account_path` | `file_path` column (JSON file on disk) |
| Clarity | `api_key` | Keychain |
| PSI | `api_key` | Keychain |
| Playwright | `none` | No credentials needed |

## Tauri Commands (IPC surface)

### Auth
- `verify_pin(pin: String) → bool`
- `set_pin(pin: String) → Result`
- `get_user() → User`
- `update_user(name: String) → Result`

### Projects
- `get_projects() → Vec<Project>`
- `create_project(name, description, color, icon) → Project`
- `update_project(id, ...) → Project`
- `delete_project(id) → Result`

### Sites
- `get_sites(project_id?) → Vec<Site>`
- `create_site(project_id, domain, url, ...) → Site`
- `update_site(id, ...) → Site`
- `delete_site(id) → Result`

### Credentials
- `save_credential(service, api_key) → Result`   -- writes to keychain
- `get_credential_status(service) → CredentialStatus`  -- never returns the key
- `test_credential(service) → TestResult`
- `delete_credential(service) → Result`

### MCP Data
- `fetch_gsc_data(site_id, date_range) → GscData`
- `fetch_bwt_data(site_id) → BwtData`
- `fetch_ga4_data(site_id, date_range) → Ga4Data`
- `fetch_clarity_data(site_id) → ClarityData`
- `fetch_psi_data(url, strategy) → PsiData`

### DOM Audit
- `run_dom_audit(site_id, url) → DomAudit`   -- spawns Playwright
- `get_last_audit(site_id) → Option<DomAudit>`
- `get_audit_history(site_id) → Vec<DomAudit>`
