# ResearchMD Student Walkthrough Fixes: Owner Runbook

This runbook covers the production database checks, D1 migrations, and deploy steps needed for the ResearchMD manuscript save and Word export fixes. Do not run these commands from CI or automated agent sessions; the project owner runs them against production.

## Why Save and Word Export Returned 404

1. **Code cause (fixed in `functions/api/research/_manuscript.js` and `research-screen-manuscript.js`):**
   - `research_manuscript_versions` rows were only created by `ingestManuscriptJob` when an async `manuscript_draft` queue job completed.
   - Students writing directly in the manuscript editor, drafting with Ask MaiK (`POST /v1/projects/{id}/ai-draft`, which writes to `research_ai_drafts` only), or importing a thesis never trigger a `manuscript_draft` job.
   - Without a version row, `GET /manuscript`, `PUT /manuscript/sections/{sectionId}`, and `POST /manuscript/export` all returned `404 manuscript_not_found`.
   - `putSection` now creates version 1 (`status = 'draft'`) on first save and upserts sections; `research-screen-manuscript.js` updates `st.manuscript.version` from the save response so a fallback `version: 2` draft syncs to server version `1` before export.
2. **Stale app bundle in the live walkthrough:**
   - The walkthrough ran a mobile `www/` bundle 52 commits behind `origin/main`.
3. **Production D1 schema check (Phase 5 migrations 0006 and 0007):**
   - `wrangler.toml` binds `RESEARCH_DB` to `stewardmd-research` (`fcb5adad-89d8-4d32-a6d1-315b007d2b7a`) with `RESEARCH_MODE = "pilot"` under `[env.production.vars]`.
   - If `stewardmd-research` was only migrated through `0005` (or an older schema), Phase 5 tables from `0006` and `0007` may be missing in production.

## Step 1: Inspect Production D1 Schema (`stewardmd-research`)

**What:** Check whether Phase 5 tables (`0006` and `0007`) exist in the remote D1 database.
**Why:** `0006_research_v6.sql` rebuilds `research_job_runs` to widen the `kind` check constraint; verify current schema state before applying migrations.
**Exact file:** None (read-only inspection query).
**Rollback:** Not applicable (read-only).

```sh
npx wrangler d1 execute stewardmd-research --remote --command "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('research_job_runs','research_manuscript_versions','research_manuscript_sections','research_manuscript_approvals','research_manuscript_exports','research_checklist_manual','research_paper_numbers','research_ai_drafts','research_paper_cards');"
```

- If all 9 tables are present and `research_job_runs` includes `'manuscript_draft'` in its `CHECK` constraint, skip Step 2 and Step 3.
- If `research_manuscript_versions` (and sibling 0006 tables) are missing, run Step 2.
- If `research_paper_numbers`, `research_ai_drafts`, or `research_paper_cards` are missing, run Step 3.

## Step 2: Apply Phase 5 Migration 0006 (if missing)

**What:** Create `research_manuscript_versions`, `research_manuscript_sections`, `research_manuscript_approvals`, `research_manuscript_exports`, `research_checklist_manual`, and rebuild `research_job_runs` to allow `'manuscript_draft'`.
**Why:** Required for server-side manuscript persistence, section saves, approvals, locking, and DOCX export gate tracking.
**Exact file:** `docs/research/contracts/phase-5/0006_research_v6.sql`

```sh
npx wrangler d1 execute stewardmd-research --remote --file docs/research/contracts/phase-5/0006_research_v6.sql
```

**Rollback:**
Note: `0006_rollback.sql` drops the Phase 5 manuscript and checklist tables and deletes any `manuscript_draft` rows in `research_job_runs`. Back up data before rolling back if any user manuscripts exist.

```sh
npx wrangler d1 execute stewardmd-research --remote --file docs/research/contracts/phase-5/0006_rollback.sql
```

## Step 3: Apply Phase 5 Migration 0007 (if missing)

**What:** Create `research_paper_numbers`, `research_ai_drafts`, and `research_paper_cards`.
**Why:** Required by `POST /v1/projects/{id}/ai-draft`, `POST /v1/paper-card`, and `POST /v1/projects/{id}/studies/auto-add` (`CREATE TABLE IF NOT EXISTS`, safe to re-run).
**Exact file:** `docs/research/contracts/phase-5/0007_research_v7.sql`

```sh
npx wrangler d1 execute stewardmd-research --remote --file docs/research/contracts/phase-5/0007_research_v7.sql
```

**Rollback:**

```sh
npx wrangler d1 execute stewardmd-research --remote --file docs/research/contracts/phase-5/0007_rollback.sql
```

## Step 4: Deploy Server Functions and Ship Updated Mobile Bundle

**What:** Deploy the updated `functions/api/research/_manuscript.js` to Cloudflare Pages and ship the updated `www/` bundle (after the lead bumps `?v=` in `index.html` and `CACHE` in `sw.js`).
**Why:** Server fixes take effect on Pages deploy (`main` push), and mobile users only receive `research-screen-manuscript.js` fixes after rebuilding `www/` and syncing native shells or pushing an OTA update.
**Exact files:**
- Server: `functions/api/research/_manuscript.js`
- Client: `research-screen-manuscript.js` (with lead `?v=` / `sw.js` cache bump and `scripts/build-www.sh`)

```sh
# 1. Run preflight and assemble www/
./scripts/preflight.sh
npm run sync

# 2. Push to main (auto-deploys Cloudflare Pages functions + static assets),
#    then either rebuild/reinstall the iOS/Android app or publish an OTA bundle
#    from the admin console ("Push to devices").
```

**Rollback:** Revert the commit on `main` (re-deploys previous Pages functions) and roll back OTA in the admin console if an OTA bundle was pushed.
