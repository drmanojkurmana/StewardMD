# StewardMD Apple Watch Integration — Design Spec

**Status:** Approved architecture, pending spec review
**Date:** 2026-07-19
**Branch:** `claude/stewardmd-apple-watch-integration-974f68` (worktree — isolated from Experimental Access work)
**Design source:** `StewardMD Watch Design Brief.dc.html` (v1.0, watchOS 26)
**Author:** Watch integration session

---

## 1. Context & the central constraint

StewardMD is a **Capacitor 8 web app** (buildless vanilla JS/HTML/CSS at repo root) wrapped in a WebView, backed by **Cloudflare Pages Functions + a Cloudflare Worker + Firebase/Firestore**. The iOS target contains ~3 boilerplate Swift files; **there is no native Swift business logic, model layer, or networking to reuse.**

Consequence: a genuinely native watchOS app cannot "reuse existing Swift services" because none exist. It reuses what actually exists — the **backend HTTP contracts and Firebase auth** — and gets its session from the paired iPhone. This is the approved interpretation of the task's "reuse existing architecture" rule.

**Approved decisions (user):**
1. **Data/auth wiring:** Hybrid — native watch calls the backend directly for what it can; Firebase token + recents bridged from iPhone via WatchConnectivity; watch-first tools on-device.
2. **Verification:** Author + rigorously review; `swift build` + XCTest the platform-agnostic core package on macOS each phase; user does final Xcode build (no watchOS simulator runtime installed in the build environment).
3. **Favorites:** Build BOTH — watch-local favorites (offline default) AND a small additive backend-backed favorites feature bridged from the phone.
4. **Backend changes:** Additive only, clearly isolated, flagged for review before deploy.
5. **Xcode target creation:** Author every source file, `Info.plist`, entitlements, asset catalog, SwiftPM package, widget, complication, App Intent, and supporting file in the correct repo structure. **Do not edit `project.pbxproj`.** Ship `WATCH_XCODE_SETUP.md` with exact click-by-click Xcode steps to add the Watch App target, Widget Extension, capabilities, and package references. Repo must be fully ready so the project builds with no additional code changes after those steps.

**Non-negotiable ground rules:** additive only; do not break existing web/iOS/Android behavior; do not touch the Experimental Access work; small logical commits; recovery tags before milestones; stop with a summary after each phase.

---

## 2. Confirmed backend surface (source of truth for the Swift networking layer)

**Hosts**
- `https://stewardmd.in` — Pages Functions, all `/api/*` app endpoints.
- `https://api.stewardmd.in` — Worker: drug search (**public, no auth**), offline-DB, OTA.
- Firebase/Firestore — auth (ID tokens, aud `stewardmd-498ec`), Pro custom claim, ICU collab data (SDK-only, no REST).
- `ghis.gitam.edu` — hospital HIS, **server-side proxy only** via `/api/ghis/*`.

**Auth**
- Per-user endpoints: `Authorization: Bearer <Firebase ID token>` (RS256, verified in `functions/_fbauth.js`). Token minted on-demand in JS via `getIdToken()`; **never persisted natively today** → must be bridged.
- Pro = Firebase custom claim `pro:true`; **launch promo until 2026-09-15 treats everyone as Pro**, so `402 needsPro` gates are currently open. Design for the gate regardless.
- Ward Sync / GHIS: a **separate opaque session token** minted by `POST /api/ghis/login` from the doctor's GHIS username+password (30-min TTL in KV). The watch cannot mint this — relay from phone.

**Endpoints the watch will use**

| Endpoint | Auth | Use |
|---|---|---|
| `GET api.stewardmd.in/search`, `/composition`, `/drug/:id`, `/monograph`, `/structured`, `/brand-search` | none | Drug/dose lookup (direct) |
| `POST /api/push/register-native` `{token, platform, workspaces?}` | Bearer | Register watch APNs token (see §8 topic gap) |
| `GET/POST /api/watch/*` (status/enable/add/remove/forget) | Bearer (+Pro) | Lab-Watch list management |
| `GET/PUT/DELETE /api/cases/*` | Bearer (+Pro for sync) | Saved cases |
| `GET /api/billing/status`, `/plans` | Bearer (guest ok) | Entitlement/subscription state |
| `POST /api/push/instruction`, `/task-remind`, `/task-overdue` | Bearer + unit member | ICU escalation actions |
| `/api/ghis/*` (patients, lab, lab-detail, medications, radiology) | **GHIS token** | Census/labs/meds — **relay from phone** |
| ICU collab (Firestore) | Firebase SDK | Units/patients/tasks — **relay from phone** |

**Computed on-device (no network):** ICU auto-scores (`icu-autoscores.js` — pure `MEDCALC` formulas), clinical calculators (`calculators.js`), ABG interpretation, all timers. These are re-expressed in Swift in the core package.

**Additive backend work (approved, isolated):**
- **A. Watch APNs topic** — `functions/_apns.js` hardcodes topic `in.stewardmd.app`; a watch app has bundle id `in.stewardmd.app.watchkitapp`. Add a per-token apns-topic (or `platform:"watchos"`) so independent watch push delivers. *Deferred*: MVP relies on watchOS auto-mirroring phone notifications (zero backend work).
- **B. Remote config** — no feature-flag service exists. Add a small KV-backed `GET /api/watch-config` (flags, kill-switches, min-version, announcements) for Phase 7.
- **C. Favorites** — add `GET/PUT/DELETE /api/favorites` (Firebase-scoped KV, mirroring `functions/api/cases/[[path]].js`) for the backend-backed favorites feature.

---

## 3. Target & module architecture

Four additive units. Existing targets are untouched except entitlements (add App Group) and the additive plugin registration.

```
ios/App/App.xcodeproj
├── App                     (existing iOS Capacitor target — UNCHANGED except +App Group entitlement)
├── StewardMDWatch          (NEW watchOS App target — SwiftUI)
└── StewardMDWatchWidgets   (NEW WidgetKit extension — complications + Smart Stack)

Swift packages
├── ios/App/CapApp-SPM                     (existing — +register capacitor-watch-bridge)
└── Packages/StewardMDWatchCore            (NEW local SwiftPM package, platform-agnostic)
    └── macOS-buildable → `swift build` + XCTest verifiable HERE

local-plugins/capacitor-watch-bridge       (NEW additive Capacitor plugin, mirrors capacitor-app-orientation)
native-watch.js                            (NEW SMD_IS_NATIVE-gated bridge JS, loaded like native-push.js)
```

### 3.1 `StewardMDWatchCore` (the reuse layer — where verification happens)
Platform-agnostic (Foundation only, no WatchKit/UIKit) so it compiles and unit-tests on macOS.

```
Sources/StewardMDWatchCore/
  Models/            Lab, Patient, WatchlistEntry, DrugDose, AntibioticRec,
                     Alert, Task, CaseSummary, Favorite, FeatureFlags, Session
  Networking/        APIClient (URLSession), Endpoint, AuthTokenProvider,
                     DrugAPI (api.stewardmd.in), AppAPI (stewardmd.in/api),
                     RequestSigner (Bearer), ErrorEnvelope, RetryPolicy
  Engines/           CalculatorEngine (qSOFA, NEWS2, GCS, shock index, …),
                     ScoreEngine (SOFA/qSOFA/APACHE adapters port of icu-autoscores),
                     ABGInterpreter, TimerEngine (Code Blue/sepsis/procedure)
  Connectivity/      WCMessage (Codable contracts), WCPayloadStore, AppGroupStore
  Cache/             OfflineStore (versioned JSON), StalenessPolicy (>15 min)
  Design/            SMDColor (OLED tokens), SMDType, SMDSpacing, SMDHaptic (mapping)
  FeatureFlags/      FeatureFlagClient, Flag
Tests/StewardMDWatchCoreTests/  (XCTest — engines, networking decode, staleness, flags)
```

### 3.2 `StewardMDWatch` (watchOS app — thin SwiftUI shell)
```
Views/       HomeView, CriticalLabsView, LabDetailView, WatchlistView,
             PatientGlanceView, WardSyncView, DrugLookupView, AntibioticView,
             CalculatorsView, EmergencyView, CodeBlueView, SepsisTimerView,
             ABGView, HandoverView, RapidToolsGrid, FavoritesView, RecentView
Navigation/  RootListView (vertical list IA), Router (2-taps-max, deep links)
System/      HapticManager (WKInterfaceDevice), CrownScroll modifiers,
             AlwaysOnModifiers, NotificationScene (Short/Long Look)
Intents/     AppIntents (StartCodeBlue, StartSepsisTimer, DrugDose, OpenCriticalLabs)
             + Siri phrases, Action-button intent
Connectivity/ WatchSessionManager (WCSessionDelegate), TokenBridge
Resources/   Assets.xcassets (color set = OLED tokens, app icon), Localizable
```

### 3.3 `StewardMDWatchWidgets` (WidgetKit extension)
Complication families: `.accessoryCircular`, `.accessoryCorner`, `.accessoryRectangular`, `.accessoryInline`, `graphicExtraLarge`, `graphicBezel`. Smart Stack widgets with Relevance API. Timeline reload on APNs; reads shared App Group state; every tap deep-links into the app (never a dead end).

### 3.4 iOS bridge (additive)
- `local-plugins/capacitor-watch-bridge` — Capacitor plugin (copy `capacitor-app-orientation` structure): `publish({uid, idToken, expiresAt, recents, favorites})` → writes App Group `UserDefaults(suiteName:"group.in.stewardmd.app")` + owns a `WCSession`, calls `updateApplicationContext`. Registered in `CapApp-SPM/Package.swift`.
- `native-watch.js` — `SMD_IS_NATIVE`-gated; on `onAuthStateChanged` + ~50-min timer calls `getIdToken()` and `WatchBridge.publish(...)`; subscribes to `SMD_RECENT.onChange` and the new favorites store; clears on sign-out. No-op on web.
- Entitlements: add `com.apple.security.application-groups = ["group.in.stewardmd.app"]` to `App.entitlements` and the watch target.

---

## 4. Data flow & WatchConnectivity architecture

```
┌─────────────── iPhone (Capacitor WebView) ───────────────┐
│  Firebase web SDK (auth state, getIdToken)               │
│        │                                                  │
│  native-watch.js ──► WatchBridge plugin                   │
│        │                    │                             │
│        │           App Group UserDefaults ◄──────────────┐│
│        │                    │  WCSession                 ││
└────────┼────────────────────┼────────────────────────────┘
         │ (relay: GHIS token, │ updateApplicationContext
         │  census, ICU, recents) sendMessage(token refresh)
         ▼                     ▼
┌─────────────── Apple Watch (SwiftUI) ────────────────────┐
│  WatchSessionManager ──► AppGroupStore / OfflineStore     │
│        │                                                  │
│  APIClient(Bearer token) ──► stewardmd.in/api/*           │
│                          └─► api.stewardmd.in (drugs)     │
│  APNs (mirrored) ──► NotificationScene ──► WidgetKit reload│
│  On-device engines ──► Calculators / ABG / Timers         │
└───────────────────────────────────────────────────────────┘
```

**Sync strategy**
- **Push-first, no polling.** APNs (mirrored MVP; independent later) drives alerts and complication/widget timeline reloads.
- **Direct fetch** for drugs (no auth) and token-scoped endpoints (`/api/watch`, `/api/cases`, `/api/billing`, `/api/favorites`).
- **Relayed state** (GHIS census/labs, ICU units/tasks, recents) via `updateApplicationContext` (coalesced latest-state), cached with "as of HH:MM" + stale banner past 15 min.
- **Token freshness:** watch uses bridged token; on 401 or near-expiry requests a fresh one via `WCSession.sendMessage`; if phone unreachable, degrades to offline/cached + on-device tools.
- **Action queue:** acks/task-ticks stored with idempotent IDs, retry with backoff, reconcile on reconnect. Phone is source of truth; conflicts resolve server-side.

---

## 5. Design system (authoritative watch tokens)

OLED dark-mode-first. Canvas `#000000`; surface `#12141C`; accent/Action button `#FF5900`; critical `#FF453A`; warning `#FFC53D`; success `#30D158`; info `#34C6F4`; teal `#25CCBC`; AI/engine `#BF5AF2`; nav navy `#0A1B52`; text-1 `#FFFFFF`; text-2 `#EBEBF5`@60%; patient blue `#8FB0FF`. Reference-range gauge gradient `#34C6F4 → #30D158(40%) → #FFC53D(70%) → #FF453A`.

Type: SF Pro, **tabular numerals always**, min 11 pt, Dynamic Type→XXL. Scale: Numeral XL 34–52 Rounded-700; Title 20–22 Semibold; Headline 16–17 Semibold; Body 14–15; Caption 11–12. Spacing 4-pt grid (4/8/12/16/24), screen margin 8–12, card padding 10–14. Radius: chip 8, card 14, button 20, pill full. Motion: push/pop 250 ms, fade 150 ms, gauge 400 ms, `cubic-bezier(.2,0,0,1)`, no bounce, respects Reduce Motion.

**Haptic tiers:** Critical = double strong + repeat @30 s; Warning = directional up single firm; Info = light click; Success = success chime. Color never sole signal — always icon + label + position. AA 4.5:1 on black.

Full screen inventory, per-module contents, complication/widget specs, notification variants, a11y and edge-case matrices are captured in the design brief and reproduced in the per-phase implementation plans.

---

## 6. Feature placement (brief §01 + verified feasibility)

- **On the wrist (P0/P1):** Critical Labs + ack, Watchlist/NEWS2, Ward Sync census, ICU deterioration, Antibiotic summary, Drug dose, Favorite calculators, Tasks/reminders.
- **Born on the wrist:** Code Blue toolkit, Sepsis 1-h bundle timer, door-to-needle/procedure timers, bedside scores/shock index, ABG interpreter, handover assistant, Siri shortcuts, Action-button launch.
- **Stays on iPhone (deep-link out):** full monographs, guideline docs, Antibiotic Engine full inputs, notes/chart, order entry, deep trends, admin/config, full chart.

---

## 7. Phasing (maps task Phases 0–8 → verifiable increments)

| # | Increment | Task phases | Verify | Recovery tag |
|---|---|---|---|---|
| 0 | Codebase analysis (this spec) | 0 | — | — |
| 1 | Core package + iOS bridge + Xcode targets scaffold | 1, 2 | `swift build`+XCTest core; bridge no-op on web | `watch-infra` |
| 2 | Triage core: Home, Critical Labs→ack, Notifications, Drug lookup, Code Blue | 4 (partial) | core tests; review UI | `watch-triage-core` |
| 3 | Widgets & complications (all families) + Smart Stack | 5 | review; snapshot logic tests | `watch-widgets` |
| 4 | Workflow: Watchlist/glance, Ward Sync, Calculators, Sepsis/procedure timers, ABG, Handover, Siri/Intents | 4 (rest) | core engine tests | `watch-workflow` |
| 5 | iPhone Settings → Apple Watch page | 3 | web smoke; no regressions | `watch-settings` |
| 6 | Remote feature management (`/api/watch-config`, flags, kill-switch) + favorites backend | 7 | endpoint tests; flag-client tests | `watch-remote-mgmt` |
| 7 | Perf, production hardening, deliverables (docs, checklists) | 6, 8 | full review | `watch-rc1` |

Each phase: small commits, recovery tag before starting, stop with a summary before proceeding.

---

## 8. Risks & open items
- **watchOS runtime not installed here** → SwiftUI/WidgetKit shells verified by review only; core package is the compile-tested backbone. User builds in Xcode 27.
- **`project.pbxproj` edits are fragile** → per decision 5, I will NOT edit `project.pbxproj`. All files are authored in the correct structure; `WATCH_XCODE_SETUP.md` gives the exact Xcode steps to add targets + package refs + capabilities so the project builds without further code changes.
- **APNs topic gap** → MVP uses notification mirroring; independent watch push is Phase 6 additive backend work.
- **GHIS/ICU can't be fetched by the watch** → relayed from phone; if phone unreachable, those views show cached + stale banner.
- **Apple IAP webhook is a scaffold** → subscription-gated watch features read the existing Pro claim; StoreKit wiring is out of scope unless requested.
- **Provisioning** (App Group on the App ID, watch bundle ids under team `5QY4LUKX23`) is a user step in the Apple Developer portal.

---

## 9. Deliverables (produced at Phase 7)
Architecture overview · folder structure · new files created · files modified · data-flow diagram · WatchConnectivity architecture · sync strategy · future extensibility notes · testing checklist · remaining optional enhancements.
