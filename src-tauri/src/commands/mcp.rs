use tauri::command;
use serde::{Deserialize, Serialize};
use crate::db;
use crate::commands::credentials::get_secret;
use crate::models::credential::McpService;
use chrono::Utc;

#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub source: String,
    pub data: serde_json::Value,
    pub fetched_at: String,
}

/// Fetch live data from an MCP source and store it as a snapshot.
#[command]
pub async fn fetch_mcp_data(
    source: String,
    site_id: i64,
    _params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    match source.as_str() {
        "psi"     => fetch_psi(site_id).await,
        "bwt"     => fetch_bwt(site_id).await,
        "gsc"     => fetch_gsc(site_id).await,
        "ga4"     => fetch_ga4(site_id).await,
        "clarity" => fetch_clarity(site_id).await,
        "openpagerank" => fetch_openpagerank(site_id).await,
        other     => Err(format!("Unknown MCP source: '{other}'")),
    }
}

/// Return the latest snapshot per source for a site.
#[command]
pub fn get_site_snapshots(site_id: i64) -> Result<Vec<Snapshot>, String> {
    db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT source, data, fetched_at
             FROM mcp_snapshots
             WHERE site_id = ?1
               AND id IN (
                 SELECT MAX(id) FROM mcp_snapshots WHERE site_id = ?1 GROUP BY source
               )
             ORDER BY source",
        )?;
        let rows = stmt.query_map([site_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut snaps = Vec::new();
        for row in rows {
            let (source, data_str, fetched_at) = row?;
            let data: serde_json::Value =
                serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Null);
            snaps.push(Snapshot { source, data, fetched_at });
        }
        Ok(snaps)
    })
    .map_err(|e| e.to_string())
}

// ── Shared helpers ────────────────────────────────────────────────────────────

fn snapshot_save(site_id: i64, source: &str, data: &serde_json::Value) -> Result<(), String> {
    db::with_conn(|conn| {
        conn.execute(
            "INSERT INTO mcp_snapshots (site_id, source, data, fetched_at, expires_at)
             VALUES (?1, ?2, ?3, datetime('now'), datetime('now', '+24 hours'))",
            (site_id, source, serde_json::to_string(data).map_err(|e| anyhow::anyhow!(e))?),
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}

/// Percent-encode a URL for embedding in an API path (handles : and / in GSC site URLs)
fn path_encode(s: &str) -> String {
    s.chars().map(|c| match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
        _ => format!("%{:02X}", c as u32),
    }).collect()
}

/// Authenticate with a Google service account JSON and return a short-lived access token.
async fn google_access_token(file_path: &str, scope: &str) -> Result<String, String> {
    let json_str = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Cannot read service account file '{file_path}': {e}"))?;
    let sa: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Invalid service account JSON: {e}"))?;

    let email = sa["client_email"].as_str()
        .ok_or("Missing client_email in service account JSON")?;
    let private_key = sa["private_key"].as_str()
        .ok_or("Missing private_key in service account JSON")?;

    #[derive(Serialize)]
    struct Claims { iss: String, scope: String, aud: String, exp: i64, iat: i64 }

    let now = Utc::now().timestamp();
    let claims = Claims {
        iss:   email.to_string(),
        scope: scope.to_string(),
        aud:   "https://oauth2.googleapis.com/token".to_string(),
        exp:   now + 3600,
        iat:   now,
    };
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_bytes())
        .map_err(|e| format!("Invalid private key in service account: {e}"))?;
    let jwt = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &key,
    ).map_err(|e| format!("JWT signing failed: {e}"))?;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion",  jwt.as_str()),
        ])
        .send().await
        .map_err(|e| format!("Token request failed: {e}"))?;

    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("Token response parse failed: {e}"))?;

    if let Some(err) = body.get("error") {
        return Err(format!(
            "Google OAuth error: {} — {}",
            err.as_str().unwrap_or("unknown"),
            body["error_description"].as_str().unwrap_or("")
        ));
    }
    body["access_token"].as_str()
        .ok_or_else(|| "No access_token in Google OAuth response".to_string())
        .map(|s| s.to_string())
}

/// Read file_path for a service from the credentials DB
fn cred_file_path(service: &str) -> Result<String, String> {
    db::with_conn(|conn| {
        conn.query_row(
            "SELECT file_path FROM credentials WHERE service = ?1 AND file_path IS NOT NULL",
            [service],
            |r| r.get::<_, String>(0),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|_| format!(
        "{} service account JSON not configured. Go to Settings → Credentials.",
        service.to_uppercase()
    ))
}

// ── PSI fetch ─────────────────────────────────────────────────────────────────

/// Parse a PSI JSON response into metrics, opportunities, and diagnostics.
fn parse_psi_metrics(json: &serde_json::Value) -> Result<serde_json::Value, String> {
    if let Some(err) = json.get("error") {
        return Err(format!(
            "PSI API error: {}",
            err.pointer("/message").and_then(|m| m.as_str()).unwrap_or("unknown")
        ));
    }
    let score = json
        .pointer("/lighthouseResult/categories/performance/score")
        .and_then(|v| v.as_f64())
        .map(|s| (s * 100.0).round() as i64)
        .unwrap_or(0);
    let lcp_ms = json
        .pointer("/lighthouseResult/audits/largest-contentful-paint/numericValue")
        .and_then(|v| v.as_f64()).unwrap_or(0.0);
    let cls = json
        .pointer("/lighthouseResult/audits/cumulative-layout-shift/numericValue")
        .and_then(|v| v.as_f64()).unwrap_or(0.0);
    let inp_ms = json
        .pointer("/lighthouseResult/audits/interaction-to-next-paint/numericValue")
        .or_else(|| json.pointer("/lighthouseResult/audits/experimental-interaction-to-next-paint/numericValue"))
        .and_then(|v| v.as_f64()).unwrap_or(0.0);
    let ttfb_ms = json
        .pointer("/lighthouseResult/audits/server-response-time/numericValue")
        .and_then(|v| v.as_f64()).unwrap_or(0.0);

    // Extract LCP element snippet for diagnosis
    let lcp_element = json
        .pointer("/lighthouseResult/audits/largest-contentful-paint-element/details/items/0/node/snippet")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Extract opportunities and diagnostics from auditRefs
    let audit_refs = json
        .pointer("/lighthouseResult/categories/performance/auditRefs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let audits = &json["lighthouseResult"]["audits"];

    let mut opportunities: Vec<serde_json::Value> = Vec::new();
    let mut diagnostics: Vec<serde_json::Value> = Vec::new();

    for audit_ref in &audit_refs {
        let id    = audit_ref["id"].as_str().unwrap_or("");
        let group = audit_ref["group"].as_str().unwrap_or("");
        let audit = &audits[id];
        let score_val = audit["score"].as_f64().unwrap_or(1.0);

        if score_val >= 0.9 { continue; }

        match group {
            "load-opportunities" => {
                let savings_ms = audit
                    .pointer("/details/overallSavingsMs")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                opportunities.push(serde_json::json!({
                    "id":           id,
                    "title":        audit["title"].as_str().unwrap_or(""),
                    "displayValue": audit["displayValue"].as_str().unwrap_or(""),
                    "savingsMs":    (savings_ms).round() as i64,
                }));
            }
            "diagnostics" => {
                diagnostics.push(serde_json::json!({
                    "id":           id,
                    "title":        audit["title"].as_str().unwrap_or(""),
                    "displayValue": audit["displayValue"].as_str().unwrap_or(""),
                }));
            }
            _ => {}
        }
    }

    // Sort opportunities by savings descending
    opportunities.sort_by(|a, b| {
        let a_ms = a["savingsMs"].as_i64().unwrap_or(0);
        let b_ms = b["savingsMs"].as_i64().unwrap_or(0);
        b_ms.cmp(&a_ms)
    });

    Ok(serde_json::json!({
        "score":         score,
        "lcp":           (lcp_ms / 100.0).round() / 10.0,
        "cls":           (cls  * 1000.0).round() / 1000.0,
        "inp":           inp_ms.round() as i64,
        "ttfb":          ttfb_ms.round() as i64,
        "lcpElement":    lcp_element,
        "opportunities": opportunities,
        "diagnostics":   diagnostics,
    }))
}

async fn fetch_psi(site_id: i64) -> Result<serde_json::Value, String> {
    let site_url: String = db::with_conn(|conn| {
        conn.query_row("SELECT url FROM sites WHERE id = ?1", [site_id], |r| r.get(0))
            .map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let api_key = get_secret(&McpService::Psi)
        .ok_or_else(|| "PSI API key not configured. Add it in Settings → Credentials.".to_string())?;

    let client = reqwest::Client::new();

    async fn run_strategy(
        client: &reqwest::Client,
        url: &str,
        key: &str,
        strategy: &str,
    ) -> Result<serde_json::Value, String> {
        let resp = client
            .get("https://www.googleapis.com/pagespeedonline/v5/runPagespeed")
            .query(&[("url", url), ("strategy", strategy), ("key", key), ("category", "performance")])
            .send().await
            .map_err(|e| format!("PSI {strategy} request failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("PSI {strategy} API error {status}: {body}"));
        }
        let json: serde_json::Value = resp.json().await
            .map_err(|e| format!("PSI {strategy} response parse failed: {e}"))?;
        parse_psi_metrics(&json)
    }

    let (mobile, desktop) = tokio::join!(
        run_strategy(&client, &site_url, &api_key, "mobile"),
        run_strategy(&client, &site_url, &api_key, "desktop"),
    );

    let data = serde_json::json!({
        "mobile":  mobile?,
        "desktop": desktop?,
    });

    snapshot_save(site_id, "psi", &data)?;
    Ok(data)
}

// ── BWT fetch ─────────────────────────────────────────────────────────────────

async fn fetch_bwt(site_id: i64) -> Result<serde_json::Value, String> {
    let (site_url, bwt_prop): (String, Option<String>) = db::with_conn(|conn| {
        conn.query_row(
            "SELECT url, bwt_property FROM sites WHERE id = ?1",
            [site_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let site_url = bwt_prop.unwrap_or(site_url);

    let api_key = get_secret(&McpService::Bwt)
        .ok_or_else(|| "BWT API key not configured. Add it in Settings → Credentials.".to_string())?;

    let now = Utc::now();
    let end_date   = now.format("%Y%m%d").to_string();
    let start_date = (now - chrono::Duration::days(30)).format("%Y%m%d").to_string();

    let client = reqwest::Client::new();
    let resp = client
        .get("https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats")
        .query(&[
            ("apikey",    api_key.as_str()),
            ("siteUrl",   site_url.as_str()),
            ("startDate", start_date.as_str()),
            ("endDate",   end_date.as_str()),
        ])
        .send().await
        .map_err(|e| format!("BWT request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("BWT API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("BWT response parse failed: {e}"))?;

    // BWT returns either {"d":{"Results":[...]}} or {"d":[...]} depending on the endpoint version
    let results = json.pointer("/d/Results")
        .and_then(|r| r.as_array())
        .or_else(|| json["d"].as_array())
        .ok_or_else(|| format!("Unexpected BWT response: {json}"))?;

    let mut total_clicks      = 0i64;
    let mut total_impressions = 0i64;
    let mut total_position    = 0.0f64;
    let count = results.len() as f64;

    for r in results {
        total_clicks      += r["Clicks"].as_i64().unwrap_or(0);
        total_impressions += r["Impressions"].as_i64().unwrap_or(0);
        total_position    += r["Position"].as_f64().unwrap_or(0.0);
    }

    let ctr = if total_impressions > 0 {
        (total_clicks as f64 / total_impressions as f64 * 1000.0).round() / 10.0
    } else { 0.0 };

    // Fetch top queries + top pages in parallel (best-effort)
    let (queries_json, pages_json) = tokio::join!(
        async {
            let r = client
                .get("https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats")
                .query(&[("apikey", api_key.as_str()), ("siteUrl", site_url.as_str())])
                .send().await;
            match r {
                Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok(),
                _ => None,
            }
        },
        async {
            let r = client
                .get("https://ssl.bing.com/webmaster/api.svc/json/GetPageStats")
                .query(&[("apikey", api_key.as_str()), ("siteUrl", site_url.as_str())])
                .send().await;
            match r {
                Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok(),
                _ => None,
            }
        }
    );

    let bwt_rows = |j: Option<&serde_json::Value>| -> Vec<serde_json::Value> {
        j.and_then(|j| j.pointer("/d/Results").and_then(|r| r.as_array())
            .or_else(|| j["d"].as_array()))
         .cloned()
         .unwrap_or_default()
    };

    // Aggregate rows by Query (API returns one row per query+date)
    let mut query_map: std::collections::HashMap<String, (i64, i64, Vec<f64>)> = std::collections::HashMap::new();
    for r in bwt_rows(queries_json.as_ref()) {
        let kw = r["Query"].as_str().unwrap_or("").to_string();
        if kw.is_empty() { continue; }
        let clicks      = r["Clicks"].as_i64().unwrap_or(0);
        let impressions = r["Impressions"].as_i64().unwrap_or(0);
        // AvgClickPosition is -1 when no clicks — fall back to AvgImpressionPosition
        let pos = r["AvgClickPosition"].as_f64()
            .filter(|&p| p >= 0.0)
            .or_else(|| r["AvgImpressionPosition"].as_f64().filter(|&p| p >= 0.0));
        let entry = query_map.entry(kw).or_insert((0, 0, Vec::new()));
        entry.0 += clicks;
        entry.1 += impressions;
        if let Some(p) = pos { entry.2.push(p); }
    }
    let mut kw_vec: Vec<(&String, &(i64, i64, Vec<f64>))> = query_map.iter().collect();
    kw_vec.sort_by(|a, b| b.1.1.cmp(&a.1.1)); // sort by impressions desc

    let keywords: Vec<serde_json::Value> = kw_vec.iter().take(25).map(|(kw, (clicks, impressions, positions))| {
        let ctr_kw = if *impressions > 0 { *clicks as f64 / *impressions as f64 * 100.0 } else { 0.0 };
        let avg_kw_pos = if positions.is_empty() { 0.0 }
            else { positions.iter().sum::<f64>() / positions.len() as f64 };
        serde_json::json!({
            "keyword":     kw,
            "clicks":      clicks,
            "impressions": impressions,
            "ctr":         (ctr_kw * 10.0).round() / 10.0,
            "position":    (avg_kw_pos * 10.0).round() / 10.0,
        })
    }).collect();

    let top_pages: Vec<serde_json::Value> = bwt_rows(pages_json.as_ref())
        .iter().take(10).map(|r| serde_json::json!({
            "url":         r["Page"].as_str().unwrap_or(""),
            "clicks":      r["Clicks"].as_i64().unwrap_or(0),
            "impressions": r["Impressions"].as_i64().unwrap_or(0),
        })).collect();

    // Derive global avg position from aggregated query data
    let all_positions: Vec<f64> = query_map.values()
        .flat_map(|(_, _, positions)| positions.iter().copied())
        .collect();
    let avg_pos = if all_positions.is_empty() { 0.0 }
        else { (all_positions.iter().sum::<f64>() / all_positions.len() as f64 * 10.0).round() / 10.0 };

    let data = serde_json::json!({
        "clicks":      total_clicks,
        "impressions": total_impressions,
        "ctr":         ctr,
        "position":    avg_pos,
        "crawlErrors": 0,
        "keywords":    keywords,
        "topPages":    top_pages,
    });

    snapshot_save(site_id, "bwt", &data)?;
    Ok(data)
}

// ── GSC fetch ─────────────────────────────────────────────────────────────────

async fn fetch_gsc(site_id: i64) -> Result<serde_json::Value, String> {
    let (site_url, gsc_prop): (String, Option<String>) = db::with_conn(|conn| {
        conn.query_row(
            "SELECT url, gsc_property FROM sites WHERE id = ?1",
            [site_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let gsc_property = gsc_prop.unwrap_or(site_url);
    let file_path    = cred_file_path("gsc")?;
    let token        = google_access_token(
        &file_path,
        "https://www.googleapis.com/auth/webmasters.readonly",
    ).await?;

    let now = Utc::now();
    let end_date   = now.format("%Y-%m-%d").to_string();
    let start_date = (now - chrono::Duration::days(30)).format("%Y-%m-%d").to_string();

    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",
            path_encode(&gsc_property)
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "startDate": start_date,
            "endDate":   end_date,
            "dimensions": [],
            "rowLimit":  1,
        }))
        .send().await
        .map_err(|e| format!("GSC request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GSC API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("GSC response parse failed: {e}"))?;

    let row = json["rows"].as_array()
        .and_then(|rows| rows.first())
        .ok_or_else(|| "No GSC data for this property — verify the service account has been added as a user in Search Console.".to_string())?;

    // Fetch top keywords (dimensions: query) — errors are silently ignored
    let kw_json: serde_json::Value = async {
        let r = client
            .post(format!(
                "https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",
                path_encode(&gsc_property)
            ))
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "startDate": start_date,
                "endDate":   end_date,
                "dimensions": ["query"],
                "rowLimit":  25,
            }))
            .send().await?;
        if r.status().is_success() { r.json::<serde_json::Value>().await } else { Ok(serde_json::json!({})) }
    }.await.unwrap_or(serde_json::json!({}));

    let keywords: Vec<serde_json::Value> = kw_json["rows"].as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| serde_json::json!({
            "keyword":     r["keys"].as_array().and_then(|k| k.first()).and_then(|v| v.as_str()).unwrap_or(""),
            "clicks":      r["clicks"].as_f64().unwrap_or(0.0).round() as i64,
            "impressions": r["impressions"].as_f64().unwrap_or(0.0).round() as i64,
            "ctr":         (r["ctr"].as_f64().unwrap_or(0.0) * 100.0 * 10.0).round() / 10.0,
            "position":    (r["position"].as_f64().unwrap_or(0.0) * 10.0).round() / 10.0,
        }))
        .collect();

    let data = serde_json::json!({
        "clicks":      row["clicks"].as_f64().unwrap_or(0.0).round() as i64,
        "impressions": row["impressions"].as_f64().unwrap_or(0.0).round() as i64,
        "ctr":         (row["ctr"].as_f64().unwrap_or(0.0) * 100.0 * 10.0).round() / 10.0,
        "position":    (row["position"].as_f64().unwrap_or(0.0) * 10.0).round() / 10.0,
        "keywords":    keywords,
    });

    snapshot_save(site_id, "gsc", &data)?;
    Ok(data)
}

// ── GA4 fetch ─────────────────────────────────────────────────────────────────

async fn fetch_ga4(site_id: i64) -> Result<serde_json::Value, String> {
    let ga4_property: Option<String> = db::with_conn(|conn| {
        conn.query_row(
            "SELECT ga4_property FROM sites WHERE id = ?1",
            [site_id],
            |r| r.get(0),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let property_id = ga4_property
        .ok_or("GA4 property ID not set for this site. Edit the site and enter the numeric property ID.")?;

    let file_path = cred_file_path("ga4")?;
    let token     = google_access_token(
        &file_path,
        "https://www.googleapis.com/auth/analytics.readonly",
    ).await?;

    let client = reqwest::Client::new();

    // Total metrics request
    let resp = client
        .post(format!(
            "https://analyticsdata.googleapis.com/v1beta/properties/{}:runReport",
            property_id
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "dateRanges": [{"startDate": "30daysAgo", "endDate": "today"}],
            "metrics": [
                {"name": "sessions"},
                {"name": "totalUsers"},
                {"name": "conversions"},
                {"name": "engagementRate"},
                {"name": "bounceRate"},
            ],
        }))
        .send().await
        .map_err(|e| format!("GA4 request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GA4 API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("GA4 response parse failed: {e}"))?;

    // No rows = property exists but has no data in the last 30 days — return zeros instead of error
    let empty_row = serde_json::json!({"metricValues": []});
    let row = json["rows"].as_array()
        .and_then(|rows| rows.first())
        .unwrap_or(&empty_row);

    let mv = row["metricValues"].as_array()
        .ok_or("Invalid GA4 response structure")?;

    fn metric(mv: &[serde_json::Value], i: usize) -> f64 {
        mv.get(i)
            .and_then(|m| m["value"].as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0)
    }

    // Organic sessions — separate filtered request
    let organic_resp = client
        .post(format!(
            "https://analyticsdata.googleapis.com/v1beta/properties/{}:runReport",
            property_id
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "dateRanges": [{"startDate": "30daysAgo", "endDate": "today"}],
            "metrics": [{"name": "sessions"}],
            "dimensionFilter": {
                "filter": {
                    "fieldName": "sessionDefaultChannelGroup",
                    "stringFilter": {"value": "Organic Search"},
                }
            },
        }))
        .send().await
        .map_err(|e| format!("GA4 organic request failed: {e}"))?;

    let organic_json: serde_json::Value = organic_resp.json().await.unwrap_or(serde_json::json!({}));
    let organic_sessions = organic_json["rows"].as_array()
        .and_then(|rows| rows.first())
        .and_then(|r| r["metricValues"].as_array())
        .and_then(|mv| mv.first())
        .and_then(|m| m["value"].as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0)
        .round() as i64;

    let data = serde_json::json!({
        "sessions":       metric(mv, 0).round() as i64,
        "users":          metric(mv, 1).round() as i64,
        "conversions":    metric(mv, 2).round() as i64,
        "engagementRate": (metric(mv, 3) * 100.0 * 10.0).round() / 10.0,
        "bounceRate":     (metric(mv, 4) * 100.0 * 10.0).round() / 10.0,
        "organic":        organic_sessions,
    });

    snapshot_save(site_id, "ga4", &data)?;
    Ok(data)
}

// ── Clarity fetch ─────────────────────────────────────────────────────────────
//
// Uses the Clarity Data Export API (v1). The Bearer token is project-specific —
// generate it in Clarity → Settings → Data Export → Generate new API token.
// The project is identified by the token itself; no projectId is needed in the URL.
//
// Rate limit: 10 requests/project/day. We make 4 requests per fetch (global +
// Device + URL + Source dimensions). The clarity_usage table tracks daily usage
// so the frontend can show a counter and disable the button when limit is reached.

/// Performs a single Clarity API request with an optional dimension breakdown.
async fn clarity_fetch_one(
    client: &reqwest::Client,
    token: &str,
    dimension: Option<&str>,
) -> Result<serde_json::Value, String> {
    const URL: &str = "https://www.clarity.ms/export-data/api/v1/project-live-insights";
    let mut builder = client
        .get(URL)
        .bearer_auth(token)
        .query(&[("numOfDays", "3")]);
    if let Some(dim) = dimension {
        builder = builder.query(&[("dimension1", dim)]);
    }
    let resp = builder.send().await
        .map_err(|e| format!("Clarity request failed: {e}"))?;

    if resp.status().as_u16() == 429 {
        return Err("Clarity API rate limit exceeded (HTTP 429). Try again tomorrow.".into());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body   = resp.text().await.unwrap_or_default();
        return Err(format!("Clarity API error {status}: {body}"));
    }
    resp.json::<serde_json::Value>().await
        .map_err(|e| format!("Clarity response parse failed: {e}"))
}

async fn fetch_clarity(site_id: i64) -> Result<serde_json::Value, String> {
    use crate::commands::clarity as cl;
    use crate::commands::credentials::get_site_clarity_token;

    // Guard against exceeding the daily limit before sending any request
    cl::check_and_reserve(site_id)?;

    // Site-specific token takes priority; global credential is the fallback
    let token = get_site_clarity_token(site_id)
        .or_else(|| get_secret(&McpService::Clarity))
        .ok_or_else(|| "Clarity token not configured for this site. Open Sites → expand the site → set the Clarity token.".to_string())?;

    let client = reqwest::Client::new();

    // Fire all 4 requests concurrently: global metrics + 3 dimension breakdowns
    let (r_global, r_device, r_url, r_source) = tokio::join!(
        clarity_fetch_one(&client, &token, None),
        clarity_fetch_one(&client, &token, Some("Device")),
        clarity_fetch_one(&client, &token, Some("URL")),
        clarity_fetch_one(&client, &token, Some("Source")),
    );

    // All 4 requests were sent — record usage regardless of parse success.
    // We don't charge on 429 (the API rejected us, we're already at limit).
    let is_rate_limited = matches!(&r_global, Err(e) if e.contains("429"));
    if !is_rate_limited {
        let _ = cl::record_usage(site_id, cl::REQUESTS_PER_FETCH);
    }

    // Global must succeed — it drives the main metrics shown in the dashboard
    let global = r_global?;

    // Persist each dimension to clarity_daily for historical accumulation
    let _ = cl::save_daily(site_id, "global", &global);
    let device_data = r_device.ok().map(|d| { let _ = cl::save_daily(site_id, "Device", &d); d });
    let url_data    = r_url.ok().map(|d|    { let _ = cl::save_daily(site_id, "URL",    &d); d });
    let source_data = r_source.ok().map(|d| { let _ = cl::save_daily(site_id, "Source", &d); d });

    // ── Parse global metrics ──────────────────────────────────────────────────
    // Field names verified against debug_clarity output. If values come back 0,
    // run debug_clarity to inspect the raw response and adjust field names below.
    let metrics = global.as_array().cloned().unwrap_or_default();

    let sum_metric = |metric_name: &str, field: &str| -> i64 {
        metrics.iter()
            .find(|m| m["metricName"].as_str() == Some(metric_name))
            .and_then(|m| m["information"].as_array())
            .map(|arr| arr.iter().filter_map(|e| {
                e[field].as_i64().or_else(|| e[field].as_str()?.parse().ok())
            }).sum())
            .unwrap_or(0)
    };

    let avg_metric = |metric_name: &str, field: &str| -> f64 {
        let vals: Vec<f64> = metrics.iter()
            .find(|m| m["metricName"].as_str() == Some(metric_name))
            .and_then(|m| m["information"].as_array())
            .map(|arr| arr.iter().filter_map(|e| {
                e[field].as_f64().or_else(|| e[field].as_str()?.parse().ok())
            }).collect())
            .unwrap_or_default();
        if vals.is_empty() { 0.0 } else { vals.iter().sum::<f64>() / vals.len() as f64 }
    };

    let sessions          = sum_metric("Traffic",            "totalSessionCount");
    let bots              = sum_metric("Traffic",            "totalBotSessionCount");
    let users             = sum_metric("Traffic",            "distantUserCount");
    let rage_clicks       = sum_metric("Rage Click Count",   "rageClickCount");
    let dead_clicks       = sum_metric("Dead Click Count",   "deadClickCount");
    let quick_backs       = sum_metric("Quickback Click",    "quickbackClickCount");
    let script_errors     = sum_metric("Script Error Count", "scriptErrorCount");
    let pages_per_session = avg_metric("Traffic",            "PagesPerSessionPercentage");
    let scroll_depth      = avg_metric("Scroll Depth",       "scrollDepthPercentage");
    let engage_time       = avg_metric("Engagement Time",    "avgEngagementTimeInSeconds");

    // ── Device breakdown ──────────────────────────────────────────────────────
    let by_device: Vec<serde_json::Value> = device_data
        .and_then(|d| {
            d.as_array()?
                .iter()
                .find(|m| m["metricName"].as_str() == Some("Traffic"))
                .and_then(|m| m["information"].as_array())
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .map(|e| serde_json::json!({
            "device":   e["Device"].as_str().unwrap_or(""),
            "sessions": e["totalSessionCount"].as_i64()
                .or_else(|| e["totalSessionCount"].as_str()?.parse().ok())
                .unwrap_or(0),
        }))
        .collect();

    // ── Top pages (capped at 20) ───────────────────────────────────────────────
    let top_pages: Vec<serde_json::Value> = url_data
        .and_then(|d| {
            d.as_array()?
                .iter()
                .find(|m| m["metricName"].as_str() == Some("Traffic"))
                .and_then(|m| m["information"].as_array())
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .take(20)
        .map(|e| serde_json::json!({
            "url":      e["URL"].as_str().unwrap_or(""),
            "sessions": e["totalSessionCount"].as_i64()
                .or_else(|| e["totalSessionCount"].as_str()?.parse().ok())
                .unwrap_or(0),
        }))
        .collect();

    // ── Traffic sources ────────────────────────────────────────────────────────
    let by_source: Vec<serde_json::Value> = source_data
        .and_then(|d| {
            d.as_array()?
                .iter()
                .find(|m| m["metricName"].as_str() == Some("Traffic"))
                .and_then(|m| m["information"].as_array())
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .map(|e| serde_json::json!({
            "source":   e["Source"].as_str().unwrap_or(""),
            "sessions": e["totalSessionCount"].as_i64()
                .or_else(|| e["totalSessionCount"].as_str()?.parse().ok())
                .unwrap_or(0),
        }))
        .collect();

    let data = serde_json::json!({
        "sessions":       sessions,
        "bots":           bots,
        "users":          users,
        "pagesPerSession": (pages_per_session * 100.0).round() / 100.0,
        "rageclicks":     rage_clicks,
        "deadClicks":     dead_clicks,
        "quickBacks":     quick_backs,
        "scriptErrors":   script_errors,
        "scrollDepth":    (scroll_depth * 10.0).round() / 10.0,
        "engageTime":     (engage_time  * 10.0).round() / 10.0,
        "period":         "3d",
        "byDevice":       by_device,
        "topPages":       top_pages,
        "bySources":      by_source,
    });

    snapshot_save(site_id, "clarity", &data)?;
    Ok(data)
}

// ── OpenPageRank fetch ────────────────────────────────────────────────────────

async fn fetch_openpagerank(site_id: i64) -> Result<serde_json::Value, String> {
    let domain: String = db::with_conn(|conn| {
        conn.query_row(
            "SELECT domain FROM sites WHERE id = ?1",
            [site_id],
            |r| r.get(0),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let api_key = get_secret(&crate::models::credential::McpService::OpenPageRank)
        .ok_or_else(|| "OpenPageRank API key not configured. Add it in Settings → Credentials.".to_string())?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://openpagerank.com/api/v1.0/getPageRank")
        .header("API-OPR", api_key.as_str())
        .query(&[("domains[0]", domain.as_str())])
        .send().await
        .map_err(|e| format!("OpenPageRank request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("OpenPageRank API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("OpenPageRank response parse failed: {e}"))?;

    let entry = json["response"].as_array()
        .and_then(|arr| arr.first())
        .ok_or_else(|| format!("Unexpected OpenPageRank response: {json}"))?;

    let page_rank   = entry["page_rank_integer"].as_i64().unwrap_or(0);
    let pr_decimal  = entry["page_rank_decimal"].as_f64().unwrap_or(0.0);
    let rank        = entry["rank"].as_str().unwrap_or("").to_string();

    let data = serde_json::json!({
        "pageRank":    page_rank,
        "prDecimal":   (pr_decimal * 100.0).round() / 100.0,
        "domainRank":  rank,
        "domain":      domain,
    });

    snapshot_save(site_id, "openpagerank", &data)?;
    Ok(data)
}

// ── GSC Timeseries ─────────────────────────────────────────────────────────────

/// Fetch daily GSC search analytics for a date range (days back from today).
#[command]
pub async fn fetch_gsc_timeseries(site_id: i64, days: i64) -> Result<Vec<serde_json::Value>, String> {
    let (site_url, gsc_prop): (String, Option<String>) = db::with_conn(|conn| {
        conn.query_row(
            "SELECT url, gsc_property FROM sites WHERE id = ?1",
            [site_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let gsc_property = gsc_prop.unwrap_or(site_url);
    let file_path    = cred_file_path("gsc")?;
    let token        = google_access_token(
        &file_path,
        "https://www.googleapis.com/auth/webmasters.readonly",
    ).await?;

    let now = Utc::now();
    let end_date   = now.format("%Y-%m-%d").to_string();
    let start_date = (now - chrono::Duration::days(days - 1)).format("%Y-%m-%d").to_string();

    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",
            path_encode(&gsc_property)
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "startDate": start_date,
            "endDate":   end_date,
            "dimensions": ["date"],
            "rowLimit": 500,
        }))
        .send().await
        .map_err(|e| format!("GSC timeseries request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GSC API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("GSC timeseries parse failed: {e}"))?;

    let rows: Vec<serde_json::Value> = json["rows"].as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| serde_json::json!({
            "date":        r["keys"].as_array().and_then(|k| k.first()).and_then(|v| v.as_str()).unwrap_or(""),
            "clicks":      r["clicks"].as_f64().unwrap_or(0.0).round() as i64,
            "impressions": r["impressions"].as_f64().unwrap_or(0.0).round() as i64,
            "ctr":         (r["ctr"].as_f64().unwrap_or(0.0) * 100.0 * 10.0).round() / 10.0,
            "position":    (r["position"].as_f64().unwrap_or(0.0) * 10.0).round() / 10.0,
        }))
        .collect();

    Ok(rows)
}

// ── GA4 Timeseries ─────────────────────────────────────────────────────────────

/// Fetch daily GA4 metrics for a date range (days back from today).
#[command]
pub async fn fetch_ga4_timeseries(site_id: i64, days: i64) -> Result<Vec<serde_json::Value>, String> {
    let ga4_property: Option<String> = db::with_conn(|conn| {
        conn.query_row(
            "SELECT ga4_property FROM sites WHERE id = ?1",
            [site_id],
            |r| r.get(0),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let property_id = ga4_property
        .ok_or("GA4 property ID not set for this site. Edit the site and enter the numeric property ID.")?;

    let file_path = cred_file_path("ga4")?;
    let token     = google_access_token(
        &file_path,
        "https://www.googleapis.com/auth/analytics.readonly",
    ).await?;

    let client   = reqwest::Client::new();
    let start_dt = format!("{}daysAgo", days - 1);

    let resp = client
        .post(format!(
            "https://analyticsdata.googleapis.com/v1beta/properties/{}:runReport",
            property_id
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "dateRanges": [{"startDate": start_dt, "endDate": "today"}],
            "dimensions": [{"name": "date"}],
            "metrics": [
                {"name": "sessions"},
                {"name": "totalUsers"},
                {"name": "conversions"},
                {"name": "engagementRate"},
                {"name": "bounceRate"},
            ],
            "orderBys": [{"dimension": {"dimensionName": "date"}}],
            "limit": 500,
        }))
        .send().await
        .map_err(|e| format!("GA4 timeseries request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GA4 API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("GA4 timeseries parse failed: {e}"))?;

    // Organic sessions by date
    let organic_resp = client
        .post(format!(
            "https://analyticsdata.googleapis.com/v1beta/properties/{}:runReport",
            property_id
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "dateRanges": [{"startDate": start_dt, "endDate": "today"}],
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": "sessions"}],
            "dimensionFilter": {
                "filter": {
                    "fieldName": "sessionDefaultChannelGroup",
                    "stringFilter": {"value": "Organic Search"},
                }
            },
            "orderBys": [{"dimension": {"dimensionName": "date"}}],
            "limit": 500,
        }))
        .send().await;

    let mut organic_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    if let Ok(r) = organic_resp {
        if let Ok(oj) = r.json::<serde_json::Value>().await {
            for row in oj["rows"].as_array().unwrap_or(&vec![]) {
                let raw = row["dimensionValues"].as_array()
                    .and_then(|d| d.first())
                    .and_then(|v| v["value"].as_str())
                    .unwrap_or("").to_string();
                let s = row["metricValues"].as_array()
                    .and_then(|m| m.first())
                    .and_then(|v| v["value"].as_str())
                    .and_then(|s| s.parse::<f64>().ok())
                    .map(|f| f.round() as i64)
                    .unwrap_or(0);
                organic_map.insert(raw, s);
            }
        }
    }

    fn metric_val(row: &serde_json::Value, i: usize) -> f64 {
        row["metricValues"].as_array()
            .and_then(|mv| mv.get(i))
            .and_then(|m| m["value"].as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0)
    }

    let rows: Vec<serde_json::Value> = json["rows"].as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| {
            let raw = r["dimensionValues"].as_array()
                .and_then(|d| d.first())
                .and_then(|v| v["value"].as_str())
                .unwrap_or("");
            // GA4 returns YYYYMMDD — normalise to YYYY-MM-DD
            let date = if raw.len() == 8 {
                format!("{}-{}-{}", &raw[0..4], &raw[4..6], &raw[6..8])
            } else {
                raw.to_string()
            };
            let organic = organic_map.get(raw).copied().unwrap_or(0);
            serde_json::json!({
                "date":           date,
                "sessions":       metric_val(r, 0).round() as i64,
                "users":          metric_val(r, 1).round() as i64,
                "conversions":    metric_val(r, 2).round() as i64,
                "engagementRate": (metric_val(r, 3) * 100.0 * 10.0).round() / 10.0,
                "bounceRate":     (metric_val(r, 4) * 100.0 * 10.0).round() / 10.0,
                "organic":        organic,
            })
        })
        .collect();

    Ok(rows)
}

// ── Site discovery ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct Ga4PropertyMatch {
    pub property_id: String,
    pub display_name: String,
}

/// Match a site's domain against GA4 data streams and persist the property ID.
/// Calls Analytics Admin API: accountSummaries → dataStreams per property.
#[command]
pub async fn detect_ga4_property(site_id: i64) -> Result<Ga4PropertyMatch, String> {
    let domain: String = db::with_conn(|conn| {
        conn.query_row(
            "SELECT domain FROM sites WHERE id = ?1",
            [site_id],
            |r| r.get(0),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let file_path = cred_file_path("ga4")?;
    let token = google_access_token(
        &file_path,
        "https://www.googleapis.com/auth/analytics.readonly",
    ).await?;

    let client = reqwest::Client::new();

    let resp = client
        .get("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")
        .bearer_auth(&token)
        .send().await
        .map_err(|e| format!("GA4 accountSummaries request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "GA4 Admin API error {status}: {body}\n\nMake sure 'Analytics Admin API' is enabled in Google Cloud."
        ));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("GA4 accountSummaries parse failed: {e}"))?;

    // Collect all (property_id, display_name) pairs
    let mut properties: Vec<(String, String)> = Vec::new();
    for account in json["accountSummaries"].as_array().unwrap_or(&vec![]) {
        for prop in account["propertySummaries"].as_array().unwrap_or(&vec![]) {
            if let (Some(property), Some(name)) = (
                prop["property"].as_str(),
                prop["displayName"].as_str(),
            ) {
                let id = property.strip_prefix("properties/").unwrap_or(property);
                properties.push((id.to_string(), name.to_string()));
            }
        }
    }

    if properties.is_empty() {
        return Err("No GA4 properties found. Make sure the service account has access to at least one GA4 property.".to_string());
    }

    // Collect ALL properties whose data streams match the domain
    let mut matches: Vec<Ga4PropertyMatch> = Vec::new();

    for (property_id, display_name) in &properties {
        let streams_resp = client
            .get(format!(
                "https://analyticsadmin.googleapis.com/v1beta/properties/{}/dataStreams",
                property_id
            ))
            .bearer_auth(&token)
            .send().await;

        let streams_json = match streams_resp {
            Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.unwrap_or_default(),
            _ => continue,
        };

        for stream in streams_json["dataStreams"].as_array().unwrap_or(&vec![]) {
            if let Some(uri) = stream.pointer("/webStreamData/defaultUri").and_then(|v| v.as_str()) {
                if uri_matches_domain(uri, &domain) {
                    matches.push(Ga4PropertyMatch {
                        property_id: property_id.clone(),
                        display_name: display_name.clone(),
                    });
                    break; // one match per property is enough
                }
            }
        }
    }

    match matches.len() {
        0 => Err(format!(
            "No GA4 property found with a data stream matching '{domain}'. \
            Verify the data stream URL is configured correctly in GA4 Admin."
        )),
        1 => {
            let m = matches.remove(0);
            db::with_conn(|conn| {
                conn.execute(
                    "UPDATE sites SET ga4_property = ?1, updated_at = datetime('now') WHERE id = ?2",
                    (m.property_id.as_str(), site_id),
                ).map_err(|e| anyhow::anyhow!(e))?;
                Ok(())
            }).map_err(|e| e.to_string())?;
            Ok(m)
        }
        _ => Err(format!(
            "Multiple GA4 properties match '{domain}': {}. \
            Fix the data stream URLs in GA4 Admin so only one property matches this domain.",
            matches.iter().map(|m| format!("{} ({})", m.display_name, m.property_id)).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn uri_matches_domain(uri: &str, domain: &str) -> bool {
    let host = uri
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .split('/')
        .next()
        .unwrap_or("");
    host == domain || host == format!("www.{}", domain)
}

/// List all GSC properties the service account has access to.
/// Returns [{siteUrl, permissionLevel}]
#[command]
pub async fn list_gsc_sites() -> Result<Vec<serde_json::Value>, String> {
    let file_path = cred_file_path("gsc")?;
    let token = google_access_token(
        &file_path,
        "https://www.googleapis.com/auth/webmasters.readonly",
    ).await?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://www.googleapis.com/webmasters/v3/sites")
        .bearer_auth(&token)
        .send().await
        .map_err(|e| format!("GSC sites request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GSC API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("GSC response parse failed: {e}"))?;

    let sites = json["siteEntry"].as_array()
        .cloned()
        .unwrap_or_default();

    Ok(sites)
}

/// Debug command: returns raw BWT API responses for GetRankAndTrafficStats,
/// GetKeywordStats, and GetSEOStats so the caller can inspect the exact payloads.
#[command]
pub async fn debug_bwt(site_id: i64) -> Result<serde_json::Value, String> {
    let (site_url, bwt_prop): (String, Option<String>) = db::with_conn(|conn| {
        conn.query_row(
            "SELECT url, bwt_property FROM sites WHERE id = ?1",
            [site_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|e| anyhow::anyhow!(e))
    }).map_err(|e| e.to_string())?;

    let site_url = bwt_prop.unwrap_or(site_url);

    let api_key = get_secret(&McpService::Bwt)
        .ok_or_else(|| "BWT API key not configured.".to_string())?;

    let now = Utc::now();
    let end_date   = now.format("%Y%m%d").to_string();
    let start_date = (now - chrono::Duration::days(30)).format("%Y%m%d").to_string();

    let client = reqwest::Client::new();

    // Run all three calls concurrently; capture text so we see errors too
    let (rank_raw, kw_raw, seo_raw) = tokio::join!(
        async {
            match client
                .get("https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats")
                .query(&[
                    ("apikey",    api_key.as_str()),
                    ("siteUrl",   site_url.as_str()),
                    ("startDate", start_date.as_str()),
                    ("endDate",   end_date.as_str()),
                ])
                .send().await
            {
                Ok(r) => {
                    let status = r.status().as_u16();
                    let body = r.text().await.unwrap_or_default();
                    serde_json::json!({ "status": status, "body": body })
                }
                Err(e) => serde_json::json!({ "error": e.to_string() }),
            }
        },
        async {
            match client
                .get("https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats")
                .query(&[("apikey", api_key.as_str()), ("siteUrl", site_url.as_str())])
                .send().await
            {
                Ok(r) => {
                    let status = r.status().as_u16();
                    let body = r.text().await.unwrap_or_default();
                    serde_json::json!({ "status": status, "body": body })
                }
                Err(e) => serde_json::json!({ "error": e.to_string() }),
            }
        },
        async {
            match client
                .get("https://ssl.bing.com/webmaster/api.svc/json/GetPageStats")
                .query(&[("apikey", api_key.as_str()), ("siteUrl", site_url.as_str())])
                .send().await
            {
                Ok(r) => {
                    let status = r.status().as_u16();
                    let body = r.text().await.unwrap_or_default();
                    serde_json::json!({ "status": status, "body": body })
                }
                Err(e) => serde_json::json!({ "error": e.to_string() }),
            }
        }
    );

    Ok(serde_json::json!({
        "siteUrl":              site_url,
        "startDate":            start_date,
        "endDate":              end_date,
        "GetRankAndTrafficStats": rank_raw,
        "GetQueryStats":        kw_raw,
        "GetPageStats":         seo_raw,
    }))
}

/// Debug command: returns the raw Clarity API response so field names can be verified.
#[command]
pub async fn debug_clarity() -> Result<serde_json::Value, String> {
    let token = get_secret(&McpService::Clarity)
        .ok_or_else(|| "Clarity API token not configured.".to_string())?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://www.clarity.ms/export-data/api/v1/project-live-insights")
        .bearer_auth(&token)
        .query(&[("numOfDays", "3")])
        .send().await
        .map_err(|e| format!("Clarity request failed: {e}"))?;

    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();

    // Try to parse as JSON for readability; fall back to raw string
    let parsed = serde_json::from_str::<serde_json::Value>(&body)
        .unwrap_or_else(|_| serde_json::json!({ "raw": body }));

    Ok(serde_json::json!({
        "status": status,
        "body":   parsed,
    }))
}

/// Return accumulated BWT snapshots as a timeseries (one point per refresh).
/// Reads from mcp_snapshots rows for source='bwt', newest `days` days.
#[command]
pub fn fetch_bwt_timeseries(site_id: i64, days: i64) -> Result<Vec<serde_json::Value>, String> {
    db::with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT data, fetched_at
             FROM mcp_snapshots
             WHERE site_id = ?1
               AND source   = 'bwt'
               AND fetched_at >= datetime('now', '-' || ?2 || ' days')
             ORDER BY fetched_at ASC",
        )?;
        let rows = stmt.query_map([site_id, days], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut points = Vec::new();
        for row in rows {
            let (data_str, fetched_at) = row?;
            let d: serde_json::Value =
                serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Null);
            // Use the date portion of fetched_at as the x-axis key
            let date = fetched_at.get(..10).unwrap_or("").to_string();
            points.push(serde_json::json!({
                "date":        date,
                "clicks":      d["clicks"].as_i64().unwrap_or(0),
                "impressions": d["impressions"].as_i64().unwrap_or(0),
                "ctr":         d["ctr"].as_f64().unwrap_or(0.0),
                "position":    d["position"].as_f64().unwrap_or(0.0),
            }));
        }
        Ok(points)
    })
    .map_err(|e| e.to_string())
}

/// List all sites registered in Bing Webmaster Tools.
/// Returns ["https://example.com/", ...]
#[command]
pub async fn list_bwt_sites() -> Result<Vec<String>, String> {
    let api_key = get_secret(&McpService::Bwt)
        .ok_or_else(|| "BWT API key not configured. Add it in Settings → Credentials.".to_string())?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://ssl.bing.com/webmaster/api.svc/json/GetUserSites")
        .query(&[("apikey", api_key.as_str())])
        .send().await
        .map_err(|e| format!("BWT request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("BWT API error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("BWT response parse failed: {e}"))?;

    // Response: { "d": ["https://example.com/", ...] }
    let sites = json["d"].as_array()
        .map(|arr| arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect())
        .unwrap_or_default();

    Ok(sites)
}
