---
tags: [module, infra]
status: PHASE 1 + PHASE 2 built. Client ships INERT until the owner's one native rebuild (Phase 3).
flag: none — native-ota.js is a pure capability-check (isNative() && plugin() present), not a flag
---
# OTA Updates

Push a code change to GitHub, press "Push to devices" in the admin console
(`stewardmd.in/admin` → App updates), and every installed phone can be offered the new web
bundle — no Xcode, no Android Studio, no App Store/Play Store review. **This is the SECOND time
this system exists** — the first was built and torn down the same day, 1 Aug 2026, because a
stale bundle silently downgraded installs. See [[Decisions]] (2026-08-22) before touching any of
this; every design choice below traces back to that one incident.

## Key files
- `functions/_ota.js` — the actual rules, pure + deps-injectable (`r2` passed in, not read from
  `env`), so it unit-tests with an in-memory fake, no Workers runtime. `getCandidate`/`publish`/
  `rollback`/`setKill`/`checkForDevice`/`getFile`.
- `functions/api/ota/[[path]].js` — the HTTP surface. Device-facing (`check`, `file/:hash`) are
  PUBLIC, no auth. Admin (`candidate`, `channel`, `history`, `publish`, `rollback`, `kill`) are
  `ownerOK()`-gated, same as every other admin endpoint.
- `scripts/ota-stage.mjs` — runs in CI on every push to `main`. Hashes `www/`, uploads only NEW
  content-addressed files (`ota/known-hashes.json` index avoids re-uploading unchanged files),
  writes a manifest + the `candidate` pointer. **Never touches the live channel.**
- `.github/workflows/ota-stage.yml` — the trigger. Builds `www/`, runs the stage script. Reuses
  the existing `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` repo secrets (already used by
  `deploy-worker.yml`) — no new secrets needed.
- `admin/index.html` pane `ota` — candidate/channel/history + Push/Rollback/Kill buttons. Same
  `api()`/`ownerOK` pattern as every other pane. **The whole admin script is one IIFE** — nothing
  it declares reaches `window`; see the gotcha below before writing another test against it.
- R2: reuses `stewardmd-offline` (already bound as `OFFLINE_BUCKET` in `worker/wrangler.jsonc` for
  the paid drug DB) under a dedicated `ota/` prefix — no new bucket. Bound as `OTA_R2` in
  `wrangler.toml` (top-level + `env.production`, both needed — Pages named envs don't inherit
  top-level bindings).
- Tests: `test/ota.test.mjs` (pure logic, fake R2, 12 cases — the kill-switch ones are the
  load-bearing ones) + `test/run-ota-admin-ui.mjs` (real headless Chrome against the real
  `admin/index.html`, 18 cases — proves the console calls the right endpoint with the right
  payload, which a server-only unit test can never catch).

## R2 object layout
```
ota/files/<sha256>            content-addressed file, immutable-cacheable
ota/manifests/<commit>.json   { commit, message, builtAt, files:[{path,hash,size}] }
ota/candidate.json            latest CI-staged build — NOT live
ota/channels/stable.json      the LIVE pointer { version, commit, manifestKey, minNativeBuild }
ota/history.json              audit trail, newest first, capped at 200
ota/kill.json                 { on, at, by } — checked FIRST on every device check
ota/known-hashes.json         internal — ota-stage.mjs's own dedup index
```

## Design decisions worth knowing
- **Staging and going live are two different acts by two different systems.** CI (on push) can
  only ever write `candidate.json`. Only `POST /api/ota/publish` (a human, owner-gated) moves the
  channel pointer. This is the direct fix for the incident: nothing a device would ever see
  changes just because someone pushed code.
- **Rollback publishes the OLD manifest under a NEW, higher version number** — it never moves the
  version counter backward. A device that only trusts "is this newer than what I have" must still
  take the rollback; reverting the counter would let a device on the bad release ignore it.
- **The kill switch is one R2 JSON object, checked first, needing no redeploy to flip.** This is
  the literal fix for "the retire mechanism itself needed a redeploy to re-arm" from the 1 Aug
  incident. It has ZERO dependency on candidate/channel/history state (test: "the load-bearing
  one" in `ota.test.mjs`).
- **A missing manifest fails the device check CLOSED** (`{ota:false, reason:"manifest-missing"}`),
  never a half-answer — see `checkForDevice`.

## Gotcha: testing admin/index.html
The entire script is `(function(){ ... })()`. `auth`, `PANES`, `goPane` etc. are closure-local —
`window.auth = {...}` from outside does NOTHING (it doesn't shadow the closure variable). To test
it: inject a fake `window.firebase` via CDP `Page.addScriptToEvaluateOnNewDocument` (must run
BEFORE the page's own script), and know that **this environment has real outbound internet** — the
genuine Firebase SDK loads from `www.gstatic.com` and will clobber your fake `window.firebase` the
instant it does, unless you also block those two URLs at the network layer (CDP `Fetch.enable` +
`Fetch.failRequest`). Drive everything after that via real DOM clicks (`document.querySelector(...).click()`),
never by calling an internal function name directly — there isn't one to call.

## Phase 2 — the native client (built)
- `native-ota.js` (`window.SMD_OTA`) — implements the contract `home.js`'s Settings page has
  carried DORMANT since before the 1 Aug teardown: `{available, isAuto, setAuto, currentVersion,
  check, install}`. `available()` is a pure capability check (`isNative() && plugin-present`), not
  a flag — so wiring is inert until the plugin actually exists on a device, no flag flip needed
  later. Loaded in `index.html` right after `native-auth.js` (needs `window.SMD_IS_NATIVE`).
- **The wire contract, verified against the real `@capgo/capacitor-updater` docs** (not guessed):
  `download({url, version, checksum})` wants ONE zip URL — self-hosted delta-via-manifest is
  ambiguous in the OSS docs, so Phase 2 doesn't depend on it; `scripts/ota-stage.mjs` now also
  zips `www/` per release (content-addressed, same `ota/files/<hash>` store) and `_ota.js`
  `checkForDevice` returns `zipHash`/`zipSize`; the ROUTER (not `_ota.js`, which has no notion of
  its own origin) builds the absolute `zipUrl` — the plugin downloads outside the WebView, so a
  relative path would fail silently on-device. `capacitor.config.json` sets `autoUpdate:"off"`
  (a STRING enum, not the boolean the pre-2026 docs imply) — our own JS drives everything, the
  plugin never polls on its own.
- **notifyAppReady() fires on every launch**, first thing, fire-and-forget — skipping it makes the
  plugin auto-rollback (its own footgun, separate from but easy to confuse with the 1 Aug one).
- **The kill switch is enforced ON-DEVICE, not just displayed**: when `/api/ota/check` returns
  `{reason:"disabled"}` and the device is on a non-zero OTA version, `check()` itself calls
  `reset()` and clears the local version — a device that already took a bad release doesn't wait
  for anyone to reopen it.
- **Two install paths, deliberately different plugin calls**: an explicit tap (banner "Update now"
  or the Settings "Download & install" button) calls `set()` — reloads immediately. The opt-in
  "Automatic updates" toggle (`isAuto()`/`setAuto()` — already modeled in the pre-existing home.js
  UI) calls `next()` — queues for a future natural restart, never interrupting an open session.
  Nothing calls the updater silently outside these two paths.
- The banner (`#smdOtaBanner`) is new: a persistent, dismissible bar, shown only in manual mode
  when a real update is ready — never for "checking"/"up to date".
- Tests: `test/run-native-ota-ui.mjs` (24 cases, real headless Chrome, a fake CapacitorUpdater +
  App plugin) covers notifyAppReady-on-load, both check() outcomes, both install() paths (set vs
  next), kill-switch enforcement (and that it's a no-op when already on the builtin), and the
  banner end to end including the tap. Verified inert (zero exceptions) in all three real device
  states: plain web, native-without-the-plugin-yet (today's actual state), native-with-plugin.

## Phase 3 (not built yet) — the one native release
- `@capgo/capacitor-updater` is in `package.json` (verified npm-resolvable, MPL-2.0, zero new
  transitive deps) but NOT yet in `node_modules`/the native Xcode/Android projects — that needs
  `npm install && npx cap sync` on the owner's machine, then a normal Xcode/Play Store release.
  Every phone must take THIS ONE store release, the normal way, before OTA can ever reach it.
- Staged rollout (10/50/100%) and the native-version gate are already modeled in `_ota.js`
  (`minNativeBuild`, `rollout` field on the channel) but the admin UI doesn't expose the rollout
  slider yet — every publish defaults to 100%.

Deps: [[Native app delivery]]. See [[Decisions]] for the full incident history and reasoning.
