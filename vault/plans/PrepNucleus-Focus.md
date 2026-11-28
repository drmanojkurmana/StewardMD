---
tags: [plan, prepnucleus, focus, ios]
---
# PrepNucleus Focus: focus timer with app blocking

Owner 2026-11-28: "add Regain like Focus Timer with app blocker on PrepNucleus, all features it has, 10x better, 10x better UI".
Owner decision 2026-11-28: **blocking free, extras Pro** (strict mode now; website blocking and schedules later).
Owner decision 2026-11-28: **iOS work runs in a separate Mac session** (Xcode + command line). This note is its brief.
Regain teardown and the full feature table: the Claude Docs page "Regain teardown, StewardMD onboarding plan, PrepNucleus Focus".

## Phase 1 (done, branch `feat/prep-focus`): JS only
- `prep-focus.js` (`window.PREP_FOCUS`) + `prep-focus.css`. Flag `smd_prep_focus`, default **OFF** (`?focus=1` / `"1"`).
  Off: `PREP_FOCUS` stays undefined and the Play "Focus room" is unchanged.
- Entry: Play section row "Focus" (was "Focus room"). `prep-play.js` hands `v-focus` and `open("focus")` to `PREP_FOCUS.open`.
- Hooks in `prep.js`: `fo-` data-act prefix, `back()`, `leave()`, `noteAnswer(it, ok)` from `record()`.
- Screens: Focus home (goal ring, Timer / Pomodoro / Stopwatch, durations, blocking row, strict switch, today timeline,
  week, recent), running (Prussian hero surface, one ring, clock, "This session" card with answers and subject, Study now,
  End), Leave early? sheet (Keep going / Finish in 5 minutes / End and save), summary.
- Run state: `localStorage smd_prep_focus_run` (wall clock; survives a killed app). Log: store `fo` (see file header).
  `fxm` month minutes shared with Play's Wrapped. Live count rides `/api/prep/play/focus` heartbeats (signed in).
- Tests: `test/prep-focus.test.mjs` (engine), `test/run-prep-focus-ui.mjs` (headless, `SHOTS=<dir>`).

## Phase 2 (Mac session): iOS `SmdFocus` plugin
**Status 2026-11-28, branch `feat/prep-focus-ios` (from `feat/onboard-story`):** code written.
- `ios/App/App/SmdFocusPlugin.swift` (registered in `MainViewController.capacitorDidLoad`), `ios/App/App/SmdFocusShared.swift`
  (App Group keys `prepFocusSelection`, `prepFocusEndsAt`, `prepFocusStrict`; `DeviceActivityName.prepFocus`; store
  `prepFocus`), compiled into App, FocusMonitor and FocusShield.
- Extension targets (synchronized folders, like `StewardMDExtension`), embedded in App, iOS 17.0, Family Controls + App
  Group entitlements each: `in.stewardmd.app.FocusMonitor` (`ios/App/FocusMonitor`), `in.stewardmd.app.FocusShield`
  (`ios/App/FocusShield`, icon `PrepMark` from `prep/art/logo-mark-amber-96.webp`), `in.stewardmd.app.FocusShieldAction`.
  `App.entitlements` has `com.apple.developer.family-controls`.
- Differs from the table below: the shield's button is "OK" and closes the blocked app (iOS does not let a shield open
  another app), no secondary button. A picked category also shields that category's websites (`webDomainCategories`).
  `stop()` keeps the selection (it is the student's pick) and clears only the session keys. The monitor leaves the
  shield up when `prepFocusEndsAt` is more than a minute ahead (a "Finish in 5 minutes" restart wrote a newer end before
  the old schedule stopped). Sessions under 15 minutes start the DeviceActivity interval in the past; an in-app Timer and
  `load()` (end already passed) clear as backups.
- Verified: the three extensions build for the simulator with no warnings; the plugin type-checks against Capacitor.
  Open: full `App` scheme build (needs `-skipPackagePluginValidation` for mlx-swift's CudaBuild plugin), simulator run,
  phone acceptance (Screen Time does not shield in the Simulator), Family Controls (Distribution) request for the app
  and the three extension bundle IDs (owner files it; needed for TestFlight / App Store only).

The JS already calls these. Register like `SmdDevicePlugin` in `ios/App/App/MainViewController.swift`
(`bridge?.registerPluginInstance(...)`, `CAPBridgedPlugin`, `jsName = "SmdFocus"`). Every method resolves; never reject
for "not available" (JS treats null/failed as "no blocking").

| Method | Resolves | Notes |
|---|---|---|
| `status()` | `{ available, authorized, apps, categories, domains }` | counts of the saved `FamilyActivitySelection` tokens; `available:false` below iOS 16 |
| `authorize()` | `{ authorized }` | `AuthorizationCenter.shared.requestAuthorization(for: .individual)` |
| `pick()` | `{ apps, categories, domains }` | present `FamilyActivityPicker` in a `UIHostingController` sheet; persist the selection (App Group `group.in.stewardmd.app`, JSON-encoded) so extensions can read it |
| `start({ endsAt, strict, title, plan })` | `{ shielding }` | `ManagedSettingsStore(named: .init("prepFocus"))`: shield `applications`, `applicationCategories` (`.specific`), `webDomains`. `endsAt` ms epoch or `null` (stopwatch). When `endsAt` is set, also `DeviceActivityCenter().startMonitoring` a one-off schedule ending at `endsAt` so the monitor extension clears the shield even if the app is killed. Called again mid-session with a new `endsAt` ("Finish in 5 minutes"): replace the schedule. |
| `stop()` | `{}` | clear the store, stop monitoring |

Targets to add (all need the Family Controls capability):
1. **DeviceActivityMonitor extension**: `intervalDidEnd` clears the `prepFocus` store.
2. **ShieldConfiguration extension**: PrepNucleus look (Midnight `#1a1a2e` background, amber `#efc07b` accent, title
   "Back to studying", subtitle with the time left if readable from the App Group, primary button "Open PrepNucleus").
3. **ShieldAction extension**: primary button opens PrepNucleus (or closes the shield); secondary does nothing in strict.

Entitlement: `com.apple.developer.family-controls` on App and each extension. Development builds work at once;
**App Store / TestFlight distribution needs Apple's approval per bundle ID** (Family Controls distribution request form).
File that request first. `Info.plist`: no usage string is required for Family Controls.

Strict mode on iOS: JS disables End; the shield stays until `endsAt`. A user can still revoke Screen Time access in
Settings; the UI says End is locked, nothing more.

Verify on a phone: start a 2 minute timer with Block on, open a blocked app (shield shows), kill PrepNucleus, wait for
the end (shield clears), check `__nat` order in the UI test's stand-in matches the real plugin.

## Later phases
3. Live Activity / Dynamic Island countdown and a "Start focus" widget (existing `prep-native.js`, `StewardMDWidgets`).
4. Android: usage access + foreground service + blocking activity behind the same `SmdFocus` surface.
5. Screen Time report (DeviceActivityReport extension, native sheet), schedules from the timetable, study rooms.
