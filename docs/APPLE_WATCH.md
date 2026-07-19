# StewardMD Apple Watch — Integration Guide & Deliverables

Native watchOS extension of StewardMD. Built as a production, App-Store-ready
part of the platform — not a notification mirror. This document is the canonical
architecture + handoff reference.

**Setup to build it:** see [`WATCH_XCODE_SETUP.md`](../WATCH_XCODE_SETUP.md).
**Design source of truth:** the StewardMD Watch Design Brief (v1.0).
**Spec / plans:** `docs/superpowers/specs/` and `docs/superpowers/plans/`.

---

## 1. Architecture overview

StewardMD is a **Capacitor web app** (vanilla JS) + **Cloudflare/Firebase**
backend; there is no native Swift business logic. A truly native watch app
therefore **reuses the backend HTTP contracts and Firebase**, not code, and gets
its session from the paired iPhone. Three principles shaped the build:

1. **Logic lives in a platform-agnostic Swift package** (`StewardMDWatchCore`)
   that compiles and unit-tests on macOS — so the hard parts (models, networking,
   clinical engines, gating, connectivity) are verified with `swift test` even
   without a watchOS runtime. **133 tests.**
2. **The watch app + widgets are thin SwiftUI shells** over that package.
3. **Everything is additive** — a new SwiftPM package, two new Xcode targets,
   one new Capacitor plugin, three new backend endpoints, and a settings page.
   Only 5 existing files changed, all additively (§4).

```
              ┌───────────────────── StewardMDWatchCore (SwiftPM, macOS-testable) ─────────────────────┐
              │ Models · Networking(APIClient/DrugAPI/AppAPI) · Engines(calc/ABG/timers) ·             │
              │ ViewModels · FeatureGate/Flags · Connectivity(WCMessage/AppGroupStore) · Design tokens │
              └───────────────▲───────────────────────────────▲───────────────────────▲───────────────┘
                              │ depends on                     │ depends on            │ depends on
        ┌─────────────────────┴──────┐        ┌────────────────┴───────┐     ┌─────────┴──────────────┐
        │ StewardMDWatch (watchOS app)│        │ StewardMDWatchWidgets  │     │ (iOS phone) capacitor- │
        │ SwiftUI · Crown · haptics · │        │ complications +        │     │ watch-bridge plugin +  │
        │ App Intents/Siri · notif.   │        │ Smart Stack (WidgetKit)│     │ native-watch.js        │
        └─────────────────────────────┘        └────────────────────────┘     └────────────────────────┘
```

**Backends the watch talks to:** `api.stewardmd.in` (drug search, public/no-auth)
and `stewardmd.in/api/*` (Firebase-Bearer: `/watch`, `/watch/ack`, `/cases`,
`/favorites`, `/billing`, `/watch-config`). GHIS census / ICU / recents are
**relayed from the iPhone** (they need the GHIS token / Firestore SDK the watch
can't hold). Timers, calculators, ABG and scores run **on-device**.

---

## 2. Folder structure

```
Packages/StewardMDWatchCore/            # shared, platform-agnostic, unit-tested
  Sources/StewardMDWatchCore/
    Actions/         Ack, AckQueue, AckSender (+ HTTPAckSender / LoggingAckSender)
    Cache/           StalenessPolicy
    Calculators/     CalculatorCatalog
    Connectivity/    WCMessage, AppGroupStore
    Design/          SMDColor/Palette, SMDSpacing, SMDType, SMDHaptic
    Engines/         CalculatorEngine, ABGInterpreter, TimerEngine
    Favorites/       FavoritesStore
    FeatureFlags/    FeatureFlags, FeatureFlagClient, FeatureGate, SemVer
    Formatting/      TimeFormat
    Input/           CrownField
    Models/          Lab, Patient, Drug, Antibiotic, CaseSummary, Favorite,
                     Billing, Session, TaskItem
    Networking/      APIClient, Endpoint, APIError, AuthTokenProvider, DrugAPI, AppAPI
    Notifications/   NotificationPayload (parser)
    ViewModels/      CriticalLabs, DrugLookup, CodeBlue, Sepsis, Procedure, ABG,
                     Handover, Watchlist
    Widgets/         GlanceState, RelevanceScorer
  Tests/StewardMDWatchCoreTests/        # 133 tests, 24 files

ios/StewardMDWatch/                     # watchOS app target (SwiftUI)
  *App.swift, RootListView, {module views}, WatchSessionStore
  System/       AppRouter, WatchServices, FeatureFlagsModel, GlancePublisher,
                HapticManager, WatchAppDelegate, WatchConnectivityManager
  Components/   SeverityChip, ReferenceGauge
  Notifications/ NotificationController
  Intents/      AppIntents, AppShortcuts
  Assets.xcassets, Info.plist, StewardMDWatch.entitlements

ios/StewardMDWatchWidgets/              # WidgetKit extension
  StewardMDWatchWidgets (bundle), GlanceProvider, Complications,
  SmartStackWidgets, WidgetViews, Info.plist, entitlements

local-plugins/capacitor-watch-bridge/   # additive iOS Capacitor plugin
  ios/Sources/WatchBridgePlugin/{WatchBridgePlugin, WatchConnectivityRelay}.swift

functions/api/watch-config.js            # remote flags/kill-switch/version
functions/api/favorites/[[path]].js      # cross-device favorites
functions/api/watch/[[path]].js          # (+ POST /ack route)
native-watch.js                          # phone→watch bridge JS
watch-settings.js                        # Settings ▸ Apple Watch page
```

---

## 3. New files created

**131 new files** (from the branch base). By area:
- **Core package:** 1 `Package.swift` + 51 sources + 24 test files (133 tests).
- **Watch app:** 27 files (app, 14 views, 7 System/, 2 Components/, notification
  controller, 2 Intents/, Info.plist, entitlements, 3 asset-catalog JSON).
- **Widget extension:** 6 files.
- **iOS bridge plugin:** 4 files (`package.json`, `Package.swift`, 2 Swift).
- **Backend:** `functions/api/watch-config.js`, `functions/api/favorites/[[path]].js`.
- **Web:** `native-watch.js`, `watch-settings.js`.
- **Docs:** 1 spec + 6 phase plans + `WATCH_XCODE_SETUP.md` + this file.

(Full enumeration: `git diff --name-status <branch-base>..HEAD | grep ^A`.)

---

## 4. Files modified (existing) — all additive, no behavior removed

| File | Change |
|---|---|
| `ios/App/App/App.entitlements` | + App Group `group.in.stewardmd.app` |
| `package.json` | + `@stewardmd/capacitor-watch-bridge` (file: dep) |
| `index.html` | + 2 `<script>` tags (`native-watch.js`, `watch-settings.js`) |
| `sidebar-redesign.js` | + watch icon, `ACT.applewatch`, one Settings row |
| `functions/api/watch/[[path]].js` | + `POST /api/watch/ack` route (before the Lab-Watch guard) |

> **Not touched:** `project.pbxproj` (targets added in Xcode per the setup guide),
> and `CapApp-SPM/Package.swift` (regenerated by `npx cap sync ios`). No web
> clinical logic, no auth/fetch/push code, and nothing in the Experimental Access
> work was modified.

---

## 5. Data-flow diagram

```
  iPhone (Capacitor WebView)                         Apple Watch (SwiftUI)
  ─────────────────────────                          ─────────────────────
  Firebase web SDK (auth)                            WatchSessionStore
       │ getIdToken()                                 │  reads App Group
       ▼                                              ▼
  native-watch.js ──publish()──► WatchBridge ──┐   AppGroupStore  ◄── WCSession
  (auth-state / 50-min timer /   (plugin)       │   (session, favorites,     applicationContext
   visibility / recents change)                 ├──► group.in.stewardmd.app   (coalesced, latest)
                                                 │                     │
  relay: GHIS token, census, ICU, recents ──WCSession──────────────────┘
                                                                       │
  APNs (server) ──push──► iPhone ──mirror──► Watch notifications        ▼
                                             (Short/Long Look)      APIClient(Bearer token)
                                                                       ├─► api.stewardmd.in (drugs, no auth)
                                                                       └─► stewardmd.in/api/* (watch, ack,
                                                                            cases, favorites, billing, config)
  On-device only: CalculatorEngine · ABGInterpreter · CodeBlue/Sepsis/Procedure timers
  Widgets/complications: read GlanceState from App Group; reload on push / GlancePublisher
```

---

## 6. WatchConnectivity architecture

> **Key fact:** App Group `UserDefaults` is **per-device** — it does *not* cross
> the iPhone↔Watch boundary. It's used only for *on-device* sharing (iPhone
> app↔bridge on the phone; watch app↔widget extension on the watch). The **only**
> cross-device transport is WatchConnectivity.

- **iPhone side** (`WatchConnectivityRelay` in the bridge plugin) owns the phone's
  `WCSession`, activates it at plugin load, and on every `publish()` calls
  `updateApplicationContext` (latest-wins, coalesced — ideal for "current session
  + favorites + relayed state"). It also mirrors the payload into the *phone's*
  App Group (for phone-side reads only).
- **Watch side** (`WatchConnectivityManager`, a `WCSessionDelegate`) receives
  `didReceiveApplicationContext` (and reads `receivedApplicationContext` on
  activation), then persists session/favorites/glance/notifPrefs into the
  *watch's own* App Group (so the watch app **and** its widget extension read it)
  and posts `.smdWatchDataUpdated` to refresh the UI. A **token-refresh request**
  flows watch→phone via `sendMessage(["kind":"tokenRequest"])`; the relay
  re-emits it as a JS event (`tokenRequested`) so `native-watch.js` republishes a
  fresh Firebase ID token, which comes back on the next `applicationContext`.
- **No WC entitlement needed** — it works once both targets exist and are paired.
- **Message contracts** are Codable (`WCMessage`/`WCMessageKind`) in the core
  package so both ends share one definition.

---

## 7. Sync strategy

- **Push-first, no polling.** APNs (mirrored from the iPhone in the MVP) drives
  alerts and WidgetKit timeline reloads (`WidgetCenter.reloadAllTimelines`).
- **Direct fetch** for the public drug API and token-scoped endpoints.
- **Relayed state** (census/ICU/recents) via `updateApplicationContext`, cached
  with an "as of HH:MM" stamp and a **>15-minute stale banner** (`StalenessPolicy`).
- **Token freshness:** the watch uses the bridged token; on 401/near-expiry it
  requests a fresh one from the phone; if unreachable it degrades to cached data
  + on-device tools.
- **Action queue:** acknowledgements are optimistic on-screen, persisted with
  **idempotent IDs** (`AckQueue` + App Group), retried on flush, and synced to
  `POST /api/watch/ack` (idempotent server-side). Phone is source of truth.
- **Feature config** (`/api/watch-config`) fetched on launch/activation; offline
  falls back to `FeatureFlags.shippedDefaults` so shipped features always work.

---

## 8. Future extensibility notes

- **Remote feature management is already in place** — add a flag key in the
  backend `DEFAULTS`, gate a `WatchFeature`, and toggle it live via
  `POST /api/watch-config` (owner). Kill switch, min-version, and announcement
  are honored by `FeatureGate` with zero app update.
- **New module** = a core ViewModel (+ tests) + a thin SwiftUI view + a
  `RootDestination`/`EmergencyRoute` case + (optional) an App Intent. The pattern
  is uniform across the 8 modules already built.
- **New complication/widget** = one `Widget` reading `GlanceState` with a
  `RelevanceScorer` kind. Add fields to `GlanceState` (Codable) as needed.
- **Specialty modules** map naturally to feature flags keyed per specialty.
- **Independent watch push** (when the phone is unreachable) needs a small backend
  change: a per-token APNs topic for `in.stewardmd.app.watchkitapp` (the MVP
  relies on watchOS mirroring — zero backend work).

---

## 9. Testing checklist

**Automated (runs here):**
- [x] `cd Packages/StewardMDWatchCore && swift test` → 133 pass (engines, models,
      networking, gating, connectivity, timers, ack queue).
- [x] `npm test` → existing web/rx suites pass (no regression).
- [x] `node --check` on all new/edited JS + backend functions.

**Manual in Xcode (after `WATCH_XCODE_SETUP.md`):**
- [ ] Watch scheme builds + launches to the six-row Home.
- [ ] Sign in on iPhone → watch shows session; API calls authorize.
- [ ] Critical-lab push → Long Look → Acknowledge → success haptic; ack survives
      offline and syncs on reconnect (`/api/watch/ack`).
- [ ] Drug lookup returns results (no auth needed).
- [ ] Code Blue timer: 2-min cycle haptic; summary on end.
- [ ] Sepsis timer checklist + nudge; procedure stopwatch; ABG Crown dials.
- [ ] Calculators (qSOFA/NEWS2/GCS/shock) via Crown/toggles; favorite a calc.
- [ ] Complications on a face + Smart Stack ordering; tap deep-links in.
- [ ] Siri: "start code blue"/"sepsis timer"/"critical labs"; Action button → Code Blue.
- [ ] iPhone Settings ▸ Apple Watch: pairing auto-detected, Sync now, toggles,
      diagnostics, 7-tap developer info.
- [ ] Accessibility: VoiceOver reads severity as text; Dynamic Type to XXL; Reduce Motion.
- [ ] Ultra & 40 mm sizes; Always-On (Code Blue timer legible).

---

## 10. Remaining work & optional enhancements

**Genuinely remaining to be "fully live" (need phone-side data + Apple APIs):**
- ~~Phone-side relay of GHIS census / watchlist.~~ **Done** — `native-watch.js`
  gathers `watchlist()` (ICU roster w/ NEWS2, GHIS worklist fallback) + `census()`
  and publishes them; the plugin forwards them; `WatchConnectivityManager` merges
  the glance (preserving the watch-owned critical badge) and persists the
  watchlist. My Patients + Ward Sync populate from live GHIS/ICU state, including
  **per-patient vitals** (latest HR/BP/SpO₂/Temp from ICU `state.vitals`, shown in
  the patient glance). *Still not relayed (no client-side source):* a true bed
  denominator and task counts — see the data-source notes.
- **`WKExtendedRuntimeSession`** for the Code Blue / sepsis timers so the display
  ticks live in Always-On and the 2-min haptic fires with the wrist down. Timers
  are now wall-clock-accurate on glance; this makes them live-in-background.
- **Structured critical-lab push payload** (analyte/value/severity) so the watch
  shows the exact value, not just "New result — <patient>" (additive backend).

**Optional enhancements:**
- Cache last-known Pro state so subscription-gated rows don't lock when offline.
- Independent watch APNs token + per-topic backend push (phone-unreachable alerts).
- Interactive complications / Smart Stack actions (acknowledge without opening).
- Enforce relayed notification-tier prefs on the watch (currently stored, not yet gated).
- Live 7-day lab trend on the Crown in Lab detail (currently a hook).
- One Crown-focused field per screen for multi-field calculators (NEWS2/ABG UX).
- Bundle a distilled offline drug/dose subset for zero-network lookup.
- Localization/RTL + mmol/L↔mg/dL unit locale (string catalog scaffolded).
- Bridge watch-local favorites ↔ `/api/favorites` for full cross-device sync.

---

## Performance & battery

- **True-black OLED** palette; minimal motion (respects Reduce Motion); AOD-safe
  tabular timers. **Push-first, no polling.** Widget/complication reloads are
  coalesced within WidgetKit's budget (hourly floor + push).
- **Native SwiftUI + lazy `List`s**; the heavy logic is value-type + `actor`-isolated,
  image-light. Core package has no third-party dependencies.
- Networking is `URLSession` with a shared client; drug lookup hits a public,
  rate-limited Worker (no auth round-trip).

## Accessibility & HIG

- Severity is **never color-only** — always icon + label + position; palette
  clears AA 4.5:1 on black. VoiceOver labels on chips/gauges. Dynamic Type scale
  defined; tap targets ≥ 44 pt; Digital Crown reaches every numeric input.
- Uses only supported WidgetKit accessory families (legacy ClockKit ExtraLarge/
  Bezel intentionally omitted — documented, not faked).

## App Store readiness & honest caveats

- **Additive & isolated:** no existing feature removed; web suites green; the
  Experimental Access work is untouched.
- **Build/verify caveat:** this environment has Xcode 27 but **no watchOS
  simulator runtime**, so the SwiftUI/WidgetKit/App-Intents shells are
  **review-verified, not compile-run here**; the core package IS compiled + tested.
  Final build/run is in the user's Xcode (see setup guide).
- **Provisioning (user):** enable App Groups on the `in.stewardmd.app` App ID and
  add the watch bundle ids under team `5QY4LUKX23`.
- **App icon art** is a design deliverable (the asset slot + color set are in place).
