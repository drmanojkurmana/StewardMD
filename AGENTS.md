# StewardMD — agent guide

Clinician-only medical decision-support app. Buildless PWA (ES5 IIFEs, no bundler/TS) served from the
repo root; Capacitor 8 wraps it for iOS + Android (native shells render the local `www/` bundle and
call `stewardmd.in/api/*`). Backend: Cloudflare Pages Functions (`functions/`) + Worker `stewardmd-api`
(`worker/`, api.stewardmd.in, D1 drug DB). Firebase auth (project `stewardmd-498ec`), Firestore, KV, R2.

## Read before touching anything
- `vault/modules/<Module>.md` first — flag + default, key files, status, gotchas. Map: `vault/Home.md`.
- Architectural decisions (don't re-litigate): `vault/decisions/Decisions.md`. Deferred work: `vault/Roadmap.md`.
- Session-spanning state incl. **temp production values that must be reverted**: latest file in `vault/handoff/`.
- Infra/signing/toolchain: `vault/Infra.md`. Deep runbooks: `docs/*.md` (gitignored from serving, in repo).
- Vault notes are a map, not ground truth — verify against code; fix drift when you find it.

## Commands
- `npm test` — unit suite: `node --test --experimental-test-module-mocks test/*.test.mjs test/connect/** rx-build` (Node ≥22 for `mock.module`). CI runs the same.
- UI/logic changes also need a real headless-browser harness run — `test/run-<area>-ui.mjs` (CDP against real files). Unit-only is not enough to claim a fix.
- `npm run eval:maik` — offline MaiK decision-layer regression eval (loads real KB, 4 GB heap).
- `npm run build:www` → assemble `www/`; `npm run sync` = build:www + `cap sync`; `npm run ios` / `android` open IDEs.
- `scripts/preflight.sh` before ANY native build (Firebase config present, merge markers, tests; `RUN_TESTS=0` skips).
- Worker: in `worker/` — `npm run check|dev|deploy` (wrangler 4 pinned; wrangler 3 silently breaks on wrangler.jsonc).
- No linter/formatter exists. Syntax-check with `node --check <file>`. Match surrounding style exactly.
- CI (`.github/workflows/ci.yml`): unit-tests · atlas-pipeline Python checks · maik-eval · merge-marker preflight. Also: `deploy-worker.yml` (path-filtered, env-approved), `ota-stage.yml` (stages www/ to R2 candidate — never live).

## Architecture / how pieces connect
- Repo root IS the web app: flat per-feature JS/CSS (`icu.js`, `maik-*`, `surgx-*`, `clinix-*`, …) loaded by
  `index.html` (~2k lines, all CSS inline). Each feature = `<feature>.js` screens + `<feature>-model.js` pure logic
  + `<feature>-flags.js` registry + `<feature>-store.js` persistence where applicable.
- Client AI SDK: `window.SMD_AI` is defined ONLY in `reasoning.js` (~line 3771); `maik-engine.js` decorates it
  (engine pref: KB-only / Cloud / On-device). Server: `functions/api/ai/[[path]].js` routes `/refine` (Vertex
  router, cached + typing-warmed), `/explain` (Gemini SSE stream), `/research`, plus per-feature kinds.
- MaiK 3-tier flow: Intent Firewall (`kb/ai/maik-scope.js`, allow-list, client+server share ONE predicate)
  → local KB engine (`kb/ai/maik-kb.js`) → `/refine` router → Gemini `/explain`. Model via `GEMINI_MODEL`
  (gemini-2.5-flash; 3.x-lite broke streaming) or KV override `ai:model:override`. Vertex primary → Developer API failover.
- Metering/caps: `functions/_usage.js` (global ₹ breaker, quotas — fail-open) + `functions/_ai_usage.js` (per-module
  caps, owner console knobs in KV). Identity is SERVER-derived from Firebase token or Cf-Access email;
  guests bucketed by hashed `X-SMD-Device` header, falling back to IP. Browser-supplied userId never trusted.
- App gate: `authorise()` accepts Cf-Access email, Authorization bearer, X-App-Token, X-SMD-App marker,
  or allowlisted Origin. `APP_GATE_KEY` set ⇒ empty-Origin anonymous calls rejected.
- Pages middleware `functions/_middleware.js`: public browsers get marketing site; app JS/vault/docs are 404'd;
  `/realapp` secret-path cookie unlocks web. Native apps unaffected (local bundle). Don't break its pass-through list.
- Persistence: KV `MAIK_KV` (metering + runtime knobs; ~380ms/write — non-gating writes go in `waitUntil`),
  D1 (drug gold data, updates, connect), R2 (FollowCare photos 7-day retention, OTA bundles, models),
  Firestore (ICU collab, steward IDs, cases), device-local AES-GCM stores (SURGX notes — no server copy).
- Deploy: push to `main` auto-deploys Pages (root + functions/); Worker deploys via GH action; native users get
  client changes only after build-www → cap sync → store rebuild/reinstall OR OTA (admin-console "Push to devices").

## Hard invariants (do not break)
- Test before claiming any fix works (unit + headless browser for UI/logic).
- Reversible changes: big/risky work goes behind a feature flag + git recovery point (tag/branch) until approved.
- Never commit secrets or PHI. Keys live outside the repo. No PHI in URLs/logs/SMS. Metering stores counters only.
- FollowCare must never change prescriptions, diagnose definitively, or stop meds. Deterministic DiagnosisMapper — no LLM.
- Safety gates FAIL CLOSED and are applied at the loader seam (SURGX review/licence gates; content without
  approved review.status does not render). A prompt is a request, not a mechanism — enforce in code server-side.
- No em-dash in app-facing text (MaiK output exempt). Brand "SURGˣ" only in user-facing strings; keys/filenames use ASCII `surgx`.
- Stage files explicitly when committing — parallel sessions edit this repo concurrently.
- ICU/GHIS styling lives inside `icu.js injectCSS()`; redesign CSS layers must stay additive/scoped (`.rds-*`).

## Cache-busting & versioning
- Every JS/CSS asset reference in `index.html` carries `?v=<token>` tokens; bump the token whenever you edit a file —
  `sw.js` (stale-while-revalidate) caches full URLs, so an unchanged token means users never see your change.
- Bump the `CACHE` name in `sw.js` in step with deploy. Content fetches under `/surgx/` use `?v=<contentVersion>`
  (clinix-content.js still fetches unversioned — known gap, see Roadmap).
- SW is WEB-ONLY: disabled/unregistered on native (capacitor://localhost etc.) — stale-JS-in-WKWebView incident.
- Native freshness: verify the RUNNING bundle's `?v=` token via WebView inspector, never trust install messages.

## Fragile areas — extra caution
- `index.html` inline boot scripts (auth interstitial gate, theme/appearance pre-paint, SW registration) — order-sensitive.
- Native networking: fetch = CapacitorHttp (buffers); streams MUST use pristine XHR (`CapacitorWebXMLHttpRequest.fullObject`,
  abort() works). iOS WebView debugging needs `ios_webkit_debug_proxy` over USB + Target.sendMessageToTarget envelope (see CLAUDE.md).
- OTA system (twice built after a stale-downgrade incident): staging ≠ live; rollback raises version; kill switch first in check path.
  Read `vault/modules/OTA Updates.md` + Decisions before touching.
- OPD workplace invariant: clinic/Connect sessions have `ghisToken === null`; the WORKPLACE decides which EMR opens (wrong-record risk).
- Steward ID caches must be keyed by uid (sign-out→sign-in hands account B account A's identity otherwise).
- `aiHeaders()` uses CACHED id token only — reinstall wipes it; signed-in users silently degrade to guest until re-login.
- Known open items (handoff 2026-08-25): prod `MAIK_GUEST_DAILY_LIMIT=300` must revert to 15; KV `ai:limits={"maik":500}` is INTENTIONAL — don't "clean up";
  answer cache writes nothing (cause unknown); 2 pre-existing failures in `test/functions/_research.test.mjs`.

## Env / secrets
- Plaintext config in `wrangler.toml` [vars] (+ `[env.production.vars]` — named envs DON'T inherit top-level; duplicate bindings there too).
- Secrets: `wrangler pages secret put <NAME>` (e.g. APP_GATE_KEY, GEMINI_API_KEY, GCP_WIF_*, MAIK_GUEST_DAILY_LIMIT);
  `.dev.vars` (gitignored) for pages dev; template in `.dev.vars.example`. Never in vault/docs/code.
- Feature flags: `<feature>-flags.js` registries (type/default/desc); release-gated flags carry FLIP-BEFORE-RELEASE comments enforced by tests.
