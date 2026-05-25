use crate::db;
use crate::models::credential::{CredentialStatus, McpService, SaveCredential, TestResult};
use keyring::Entry;
use std::str::FromStr;
use tauri::Manager;

impl FromStr for McpService {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "gsc"        => Ok(McpService::Gsc),
            "bwt"        => Ok(McpService::Bwt),
            "ga4"        => Ok(McpService::Ga4),
            "clarity"    => Ok(McpService::Clarity),
            "psi"        => Ok(McpService::Psi),
            "playwright"     => Ok(McpService::Playwright),
            "openpagerank"   => Ok(McpService::OpenPageRank),
            other            => Err(format!("Unknown service: {other}")),
        }
    }
}

fn service_to_str(s: &McpService) -> &'static str {
    match s {
        McpService::Gsc        => "gsc",
        McpService::Bwt        => "bwt",
        McpService::Ga4        => "ga4",
        McpService::Clarity    => "clarity",
        McpService::Psi        => "psi",
        McpService::Playwright   => "playwright",
        McpService::OpenPageRank => "openpagerank",
    }
}

/// Try keyring, fall back to SQLite secret_value column (e.g. WSL without D-Bus secrets)
fn try_keyring_set(svc: &McpService, secret: &str) -> Result<bool, String> {
    match Entry::new(svc.keychain_service(), "default") {
        Ok(entry) => match entry.set_password(secret) {
            Ok(_)  => Ok(true),
            Err(_) => Ok(false), // keyring not available — caller stores in DB
        },
        Err(_) => Ok(false),
    }
}

fn try_keyring_get(svc: &McpService) -> Option<String> {
    Entry::new(svc.keychain_service(), "default")
        .ok()?
        .get_password()
        .ok()
}

fn try_keyring_delete(svc: &McpService) {
    if let Ok(entry) = Entry::new(svc.keychain_service(), "default") {
        let _ = entry.delete_password();
    }
}

/// Save a credential — tries OS keychain first, falls back to SQLite secret_value
#[tauri::command]
pub fn save_credential(payload: SaveCredential) -> Result<CredentialStatus, String> {
    let svc: McpService = payload.service.parse()?;
    let svc_str = service_to_str(&svc);

    // Determine storage: try keyring, fall back to DB column
    let (key_ref, db_secret): (String, Option<String>) = if payload.secret == "_NO_SECRET_" {
        (format!("none:{}", svc_str), None)
    } else {
        let stored_in_keyring = try_keyring_set(&svc, &payload.secret)?;
        if stored_in_keyring {
            (format!("keychain:{}", svc.keychain_service()), None)
        } else {
            (format!("db:{}", svc_str), Some(payload.secret.clone()))
        }
    };

    let cred_type = serde_json::to_string(&svc.credential_type()).unwrap_or_default().trim_matches('"').to_string();
    let label = svc.label().to_string();
    let docs_url = svc.docs_url().to_string();

    db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO credentials (service, label, key_ref, credential_type, file_path, secret_value, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
             ON CONFLICT(service) DO UPDATE SET
               label           = excluded.label,
               key_ref         = excluded.key_ref,
               credential_type = excluded.credential_type,
               file_path       = excluded.file_path,
               secret_value    = excluded.secret_value,
               is_active       = 1,
               last_error      = NULL,
               updated_at      = datetime('now')",
            (
                svc_str,
                &label,
                &key_ref,
                &cred_type,
                &payload.file_path,
                &db_secret,
            ),
        )?;
        Ok(CredentialStatus {
            service:         svc_str.to_string(),
            label,
            credential_type: cred_type,
            is_configured:   true,
            is_active:       true,
            last_tested:     None,
            last_error:      None,
            file_path:       payload.file_path,
            docs_url,
        })
    })
    .map_err(|e| e.to_string())
}

/// Get status of all 6 MCP credentials (never returns secrets)
#[tauri::command]
pub fn get_all_credential_statuses() -> Result<Vec<CredentialStatus>, String> {
    let all_services = [
        McpService::Gsc,
        McpService::Bwt,
        McpService::Ga4,
        McpService::Clarity,
        McpService::Psi,
        McpService::Playwright,
        McpService::OpenPageRank,
    ];

    db::with_conn(|conn| {
        let mut result = Vec::new();
        for svc in &all_services {
            let svc_str = service_to_str(svc);
            let cred_type = serde_json::to_string(&svc.credential_type()).unwrap_or_default().trim_matches('"').to_string();

            // Get metadata + fallback secret from DB
            let db_row: Option<(bool, Option<String>, Option<String>, Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT is_active, last_tested, last_error, file_path, secret_value
                     FROM credentials WHERE service = ?1",
                    [svc_str],
                    |r| Ok((
                        r.get::<_, bool>(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                    )),
                )
                .ok();

            // Configured = Playwright (no key needed), OR keyring has it, OR DB secret/file_path is set
            let in_keychain = try_keyring_get(svc).is_some();
            let in_db      = db_row.as_ref().and_then(|r| r.4.as_ref()).is_some(); // secret_value
            let has_file   = db_row.as_ref().and_then(|r| r.3.as_ref()).is_some(); // file_path (service accounts)
            let is_configured = *svc == McpService::Playwright || in_keychain || in_db || has_file;

            result.push(CredentialStatus {
                service:         svc_str.to_string(),
                label:           svc.label().to_string(),
                credential_type: cred_type,
                is_configured,
                is_active:       db_row.as_ref().map(|r| r.0).unwrap_or(false),
                last_tested:     db_row.as_ref().and_then(|r| r.1.clone()),
                last_error:      db_row.as_ref().and_then(|r| r.2.clone()),
                file_path:       db_row.as_ref().and_then(|r| r.3.clone()),
                docs_url:        svc.docs_url().to_string(),
            });
        }
        Ok(result)
    })
    .map_err(|e| e.to_string())
}

/// Retrieve raw secret — tries keychain first, falls back to SQLite secret_value
pub fn get_secret(svc: &McpService) -> Option<String> {
    // Try keyring first
    if let Some(s) = try_keyring_get(svc) {
        return Some(s);
    }
    // Fall back to DB column
    db::with_conn(|conn| {
        let val: Option<String> = conn.query_row(
            "SELECT secret_value FROM credentials WHERE service = ?1 AND secret_value IS NOT NULL",
            [service_to_str(svc)],
            |r| r.get::<_, String>(0),
        ).ok();
        Ok(val)
    }).ok().flatten()
}

/// Delete credential from keychain + DB
#[tauri::command]
pub fn delete_credential(service: String) -> Result<(), String> {
    let svc: McpService = service.parse()?;
    try_keyring_delete(&svc);
    db::with_conn(|conn| {
        conn.execute(
            "DELETE FROM credentials WHERE service = ?1",
            [service_to_str(&svc)],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

/// Import a service account JSON — copies it into the app data dir and saves the credential.
/// Returns the service account email on success (shown in the UI as confirmation).
#[tauri::command]
pub fn import_service_account(
    app: tauri::AppHandle,
    service: String,
    content: String,
) -> Result<String, String> {
    let svc: McpService = service.parse()?;

    // Validate JSON has required fields
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON: {e}"))?;
    if json.get("type").and_then(|v| v.as_str()) != Some("service_account") {
        return Err("Not a service account JSON — make sure you downloaded a Service Account key from Google Cloud.".into());
    }
    let email = json["client_email"].as_str()
        .ok_or("Missing client_email — invalid service account file")?
        .to_string();
    if json.get("private_key").and_then(|v| v.as_str()).is_none() {
        return Err("Missing private_key — invalid service account file".into());
    }

    // Copy file to app data dir
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?;
    let sa_dir = app_data_dir.join("service-accounts");
    std::fs::create_dir_all(&sa_dir)
        .map_err(|e| format!("Cannot create service-accounts dir: {e}"))?;

    // GSC and GA4 share the same JSON — store as "google.json" and link both
    let is_google = matches!(svc, McpService::Gsc | McpService::Ga4);
    let file_name = if is_google { "google.json".to_string() } else { format!("{}.json", service_to_str(&svc)) };
    let dest = sa_dir.join(&file_name);
    std::fs::write(&dest, &content)
        .map_err(|e| format!("Cannot write service account file: {e}"))?;

    let file_path = dest.to_string_lossy().to_string();

    // Services to configure — for Google, link both gsc and ga4 to the same file
    let services_to_save: &[McpService] = if is_google {
        &[McpService::Gsc, McpService::Ga4]
    } else {
        std::slice::from_ref(&svc)
    };

    db::with_conn(|conn| {
        for s in services_to_save {
            let s_str     = service_to_str(s);
            let cred_type = serde_json::to_string(&s.credential_type()).unwrap_or_default().trim_matches('"').to_string();
            let label     = s.label().to_string();
            let key_ref   = format!("file:{file_path}");
            conn.execute(
                "INSERT INTO credentials (service, label, key_ref, credential_type, file_path, is_active)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)
                 ON CONFLICT(service) DO UPDATE SET
                   label           = excluded.label,
                   key_ref         = excluded.key_ref,
                   credential_type = excluded.credential_type,
                   file_path       = excluded.file_path,
                   is_active       = 1,
                   last_error      = NULL,
                   updated_at      = datetime('now')",
                (s_str, &label, &key_ref, &cred_type, &file_path),
            )?;
        }
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    Ok(email)
}

/// Quick connection test per service
#[tauri::command]
pub async fn test_credential(service: String) -> Result<TestResult, String> {
    let svc: McpService = service.parse()?;
    let svc_str = service_to_str(&svc).to_string();
    let start = std::time::Instant::now();

    let result = match svc {
        McpService::Playwright => TestResult {
            success:    true,
            message:    "Playwright needs no credentials — always ready".into(),
            latency_ms: None,
        },
        McpService::Bwt => {
            let key = get_secret(&McpService::Bwt)
                .ok_or("BWT API key not configured")?;
            let url = format!(
                "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey={}",
                key
            );
            match reqwest::get(&url).await {
                Ok(r) if r.status().is_success() => TestResult {
                    success:    true,
                    message:    "Connected to Bing Webmaster Tools ✓".into(),
                    latency_ms: Some(start.elapsed().as_millis() as u64),
                },
                Ok(r) => TestResult {
                    success:    false,
                    message:    format!("BWT returned HTTP {}", r.status()),
                    latency_ms: Some(start.elapsed().as_millis() as u64),
                },
                Err(e) => TestResult {
                    success:    false,
                    message:    format!("BWT connection failed: {e}"),
                    latency_ms: None,
                },
            }
        }
        McpService::Psi => {
            let key = get_secret(&McpService::Psi)
                .ok_or("PSI API key not configured")?;
            let url = format!(
                "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&key={}",
                key
            );
            match reqwest::get(&url).await {
                Ok(r) if r.status().is_success() => TestResult {
                    success:    true,
                    message:    "PageSpeed Insights API key valid ✓".into(),
                    latency_ms: Some(start.elapsed().as_millis() as u64),
                },
                Ok(r) => TestResult {
                    success:    false,
                    message:    format!("PSI returned HTTP {}", r.status()),
                    latency_ms: Some(start.elapsed().as_millis() as u64),
                },
                Err(e) => TestResult {
                    success:    false,
                    message:    format!("PSI connection failed: {e}"),
                    latency_ms: None,
                },
            }
        }
        // GSC, GA4, Clarity need OAuth flow or file — mark as manual verify
        _ => TestResult {
            success:    true,
            message:    format!("{} credentials saved — verify by running a data fetch", svc.label()),
            latency_ms: None,
        },
    };

    // Update last_tested or last_error in DB
    let _ = db::with_conn(|conn| {
        if result.success {
            conn.execute(
                "UPDATE credentials SET last_tested = datetime('now'), last_error = NULL
                 WHERE service = ?1",
                [&svc_str],
            )?;
        } else {
            conn.execute(
                "UPDATE credentials SET last_error = ?1 WHERE service = ?2",
                (&result.message, &svc_str),
            )?;
        }
        Ok(())
    });

    Ok(result)
}

// ── Per-site Clarity token ─────────────────────────────────────────────────

fn site_clarity_key(site_id: i64) -> String {
    format!("seo-hub-clarity-site-{}", site_id)
}

/// Public helper used by mcp.rs to read a site's Clarity token at fetch time.
pub fn get_site_clarity_token(site_id: i64) -> Option<String> {
    let key = site_clarity_key(site_id);
    Entry::new(&key, "default")
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn save_site_clarity_token(site_id: i64, token: String) -> Result<(), String> {
    Entry::new(&site_clarity_key(site_id), "default")
        .map_err(|e| format!("Keyring error: {e}"))?
        .set_password(&token)
        .map_err(|e| format!("Failed to save Clarity token: {e}"))
}

#[tauri::command]
pub fn delete_site_clarity_token(site_id: i64) -> Result<(), String> {
    if let Ok(entry) = Entry::new(&site_clarity_key(site_id), "default") {
        let _ = entry.delete_password();
    }
    Ok(())
}

#[tauri::command]
pub fn get_site_clarity_status(site_id: i64) -> bool {
    get_site_clarity_token(site_id).is_some()
}
