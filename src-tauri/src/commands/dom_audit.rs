use crate::db;
use crate::models::audit::*;
use anyhow::Result;
use std::process::Command;
use tauri::Manager;

/// JavaScript injected into the page by Playwright to extract all SEO-relevant DOM nodes
const DOM_EXTRACT_SCRIPT: &str = r#"
() => {
  const head = document.head;
  const get = (sel) => document.querySelector(sel);
  const getAll = (sel) => Array.from(document.querySelectorAll(sel));
  const attr = (el, a) => el ? el.getAttribute(a) : null;

  // Canonical
  const canonicalEl = get('link[rel="canonical"]');
  const canonical = attr(canonicalEl, 'href');

  // Title
  const title = document.title || null;

  // Meta description
  const metaDesc = attr(get('meta[name="description"]'), 'content');

  // Meta robots
  const metaRobots = attr(get('meta[name="robots"]'), 'content')
    || attr(get('meta[name="googlebot"]'), 'content');

  // H1
  const h1s = getAll('h1');
  const h1_text = h1s[0] ? h1s[0].textContent.trim() : null;

  // Hreflang
  const hreflang_tags = getAll('link[rel="alternate"][hreflang]').map(el => ({
    lang: attr(el, 'hreflang'),
    href: attr(el, 'href'),
  }));

  // Open Graph tags
  const og_tags = {};
  getAll('meta[property^="og:"]').forEach(el => {
    og_tags[attr(el, 'property')] = attr(el, 'content');
  });
  // Twitter cards
  getAll('meta[name^="twitter:"]').forEach(el => {
    og_tags[attr(el, 'name')] = attr(el, 'content');
  });

  // JSON-LD schema types
  const schema_types = getAll('script[type="application/ld+json"]').flatMap(el => {
    try {
      const obj = JSON.parse(el.textContent);
      const types = Array.isArray(obj) ? obj.map(o => o['@type']) : [obj['@type']];
      return types.filter(Boolean);
    } catch { return []; }
  });

  // Invalid head detection — elements that force <head> to end early
  const invalidHeadEls = Array.from(head.children).some(el => {
    const tag = el.tagName.toLowerCase();
    return !['title','base','link','meta','script','style','noscript'].includes(tag);
  });

  return {
    url:             window.location.href,
    canonical,
    title,
    meta_description: metaDesc,
    meta_robots:      metaRobots,
    h1_count:         h1s.length,
    h1_text,
    hreflang_tags,
    og_tags,
    schema_types,
    llms_txt_exists:  false,  // checked separately via fetch
    robots_txt:       null,   // fetched separately
    has_invalid_head: invalidHeadEls,
  };
}
"#;

/// Compute DOM SEO score 0–100 from the payload + issues
fn compute_score(payload: &DomPayload, url: &str) -> (i64, Vec<AuditIssue>) {
    let mut score: i64 = 100;
    let mut issues = Vec::new();

    // ── Canonical ─────────────────────────────────────────────────
    match &payload.canonical {
        None => {
            score -= 15;
            issues.push(AuditIssue {
                severity: IssueSeverity::Critical,
                category: "Canonical".into(),
                message:  "Missing canonical tag".into(),
                fix:      format!("Add <link rel=\"canonical\" href=\"{url}\"> to <head>"),
            });
        }
        Some(c) if c != url => {
            score -= 5;
            issues.push(AuditIssue {
                severity: IssueSeverity::Warning,
                category: "Canonical".into(),
                message:  format!("Canonical points to different URL: {c}"),
                fix:      "Verify if cross-domain canonical is intentional".into(),
            });
        }
        _ => {}
    }

    // ── Title ──────────────────────────────────────────────────────
    match &payload.title {
        None => {
            score -= 20;
            issues.push(AuditIssue {
                severity: IssueSeverity::Critical,
                category: "Title".into(),
                message:  "Missing title tag".into(),
                fix:      "Add a descriptive <title> to <head> (50-60 chars)".into(),
            });
        }
        Some(t) if t.len() < 10 => {
            score -= 5;
            issues.push(AuditIssue {
                severity: IssueSeverity::Warning,
                category: "Title".into(),
                message:  format!("Title too short ({} chars)", t.len()),
                fix:      "Expand title to 50-60 characters with primary keyword".into(),
            });
        }
        Some(t) if t.len() > 60 => {
            score -= 5;
            issues.push(AuditIssue {
                severity: IssueSeverity::Warning,
                category: "Title".into(),
                message:  format!("Title too long ({} chars) — will be truncated in SERP", t.len()),
                fix:      "Shorten title to under 60 characters".into(),
            });
        }
        _ => {}
    }

    // ── Meta Description ───────────────────────────────────────────
    match &payload.meta_description {
        None => {
            score -= 10;
            issues.push(AuditIssue {
                severity: IssueSeverity::Warning,
                category: "Meta Description".into(),
                message:  "Missing meta description".into(),
                fix:      "Add <meta name=\"description\" content=\"...\"> (150-160 chars)".into(),
            });
        }
        Some(d) if d.len() > 160 => {
            score -= 3;
            issues.push(AuditIssue {
                severity: IssueSeverity::Info,
                category: "Meta Description".into(),
                message:  format!("Meta description too long ({} chars)", d.len()),
                fix:      "Trim to 150-160 characters to avoid truncation".into(),
            });
        }
        _ => {}
    }

    // ── H1 ─────────────────────────────────────────────────────────
    if payload.h1_count == 0 {
        score -= 10;
        issues.push(AuditIssue {
            severity: IssueSeverity::Critical,
            category: "Headings".into(),
            message:  "Missing H1 tag".into(),
            fix:      "Add exactly one <h1> with primary keyword".into(),
        });
    } else if payload.h1_count > 1 {
        score -= 5;
        issues.push(AuditIssue {
            severity: IssueSeverity::Warning,
            category: "Headings".into(),
            message:  format!("Multiple H1 tags found ({})", payload.h1_count),
            fix:      "Use only one <h1> per page".into(),
        });
    }

    // ── Meta Robots ────────────────────────────────────────────────
    if let Some(robots) = &payload.meta_robots {
        if robots.contains("noindex") {
            score -= 30;
            issues.push(AuditIssue {
                severity: IssueSeverity::Critical,
                category: "Indexation".into(),
                message:  "Page has noindex directive — blocked from Google".into(),
                fix:      "Remove noindex from meta robots if page should be indexed".into(),
            });
        }
    }

    // ── Schema ─────────────────────────────────────────────────────
    if payload.schema_types.is_empty() {
        score -= 5;
        issues.push(AuditIssue {
            severity: IssueSeverity::Info,
            category: "Schema".into(),
            message:  "No JSON-LD structured data found".into(),
            fix:      "Add relevant schema (FAQPage, LocalBusiness, etc.) to improve AI citation chances".into(),
        });
    }

    // ── llms.txt ───────────────────────────────────────────────────
    if !payload.llms_txt_exists {
        issues.push(AuditIssue {
            severity: IssueSeverity::Info,
            category: "AI Indexing".into(),
            message:  "No /llms.txt found".into(),
            fix:      "Add /llms.txt to guide AI crawlers (Perplexity, Claude, GPT)".into(),
        });
    }

    // ── Invalid head ───────────────────────────────────────────────
    if payload.has_invalid_head {
        score -= 8;
        issues.push(AuditIssue {
            severity: IssueSeverity::Critical,
            category: "HTML".into(),
            message:  "Invalid elements in <head> — may cause canonical/meta to be ignored".into(),
            fix:      "Validate HTML head section and remove non-head elements".into(),
        });
    }

    (score.max(0), issues)
}

fn save_audit(site_id: i64, payload: &DomPayload, issues: &[AuditIssue], score: i64, robots: Option<&str>) -> Result<i64> {
    db::with_conn(|conn| {
        let hreflang_json = serde_json::to_string(&payload.hreflang_tags)?;
        let og_json = serde_json::to_string(&payload.og_tags)?;
        let schema_json = serde_json::to_string(&payload.schema_types)?;
        let issues_json = serde_json::to_string(issues)?;

        conn.execute(
            "INSERT INTO dom_audits (
                site_id, url, canonical, canonical_match, title, title_length,
                meta_description, meta_desc_length, meta_robots, h1_count, h1_text,
                hreflang_tags, og_tags, schema_types, robots_txt, llms_txt,
                has_invalid_head, raw_issues, score
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            rusqlite::params![
                site_id,
                &payload.url,
                &payload.canonical,
                payload.canonical.as_deref().map(|c| c == payload.url),
                &payload.title,
                payload.title.as_ref().map(|t| t.len() as i64),
                &payload.meta_description,
                payload.meta_description.as_ref().map(|d| d.len() as i64),
                &payload.meta_robots,
                payload.h1_count,
                &payload.h1_text,
                &hreflang_json,
                &og_json,
                &schema_json,
                robots,
                payload.llms_txt_exists as i64,
                payload.has_invalid_head as i64,
                &issues_json,
                score,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

/// Returns the directory where playwright is installed for this app.
/// In production: {app_data}/node_modules. In dev fallback: project node_modules.
fn playwright_node_path(app: &tauri::AppHandle) -> String {
    if let Ok(app_data) = app.path().app_data_dir() {
        let p = app_data.join("node_modules");
        if p.join("playwright").exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    String::new()
}

#[tauri::command]
pub fn check_dom_audit_ready(app: tauri::AppHandle) -> bool {
    let Ok(app_data) = app.path().app_data_dir() else { return false };
    app_data.join("node_modules").join("playwright").join("package.json").exists()
}

#[tauri::command]
pub async fn install_dom_audit_deps(app: tauri::AppHandle) -> Result<(), String> {
    let app_data = app.path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?;

    // npm install playwright --prefix {app_data}
    let status = Command::new("npm")
        .args(["install", "playwright", "--prefix", &app_data.to_string_lossy()])
        .status()
        .map_err(|e| format!("npm not found — make sure Node.js is installed: {e}"))?;
    if !status.success() {
        return Err("Failed to install playwright npm package".into());
    }

    // playwright install chromium, store browsers in app data
    let browsers_path = app_data.join("browsers");
    let status = Command::new("node")
        .args(["-e", "require('playwright/install-deps')"])
        .env("NODE_PATH", app_data.join("node_modules"))
        .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_path)
        .status()
        // fallback: use npx
        .or_else(|_| Command::new("npx")
            .args(["playwright", "install", "chromium"])
            .env("NODE_PATH", app_data.join("node_modules"))
            .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_path)
            .status())
        .map_err(|e| format!("Failed to install Chromium: {e}"))?;
    if !status.success() {
        // Try direct playwright binary
        let pw_bin = app_data.join("node_modules").join(".bin").join("playwright");
        Command::new(pw_bin)
            .args(["install", "chromium"])
            .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_path)
            .status()
            .map_err(|e| format!("Failed to install Chromium: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn run_dom_audit(app: tauri::AppHandle, site_id: i64, url: String) -> Result<DomAudit, String> {
    // Build the Node.js one-liner that uses Playwright to extract DOM
    // This approach works without a persistent MCP connection
    let script = format!(
        r#"
const {{ chromium }} = require('playwright');
(async () => {{
  const browser = await chromium.launch({{ headless: true }});
  const page = await browser.newPage();
  await page.goto({url_json}, {{ waitUntil: 'networkidle', timeout: 30000 }});

  const domData = await page.evaluate({script});

  // Fetch robots.txt and llms.txt separately
  const robotsResp = await page.evaluate(async (base) => {{
    try {{
      const r = await fetch(base + '/robots.txt');
      return r.ok ? await r.text() : null;
    }} catch {{ return null; }}
  }}, new URL({url_json}).origin);

  const llmsExists = await page.evaluate(async (base) => {{
    try {{
      const r = await fetch(base + '/llms.txt');
      return r.ok;
    }} catch {{ return false; }}
  }}, new URL({url_json}).origin);

  domData.robots_txt = robotsResp;
  domData.llms_txt_exists = llmsExists;

  await browser.close();
  process.stdout.write(JSON.stringify(domData));
}})();
"#,
        url_json = serde_json::to_string(&url).unwrap(),
        script = DOM_EXTRACT_SCRIPT,
    );

    // Write script to temp file and run with node
    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join(format!("seo-hub-audit-{}.js", uuid::Uuid::new_v4()));
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;

    let node_path = playwright_node_path(&app);
    let app_data = app.path().app_data_dir().ok();
    let browsers_path = app_data.as_ref().map(|d| d.join("browsers"));

    let mut cmd = Command::new("node");
    cmd.arg(&script_path);
    if !node_path.is_empty() {
        cmd.env("NODE_PATH", &node_path);
    }
    if let Some(bp) = &browsers_path {
        cmd.env("PLAYWRIGHT_BROWSERS_PATH", bp);
    }
    let output = cmd.output()
        .map_err(|e| format!("Failed to run Playwright audit: {e}. Make sure Node.js is installed."))?;

    // Cleanup temp script
    let _ = std::fs::remove_file(&script_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Playwright audit failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let payload: DomPayload = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse audit output: {e}\nOutput: {stdout}"))?;

    let (score, issues) = compute_score(&payload, &url);
    let audit_id = save_audit(site_id, &payload, &issues, score, payload.robots_txt.as_deref())
        .map_err(|e| e.to_string())?;

    Ok(DomAudit {
        id:               audit_id,
        site_id,
        url:              payload.url.clone(),
        canonical:        payload.canonical.clone(),
        canonical_match:  payload.canonical.as_deref().map(|c| c == url),
        title:            payload.title.clone(),
        title_length:     payload.title.as_ref().map(|t| t.len() as i64),
        meta_description: payload.meta_description.clone(),
        meta_desc_length: payload.meta_description.as_ref().map(|d| d.len() as i64),
        meta_robots:      payload.meta_robots.clone(),
        h1_count:         Some(payload.h1_count),
        h1_text:          payload.h1_text.clone(),
        hreflang_tags:    Some(payload.hreflang_tags),
        og_tags:          Some(payload.og_tags),
        schema_types:     Some(payload.schema_types),
        robots_txt:       payload.robots_txt,
        llms_txt:         payload.llms_txt_exists,
        has_invalid_head: payload.has_invalid_head,
        issues,
        score:            Some(score),
        crawled_at:       chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn get_last_audit(site_id: i64) -> Result<Option<DomAudit>, String> {
    db::with_conn(|conn| {
        let row = conn.query_row(
            "SELECT id, site_id, url, canonical, canonical_match, title, title_length,
                    meta_description, meta_desc_length, meta_robots, h1_count, h1_text,
                    hreflang_tags, og_tags, schema_types, robots_txt, llms_txt,
                    has_invalid_head, raw_issues, score, crawled_at
             FROM dom_audits WHERE site_id = ?1
             ORDER BY crawled_at DESC LIMIT 1",
            [site_id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?, r.get::<_, Option<bool>>(4)?,
                    r.get::<_, Option<String>>(5)?, r.get::<_, Option<i64>>(6)?,
                    r.get::<_, Option<String>>(7)?, r.get::<_, Option<i64>>(8)?,
                    r.get::<_, Option<String>>(9)?, r.get::<_, Option<i64>>(10)?,
                    r.get::<_, Option<String>>(11)?,
                    r.get::<_, Option<String>>(12)?, r.get::<_, Option<String>>(13)?,
                    r.get::<_, Option<String>>(14)?, r.get::<_, Option<String>>(15)?,
                    r.get::<_, bool>(16)?, r.get::<_, bool>(17)?,
                    r.get::<_, Option<String>>(18)?,
                    r.get::<_, Option<i64>>(19)?, r.get::<_, String>(20)?,
                ))
            },
        );

        match row {
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(anyhow::Error::from(e)),
            Ok(r) => {
                let hreflang: Vec<HreflangTag> = r.12
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                let og: Option<serde_json::Value> = r.13
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok());
                let schema: Vec<String> = r.14
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                let issues: Vec<AuditIssue> = r.18
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();

                Ok(Some(DomAudit {
                    id: r.0, site_id: r.1, url: r.2,
                    canonical: r.3, canonical_match: r.4,
                    title: r.5, title_length: r.6,
                    meta_description: r.7, meta_desc_length: r.8,
                    meta_robots: r.9, h1_count: r.10, h1_text: r.11,
                    hreflang_tags: Some(hreflang),
                    og_tags: og,
                    schema_types: Some(schema),
                    robots_txt: r.15,
                    llms_txt: r.16,
                    has_invalid_head: r.17,
                    issues,
                    score: r.19,
                    crawled_at: r.20,
                }))
            }
        }
    })
    .map_err(|e| e.to_string())
}
