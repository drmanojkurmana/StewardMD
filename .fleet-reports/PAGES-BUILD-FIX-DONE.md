# Pages build fix — 2026-10-15

## Root cause (proven, not guessed)

Cloudflare Pages caps a site at **20,000 files** and **25 MiB per file**
([Pages limits](https://developers.cloudflare.com/pages/platform/limits/)).
Pages Functions under `functions/` are compiled separately and do not count
as site files (the pass/fail boundary below only lines up under that
reading). The `stewardmd` project deploys the repo root; its dashboard
build command was only `rm -rf test docs vault android ios`
(`docs/wardsynq/SESSION_STATE_2026-09-19.md`).

Check-run history (`gh api .../commits/<sha>/check-runs`) plus a local
replay of that exact build (tracked files, dashboard `rm`, count):

| Commit | Check | Static files (excl `functions/`) |
| --- | --- | --- |
| `9984b49a3` (2026-10-12), via `38684c31f`/`f346bec2e` | last success | 19,737 |
| `7c1c07f5a` (2026-10-13) | first failure | 20,289 |
| `d93c99577` / origin/main | failing | 22,851 |

`7c1c07f5a` added 549 `prep/` files (mostly `prep/lessons/v1/*.json`),
which crossed the cap. Every production build since 2026-10-13 has
failed, so no `functions/**` change (Ask MaiK answers #164x, the bank
lock, all of `functions/api`) is live; OTA kept shipping the app bundle,
which hid it. Ruled out: no tracked file over 25 MiB (largest is
`kb/dist/kb.disease-docs.json`, 20.4 MB), no build-script error — the
count is the failure. The Cloudflare build log itself needs dashboard
login and the repo token cannot read Pages (API error 10000, confirmed),
so the log line is unverified; the count replay matches the pass/fail
boundary exactly.

## What changed (branch `pages-fix-1014`, PR #1649)

- `scripts/pages-build.sh` — the Pages build command, now versioned in
  the repo as the single source of truth. In the build copy only, it
  removes the old five dirs plus provably non-runtime trees: `worker`,
  `prep-arena-worker`, `voice-worker` (separate Workers),
  `kb/reference`, `kb/validation`, `kb/diseases`, `kb/tools` (KB
  source/build inputs — `scripts/build-www.sh` already excludes them
  from the runtime bundle), `prep/fill`, `prep/screen`, `prep/build`
  (batch/classifier outputs), `bench`, `backend`, `tools`,
  `local-plugins`, `Packages`, `atlas-pipeline`, `scrollcraft`,
  `store-assets`, `voice-service`, `voice-benchmark`, `prompts`,
  `infra`, `qa-report`, `archive`, `.fleet-reports`, `.github`,
  `.planning`. Nothing is deleted from git; OTA and
  `scripts/build-www.sh` are untouched and unchanged.
  Every `functions/` import that escapes `functions/` was resolved and
  lands on a kept path (root `*.js`, `connect-agent/manifest/*.mjs`,
  `data/interaction-rules.json`, `kb/ai`, `kb/protocols`, `wardsynq/`).
  Kept on purpose, with the runtime evidence in the script header:
  `functions/`, `connect-agent/`, `atlas/`, runtime `kb/`, `prep/`,
  `data/`, `assets/`, `vendor/`, `tokos/` + `tokos-models/`
  (`tokos-loader.js` loads `tokos-models/<id>.js` on first open; an
  earlier draft of this fix excluded it and would have broken Tokos
  on the web), `narke-models/`, `wardsynq/`, `scripts/` (already ships
  today; the build script must not delete its own directory),
  `_headers`, `_redirects`.
- `test/pages-output.test.mjs` — guard test (runs in the normal
  `test/*.test.mjs` suite): replays the `pages-build.sh` exclusion
  list over `git ls-files` and fails over **19,000 files** or
  **24 MiB** per file. Negative control: with the old 5-dir list it
  fails (22,853); with the new list it passes (3/3).
- `functions/api/health.js` — tiny unauthenticated deploy probe,
  `GET /api/health` → `{"ok":true,"v":"2026-10-15-pagesfix1"}`. Today
  that URL returns the SPA HTML fallback, so a JSON reply proves
  server code deployed. It reads no env, bindings or input and changes
  no state, so `scripts/security-scan.mjs` now names it in
  `PUBLIC_ALLOWLIST` (public by design); the scan passes with 0
  findings again.

Why not a `www-pages/` output dir or `.assetsignore`: `.assetsignore`
is a Workers Static Assets (`wrangler deploy`) feature, not a Pages
Git-build feature. Setting `pages_build_output_dir` in `wrangler.toml`
would still need the dashboard build command to create that directory
first (and Pages Functions `wrangler.toml` config requires the V2
build system), while risking every web-served static the allowlist
forgot. The versioned `rm` keeps the output dir (repo root), bindings
and Functions layout exactly as they are today; only the exclusion
list moves into the repo, where the guard test can replay it.

Verified locally: full simulation (`git archive` → `bash
scripts/pages-build.sh` in a clean copy) yields **12,909 static
files**, 0 files over 24 MiB, and spot-checked runtime files all
survive (`index.html`, `_headers`, `tokos-models/drill-breech.js`,
`prep/lessons/v1/index.json`, `kb/dist/kb.enrichment.js`,
`atlas/modules.json`, `connect-agent/manifest/interpret.mjs`,
`data/offline-clinical.json.gz`, `functions/api/health.js`).
Guard test 3/3 and `node scripts/security-scan.mjs` (0 findings) pass
on this branch.

## Owner must do (one dashboard setting — this blocks the green check)

Cloudflare dashboard → Pages → `stewardmd` → Settings → Builds &
deployments → **Build command**: replace the current value with

```
bash scripts/pages-build.sh
```

Leave the build output directory blank (repo root) and the root
directory as `/`, exactly as now. Do this **after** PR #1649 merges
(the script must exist on `main` first). Then production still needs
one build trigger: Deployments → `⋯` on the latest production
deployment → **Retry deployment** (or any push to `main`). The PR's
"Cloudflare Pages" check cannot go green before this paste, because
preview builds use the same dashboard command; that red check on the
PR is expected and is not a code failure. After the retry, confirm
server code is live with:

```
curl https://stewardmd.in/api/health
# expect: {"ok":true,"v":"2026-10-15-pagesfix1"}
```

Optional, not required: on a paid plan, `PAGES_WRANGLER_MAJOR_VERSION=4`
raises the cap to 100,000 files. Do not rely on it; the guard above
keeps the site under the free-plan cap regardless.
