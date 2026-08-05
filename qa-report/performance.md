# Performance & Reliability (Phase 7)

## Critical

- **C1 - KardioX loads 7 ONNX models (~157 MB) CONCURRENTLY, per analysis, no session reuse.**
  `kardiox-ort.js:145-159` (`ensure()` uses `Promise.all(heads.map(...))`) via `kardiox-providers.js:272-306`
  which builds a **fresh** analyzer (`_sessions=null`) on **every** call. 7 x ~22.5 MB heads deserialized
  at once -> ~300-450 MB momentary peak on top of the resident WebView (KB, DOM) -> OOM risk on constrained
  devices, repeated every ECG analysis. A safe **sequential** pattern already exists in
  `kardiox-engines.js:111-120` but isn't the one wired in. **Fix:** switch `ensure()` to sequential
  `.reduce()` load (or load-then-run per head) + hoist the analyzer to a module singleton so sessions are
  created once per app session.

## High

- **H1 - 26 MB of KB "enrichment" JS parsed eagerly on every cold start** (`kb.enrichment.js` 13.6 MB +
  `kb.enrichment.2.js` 12.8 MB), though `index.html:1487` comment claims "~4.8MB" (5x doc drift). Each is a
  single top-level object literal -> full eager parse, retained for the app lifetime, even if MaiK/KB is
  never opened that session. Load is correctly after first paint, but unconditional. **Fix:** correct the
  comment; **gate the load behind first actual KB/MaiK use** (reasoning.js has closure fallbacks); chunk further.
- **H2 - 67 feature-module scripts (~4.3 MB, ~41% of main bytes) load on every cold start regardless of
  use** - KardioX (2.84 MB incl. `kardiox-content-pack.js` 1.8 MB), ThoreX, FundX, FollowCare, SknX, ws-packs,
  hospitals-in - all plain `<script defer>`, not lazy. **Fix:** apply the KB lazy dynamic-`<script>`-injection
  pattern per module family, triggered on first navigation into that workspace. **Highest-leverage,
  lowest-risk cold-start win** (pattern already proven in-codebase).
- **H3 - GHIS Ward patient search has no debounce + full unvirtualized re-render per keystroke**
  (`ghis-ward.js:942-959` + `318-347`) over the whole hospital worklist -> main-thread jank on Android.
  **Fix:** debounce ~150-200ms (idiom exists at `home.js:4735`) + cap/virtualize the list.
- **H4 - GHIS import fans out up to 25 concurrent upstream-proxy round-trips per patient**
  (`ghis-ward.js:516-650`). Good `.slice(0,N)` caps, but 25+ simultaneous proxy calls to a legacy HIS ->
  slow/flaky; repeats across 3 near-duplicate call sites (no caching). **Fix:** batch server-side in
  `ghis-proxy.js` or queue 5-at-a-time + brief per-patient cache.

## Medium

- **M1 - Firestore `timeline`/`tasks` listeners have no `.limit()`** (`icu-collab.js:848,851,923`). Mitigated
  by a 7-day TTL, but a very active patient's in-window docs are re-derived fully on every write (no
  `docChanges()`). **Fix:** add `.limit(200)` belt-and-suspenders.
- **M2 - `interaction-rules.js` (864 KB) is a single eagerly-parsed object literal** (`:14`). The consuming
  algorithm is efficient; the cost is the boot parse. Lower priority (used early). Candidate for lazy-load
  if the cold path is slimmed further.
- **M3 - two ~13 MB / ~11 MB single files** (`kb.enrichment.js`, `.2.js`, `ort-wasm-simd-threaded.wasm`) -
  under the 25 MiB Cloudflare per-file limit today, but the KB files grow. **Fix:** add a `www/` size-budget
  check to `build-www.sh`/CI (fail if a file > ~20 MiB) so growth is caught before a silent deploy failure.

## Low
- **L1** `kb.index.json` (13 MB) is correctly **excluded** from `www/` (build input only) - verified, not an issue.
- **L2** `icu.js:7489` runs a permanent uncleared 60s heartbeat (guarded, cheap when idle) - minor native battery note.
- **L3** `home.js` 146 addEventListener vs 4 remove - **audited, no leak** (popups pair add/remove; rest are one-time init GC'd with DOM).

## Verified-good (already resolved)
- **Firestore native WebChannel storm fixed** (`experimentalForceLongPolling:true` for native) - matches the MaiK-hang memory note.
- `offline-clinical.js` (5.8 MB) genuinely lazy (first `ensureData()`), FundX MediaPipe lazy, icu-collab listeners bounded per-membership with clean teardown.

## Net
One **Critical** (KardioX concurrent model load -> OOM) and two high-leverage **cold-start** wins (lazy-load
KB + feature modules). None are deploy-breakers today, but C1 + H1/H2 are the difference between the app
feeling fast/reliable and feeling heavy on mid-range Android. No unbounded memory leak found.
