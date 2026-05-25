use tauri::command;
use serde::Serialize;
use crate::db;
use chrono::Utc;

pub const DAILY_LIMIT: i64 = 10;
pub const REQUESTS_PER_FETCH: i64 = 4; // global + Device + URL + Source

#[derive(Debug, Serialize)]
pub struct ClarityUsage {
    pub requests_used:   i64,
    pub limit:           i64,
    pub remaining:       i64,
    pub last_fetched_at: Option<String>,
    pub can_fetch:       bool,
}

/// Returns today's Clarity API usage for a site.
/// The frontend uses this to show the rate-limit indicator before triggering a fetch.
#[command]
pub fn get_clarity_usage(site_id: i64) -> Result<ClarityUsage, String> {
    let today = Utc::now().format("%Y-%m-%d").to_string();

    db::with_conn(|conn| {
        let requests_used: i64 = conn
            .query_row(
                "SELECT requests_used FROM clarity_usage WHERE site_id = ?1 AND date = ?2",
                rusqlite::params![site_id, &today],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let last_fetched_at: Option<String> = conn
            .query_row(
                "SELECT fetched_at FROM clarity_daily \
                 WHERE site_id = ?1 ORDER BY fetched_at DESC LIMIT 1",
                [site_id],
                |r| r.get(0),
            )
            .ok();

        let remaining = (DAILY_LIMIT - requests_used).max(0);
        Ok(ClarityUsage {
            requests_used,
            limit: DAILY_LIMIT,
            remaining,
            last_fetched_at,
            can_fetch: remaining >= REQUESTS_PER_FETCH,
        })
    })
    .map_err(|e| e.to_string())
}

/// Checks that at least REQUESTS_PER_FETCH slots remain for today.
/// Called before making API requests; returns Err with a user-facing message if over limit.
pub fn check_and_reserve(site_id: i64) -> Result<(), String> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let used: i64 = db::with_conn(|conn| {
        Ok(conn
            .query_row(
                "SELECT requests_used FROM clarity_usage WHERE site_id = ?1 AND date = ?2",
                rusqlite::params![site_id, &today],
                |r| r.get(0),
            )
            .unwrap_or(0))
    })
    .unwrap_or(0);

    if used + REQUESTS_PER_FETCH > DAILY_LIMIT {
        Err(format!(
            "Clarity daily limit reached ({used}/{DAILY_LIMIT} requests used today). Resets tomorrow."
        ))
    } else {
        Ok(())
    }
}

/// Atomically increments today's usage counter for a site.
pub fn record_usage(site_id: i64, count: i64) -> anyhow::Result<()> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO clarity_usage (site_id, date, requests_used) VALUES (?1, ?2, ?3)
             ON CONFLICT(site_id, date) DO UPDATE SET requests_used = requests_used + ?3",
            rusqlite::params![site_id, &today, count],
        )?;
        Ok(())
    })
}

/// Persists one dimension snapshot to clarity_daily.
/// On conflict (same site + date + dimension) it overwrites, keeping one row per day.
pub fn save_daily(site_id: i64, dimension: &str, data: &serde_json::Value) -> anyhow::Result<()> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO clarity_daily (site_id, date, dimension, data) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(site_id, date, dimension) DO UPDATE SET
               data = excluded.data, fetched_at = datetime('now')",
            rusqlite::params![
                site_id,
                &today,
                dimension,
                &serde_json::to_string(data).unwrap_or_default()
            ],
        )?;
        Ok(())
    })
}
