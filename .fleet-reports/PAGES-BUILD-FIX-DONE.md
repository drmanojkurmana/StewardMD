# Pages build fix — 2026-10-15

## Root cause (proven, not guessed)

Cloudflare Pages caps a site at **20,000 files** and **25 MiB per file**
([Pages limits](https://developers.cloudflare.com/pages/platform/limits/)).
Pages Functions under `functions/` are compiled separately and do not count
as site files. The `stewardmd` project deploys the repo root; its dashboard
build command was only `rm -rf test docs vault android ios`
(`docs/wardsynq/SESSION_STATE_2026-09-19.md`).

Local replay of that exact build (fresh `git archive`, dashboard `rm`, count):

| Commit | Check | Static files (excl `functions/`) |
| --- | --- | --- |
| `9984b49a3` (2026-10-12) | last success | 19,734 |
| `a9324fc01` (2026-10-13) | first failure | 20,284 |
| `d93c99577` / origin/main | failing | 22,846 |

`a9324fc01` added 545 `prep/lessons/v1/*.json` files (+2 more = 547 in
`prep/`), which crossed the cap. Every production build since 2026-10-13 has
failed, so no `functions/**` change (Ask MaiK answers #164x, bank lock, all
of `functions/api`) is live; OTA kept shipping the app bundle, which hid it.
Ruled out: no file over 25 MiB (largest is `kb/dist/kb.disease-docs.json`,
20.4 MB), no symlinks in the tree, no build-script error — the count is the
failure. The Cloudflare build log itself needs dashboard login and the
repo token cannot read Pages (API error 10000, confirmed), so the log line
is unverified; the count replay matches the pass/fail boundary exactly.

## What changed (branch `pages-fix-1014`)

- `scripts/pages-build.sh` — the Pages build command, now versioned in the
  repo as the single source of truth. In the build copy only, it removes the
  old five dirs plus provably non-runtime trees: `worker`,
  `prep-arena-worker`, `voice-worker` (separate Workers), `kb/reference`,
  `kb/validation`, `kb/diseases`, `kb/tools` (KB source/build inputs —
  `scripts/build-www.sh` already excludes them from the runtime bundle),
  `prep/fill`, `prep/screen`, `prep/build` (batch/classifier outputs; the
  runtime uses `prep/lessons`, `prep/overlays`, `prep/bank`, `prep/art`),
  `bench`, `backend`, `tools`, `scripts`, `local-plugins`, `Packages`,
  `atlas-pipeline`, `scrollcraft`, `store-assets`, `tokos-models`,
  `voice-service`, `voice-benchmark`, `prompts`, `infra`, `qa-report`,
  `archive`, `.fleet-reports`, `.github`, `.planning`. Nothing is deleted
  from git; OTA and `scripts/build-www.sh` are untouched. Kept on purpose:
  `functions/` and `connect-agent/` (`functions/api/connect` imports
  `connect-agent/manifest/*.mjs`), `atlas/`, runtime `kb/`, `prep/`,
  `data/`, `assets/`, `_headers`, `_redirects`.
- `test/pages-output.test.mjs` — guard test (runs in the normal
  `test/*.test.mjs` suite): replays the `pages-build.sh` exclusion list over
  `git ls-files` and fails over **19,000 files** or **24 MiB** per file.
  Negative control: with the old 5-dir list it fails; with the new list it
  passes (3/3).
- `functions/api/health.js` — tiny unauthenticated deploy probe,
  `GET /api/health` → `{"ok":true,"v":"2026-10-15-pagesfix1"}`. Today that
  URL returns the SPA HTML fallback, so a JSON reply proves server code
  deployed.

Verified locally: full simulation of the new build yields **12,673 static
files**, 0 files over 24 MiB, and spot-checked runtime files all survive
(`index.html`, `_headers`, `prep/lessons/v1/index.json`,
`kb/dist/kb.enrichment.js`, `atlas/modules.json`,
`connect-agent/manifest/interpret.mjs`, `data/offline-clinical.json.gz`).

## Owner must do (one dashboard setting — this blocks the green check)

Cloudflare dashboard → Pages → `stewardmd` → Settings → Builds &
deployments → **Build command**: replace the current value with

```
bash scripts/pages-build.sh
```

Leave the build output directory blank (repo root) and the root directory
as `/`, exactly as now. The PR's "Cloudflare Pages" check cannot go green
until this is saved, because preview builds use the same dashboard command;
likewise production cannot deploy until the PR merges after that. After
merging, confirm server code is live with:

```
curl https://stewardmd.in/api/health
# expect: {"ok":true,"v":"2026-10-15-pagesfix1"}
```
