# StewardMD Apple Watch — Xcode Setup

This repo ships **all** watch source, the shared Swift package, the iOS bridge
plugin, entitlements, Info.plists, and asset catalogs. It does **not** edit
`ios/App/App.xcodeproj/project.pbxproj` (that file is fragile and must be wired
in Xcode). Follow these steps once; afterwards the project builds with no
further code changes.

**Prerequisites:** Xcode 27+, a watchOS 10+ simulator runtime installed
(`Xcode ▸ Settings ▸ Components`), Apple Developer team `5QY4LUKX23`.

---

## 0. Regenerate Capacitor packages (picks up the watch bridge plugin)

```bash
npm install                 # links @stewardmd/capacitor-watch-bridge (file: dep)
npm run build:www           # assembles www/ (includes native-watch.js)
npx cap sync ios            # regenerates ios/App/CapApp-SPM/Package.swift to
                            # include StewardmdCapacitorWatchBridge
```

Open the project:

```bash
npx cap open ios            # opens ios/App/App.xcodeproj
```

Confirm the phone `App` target builds and runs as before (no regressions).

---

## 1. Add the shared Swift package

1. **File ▸ Add Package Dependencies… ▸ Add Local…**
2. Choose `Packages/StewardMDWatchCore`.
3. Add product **StewardMDWatchCore** to the targets that use it (the watch app
   and the widget extension in the steps below). It is **not** needed by the
   iPhone `App` target.

---

## 2. Create the Watch App target

1. **File ▸ New ▸ Target… ▸ watchOS ▸ App.**
2. Product Name: **StewardMDWatch**  ·  Interface: **SwiftUI**  ·  Language:
   **Swift**  ·  Bundle Identifier: **in.stewardmd.app.watchkitapp**  ·  Team:
   **5QY4LUKX23**  ·  "Watch App for iOS App": select the existing **App**.
3. When prompted to activate the new scheme, choose **Activate**.
4. Delete the Xcode-generated `StewardMDWatchApp.swift`, `ContentView.swift`,
   `Assets.xcassets`, and `Info.plist` from the new target group.
5. **Add Files to "StewardMDWatch"…** → add everything under
   `ios/StewardMDWatch/` (`StewardMDWatchApp.swift`, `RootListView.swift`,
   `WatchSessionStore.swift`, `Assets.xcassets`, `Info.plist`,
   `StewardMDWatch.entitlements`). Ensure **Target Membership = StewardMDWatch**.
6. In the target's **Build Settings**:
   - `INFOPLIST_FILE = ios/StewardMDWatch/Info.plist`
   - `GENERATE_INFOPLIST_FILE = NO`
   - `CODE_SIGN_ENTITLEMENTS = ios/StewardMDWatch/StewardMDWatch.entitlements`
   - `WATCHOS_DEPLOYMENT_TARGET = 10.0`
7. **General ▸ Frameworks and Libraries** → add **StewardMDWatchCore**.

---

## 3. Create the Widget Extension target

1. **File ▸ New ▸ Target… ▸ watchOS ▸ Widget Extension.** Uncheck "Include Live
   Activity" and "Include Configuration Intent".
2. Product Name: **StewardMDWatchWidgets**  ·  Bundle Identifier:
   **in.stewardmd.app.watchkitapp.widgets**  ·  Embed in **StewardMDWatch**.
3. Delete the generated sources / Info.plist for the extension.
4. **Add Files…** → add everything under `ios/StewardMDWatchWidgets/`
   (`StewardMDWatchWidgets.swift`, `Info.plist`,
   `StewardMDWatchWidgets.entitlements`). Target Membership =
   **StewardMDWatchWidgets**.
5. Build Settings:
   - `INFOPLIST_FILE = ios/StewardMDWatchWidgets/Info.plist`
   - `GENERATE_INFOPLIST_FILE = NO`
   - `CODE_SIGN_ENTITLEMENTS = ios/StewardMDWatchWidgets/StewardMDWatchWidgets.entitlements`
6. **Frameworks and Libraries** → add **StewardMDWatchCore**.

---

## 4. Capabilities (App Groups)

For **all three** targets — `App`, `StewardMDWatch`, `StewardMDWatchWidgets` —
open **Signing & Capabilities**, ensure automatic signing with team
`5QY4LUKX23`, then add **App Groups** and enable **`group.in.stewardmd.app`**.

> The entitlement files in the repo already declare this group; adding the
> capability in Xcode provisions it. Also enable App Groups on the App ID
> (`in.stewardmd.app`) in the Apple Developer portal if not already present.

---

## 5. Build & verify

1. Select the **StewardMDWatch** scheme + a paired iPhone/Watch simulator.
2. **Build** — it should compile and launch to the six-row root list.
3. Add the **StewardMD** complication to a watch face / Smart Stack; it renders
   the status view.

**Notifications (MVP):** watch alerts rely on automatic iPhone→watch mirroring
of the existing APNs pipeline — no separate watch APNs setup is required yet.
Independent watch push (its own APNs token + a backend apns-topic change) is
scheduled for a later phase.

**Auth:** sign in on the iPhone as usual; `native-watch.js` publishes the
session to the App Group, and the watch reads it via `WatchSessionStore`.

---

## Verifying the shared package independently (CI-friendly)

```bash
cd Packages/StewardMDWatchCore && swift test
```

This builds + tests the reusable core (models, networking, engines, tokens,
connectivity) on macOS — no watchOS runtime needed.
