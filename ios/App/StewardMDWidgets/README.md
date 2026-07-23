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

## Next (design §09/§10 — separate files, after this target builds)
- **Live Activities** (`LiveActivities.swift`) — Code Blue / Sepsis / Procedure timers (ActivityKit).
- **Controls** (`Controls.swift`) — Control Center + Action-button (iOS 18 `ControlWidget`).
