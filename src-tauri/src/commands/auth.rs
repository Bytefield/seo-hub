use crate::db;
use crate::models::user::User;
use bcrypt::{hash, verify, DEFAULT_COST};
use tauri::State;
use std::sync::Mutex;

pub struct AuthState(pub Mutex<bool>); // is_unlocked

#[tauri::command]
pub fn get_user() -> Result<User, String> {
    db::with_conn(|conn| {
        let user = conn.query_row(
            "SELECT id, name, pin_hash IS NOT NULL as has_pin, created_at, updated_at
             FROM users WHERE id = 1",
            [],
            |r| Ok(User {
                id:         r.get(0)?,
                name:       r.get(1)?,
                has_pin:    r.get::<_, bool>(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            }),
        )?;
        Ok(user)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_user(name: String) -> Result<User, String> {
    db::with_conn(|conn| {
        conn.execute(
            "UPDATE users SET name = ?1, updated_at = datetime('now') WHERE id = 1",
            [&name],
        )?;
        let user = conn.query_row(
            "SELECT id, name, pin_hash IS NOT NULL as has_pin, created_at, updated_at
             FROM users WHERE id = 1",
            [],
            |r| Ok(User {
                id:         r.get(0)?,
                name:       r.get(1)?,
                has_pin:    r.get::<_, bool>(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            }),
        )?;
        Ok(user)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_pin(pin: String, auth: State<AuthState>) -> Result<(), String> {
    if pin.len() < 4 || pin.len() > 8 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN must be 4-8 digits".into());
    }
    let hashed = hash(&pin, DEFAULT_COST).map_err(|e| e.to_string())?;
    db::with_conn(|conn| {
        conn.execute(
            "UPDATE users SET pin_hash = ?1, updated_at = datetime('now') WHERE id = 1",
            [&hashed],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    *auth.0.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
pub fn remove_pin(pin: String, auth: State<AuthState>) -> Result<(), String> {
    verify_pin(pin, auth)?;
    db::with_conn(|conn| {
        conn.execute(
            "UPDATE users SET pin_hash = NULL, updated_at = datetime('now') WHERE id = 1",
            [],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn verify_pin(pin: String, auth: State<AuthState>) -> Result<bool, String> {
    let hash_opt: Option<String> = db::with_conn(|conn| {
        let h: Option<String> = conn
            .query_row("SELECT pin_hash FROM users WHERE id = 1", [], |r| r.get(0))
            .ok();
        Ok(h)
    })
    .map_err(|e| e.to_string())?;

    match hash_opt {
        None => {
            // No PIN set — always unlocked
            *auth.0.lock().unwrap() = true;
            Ok(true)
        }
        Some(h) => {
            let ok = verify(&pin, &h).unwrap_or(false);
            if ok {
                *auth.0.lock().unwrap() = true;
            }
            Ok(ok)
        }
    }
}

#[tauri::command]
pub fn lock_app(auth: State<AuthState>) {
    *auth.0.lock().unwrap() = false;
}

#[tauri::command]
pub fn is_unlocked(auth: State<AuthState>) -> bool {
    *auth.0.lock().unwrap()
}
