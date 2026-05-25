pub mod migrations;
pub mod queries;

use anyhow::Result;
use once_cell::sync::OnceCell;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn init(app_data_dir: PathBuf) -> Result<()> {
    std::fs::create_dir_all(&app_data_dir)?;
    let db_path = app_data_dir.join("synio-seo-hub.db");
    let conn = Connection::open(db_path)?;
    migrations::run_migrations(&conn)?;
    DB.set(Mutex::new(conn))
        .map_err(|_| anyhow::anyhow!("DB already initialized"))?;
    Ok(())
}

pub fn with_conn<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Connection) -> Result<T>,
{
    let conn = DB
        .get()
        .ok_or_else(|| anyhow::anyhow!("DB not initialized"))?
        .lock()
        .map_err(|e| anyhow::anyhow!("DB lock poisoned: {e}"))?;
    f(&conn)
}
