# StewardMD Drug API (Cloudflare Worker)

D1-backed search API for the ~254k Indian branded-drug catalogue. Deployed
**independently** of the GitHub Pages frontend — the browser only ever fetches
small JSON results; the full database is never downloaded to the client.

## Status
- **Phase 1 (current): scaffold only.** Worker + config + schema exist. The D1
  database `stewardmd-prod` is still **empty** — endpoints return empty results
  (`x-db-status: empty`) until the Phase 3 import. Nothing is deployed.

## Endpoints (GET, JSON)
| Route | Purpose |
|-------|---------|
| `/health` | Liveness + D1 status (`dbReady`, row count once imported) |
| `/search?q=&limit=` | Full-text drug search (FTS5); slim rows: `id, brand, composition, class, manufacturer, form, mrp` |
| `/suggest?q=&limit=` | Lightweight brand-name autocomplete |
| `/drug/:id` | Single drug detail (full row) |

## Architecture
- **Binding:** existing D1 `stewardmd-prod` as `env.DB` (see `wrangler.jsonc`). No new DB is created.
- **Search:** SQLite **FTS5** (`drugs_fts`, external-content over `drugs`) — prefix-matched tokens, `ORDER BY rank`, `LIMIT`. See `schema.sql`.
- **Caching (layered):** browser (`Cache-Control`) → Cloudflare edge / Worker cache (`caches.default`) → D1. CORS is applied per-request *after* cache lookup.
- **CORS:** `stewardmd.in`, `www.stewardmd.in`, and Capacitor origins (`capacitor://localhost`, `ionic://localhost`, `http://localhost`).

## Endpoints (env)
- **Dev:** `*.workers.dev` (`workers_dev: true`).
- **Prod:** `api.stewardmd.in` (custom-domain route; activates on deploy once the zone is on Cloudflare).

## Local commands (run from `worker/`)
```bash
npm install          # installs wrangler locally (optional; global wrangler also works)
npm run check        # wrangler deploy --dry-run (validate config + bundle; no deploy)
npm run dev          # local dev server on a *.workers.dev preview
# npm run deploy     # PHASE 5 — do not run until approved
```

## Not in this phase
- No data import (`schema.sql` not applied to D1 yet).
- No deploy. No frontend changes. No commits.
