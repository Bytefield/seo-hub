mod commands;
mod db;
mod models;

use commands::{auth::*, clarity::*, credentials::*, dom_audit::*, mcp::*, projects::*};
use commands::credentials::{save_site_clarity_token, delete_site_clarity_token, get_site_clarity_status};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AuthState(std::sync::Mutex::new(false)))
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Could not determine app data dir");
            db::init(app_data_dir).expect("Failed to initialize database");

            // Auto-unlock if no PIN is set
            let has_pin: bool = db::with_conn(|conn| {
                Ok(conn
                    .query_row(
                        "SELECT pin_hash IS NOT NULL FROM users WHERE id = 1",
                        [],
                        |r| r.get::<_, bool>(0),
                    )
                    .unwrap_or(false))
            })
            .unwrap_or(false);

            if !has_pin {
                let state = app.state::<AuthState>();
                *state.0.lock().unwrap() = true;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth
            get_user,
            update_user,
            set_pin,
            remove_pin,
            verify_pin,
            lock_app,
            is_unlocked,
            // Projects
            get_projects,
            create_project,
            update_project,
            delete_project,
            // Sites
            commands::sites::get_sites,
            commands::sites::create_site,
            commands::sites::update_site,
            commands::sites::delete_site,
            // Credentials
            save_credential,
            get_all_credential_statuses,
            delete_credential,
            test_credential,
            import_service_account,
            // DOM Audit
            run_dom_audit,
            get_last_audit,
            commands::dom_audit::check_dom_audit_ready,
            commands::dom_audit::install_dom_audit_deps,
            // MCP
            fetch_mcp_data,
            commands::mcp::get_site_snapshots,
            commands::mcp::list_gsc_sites,
            commands::mcp::list_bwt_sites,
            commands::mcp::detect_ga4_property,
            commands::mcp::fetch_gsc_timeseries,
            commands::mcp::fetch_ga4_timeseries,
            commands::mcp::fetch_bwt_timeseries,
            commands::mcp::debug_bwt,
            commands::mcp::debug_clarity,
            // Clarity rate-limit
            get_clarity_usage,
            // Per-site Clarity token
            save_site_clarity_token,
            delete_site_clarity_token,
            get_site_clarity_status,
        ])
        .run(tauri::generate_context!())
        .expect("Error running SYNIO SEO Hub");
}
