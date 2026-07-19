# Watch Phase 2 — Triage Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. TDD, checkbox steps.

**Goal:** Deliver the P0 "triage core" end-to-end — Home, Critical Labs → Lab detail → Acknowledge, Notifications (Short/Long Look + haptic tiers), Drug lookup, and the Code Blue timer — wiring the Phase-1 core engines/APIs into real SwiftUI.

**Architecture:** Keep clinical/stateful logic in `StewardMDWatchCore` (view models, ack queue, notification parsing, timer view models, formatters) so it is `swift test`-verified on macOS; the watch-target SwiftUI views stay thin (review-only). Actions are optimistic + offline-queued with idempotent IDs.

**Tech Stack:** SwiftUI (watchOS), WidgetKit (Phase 3), WatchKit haptics, Swift Concurrency, XCTest.

## Global Constraints

- Same as Phase 1 (additive only; no `project.pbxproj` edits; core package platform-agnostic; App Group `group.in.stewardmd.app`; auth Bearer; hosts `stewardmd.in` / `api.stewardmd.in`; commits end with the Co-Authored-By trailer).
- **New files go in `ios/StewardMDWatch/` (views) or `Packages/StewardMDWatchCore/` (logic).** Update `WATCH_XCODE_SETUP.md` file list where new view files are added.
- **`POST /api/watch/ack` does not exist yet** — the ack queue records locally + optimistic UI now; network sync completes when that additive endpoint lands (Phase 6). Flag, don't fake success.
- Recovery tag `watch-triage-core-start` before Task 1; milestone tag `watch-triage-core` after the last task.

## File Structure (new)

```
Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/
  Actions/Ack.swift  AckQueue.swift  AckSender.swift
  Notifications/NotificationPayload.swift
  ViewModels/CriticalLabsModel.swift  DrugLookupModel.swift  CodeBlueModel.swift
  Formatting/TimeFormat.swift
  Networking/AppAPI.swift            (extend: acknowledge, drug dose)
Packages/.../Tests/StewardMDWatchCoreTests/
  AckQueueTests.swift  NotificationPayloadTests.swift
  CriticalLabsModelTests.swift  DrugLookupModelTests.swift
  CodeBlueModelTests.swift  TimeFormatTests.swift

ios/StewardMDWatch/
  HomeView.swift  CriticalLabsView.swift  LabDetailView.swift
  DrugLookupView.swift  CodeBlueView.swift  EmergencyView.swift
  System/HapticManager.swift  Components/SeverityChip.swift  ReferenceGauge.swift
  Notifications/NotificationController.swift
```

---

### Task 1: Time formatting (tabular mm:ss / countdowns)
- Test `TimeFormatTests`: `TimeFormat.mmss(0)=="0:00"`, `mmss(84)=="1:24"`, `mmss(3599)=="59:59"`, `hmmss(3661)=="1:01:01"`.
- Implement `enum TimeFormat { static func mmss(_:) ; static func hmmss(_:) }` (tabular-friendly strings).
- Commit `feat(watch-core): tabular time formatting`.

### Task 2: Offline Ack queue (idempotent, retry, audit)
- Interfaces: `struct Ack: Codable, Equatable { id, labId, patientLabel?, ackedAt }`; `protocol AckSender: Sendable { func send(_ ack: Ack) async -> Bool }`; `actor AckQueue { init(store:sender:); func enqueue(_:) async; var pendingCount: Int { get async }; func flush() async }`.
- Tests `AckQueueTests`: enqueue dedupes same `id`; `flush` with a failing sender keeps it pending; a then-succeeding sender drains it; queue persists/reloads via injected store.
- Implement with an in-memory + injectable persistence (`AckStore` protocol; default backed by a file/App Group). Retry with bounded backoff on flush.
- Commit `feat(watch-core): offline ack queue with idempotent IDs`.

### Task 3: Notification payload parsing (Short/Long Look, PHI-min)
- Interfaces: `enum NotificationParser { static func parse(_ userInfo: [AnyHashable: Any]) -> LabAlert? ; static func shortLookText(_:) -> String ; static func hapticTier(_:) -> SMDHapticTier }`.
- Tests: parse an APNs dict `{aps:{alert:{title,body}}, url:"/?ghisPatient=..", analyte, value, severity}` → LabAlert; `shortLookText` returns "Critical result" (no PHI); `hapticTier` maps "critical"→.critical, "warning"→.warning.
- Commit `feat(watch-core): APNs payload parsing + PHI-safe short look`.

### Task 4: CriticalLabs model (rank + acknowledge)
- Interfaces: `@MainActor final class CriticalLabsModel: ObservableObject { @Published labs: [LabAlert]; func ingest(_:); func acknowledge(_:) ; var unacknowledgedCount: Int }`. Ranking: critical before warning, then most-recent `ts`.
- Tests: ingest unsorted → `labs` ranked; `acknowledge` removes/marks + enqueues an `Ack`; `unacknowledgedCount` correct.
- Commit `feat(watch-core): critical-labs model (rank + acknowledge)`.

### Task 5: DrugLookup model
- Interfaces: `@MainActor final class DrugLookupModel: ObservableObject { enum State { idle, loading, results([DrugSearchResult]), empty, error }; func search(_ q:) async }` using injected `DrugAPI`.
- Tests (MockURLProtocol): query → `.results`; empty payload → `.empty`; blank query → `.idle`; 503 → `.error`.
- Commit `feat(watch-core): drug lookup model`.

### Task 6: CodeBlue model (timer + drug schedule)
- Interfaces: `@MainActor final class CodeBlueModel: ObservableObject { @Published elapsed; var cycleLabel; var rhythmCountdownLabel; var nextDrug: String; func tick(_:) -> Bool /* rhythm due */; func end() -> CodeBlueSummary }`. Adrenaline every 2nd cycle (~3–5 min); summary = duration, cycles, adrenaline count, shocks.
- Tests: after 121s cycle==2 & rhythm-due true; `nextDrug` reflects adrenaline schedule; `end()` summary counts.
- Commit `feat(watch-core): code blue model (timer + drug schedule + summary)`.

### Task 7: SwiftUI views + haptics (watch target, review-verified)
- `HapticManager` → `WKInterfaceDevice.current().play(_:)` mapped from `SMDHapticTier`.
- `HomeView` (greeting + on-call context + rows with critical badge), `CriticalLabsView` (ranked cards), `LabDetailView` (value, `ReferenceGauge`, Acknowledge → success haptic + optimistic, crown hook), `DrugLookupView` (search field + results + dose), `CodeBlueView` (AOD-safe timer, cycle, next drug, Rhythm/Drug buttons), `EmergencyView` (entry to Code Blue), `SeverityChip`, `ReferenceGauge`, `NotificationController` (Short/Long Look).
- Wire `RootListView` destinations to the real views.
- Update `WATCH_XCODE_SETUP.md` "Add Files" list.
- Verify: core `swift test` green; web suite green; views review-checked. Commit `feat(watch-app): triage-core SwiftUI (home, labs, drugs, code blue)`.

### Task 8: Tag
- `swift test` (full) green → `git tag watch-triage-core`.

## Self-Review
- Spec coverage: brief §05 Home/Critical labs/Lab detail/Drug/Code Blue → Tasks 4–7; §10 notifications/haptics → Tasks 3,7; Flow A (<10s ack) → Tasks 2,4,7; §13 ack idempotency/optimistic/queued → Task 2.
- Placeholders: none — ack sync endpoint explicitly flagged pending (Phase 6).
- Types: `LabAlert`, `SMDHapticTier`, `DrugSearchResult`, `AckQueue`/`Ack`/`AckSender` consistent with Phase 1.
