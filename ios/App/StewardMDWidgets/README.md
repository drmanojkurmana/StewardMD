# StewardMD iOS Widgets — Xcode target setup

These are the source files for the **iOS home-screen / Lock-screen / StandBy widgets** (design §07/§08).
The Swift is written; the **Widget Extension target must be created in Xcode** (can't be done from the CLI).
Everything reuses `StewardMDWatchCore` (`GlanceState`, `AppGroupStore`, `RelevanceScorer`, `SMDPalette`) — one
source of truth shared with the watch.

## One-time Xcode setup

1. **Create the target**
   - Open `ios/App/App.xcodeproj`.
   - File ▸ New ▸ Target… ▸ **Widget Extension** (iOS). Name it **`StewardMDWidgets`**.
   - Uncheck "Include Live Activity" for now (we add ActivityKit separately), **check** "Include Configuration Intent" only if you want configurable widgets (not required — these are `StaticConfiguration`).
   - When prompted "Activate scheme?", Activate.

2. **Add the source files**
   - Xcode creates a starter `StewardMDWidgets.swift` + `Assets` + `Info.plist` in a new group.
   - **Delete Xcode's starter `StewardMDWidgets.swift`** (its `@main` bundle) — ours replaces it.
   - Drag these three files into the new target group (Target Membership = `StewardMDWidgets` only):
     - `StewardMDWidgetsBundle.swift`  (the `@main` bundle + provider + widget configs)
     - `HomeWidgetViews.swift`
     - *(later)* `LiveActivities.swift`, `Controls.swift`
   - (They live here in `ios/App/StewardMDWidgets/`; keep them in that folder.)

3. **Shared code — add the package to this target**
   - Select the **StewardMDWidgets** target ▸ General ▸ *Frameworks and Libraries* ▸ **+** ▸ add **`StewardMDWatchCore`** (the local Swift package already in the project).

4. **App Group (so the widget reads the same snapshot the app writes)**
   - Both the **App** target and **StewardMDWidgets** target ▸ Signing & Capabilities ▸ **+ Capability ▸ App Groups** ▸ enable **`group.in.stewardmd.app`** (already used by the watch — same id).

5. **Build** the App scheme to a device/simulator, long-press the Home Screen ▸ **+** ▸ StewardMD ▸ add a widget.

## Making them show live data

The tiles read `GlanceState` from the App Group. The **iPhone app must write it**:

```swift
import StewardMDWatchCore
// when unit data changes (criticals, tasks, census, watchlist top by NEWS2):
let store = AppGroupStore()
var g = store.loadGlance()
g.criticalCount = …; g.tasksDue = …; g.patientCount = …
g.watchlistTop = "Bed 12 · NEWS2 9"; g.watchlistNews = 9
g.updatedAt = Date().timeIntervalSince1970
store.saveGlance(g)
WidgetCenter.shared.reloadAllTimelines()
```

In this Capacitor app the natural writer is a tiny Capacitor plugin (or the existing WatchBridge) that
the web layer calls when ICU state changes — mirroring what the watch's `GlancePublisher` already does.
Until that's wired, the widgets render the built-in sample/placeholder.

## Widgets included
- **Critical labs** — systemSmall / systemMedium
- **ICU watchlist** — systemSmall / systemMedium / systemLarge
- **Tasks & rounds** — systemSmall / systemMedium
- **Ward census** — systemSmall

Deep links (`stewardmd://criticalLabs | patients | tasks | home`) are handled by the app's URL router.

## Live Activities + Controls (§09/§10 — written; extra setup below)

`LiveActivities.swift` (Code Blue, ActivityKit) and `Controls.swift` (iOS 18 `ControlWidget`s) are in
this target and registered in the bundle (availability-guarded). Add them to the target membership too.

**Live Activity setup**
- App target ▸ Info.plist ▸ add **`NSSupportsLiveActivities` = YES**.
- The app **starts/updates** the Code Blue activity from the live `CodeBlueState` (shared `CodeBlueActivityAttributes` in StewardMDWatchCore):
  ```swift
  import ActivityKit; import StewardMDWatchCore
  let attr = CodeBlueActivityAttributes(unit: "MICU · Bed 12")
  let activity = try Activity.request(attributes: attr,
      content: .init(state: .from(codeBlueState), staleDate: nil))
  // on each streamed frame:
  await activity.update(.init(state: .from(codeBlueState), staleDate: nil))
  // on ROSC / stop:
  await activity.end(.init(state: .from(codeBlueState), staleDate: nil), dismissalPolicy: .default)
  ```
  Natural home: the existing iPhone Code Blue sync service (CodeBlueLiveModel / CodeBlueSyncService)
  that already receives watch→phone frames — call `activity.update` there.

**Controls setup (iOS 18+)**
- Controls are guarded with `@available(iOS 18, *)`, so a lower deployment target is fine — they just
  don't appear pre-18.
- Each control's `LaunchRouteIntent` stashes a route in the App Group and opens the app. The app must
  **consume it on activation**:
  ```swift
  if let r = UserDefaults(suiteName: AppGroupStore.defaultSuite)?.string(forKey: "smd.pendingControlRoute") {
      UserDefaults(suiteName: AppGroupStore.defaultSuite)?.removeObject(forKey: "smd.pendingControlRoute")
      // route to stewardmd://<r>  (codeblue | askai | drugs) via the existing URL router
  }
  ```
  In this Capacitor app, do that in the AppDelegate/SceneDelegate `applicationDidBecomeActive` (or the
  Capacitor bridge) and forward to the same deep-link handler the widgetURLs use.

## Sepsis / Procedure Live Activities (follow-on)
Same pattern as Code Blue — add `SepsisActivityAttributes` / `ProcedureActivityAttributes` in Core and
a widget per type. Left as a fast follow once Code Blue's activity is confirmed on device.
