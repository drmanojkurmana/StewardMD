# Watch Phase 4 — Workflow Plan

> REQUIRED SUB-SKILL: executing-plans. TDD, checkbox steps.

**Goal:** The P1 "workflow" set — watchlist/patient glance, Ward Sync census, favorite calculators (Crown input), sepsis + procedure timers, ABG interpreter, handover assistant, and Siri/App Intents + Action-button launch.

**Architecture:** All numeric/stateful logic lives in `StewardMDWatchCore` (Crown fields, timer+checklist models, ABG model, handover assembly, favorites, watchlist ranking) → `swift test`-verified. Watch views + App Intents are review-verified.

## Global Constraints
Same as prior phases. Recovery tag `watch-workflow-start` before Task 1; milestone `watch-workflow` after. Live GHIS census/watchlist need the relayed GHIS token (phone) — Phase 4 renders from relayed/cached `GlanceState`/`WatchlistEntry` with honest staleness; direct GHIS fetch is out of scope here.

## Files
```
Packages/.../Sources/StewardMDWatchCore/
  Input/CrownField.swift
  ViewModels/SepsisTimerModel.swift  ProcedureStopwatch.swift  ABGModel.swift
             HandoverModel.swift  WatchlistModel.swift
  Favorites/FavoritesStore.swift
  Calculators/CalculatorCatalog.swift
Packages/.../Tests/...  (one test file per model)
ios/StewardMDWatch/
  WatchlistView.swift  PatientGlanceView.swift  WardSyncView.swift
  CalculatorsView.swift  CalculatorDetailView.swift  SepsisTimerView.swift
  ProcedureTimerView.swift  ABGView.swift  HandoverView.swift
  Intents/AppIntents.swift  Intents/AppShortcuts.swift
```

### Task 1: CrownField (clamped numeric input)
- `struct CrownField { value, min, max, step; mutating set(_)/increment()/decrement() clamp; var normalized: Double }`.
- Tests: clamp at bounds; step; normalized 0…1.
- Commit.

### Task 2: FavoritesStore (watch-local, App-Group synced)
- `@MainActor final class FavoritesStore: ObservableObject { @Published favorites; func toggle(_:); func isFavorite(_ id:); }` over `AppGroupStore.save/loadFavorites`.
- Tests: toggle adds/removes + persists; isFavorite.
- Commit.

### Task 3: CalculatorCatalog + WatchlistModel
- `CalculatorCatalog`: list of wrist calculators (qSOFA, NEWS2, GCS, shock index) with field defs; compute via `CalculatorEngine`.
- `WatchlistModel`: rank `[WatchlistEntry]` sickest-first; counts.
- Tests: catalog compute (qSOFA/shock); watchlist ranking + flaggedCount.
- Commit.

### Task 4: SepsisTimerModel + ProcedureStopwatch
- `SepsisTimerModel`: wraps `SepsisBundleTimer` + checklist [cultures, lactate, antibiotics, fluids] done flags; `remainingLabel`, `shouldNudge`, `allDone`.
- `ProcedureStopwatch`: count-up elapsed + `label`; start/stop/reset.
- Tests: checklist toggle + completion; nudge window; stopwatch label.
- Commit.

### Task 5: ABGModel + HandoverModel
- `ABGModel`: CrownFields pH/pCO2/HCO3 (+ optional Na/Cl); `result` via `ABGInterpreter`; `summaryLine`.
- `HandoverModel`: assemble sick-list from `[WatchlistEntry]` (flagged first), `toggleHandedOff`, `footer` "N patients · M flagged".
- Tests: ABG worked example → metabolic acidosis; handover ordering + footer + toggle.
- Commit.

### Task 6: Views + Intents (review-verified)
- Watchlist/PatientGlance/WardSync/Calculators(+detail Crown)/SepsisTimer/ProcedureTimer/ABG/Handover views using core models + `SMDPalette`; `.digitalCrownRotation` for numeric input; wire `RootListView` (patients, wardSync, calculators) + `EmergencyView` (sepsis, ABG, procedure) to real views.
- `AppIntents.swift`: `StartCodeBlueIntent`, `StartSepsisTimerIntent`, `OpenCriticalLabsIntent`, `DrugDoseIntent(query)`; `AppShortcuts.swift`: `AppShortcutsProvider` with Siri phrases ("Start code blue", "Start sepsis timer", "<drug> dose"). Document Action-button assignment.
- Update `WATCH_XCODE_SETUP.md`.
- Verify: core `swift test` + web green; review views/intents. Commit.

### Task 7: tag `watch-workflow`.

## Self-Review
§05 watchlist/glance/ward/calculators → Tasks 3,6; §06 sepsis/procedure/ABG/handover/Siri/Action-button → Tasks 4,5,6; favorites (watch-local half of the "both" decision) → Task 2. Types (`CrownField`, `SepsisTimerModel`, `ABGModel`, `HandoverModel`, `FavoritesStore`, `WatchlistModel`) consistent with core.
