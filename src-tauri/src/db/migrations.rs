use anyhow::Result;
use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        );
    ")?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current < 1 {
        migration_v1(conn)?;
        conn.execute("INSERT INTO schema_version VALUES (1)", [])?;
    }
    if current < 2 {
        migration_v2(conn)?;
        conn.execute("INSERT INTO schema_version VALUES (2)", [])?;
    }
    if current < 3 {
        migration_v3(conn)?;
        conn.execute("INSERT INTO schema_version VALUES (3)", [])?;
    }

    Ok(())
}

fn migration_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        -- ── USERS ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY DEFAULT 1,
            name        TEXT    NOT NULL DEFAULT 'Admin',
            pin_hash    TEXT,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO users (id, name) VALUES (1, 'Admin');

        -- ── PROJECTS ───────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            description TEXT,
            color       TEXT    NOT NULL DEFAULT '#f97316',
            icon        TEXT    NOT NULL DEFAULT '🌐',
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        -- ── SITES ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS sites (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name            TEXT    NOT NULL,
            domain          TEXT    NOT NULL,
            url             TEXT    NOT NULL,
            gsc_property    TEXT,
            ga4_property    TEXT,
            bwt_property    TEXT,
            clarity_project TEXT,
            notes           TEXT,
            is_active       INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(domain)
        );

        -- ── CREDENTIALS ────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS credentials (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            service         TEXT    NOT NULL,
            label           TEXT    NOT NULL,
            key_ref         TEXT    NOT NULL,
            credential_type TEXT    NOT NULL DEFAULT 'api_key',
            file_path       TEXT,
            is_active       INTEGER NOT NULL DEFAULT 1,
            last_tested     TEXT,
            last_error      TEXT,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(service)
        );

        -- ── DOM AUDITS ─────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS dom_audits (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id          INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            url              TEXT    NOT NULL,
            canonical        TEXT,
            canonical_match  INTEGER,
            title            TEXT,
            title_length     INTEGER,
            meta_description TEXT,
            meta_desc_length INTEGER,
            meta_robots      TEXT,
            h1_count         INTEGER,
            h1_text          TEXT,
            hreflang_tags    TEXT,
            og_tags          TEXT,
            schema_types     TEXT,
            robots_txt       TEXT,
            llms_txt         INTEGER NOT NULL DEFAULT 0,
            has_invalid_head INTEGER NOT NULL DEFAULT 0,
            raw_issues       TEXT,
            score            INTEGER,
            crawled_at       TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        -- ── MCP SNAPSHOTS ──────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS mcp_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            source      TEXT    NOT NULL,
            data        TEXT    NOT NULL,
            fetched_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            expires_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_site_source
            ON mcp_snapshots(site_id, source);
    ")?;
    Ok(())
}

/// v2: fallback secret storage for platforms without a working keyring (e.g. WSL)
fn migration_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        ALTER TABLE credentials ADD COLUMN secret_value TEXT;
    ")?;
    Ok(())
}

/// v3: Clarity rate-limit tracking and daily dimension snapshots
fn migration_v3(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        -- Tracks how many Clarity API requests have been made per site per day.
        -- Resets naturally since each row is keyed by date (YYYY-MM-DD).
        CREATE TABLE IF NOT EXISTS clarity_usage (
            site_id       INTEGER NOT NULL,
            date          TEXT    NOT NULL,
            requests_used INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (site_id, date)
        );

        -- Stores one daily snapshot per (site, date, dimension).
        -- Dimension values: 'global', 'Device', 'URL', 'Source'.
        -- Accumulates over time to give 30-day history without hitting the API.
        CREATE TABLE IF NOT EXISTS clarity_daily (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            date       TEXT    NOT NULL,
            dimension  TEXT    NOT NULL,
            data       TEXT    NOT NULL,
            fetched_at TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(site_id, date, dimension)
        );
        CREATE INDEX IF NOT EXISTS idx_clarity_daily_site_date
            ON clarity_daily(site_id, date DESC);
    ")?;
    Ok(())
}
