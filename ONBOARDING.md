# StewardMD — Onboarding for Claude Code (terminal)

Paste-ready context for a fresh Claude Code session (terminal or GUI). It has no
memory of prior sessions — this file is the handoff.

## What this is
StewardMD is an antibiotic / clinical-decision-support web app for clinicians,
deployed to **stewardmd.in** via **Cloudflare Pages**. Vanilla browser JS (no
build step) + Cloudflare Pages Functions (`functions/`) + Firebase auth + KV.

## Repo & environment
- **GitHub:** `drmanojkurmana/StewardMD` (private). Clone with
  `gh repo clone drmanojkurmana/StewardMD` then `cd StewardMD`.
  (There is no reliable long-lived local checkout — clone fresh.)
- **`gh` auth:** ensure `gh auth status` shows `drmanojkurmana`; else `gh auth login`.
- **Deploy is git-connected:** merging a PR to `main` **auto-deploys to production**
  where clinicians use it live. **Never merge to `main` without explicit sign-off.**
  Do work on a branch and open a PR.
- **Formatter caveat:** a save-time formatter may rewrite `home.js` / `app.js` /
  `index.html`. Make edits programmatically and re-read the file after saving to
  confirm the change stuck; `git add` only the specific files you touched.
- **Cache-busting convention:** on any shipped asset change, bump `?v=goldN` on the
  `<script>` in `index.html` AND `var CACHE = "stewardmd-goldN"` in `sw.js`.

## Run & verify locally
```bash
# static dev server (correct .mjs MIME); serves the app, NOT the Functions runtime
node test/serve.mjs . 8903

# MaiK behavioural eval — REAL routing + retrieval, STUBBED provider (no paid calls)
BASE=http://localhost:8903/ node test/maik-eval/run-eval.mjs
# expect ~98% Tier-1; the only expected failure is the reviewer-gated K-04

# Knowledge Units unit tests (pure logic + client sandbox)
node functions/api/ku/ledger.test.mjs      # expect: ALL 23 PASS
node test/ku-client.test.mjs               # expect: ALL 11 PASS
```
The eval spawns headless Chrome via CDP (expects Chrome at
`/Applications/Google Chrome.app/...`). Note: the SPA sometimes bounces to
`about:blank` under raw automation — a known service-worker/redirect glitch; prefer
the eval harness over ad-hoc scripted browsing, and it's a good bug to fix.

## Browser MCP (for live UI checks)
Live checks (rendering, streaming, sign-in flows) need a browser tool:
```bash
claude mcp add playwright npx @playwright/mcp@latest
```
(or ask Claude to "set up the Playwright MCP server").

## Open work (as of 2026-07-11) — three review-ready PRs, all UNMERGED
- **#327** — MaiK "assume-and-refine" + contextual follow-up chips (base: `main`).
  Fixes the relevance gate that refused specific in-KB questions; adds
  zero-token follow-up chips.
- **#328** — MaiK tables + per-claim citations + streaming (stacked on #327).
  Progressive-enhancement; all fall back safely if the model/provider doesn't
  cooperate. Merge #327 first.
- **#329** — Knowledge Units: read-to-earn points + subscription-discount tiers
  (base: `main`, independent). Server-authoritative KV ledger keyed to a verified
  Firebase uid; header chip + progress panel; redemption/billing deferred.

### Merge order
`#327` → `#328` → `#329` (independent, any time). Confirm with the maintainer
before each merge (prod deploy).

## Knowledge Units — prod prerequisites (#329)
Before KU can earn in production:
1. **Bind a KV namespace** to the Pages project — reuse `MAIK_KV` / `CASES_KV`, or
   add a dedicated `KU_KV` (the endpoint uses `usageKv(env)` which checks
   `MAIK_KV || CASES_KV || GHIS_KV || UPDATES_KV`). Without KV it fail-closes (503)
   and the chip simply stays at 0 — no breakage.
2. Confirm **`FIREBASE_PROJECT_ID`** is available to Functions (used to verify the
   Firebase ID token in `functions/_usage.js`).
Surface the exact wrangler/Pages dashboard settings to the maintainer; do not
guess-edit secrets.

## Live smoke tests still owed (couldn't run headless)
- **MaiK (#328):** ask a comparison question → a markdown table renders; `[n]`
  citation chips appear and open the numbered sources footer; tokens stream in.
  Kill-switch: `localStorage smd_maik_stream="0"` reverts to non-stream.
- **Knowledge Units (#329):** sign in → read a few clinical pages → the ◆ KU chip
  climbs; open the Knowledge Points panel → progress + breakdown; re-read the same
  page the same day → no double count; sign out → chip hides.

## Where the design lives
- Specs: `docs/superpowers/specs/2026-07-11-*.md`
- Plans: `docs/superpowers/plans/2026-07-11-*.md`
Read these first for full rationale before changing MaiK or Knowledge Units.

## Key files
- MaiK: `home.js` (chat UI/routing), `kb/ai/steward-ai.browser.js` (grounding +
  relevance gate), `kb/ai/interface.mjs` (tf-idf retrieval), `reasoning.js`
  (`SMD_AI`, `SMD_MaiK`), `functions/api/ai/[[path]].js` (Gemini + streaming).
- Knowledge Units: `functions/api/ku/ledger.js` (pure), `functions/api/ku/[[path]].js`
  (endpoint), `ku.js` (client), hooks in `reasoning.js`/`calculators.js`/`home.js`.
- Identity/usage: `functions/_usage.js` (`identify()` verifies Firebase tokens).
