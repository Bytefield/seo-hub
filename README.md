# SEO Hub (Tauri)

Local-first desktop SEO dashboard built with **Tauri (Rust) + React + SQLite**.

SEO Hub stores projects/sites/audits in a local SQLite database and can spawn MCP servers to integrate external data sources (GSC/GA4/Bing/Clarity/etc.). Credentials are intended to live in the OS keychain (not in the repo).

## What it does

- Manage **projects** and **sites** (domains) locally.
- Run a **DOM audit** workflow (Playwright-based) and persist results.
- Provide a unified dashboard UI (React + Tailwind) for SEO signals.
- (Optional) Expose/read data via an MCP server (see `mcp-server/`).

## Tech stack

- Frontend: React 18, TypeScript, Vite, Tailwind
- Desktop shell: Tauri v2 (Rust)
- Database: SQLite (`rusqlite` in app, `better-sqlite3` in `mcp-server/`)
- State: Zustand

## Local development

Prerequisites:
- Node.js
- Rust toolchain (for Tauri)

Install deps:

```bash
npm install
```

Run the desktop app in dev mode:

```bash
npm run tauri dev
```

Build the desktop app:

```bash
npm run tauri build
```

Frontend-only dev server (Tauri expects port 1420):

```bash
npm run dev
```

## Data & configuration

### SQLite DB location

The app uses Tauri app data directories. The `mcp-server/` resolves the DB path as:
- Windows: `%APPDATA%\com.synio.seohub\synio-seo-hub.db`
- Linux/macOS: `~/.local/share/com.synio.seohub/synio-seo-hub.db`

You can override the DB path for the `mcp-server/` with:

```bash
SEO_HUB_DB=/absolute/path/to/synio-seo-hub.db
```

### Secrets / credentials

Do **not** commit secrets.

This repo is designed so that credential material is stored via OS keychain (Rust `keyring`), and the database stores only metadata.

## MCP server

There is a Node MCP server under `mcp-server/` which can read the app DB (read-only) and expose data to an LLM client.

```bash
cd mcp-server
npm install
npm run build
```

(Exact invocation depends on your Claude Desktop / MCP configuration; see `mcp-server/claude_desktop_config.json` and `ARCHITECTURE.md`.)

## Architecture

- `ARCHITECTURE.md` contains a full module map and the SQLite schema.
- `src-tauri/src/db/` contains migrations and queries.
- `src-tauri/src/commands/` contains Tauri commands (auth/projects/sites/credentials/mcp/dom_audit).

## Licence

MIT
