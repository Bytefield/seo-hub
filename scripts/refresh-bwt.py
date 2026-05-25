#!/usr/bin/env python3
"""
Nightly BWT snapshot refresh for SEO Hub.
Reads credentials from the app SQLite DB, calls Bing Webmaster Tools API,
and inserts a new mcp_snapshots row — exactly what the app does on Refresh All.

Cron (runs every day at 08:00):
  0 8 * * * /usr/bin/python3 /home/papi/work/seo-hub/scripts/refresh-bwt.py >> /tmp/seo-hub-bwt.log 2>&1
"""

import sqlite3
import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta, timezone
import sys
import os

# ── DB location ───────────────────────────────────────────────────────────────
# Tauri stores the DB at %APPDATA%\com.synio.seohub\data\synio-seo-hub.db
# which maps to this WSL2 path:
DB_CANDIDATES = [
    # Tauri production (installed app) — Windows Roaming/Local AppData
    "/mnt/c/Users/jesus/AppData/Roaming/com.synio.seohub/data/synio-seo-hub.db",
    "/mnt/c/Users/jesus/AppData/Local/com.synio.seohub/data/synio-seo-hub.db",
    # Tauri dev mode (npm run tauri dev) — uses a "dev" suffixed identifier
    "/mnt/c/Users/jesus/AppData/Roaming/com.synio.seohub.dev/data/synio-seo-hub.db",
    "/mnt/c/Users/jesus/AppData/Local/com.synio.seohub.dev/data/synio-seo-hub.db",
    # Override via env var: DB_PATH=/path/to/synio-seo-hub.db python3 refresh-bwt.py
    *([] if not os.environ.get("DB_PATH") else [os.environ["DB_PATH"]]),
]

def find_db() -> str:
    for p in DB_CANDIDATES:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(
        f"SEO Hub database not found. Tried:\n" + "\n".join(DB_CANDIDATES)
    )

# ── BWT API helpers ───────────────────────────────────────────────────────────
BASE = "https://ssl.bing.com/webmaster/api.svc/json"

def bwt_get(endpoint: str, params: dict) -> dict | None:
    url = f"{BASE}/{endpoint}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  [warn] {endpoint} failed: {e}")
        return None

def unwrap_d(j: dict | None) -> list:
    if j is None:
        return []
    d = j.get("d", {})
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        return d.get("Results") or []
    return []

def fetch_bwt_snapshot(api_key: str, site_url: str) -> dict:
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=30)).strftime("%Y%m%d")
    end   = now.strftime("%Y%m%d")

    # 1. Overall clicks / impressions
    rank = bwt_get("GetRankAndTrafficStats", {
        "apikey": api_key, "siteUrl": site_url,
        "startDate": start, "endDate": end,
    })
    results = unwrap_d(rank)
    total_clicks = sum(r.get("Clicks", 0) for r in results)
    total_impr   = sum(r.get("Impressions", 0) for r in results)
    ctr = round(total_clicks / total_impr * 100, 1) if total_impr else 0.0

    # 2. Top queries (best-effort)
    queries_raw = bwt_get("GetQueryStats", {"apikey": api_key, "siteUrl": site_url})
    query_map: dict[str, list] = {}
    for r in unwrap_d(queries_raw):
        kw = r.get("Query", "")
        if not kw:
            continue
        pos = r.get("AvgClickPosition", -1)
        if pos < 0:
            pos = r.get("AvgImpressionPosition", 0)
        entry = query_map.setdefault(kw, [0, 0, []])
        entry[0] += r.get("Clicks", 0)
        entry[1] += r.get("Impressions", 0)
        if pos > 0:
            entry[2].append(pos)

    keywords = []
    for kw, (cl, im, positions) in sorted(query_map.items(), key=lambda x: -x[1][1])[:25]:
        kw_ctr = round(cl / im * 100, 1) if im else 0.0
        avg_pos = round(sum(positions) / len(positions), 1) if positions else 0.0
        keywords.append({"keyword": kw, "clicks": cl, "impressions": im,
                         "ctr": kw_ctr, "position": avg_pos})

    # 3. Avg position from query data
    all_pos = [p for _, _, ps in query_map.values() for p in ps]
    avg_pos = round(sum(all_pos) / len(all_pos), 1) if all_pos else 0.0

    # 4. Top pages (best-effort)
    pages_raw = bwt_get("GetPageStats", {"apikey": api_key, "siteUrl": site_url})
    top_pages = [
        {"url": r.get("Page", ""), "clicks": r.get("Clicks", 0),
         "impressions": r.get("Impressions", 0)}
        for r in unwrap_d(pages_raw)[:10]
    ]

    return {
        "clicks": total_clicks,
        "impressions": total_impr,
        "ctr": ctr,
        "position": avg_pos,
        "crawlErrors": 0,
        "keywords": keywords,
        "topPages": top_pages,
    }

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print(f"[{datetime.now().isoformat(timespec='seconds')}] BWT refresh starting")

    db_path = find_db()
    print(f"  DB: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Read BWT API key (secret_value fallback — used in WSL2 without D-Bus keyring)
    row = conn.execute(
        "SELECT secret_value FROM credentials WHERE service = 'bwt' AND secret_value IS NOT NULL LIMIT 1"
    ).fetchone()
    if not row:
        print("  [error] BWT API key not found in DB. Configure it in the app first.")
        sys.exit(1)
    api_key = row["secret_value"]
    print("  API key: found")

    # Get all active sites that have BWT configured
    sites = conn.execute(
        "SELECT id, domain, url, bwt_property FROM sites WHERE is_active = 1"
    ).fetchall()

    refreshed = 0
    for site in sites:
        site_url = site["bwt_property"] or site["url"]
        print(f"  Site [{site['id']}] {site['domain']} → {site_url}")
        try:
            data = fetch_bwt_snapshot(api_key, site_url)
            conn.execute(
                """INSERT INTO mcp_snapshots (site_id, source, data, fetched_at, expires_at)
                   VALUES (?, 'bwt', ?, datetime('now'), datetime('now', '+25 hours'))""",
                (site["id"], json.dumps(data))
            )
            conn.commit()
            print(f"    ✓ clicks={data['clicks']} impr={data['impressions']} "
                  f"ctr={data['ctr']}% pos=#{data['position']} "
                  f"keywords={len(data['keywords'])}")
            refreshed += 1
        except Exception as e:
            print(f"    [error] {e}")

    conn.close()
    print(f"[{datetime.now().isoformat(timespec='seconds')}] Done — {refreshed}/{len(sites)} sites refreshed")

if __name__ == "__main__":
    main()
