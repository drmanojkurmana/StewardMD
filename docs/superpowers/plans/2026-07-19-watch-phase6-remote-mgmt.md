# Watch Phase 6 — Remote Feature Management + Backend Plan

> REQUIRED SUB-SKILL: executing-plans.

**Goal:** Remotely enable/disable watch features without an app update, plus the additive backend the watch needs: feature flags / kill switch / min-version / announcements (`/api/watch-config`), backend-backed favorites (`/api/favorites`), and durable acknowledge sync (`/api/watch/ack`). Wire the watch to consume them.

**Architecture:** New Cloudflare Pages Functions mirror `functions/api/cases/[[path]].js` exactly (shared `identify()` auth, existing KV, no new bindings). The remote-gating decision (flag + kill switch + subscription + version) is pure logic in `StewardMDWatchCore` (`FeatureGate`), `swift test`-verified. Backend JS verified by `node --check` + review (headless wrangler run out of scope).

## Global Constraints
Additive only; isolate from Experimental Access; no new wrangler bindings (reuse `CASES_KV`/`GHIS_KV`); recovery tag `watch-remote-start` before, milestone `watch-remote` after. `/api/watch-config` is public (no auth) — the `FeatureFlagClient` from Phase 1 calls it unauthenticated.

## Files
```
functions/api/watch-config.js                 (NEW: GET public flags; POST owner-only update)
functions/api/favorites/[[path]].js           (NEW: GET/PUT/DELETE, Firebase-scoped, mirrors cases)
functions/api/watch/[[path]].js               (MODIFY: add POST ack, before the Lab-Watch config guard)
Packages/.../Sources/StewardMDWatchCore/
  FeatureFlags/FeatureGate.swift  (NEW)  + FeatureFlags.requiresUpdate (extend)
  Actions/AckSender.swift  (extend: HTTPAckSender)  Networking/AppAPI.swift (extend: acknowledge)
Packages/.../Tests/...  FeatureGateTests.swift  AckSyncTests.swift  VersionTests.swift
ios/StewardMDWatch/System/WatchServices.swift   (MODIFY: ack queue uses HTTPAckSender)
ios/StewardMDWatch/ViewModels or App            (FeatureFlagsModel + announcement banner + gating)
```

### Task 1: Backend — `/api/watch-config`
- `functions/api/watch-config.js`: `GET` returns `{flags, minVersion, announcement, killSwitch}` = baked defaults deep-merged with KV key `watch:config` (if present); no auth; `Cache-Control:no-store`. `POST` guarded by `ownerOK` (from `../_adminauth.js`) writes the KV key. No KV → return defaults.
- `node --check`; commit.

### Task 2: Backend — `/api/favorites`
- `functions/api/favorites/[[path]].js` mirrors cases: `identify()` from `../../_fbauth.js`; `GET` → `{enabled, favorites:[{id,kind,label}]}`; `PUT /:id` body `{kind,label}` → `{ok, favorites}` (cap 50); `DELETE /:id`; signed-out GET → `{enabled:false}`, writes → 401; no KV → 501. Not Pro-gated.
- `node --check`; commit.

### Task 3: Backend — `POST /api/watch/ack`
- In `functions/api/watch/[[path]].js`, add the `ack` route **before** the `watchConfigured` guard so it works independently: Firebase auth, body `{id, labId, patientLabel, ackedAt}`; idempotent by `id` (dup → `{ok, idempotent:true}`); append to KV `watchack:<uid>` (cap 500) for the audit trail; no KV → 501.
- `node --check`; commit.

### Task 4: Core — FeatureGate + version + ack sync
- `FeatureFlags.requiresUpdate(currentVersion:)` using a semver compare helper.
- `FeatureGate`: `init(flags:, isPro:, appVersion:)`; `enum WatchFeature { … var requiresPro }`; `func evaluate(_:) -> GateResult { allowed | disabledRemotely | needsPro | needsUpdate }` (kill switch → all disabled; below minVersion → needsUpdate).
- `AppAPI.acknowledge(_ ack:)` → `POST /api/watch/ack`; `HTTPAckSender: AckSender` using it (200 → true).
- Tests: kill switch disables all; flag off → disabledRemotely; pro feature without pro → needsPro; below minVersion → needsUpdate; semver compare; HTTPAckSender success/failure via mock.
- Commit.

### Task 5: Watch wiring (review-verified)
- `WatchServices.ackQueue` uses `HTTPAckSender` (APIClient + BridgedTokenProvider); flush on launch/reconnect.
- `FeatureFlagsModel` (ObservableObject) fetches `/api/watch-config` + billing on launch; exposes `gate` + `announcement`; RootListView shows an announcement banner and hides/locks gated rows (antibiotic summary / ICU deterioration behind flags; a "needs update" notice if below minVersion).
- Update `WATCH_XCODE_SETUP.md` if new files added.
- Verify: core `swift test` + web `npm test` + `node --check` backend; review. Commit.

### Task 6: tag `watch-remote`.

## Self-Review
Covers the task's Phase-7 list: feature flags, subscription-based features (Pro via FeatureGate), experimental/specialty modules (flags), remote announcements, kill switches, version compatibility. Favorites (backend half) + ack sync close prior-phase TODOs. All additive; mirrors `cases`.
