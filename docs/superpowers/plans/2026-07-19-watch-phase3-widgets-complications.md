# Watch Phase 3 — Widgets & Complications Plan

> REQUIRED SUB-SKILL: executing-plans. TDD, checkbox steps.

**Goal:** Production complications (all WidgetKit accessory families) + Smart Stack widgets, driven by a shared `GlanceState` in the App Group, self-ordered by a `RelevanceScorer`, reloading on push.

**Architecture:** A Codable `GlanceState` snapshot is the single source for widgets (written by the app/bridge, read by the extension from the App Group). Relevance is pure logic in the core package (testable). WidgetKit views are review-verified (no watchOS runtime here).

## Global Constraints
Same as Phases 1–2. Recovery tag `watch-widgets-start` before Task 1; milestone `watch-widgets` after.

**WidgetKit family note (HIG-honest):** modern watchOS WidgetKit supports four accessory families — `.accessoryCircular`, `.accessoryCorner`, `.accessoryRectangular`, `.accessoryInline`. The brief's "Extra Large" and "Bezel" are legacy ClockKit `CLKComplicationFamily` values with no WidgetKit equivalent; per HIG we implement the four supported families and document the mapping (do not fabricate unsupported APIs).

## Files
```
Packages/.../Sources/StewardMDWatchCore/
  Widgets/GlanceState.swift  RelevanceScorer.swift
  Connectivity/AppGroupStore.swift        (extend: glance save/load)
Packages/.../Tests/.../ GlanceStateTests.swift  RelevanceScorerTests.swift
ios/StewardMDWatchWidgets/
  GlanceProvider.swift  Complications.swift  SmartStackWidgets.swift  WidgetViews.swift
  StewardMDWatchWidgets.swift              (bundle: register all)
ios/StewardMDWatch/System/GlancePublisher.swift   (app writes GlanceState + reloads widgets)
```

### Task 1: GlanceState + App Group persistence
- `struct GlanceState: Codable, Equatable, Sendable { criticalCount, topCritical?, patientCount, tasksDue, roundsDone, roundsTotal, censusOccupied, censusTotal, shiftEndsAt?, onCall, ward?, bleep?, updatedAt; static let empty }`.
- Extend `AppGroupStore`: `saveGlance(_:)`, `loadGlance() -> GlanceState`.
- Tests: round-trip; `loadGlance` returns `.empty` when absent.
- Commit.

### Task 2: RelevanceScorer
- `enum WidgetKind: String, CaseIterable { criticalLabs, patients, rounds, shift, onCall, drugLookup }`.
- `enum RelevanceScorer { static func score(_ state:, hour: Int) -> [WidgetKind: Double] }`. Rules: criticalLabs = 1.0 if criticalCount>0 else 0.2; shift rises within 90 min of `shiftEndsAt`; rounds higher 8–11h; onCall = 0.9 if onCall; patients baseline 0.5.
- Tests: criticals present → criticalLabs top; near shift end → shift ≥ 0.8; onCall true → onCall high.
- Commit.

### Task 3: WidgetKit — providers, complications, Smart Stack (review-verified)
- `GlanceProvider: TimelineProvider` reads App Group `GlanceState`; entry carries `TimelineEntryRelevance(score:)` from `RelevanceScorer`. Hourly floor + push reload.
- `Complications`: `CriticalLabsComplication` (`.accessoryCircular` gauge/count, `.accessoryCorner`, `.accessoryRectangular` 3-line, `.accessoryInline`), `RoundsComplication` (circular/corner ring), `ShiftComplication` (corner gauge/inline).
- `SmartStackWidgets`: TodaysPatients, CriticalLabs, Rounds, Shift, OnCall (`.accessoryRectangular`/`.accessoryCircular`) with relevance.
- `WidgetViews`: shared SwiftUI subviews (gauge, count, 3-line) using `SMDPalette`.
- Bundle registers all widgets.
- `GlancePublisher` (app side): writes `GlanceState` to App Group + `WidgetCenter.shared.reloadAllTimelines()`; call from `CriticalLabsModel` changes and on push in `WatchAppDelegate`.
- Update `WATCH_XCODE_SETUP.md` file list.
- Verify: core `swift test` green; web green; widget code review-checked. Commit.

### Task 4: tag `watch-widgets`.

## Self-Review
- §08 complications (all families) → Task 3 (4 supported families, legacy families documented). §09 Smart Stack + Relevance → Tasks 2,3. Push reload → Task 3. Types (`GlanceState`, `WidgetKind`, `RelevanceScorer`) consistent.
