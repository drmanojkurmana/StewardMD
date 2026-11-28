---
tags: [plan, prepnucleus, focus, ios, prompt]
---
# Mac session prompt: PrepNucleus Focus iOS app blocking

Paste everything below the line into Claude Code on the Mac (repo checkout, Xcode installed, iPhone on USB).

---

You are adding real app blocking to PrepNucleus Focus in the StewardMD iOS app. The JS side is done and already calls a
native Capacitor plugin named `SmdFocus`; your job is that plugin plus three Screen Time extensions, built, installed
and verified on the iPhone. Follow `CLAUDE.md` (native build gotchas, verify the running bundle, installing wipes app data).

## Start
1. `git fetch origin && git checkout feat/onboard-story && git checkout -b feat/prep-focus-ios`
   (`feat/onboard-story` contains `feat/prep-focus`.) Do not merge anything into `main`.
2. Read, in order: `vault/plans/PrepNucleus-Focus.md` (the contract), the header of `prep-focus.js` (how JS calls the
   plugin; search it for `natCall`), `ios/App/App/MainViewController.swift` (how `SmdDevicePlugin` is registered with
   `bridge?.registerPluginInstance`, `CAPBridgedPlugin`, `jsName`), `ios/App/App/App.entitlements`.
3. Facts already checked: main bundle ID `in.stewardmd.app`; App Group `group.in.stewardmd.app` exists; iOS deployment
   target 17.0 (Family Controls needs 16+, so no `#available` guards for it); the project is Capacitor SPM, build the
   `App` scheme of `ios/App/App.xcodeproj` (there is no `.xcworkspace`); export
   `DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"` per command.

## The plugin: `ios/App/App/SmdFocusPlugin.swift`
`@objc(SmdFocusPlugin) public class SmdFocusPlugin: CAPPlugin, CAPBridgedPlugin`, `jsName = "SmdFocus"`, registered in
`MainViewController` next to `SmdDevicePlugin`. Every method **resolves** (never rejects for "unavailable"); JS treats a
missing plugin or a failed call as "no blocking".

| Method | Resolves | Do |
|---|---|---|
| `status()` | `{ available: true, authorized, apps, categories, domains }` | `authorized` = `AuthorizationCenter.shared.authorizationStatus == .approved`; counts from the saved selection's `applicationTokens`, `categoryTokens`, `webDomainTokens` |
| `authorize()` | `{ authorized }` | `try await AuthorizationCenter.shared.requestAuthorization(for: .individual)`; catch -> `authorized: false` |
| `pick()` | `{ apps, categories, domains }` | present SwiftUI `FamilyActivityPicker(selection:)` in a `UIHostingController` sheet with Cancel / Done; on Done save the `FamilyActivitySelection` (it is `Codable`) as JSON in `UserDefaults(suiteName: "group.in.stewardmd.app")` key `prepFocusSelection` |
| `start({ endsAt, strict, title, plan })` | `{ shielding }` | load the selection; `let store = ManagedSettingsStore(named: .init("prepFocus"))`; `store.shield.applications = apps`, `store.shield.applicationCategories = .specific(categories)`, `store.shield.webDomains = domains`. Save `endsAt` (ms epoch, may be null for a stopwatch) and `strict` to the App Group (`prepFocusEndsAt`, `prepFocusStrict`). If `endsAt` is set: `DeviceActivityCenter().stopMonitoring([.prepFocus])` then `startMonitoring(.prepFocus, during: DeviceActivitySchedule(intervalStart: now comps, intervalEnd: endsAt comps, repeats: false))`. A second `start` mid-session (the "Finish in 5 minutes" button) must replace the schedule and keep the shield. DeviceActivity rejects intervals under 15 minutes: when `endsAt - now < 15 min`, start the interval earlier (now - 15 min) so it still ends at `endsAt`, and also keep an in-app `Timer` as a backup that calls the same clear. |
| `stop()` | `{}` | `store.clearAllSettings()`, `stopMonitoring([.prepFocus])`, remove the App Group keys |

`extension DeviceActivityName { static let prepFocus = Self("prepFocus") }` in a file shared with the monitor extension.

## Three extension targets (Xcode: File > New > Target)
Bundle IDs under `in.stewardmd.app.`: `FocusMonitor`, `FocusShield`, `FocusShieldAction`. Each gets the Family Controls
capability and the App Group `group.in.stewardmd.app`. Embed them in the App target.
1. **Device Activity Monitor**: `intervalDidEnd(for:)` -> `ManagedSettingsStore(named: .init("prepFocus")).clearAllSettings()`
   and clear the App Group keys. This is what removes the shield when PrepNucleus was killed.
2. **Shield Configuration**: same look for app, category and web shields. Background `#1a1a2e` (Midnight), title
   "Back to studying" in `#f5f3ee`, subtitle "PrepNucleus Focus is on" plus "until h:mm" when `prepFocusEndsAt` is
   readable, icon from the PrepNucleus mark (`prep/art/logo-mark-amber-96.webp`, export a PNG into the extension's
   assets), primary button "OK" in amber `#efc07b` with label colour `#1a1a2e`. No em dashes in any text.
3. **Shield Action**: primary -> `.close`. Secondary: none. (iOS does not let a shield open another app directly.)

Entitlements: add `com.apple.developer.family-controls` = true to `App.entitlements` and each extension's entitlements.
Development builds work at once. **TestFlight and App Store need Apple's approval of the Family Controls (Distribution)
request for the app and each of the three extension bundle IDs**: tell the owner to file it, do not block on it.

## Build, install, verify
1. Build the `App` scheme for the device. Find the product with `find ios/DerivedData -name App.app`. Check the built
   `public/index.html` carries `prep-loader.js?v=prep203` and `onboard-story.js?v=story1`, and that
   `App.app/App.debug.dylib` (not `App`) contains `SmdFocusPlugin`. Check `App.app/PlugIns/` has all three `.appex`.
2. Warn the owner before installing: installing wipes app data (sign-in, SURGX notes). Then `devicectl` uninstall +
   install, and read the `?v=` token from the live WebView (`ios_webkit_debug_proxy`, `test/ios-webkit-cdp.mjs`, wrap
   commands in `Target.sendMessageToTarget`).
3. Turn the feature on in the WebView: `localStorage.setItem("smd_prep_focus","1")`, reload. Open PrepNucleus > Play >
   Focus.
4. Acceptance, on the phone:
   - Block distracting apps row: tap -> Screen Time permission sheet -> Allow -> picker -> pick Instagram and the Games
     category -> the row reads "1 app, 1 category" (counts from `status()`).
   - Block during focus on, Timer 25m, Start. Open Instagram: the PrepNucleus shield shows. Safari to a domain picked as
     a website: blocked.
   - End session -> End and save: Instagram opens normally right away.
   - Strict mode on, Start, force-quit StewardMD, wait past `endsAt` (use a short custom `endsAt` from the WebView console:
     `Capacitor.Plugins.SmdFocus.start({ endsAt: Date.now() + 120000, strict: true })`): the shield clears on its own.
   - "Finish in 5 minutes" mid-session: the shield stays and now ends 5 minutes later.
   - Without permission (`Settings > Screen Time` revoked): Focus still runs as a timer, no crash, row says "Not set up".
5. Run `npm test` and `node test/run-prep-focus-ui.mjs` (JS unchanged, but confirm).

## Finish
- Commit only the files you touched (stage explicitly; other sessions edit this repo). Push `feat/prep-focus-ios`.
- Update `vault/plans/PrepNucleus-Focus.md` (Phase 2 status, bundle IDs, anything that differed) and
  `vault/modules/PrepNucleus.md` (Focus section: "seen on a phone" when it is).
- Report: what passed on the phone, screenshots of the shield and the picker, and whether the Family Controls
  distribution request still needs filing.
