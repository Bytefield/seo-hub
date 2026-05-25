use crate::db;
use crate::models::project::{CreateProject, Project, UpdateProject};

#[tauri::command]
pub fn get_projects() -> Result<Vec<Project>, String> {
    db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.description, p.color, p.icon, p.is_active,
                    COUNT(s.id) as site_count, p.created_at, p.updated_at
             FROM projects p
             LEFT JOIN sites s ON s.project_id = p.id AND s.is_active = 1
             GROUP BY p.id
             ORDER BY p.created_at DESC",
        )?;
        let projects = stmt.query_map([], |r| {
            Ok(Project {
                id:          r.get(0)?,
                name:        r.get(1)?,
                description: r.get(2)?,
                color:       r.get(3)?,
                icon:        r.get(4)?,
                is_active:   r.get::<_, bool>(5)?,
                site_count:  r.get(6)?,
                created_at:  r.get(7)?,
                updated_at:  r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(projects)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project(payload: CreateProject) -> Result<Project, String> {
    db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO projects (name, description, color, icon)
             VALUES (?1, ?2, ?3, ?4)",
            (
                &payload.name,
                &payload.description,
                payload.color.as_deref().unwrap_or("#f97316"),
                payload.icon.as_deref().unwrap_or("🌐"),
            ),
        )?;
        let id = conn.last_insert_rowid();
        let project = conn.query_row(
            "SELECT p.id, p.name, p.description, p.color, p.icon, p.is_active,
                    0 as site_count, p.created_at, p.updated_at
             FROM projects p WHERE p.id = ?1",
            [id],
            |r| Ok(Project {
                id:          r.get(0)?,
                name:        r.get(1)?,
                description: r.get(2)?,
                color:       r.get(3)?,
                icon:        r.get(4)?,
                is_active:   r.get::<_, bool>(5)?,
                site_count:  r.get(6)?,
                created_at:  r.get(7)?,
                updated_at:  r.get(8)?,
            }),
        )?;
        Ok(project)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_project(id: i64, payload: UpdateProject) -> Result<Project, String> {
    db::with_conn(|conn| {
        if let Some(name) = &payload.name {
            conn.execute(
                "UPDATE projects SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
                (name, id),
            )?;
        }
        if let Some(desc) = &payload.description {
            conn.execute(
                "UPDATE projects SET description = ?1, updated_at = datetime('now') WHERE id = ?2",
                (desc, id),
            )?;
        }
        if let Some(color) = &payload.color {
            conn.execute(
                "UPDATE projects SET color = ?1, updated_at = datetime('now') WHERE id = ?2",
                (color, id),
            )?;
        }
        if let Some(icon) = &payload.icon {
            conn.execute(
                "UPDATE projects SET icon = ?1, updated_at = datetime('now') WHERE id = ?2",
                (icon, id),
            )?;
        }
        if let Some(active) = payload.is_active {
            conn.execute(
                "UPDATE projects SET is_active = ?1, updated_at = datetime('now') WHERE id = ?2",
                (active as i64, id),
            )?;
        }
        let project = conn.query_row(
            "SELECT p.id, p.name, p.description, p.color, p.icon, p.is_active,
                    COUNT(s.id) as site_count, p.created_at, p.updated_at
             FROM projects p
             LEFT JOIN sites s ON s.project_id = p.id AND s.is_active = 1
             WHERE p.id = ?1
             GROUP BY p.id",
            [id],
            |r| Ok(Project {
                id:          r.get(0)?,
                name:        r.get(1)?,
                description: r.get(2)?,
                color:       r.get(3)?,
                icon:        r.get(4)?,
                is_active:   r.get::<_, bool>(5)?,
                site_count:  r.get(6)?,
                created_at:  r.get(7)?,
                updated_at:  r.get(8)?,
            }),
        )?;
        Ok(project)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(id: i64) -> Result<(), String> {
    db::with_conn(|conn| {
        conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}
