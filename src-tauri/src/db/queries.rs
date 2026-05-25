// SQL query helpers — thin wrappers over db::with_conn used by commands.
use anyhow::Result;
use crate::db::with_conn;
use crate::models::{project::Project, site::Site};

// ── Projects ─────────────────────────────────────────────────────────────────

pub fn list_projects() -> Result<Vec<Project>> {
    with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.description, p.color, p.icon, p.is_active,
                    COUNT(s.id) AS site_count,
                    p.created_at, p.updated_at
             FROM projects p
             LEFT JOIN sites s ON s.project_id = p.id
             GROUP BY p.id
             ORDER BY p.created_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                color: r.get(3)?,
                icon: r.get(4)?,
                is_active: r.get(5)?,
                site_count: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    })
}

// ── Sites ─────────────────────────────────────────────────────────────────────

pub fn list_sites(project_id: Option<i64>) -> Result<Vec<Site>> {
    with_conn(|conn| {
        let sql = if project_id.is_some() {
            "SELECT s.id, s.project_id, p.name AS project_name,
                    s.name, s.domain, s.url,
                    s.gsc_property, s.ga4_property, s.bwt_property, s.clarity_project,
                    s.notes, s.is_active,
                    da.score AS last_audit_score, da.crawled_at AS last_audit_at,
                    s.created_at, s.updated_at
             FROM sites s
             JOIN projects p ON p.id = s.project_id
             LEFT JOIN (
                 SELECT site_id, score, crawled_at
                 FROM dom_audits
                 WHERE id IN (SELECT MAX(id) FROM dom_audits GROUP BY site_id)
             ) da ON da.site_id = s.id
             WHERE s.project_id = ?1
             ORDER BY s.created_at DESC"
        } else {
            "SELECT s.id, s.project_id, p.name AS project_name,
                    s.name, s.domain, s.url,
                    s.gsc_property, s.ga4_property, s.bwt_property, s.clarity_project,
                    s.notes, s.is_active,
                    da.score AS last_audit_score, da.crawled_at AS last_audit_at,
                    s.created_at, s.updated_at
             FROM sites s
             JOIN projects p ON p.id = s.project_id
             LEFT JOIN (
                 SELECT site_id, score, crawled_at
                 FROM dom_audits
                 WHERE id IN (SELECT MAX(id) FROM dom_audits GROUP BY site_id)
             ) da ON da.site_id = s.id
             ORDER BY s.created_at DESC"
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = if let Some(pid) = project_id {
            stmt.query_map(rusqlite::params![pid], map_site)?
        } else {
            stmt.query_map([], map_site)?
        };
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    })
}

fn map_site(r: &rusqlite::Row) -> rusqlite::Result<Site> {
    Ok(Site {
        id: r.get(0)?,
        project_id: r.get(1)?,
        project_name: r.get(2)?,
        name: r.get(3)?,
        domain: r.get(4)?,
        url: r.get(5)?,
        gsc_property: r.get(6)?,
        ga4_property: r.get(7)?,
        bwt_property: r.get(8)?,
        clarity_project: r.get(9)?,
        notes: r.get(10)?,
        is_active: r.get(11)?,
        last_audit_score: r.get(12)?,
        last_audit_at: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}
