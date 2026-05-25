use crate::db;
use crate::models::site::{CreateSite, Site, UpdateSite};

#[tauri::command]
pub fn get_sites(project_id: Option<i64>) -> Result<Vec<Site>, String> {
    db::with_conn(|conn| {
        let sql = "
            SELECT s.id, s.project_id, p.name as project_name, s.name, s.domain, s.url,
                   s.gsc_property, s.ga4_property, s.bwt_property, s.clarity_project,
                   s.notes, s.is_active,
                   da.score as last_audit_score, da.crawled_at as last_audit_at,
                   s.created_at, s.updated_at
            FROM sites s
            JOIN projects p ON p.id = s.project_id
            LEFT JOIN dom_audits da ON da.id = (
                SELECT id FROM dom_audits WHERE site_id = s.id
                ORDER BY crawled_at DESC LIMIT 1
            )
            WHERE (?1 IS NULL OR s.project_id = ?1)
            ORDER BY p.name, s.domain";

        let mut stmt = conn.prepare(sql)?;
        let sites = stmt.query_map([project_id], |r| {
            Ok(Site {
                id:              r.get(0)?,
                project_id:      r.get(1)?,
                project_name:    r.get(2)?,
                name:            r.get(3)?,
                domain:          r.get(4)?,
                url:             r.get(5)?,
                gsc_property:    r.get(6)?,
                ga4_property:    r.get(7)?,
                bwt_property:    r.get(8)?,
                clarity_project: r.get(9)?,
                notes:           r.get(10)?,
                is_active:       r.get::<_, bool>(11)?,
                last_audit_score: r.get(12)?,
                last_audit_at:   r.get(13)?,
                created_at:      r.get(14)?,
                updated_at:      r.get(15)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(sites)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_site(payload: CreateSite) -> Result<Site, String> {
    db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO sites (project_id, name, domain, url, gsc_property, ga4_property,
                                bwt_property, clarity_project, notes)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            (
                payload.project_id,
                &payload.name,
                &payload.domain,
                &payload.url,
                &payload.gsc_property,
                &payload.ga4_property,
                &payload.bwt_property,
                &payload.clarity_project,
                &payload.notes,
            ),
        )?;
        let id = conn.last_insert_rowid();
        let site = conn.query_row(
            "SELECT s.id, s.project_id, p.name, s.name, s.domain, s.url,
                    s.gsc_property, s.ga4_property, s.bwt_property, s.clarity_project,
                    s.notes, s.is_active, NULL, NULL, s.created_at, s.updated_at
             FROM sites s JOIN projects p ON p.id = s.project_id WHERE s.id = ?1",
            [id],
            |r| Ok(Site {
                id:              r.get(0)?,
                project_id:      r.get(1)?,
                project_name:    r.get(2)?,
                name:            r.get(3)?,
                domain:          r.get(4)?,
                url:             r.get(5)?,
                gsc_property:    r.get(6)?,
                ga4_property:    r.get(7)?,
                bwt_property:    r.get(8)?,
                clarity_project: r.get(9)?,
                notes:           r.get(10)?,
                is_active:       r.get::<_, bool>(11)?,
                last_audit_score: r.get(12)?,
                last_audit_at:   r.get(13)?,
                created_at:      r.get(14)?,
                updated_at:      r.get(15)?,
            }),
        )?;
        Ok(site)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_site(id: i64, payload: UpdateSite) -> Result<(), String> {
    db::with_conn(|conn| {
        // Selective update — only fields provided
        let mut sets = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        macro_rules! field {
            ($opt:expr, $col:expr) => {
                if let Some(v) = $opt {
                    sets.push(format!("{} = ?{}", $col, params.len() + 1));
                    params.push(Box::new(v));
                }
            };
        }

        field!(payload.name,            "name");
        field!(payload.domain,          "domain");
        field!(payload.url,             "url");
        field!(payload.gsc_property,    "gsc_property");
        field!(payload.ga4_property,    "ga4_property");
        field!(payload.bwt_property,    "bwt_property");
        field!(payload.clarity_project, "clarity_project");
        field!(payload.notes,           "notes");
        field!(payload.is_active.map(|b| b as i64), "is_active");

        if sets.is_empty() { return Ok(()); }

        sets.push("updated_at = datetime('now')".into());
        let sql = format!("UPDATE sites SET {} WHERE id = ?{}", sets.join(", "), params.len() + 1);
        params.push(Box::new(id));

        conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_site(id: i64) -> Result<(), String> {
    db::with_conn(|conn| {
        conn.execute("DELETE FROM sites WHERE id = ?1", [id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}
