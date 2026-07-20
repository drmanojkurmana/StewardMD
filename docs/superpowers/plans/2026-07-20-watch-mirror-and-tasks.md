# Watch Mirror + Head→JR Task Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Apple Watch faithfully mirror the phone (all shared-unit patients, working drug search, unit-wide criticals) and add a Head→JR task flow (see + tap-complete) with true APNs push to the wrist.

**Architecture:** Phone-relay (Approach A). The phone stays the only Firestore client via the public `window.SMD_ICU_GROUPS` API; it relays snapshots to the watch over WatchConnectivity. The watch renders and writes task-status changes back via `transferUserInfo` → `SMD_ICU_GROUPS.setTaskStatus`. APNs push is a separate alert layer.

**Tech Stack:** Swift 6 / SwiftUI / WatchConnectivity (watch app + `StewardMDWatchCore` SwiftPM package, macOS-testable via `swift test`); a Capacitor plugin (Swift); vanilla-JS bridge (`native-watch.js`); Cloudflare Pages Functions (push backend).

## Global Constraints

- **Do not modify the Experimental Access work.** All changes additive; web build + existing native flows untouched.
- Reuse the **public** `window.SMD_ICU_GROUPS` API; do **not** read `icu.js` private state.
- No new server-side Firestore. Group reads/writes stay on the phone's client SDK.
- After **any** `native-watch.js` change, run `npm run build:www && npx cap copy ios` or the app bundle stays stale.
- `StewardMDWatchCore` must keep building on macOS (`swift test`); guard iOS/watchOS-only APIs with `#if canImport(...)`.
- Task status vocabulary is exactly `pending | progress | done` (matches `icu-collab.js`).
- Roles that may instruct: `head, professor, assistant, senior_resident` (from `icu-collab.js` `INSTRUCT`). Executors: `junior_resident, intern`.
- Done tasks drop from the watch list after **6h** (matches the phone Rounds view).
- Watch APNs topic: `in.stewardmd.app.watchkitapp`. Phone topic: `in.stewardmd.app`.

## File Structure

**Create**
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/WatchTask.swift` — `WatchTask` + `WatchTaskAction` value types.
- `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/ViewModels/TasksModel.swift` — ranking/filtering/optimistic state.
- `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/TasksModelTests.swift`
- `ios/StewardMDWatch/TasksView.swift` — Tasks list + row + write-back wiring.

**Modify**
- `Packages/.../Models/Drug.swift` — `brands: [String]?` → `Int?`.
- `Packages/.../Connectivity/AppGroupStore.swift` — tasks persistence.
- `Packages/.../Tests/.../ModelDecodeTests.swift`, `DrugLookupModelTests.swift` — real drug payload.
- `Packages/.../Tests/.../ConnectivityTests.swift` — tasks round-trip.
- `ios/StewardMDWatch/System/WatchServices.swift` — add `tasks` model.
- `ios/StewardMDWatch/System/WatchConnectivityManager.swift` — decode/persist/seed tasks + role; write-back sender.
- `ios/StewardMDWatch/StewardMDWatchApp.swift` — inject `tasks`.
- `ios/StewardMDWatch/RootListView.swift` — Tasks row + badge + destination.
- `ios/StewardMDWatch/System/AppRouter.swift` — `tasks` route.
- `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchConnectivityRelay.swift` — `didReceiveUserInfo` (taskStatus, watchPushToken).
- `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift` — publish `tasks`/`role`; re-emit `taskStatus`/`watchPushToken` to JS.
- `native-watch.js` — subscribe all units; relay patients (all)/criticals (unit-wide)/tasks/role; `taskStatus` + `watchPushToken` handlers.
- **P3 backend:** `functions/_apns.js`, `functions/_nativepush.js`, `functions/_taskpush.js` — watch-topic branch + fan-out (read at implementation time; shared/volatile files).

---

## PHASE 1 — Mirror fixes

### Task 1: Fix drug search decode (`brands` is a count)

**Files:**
- Modify: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/Drug.swift:14`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/ModelDecodeTests.swift:11,19`, `DrugLookupModelTests.swift:17`

**Interfaces:**
- Produces: `DrugSearchResult.brands: Int?` (brand count).

- [ ] **Step 1: Update the decode tests to the REAL payload shape**

In `ModelDecodeTests.swift` replace the two fabricated `brands` arrays with the real integer form and assert the count:

```swift
func testDecodesDrugSearch() throws {
    let j = #"{"query":"amiod","count":1,"results":[{"composition":"Amiodarone","class":"Antiarrhythmic","brands":42}]}"#
    let r = try decode(DrugSearchResponse.self, j)
    XCTAssertEqual(r.count, 1)
    XCTAssertEqual(r.results.first?.composition, "Amiodarone")
    XCTAssertEqual(r.results.first?.brands, 42)
}
```

Keep the null case but as an integer-optional (`"brands":null` stays valid):

```swift
func testDecodesNullFields() throws {
    let j = #"{"query":"x","count":1,"results":[{"composition":"Foo","class":null,"brands":null}]}"#
    let r = try decode(DrugSearchResponse.self, j)
    XCTAssertNil(r.results.first?.drugClass)
    XCTAssertNil(r.results.first?.brands)
}
```

In `DrugLookupModelTests.swift:17` change the stub body's `"brands":["Cordarone"]` to `"brands":3`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Packages/StewardMDWatchCore && swift test --filter ModelDecodeTests`
Expected: FAIL — decoding `42` into `[String]?` throws `typeMismatch`.

- [ ] **Step 3: Change the model field**

In `Drug.swift`, line 14:

```swift
    public let brands: Int?          // brand-count for this composition (API returns a number)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Packages/StewardMDWatchCore && swift test --filter ModelDecodeTests && swift test --filter DrugLookupModelTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/Drug.swift Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/ModelDecodeTests.swift Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/DrugLookupModelTests.swift
git commit -m "fix(watch): drug search brands is an Int count, not [String]

The Worker returns brands as a count (e.g. 2679); the model decoded it as
[String], so DrugSearchResponse decode threw and every query returned nothing.
Tests updated to the real payload shape."
```

---

### Task 2: Relay all shared-unit patients + unit-wide criticals (`native-watch.js`)

This is a JS bridge change (no unit-test harness in-repo). It is verified by rebuild + on-device logs. Keep every read synchronous/side-effect-free except the explicit subscriptions.

**Files:**
- Modify: `native-watch.js`

**Interfaces:**
- Consumes: `window.SMD_ICU_GROUPS.{enabled, subscribeGroups, subscribePatients, subscribeTasks, setTaskStatus}`; each group `{id, myRole, kind, name, hospital}`; patient `{id, name, dx, bed, state, severity, assignedTo}`; task shape per `mapTask`.
- Produces: `publish()` payload keys `watchlist` (all units), `criticals` (unit-wide), `tasks`, `role`.

- [ ] **Step 1: Add a live group cache that re-publishes on change**

Add near the top of the IIFE (after `recents()`):

```javascript
  // ---- Shared-unit (group mode) live cache ----------------------------------
  // Subscribe to ALL the doctor's shared units and their patients/tasks, so the
  // watch mirrors "ICU and my ward" — not just the one open unit. Purely reads
  // the PUBLIC SMD_ICU_GROUPS API (never icu.js internals). Re-publishes (debounced)
  // on any snapshot change.
  var _grp = { groups: [], patients: {}, tasks: {}, role: {}, subs: [], ptSubs: {} };
  var _grpMax = 6;            // cap live units
  var _grpPtMax = 40;         // cap total patients we hold task listeners for
  function groupsApi() { try { return window.SMD_ICU_GROUPS || null; } catch (e) { return null; } }
  function groupsOn() { var a = groupsApi(); try { return !!(a && a.enabled && a.enabled()); } catch (e) { return !!a; } }

  var _repubT = null;
  function republishSoon() {
    if (_repubT) return;
    _repubT = setTimeout(function () { _repubT = null; autoPublish(); }, 400);
  }

  function startGroupSync() {
    var api = groupsApi();
    if (!api || !api.subscribeGroups || !groupsOn()) return;
    // one groups listener; (re)build per-group patient + task listeners on change
    _grp.subs.push(api.subscribeGroups(function (groups) {
      _grp.groups = (groups || []).slice(0, _grpMax);
      _grp.role = {};
      _grp.groups.forEach(function (g) { _grp.role[g.id] = g.myRole || null; });
      rebuildGroupPatientSubs();
      republishSoon();
    }, function () {}));
  }

  function rebuildGroupPatientSubs() {
    var api = groupsApi(); if (!api) return;
    var wanted = {};
    _grp.groups.forEach(function (g) {
      wanted[g.id] = 1;
      if (!_grp.ptSubs[g.id]) {
        _grp.ptSubs[g.id] = { patientsOff: null, taskOffs: {} };
        _grp.ptSubs[g.id].patientsOff = api.subscribePatients(g.id, function (pts) {
          _grp.patients[g.id] = pts || [];
          syncTaskSubs(g.id, pts || []);
          republishSoon();
        }, function () {});
      }
    });
    // tear down units we've left
    Object.keys(_grp.ptSubs).forEach(function (gid) {
      if (!wanted[gid]) { teardownGroup(gid); }
    });
  }

  function syncTaskSubs(gid, pts) {
    var api = groupsApi(); if (!api || !api.subscribeTasks) return;
    var slot = _grp.ptSubs[gid]; if (!slot) return;
    var want = {};
    var total = 0; Object.keys(_grp.ptSubs).forEach(function (k) { total += Object.keys(_grp.ptSubs[k].taskOffs).length; });
    pts.forEach(function (p) {
      if (!p || !p.id) return;
      want[p.id] = 1;
      if (!slot.taskOffs[p.id] && total < _grpPtMax) {
        total++;
        slot.taskOffs[p.id] = api.subscribeTasks(gid, p.id, function (tasks) {
          _grp.tasks[gid + "/" + p.id] = tasks || [];
          republishSoon();
        });
      }
    });
    Object.keys(slot.taskOffs).forEach(function (pid) {
      if (!want[pid]) { try { slot.taskOffs[pid](); } catch (e) {} delete slot.taskOffs[pid]; delete _grp.tasks[gid + "/" + pid]; }
    });
  }

  function teardownGroup(gid) {
    var slot = _grp.ptSubs[gid]; if (!slot) return;
    try { slot.patientsOff && slot.patientsOff(); } catch (e) {}
    Object.keys(slot.taskOffs).forEach(function (pid) { try { slot.taskOffs[pid](); } catch (e) {} delete _grp.tasks[gid + "/" + pid]; });
    delete _grp.ptSubs[gid]; delete _grp.patients[gid];
  }
```

- [ ] **Step 2: Feed shared patients into `watchlist()` and criticals across all units**

In `watchlist()`, after the "1. Open patient" block and BEFORE the saved-roster block, add shared-unit patients as the primary source:

```javascript
    // 1b. Shared-unit patients (group mode) — ALL the doctor's units.
    try {
      Object.keys(_grp.patients).forEach(function (gid) {
        (_grp.patients[gid] || []).forEach(function (p) {
          if (!p) return;
          var st2 = p.state || {};
          push({
            id: String(gid + ":" + (p.id || "")),
            name: String(p.name || (st2.patient && st2.patient.name) || "Patient"),
            bed: String(p.bed || (st2.patient && st2.patient.bed) || ""),
            news2: news2Of(st2),
            flag: String(p.dx || (st2.patient && st2.patient.diagnosis) || "") || null,
            vitals: vitalsFrom(st2)
          });
        });
      });
    } catch (e) {}
```

Extend `criticals()` to also walk every shared patient's `state.alerts` (same mapping as the open patient). After the existing open-patient block, before `return out.slice(...)`:

```javascript
    try {
      Object.keys(_grp.patients).forEach(function (gid) {
        (_grp.patients[gid] || []).forEach(function (p) {
          var st2 = p.state || {}, alerts = st2.alerts || [];
          if (!alerts.length) return;
          var label = [p.bed ? ("Bed " + p.bed) : null, p.name].filter(Boolean).join(" · ");
          alerts.forEach(function (a) {
            if (!a || (a.severity !== "crit" && a.severity !== "warn")) return;
            var m = String(a.msg || "").match(/([\d.]+)\s*([A-Za-z%\/]+)?/);
            out.push({
              id: "icu-" + String(gid + ":" + (p.id || "")) + "-" + String(a.title || ""),
              analyte: String(a.title || "Alert"),
              value: m ? m[1] : "", units: (m && m[2]) ? m[2] : null, refRange: null,
              patientLabel: label || null,
              severity: a.severity === "crit" ? "critical" : "warning",
              ts: Math.floor(Date.now() / 1000)
            });
          });
        });
      });
    } catch (e) {}
```

- [ ] **Step 3: Start group sync at boot**

In `start()`, after the auth wiring, add:

```javascript
    startGroupSync();
```

- [ ] **Step 4: Rebuild the web bundle into the app**

Run: `npm run build:www && npx cap copy ios`
Expected: completes; `grep -c subscribeGroups ios/App/App/public/native-watch.js` → `1`.

- [ ] **Step 5: Commit**

```bash
git add native-watch.js package-lock.json ios/App/App/public/native-watch.js
git commit -m "feat(watch-relay): relay all shared-unit patients + unit-wide criticals

Subscribe to every shared unit via the public SMD_ICU_GROUPS API and feed all
their patients into the watchlist and their alerts into criticals — so the watch
mirrors ICU and ward, not just the open patient. No icu.js internals touched."
```

- [ ] **Step 6: On-device verify**

Run the App scheme; open your ICU + ward. Expected phone log: `publish ... watchlist=5 criticals=N` (was `watchlist=1`). On the watch, My Patients shows all patients and Critical Labs shows unit-wide alerts.

---

## PHASE 2 — Tasks on the watch

### Task 3: `WatchTask` + `WatchTaskAction` models

**Files:**
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/WatchTask.swift`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/TasksModelTests.swift` (created here; extended in Task 4)

**Interfaces:**
- Produces: `WatchTask(id, groupId, patientId, patientLabel, text, priority, status, assignedByName, assignedToUid, dueAt, ts)`; `WatchTaskAction(groupId, patientId, taskId, status)`; both `Codable, Sendable, Equatable`.

- [ ] **Step 1: Write the failing decode test**

Create `TasksModelTests.swift`:

```swift
import XCTest
@testable import StewardMDWatchCore

final class WatchTaskTests: XCTestCase {
    func testDecodesFromRelayPayload() throws {
        let j = #"{"id":"t1","groupId":"g1","patientId":"p1","patientLabel":"Bed 3 · Okafor","text":"Repeat ABG","priority":"high","status":"pending","assignedByName":"Dr Head","assignedToUid":"u2","dueAt":123.0,"ts":100.0}"#
        let t = try JSONDecoder().decode(WatchTask.self, from: Data(j.utf8))
        XCTAssertEqual(t.id, "t1")
        XCTAssertEqual(t.priority, "high")
        XCTAssertEqual(t.status, "pending")
        XCTAssertEqual(t.patientLabel, "Bed 3 · Okafor")
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Packages/StewardMDWatchCore && swift test --filter WatchTaskTests`
Expected: FAIL — `WatchTask` undefined.

- [ ] **Step 3: Create the models**

```swift
import Foundation

/// A round task relayed from a shared ICU/ward unit (design: Head→JR flow).
/// Assembled on the phone from `SMD_ICU_GROUPS`; the watch ranks + renders and
/// writes status changes back.
public struct WatchTask: Codable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let groupId: String
    public let patientId: String
    public let patientLabel: String?
    public let text: String
    public let priority: String   // immediate | high | moderate | low
    public let status: String     // pending | progress | done
    public let assignedByName: String?
    public let assignedToUid: String?
    public let dueAt: Double?
    public let ts: Double?

    public init(id: String, groupId: String, patientId: String, patientLabel: String?,
                text: String, priority: String, status: String, assignedByName: String?,
                assignedToUid: String?, dueAt: Double?, ts: Double?) {
        self.id = id; self.groupId = groupId; self.patientId = patientId
        self.patientLabel = patientLabel; self.text = text; self.priority = priority
        self.status = status; self.assignedByName = assignedByName
        self.assignedToUid = assignedToUid; self.dueAt = dueAt; self.ts = ts
    }
}

/// A status change the watch sends back to the phone (→ SMD_ICU_GROUPS.setTaskStatus).
public struct WatchTaskAction: Codable, Sendable, Equatable {
    public let groupId: String
    public let patientId: String
    public let taskId: String
    public let status: String
    public init(groupId: String, patientId: String, taskId: String, status: String) {
        self.groupId = groupId; self.patientId = patientId; self.taskId = taskId; self.status = status
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd Packages/StewardMDWatchCore && swift test --filter WatchTaskTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Models/WatchTask.swift Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/TasksModelTests.swift
git commit -m "feat(watch): WatchTask + WatchTaskAction models for the task flow"
```

---

### Task 4: `TasksModel` — rank, filter, optimistic status

**Files:**
- Create: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/ViewModels/TasksModel.swift`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/TasksModelTests.swift` (extend)

**Interfaces:**
- Consumes: `WatchTask`, `WatchTaskAction`.
- Produces: `@MainActor TasksModel` — `tasks: [WatchTask]`, `ingest([WatchTask], now:)`, `openCount`, `visibleTasks(myUid:canInstruct:) -> [WatchTask]`, `setStatus(_:to:now:) ` (optimistic; invokes `onAction`), `var onAction: ((WatchTaskAction) -> Void)?`.

- [ ] **Step 1: Write failing tests (ranking, filtering, optimistic status)**

Append to `TasksModelTests.swift`:

```swift
@MainActor
final class TasksModelTests: XCTestCase {
    private func t(_ id: String, priority: String = "moderate", status: String = "pending",
                   assignedTo: String? = nil, dueAt: Double? = nil, ts: Double = 0) -> WatchTask {
        WatchTask(id: id, groupId: "g", patientId: "p", patientLabel: "Bed 1",
                  text: id, priority: priority, status: status, assignedByName: "Head",
                  assignedToUid: assignedTo, dueAt: dueAt, ts: ts)
    }

    func testRanksOverdueThenPriorityThenRecency() {
        let m = TasksModel()
        m.ingest([
            t("low", priority: "low", ts: 10),
            t("imm", priority: "immediate", ts: 5),
            t("overdue", priority: "low", dueAt: 50, ts: 1)
        ], now: 100)
        XCTAssertEqual(m.tasks.map(\.id), ["overdue", "imm", "low"])
    }

    func testOpenCountExcludesDone() {
        let m = TasksModel()
        m.ingest([t("a"), t("b", status: "done")], now: 100)
        XCTAssertEqual(m.openCount, 1)
    }

    func testDropsDoneOlderThanSixHours() {
        let m = TasksModel()
        let sixHoursAgo = 100.0 - 6.5 * 3600
        m.ingest([t("old", status: "done", ts: sixHoursAgo), t("open")], now: 100)
        XCTAssertEqual(m.tasks.map(\.id), ["open"])
    }

    func testVisibilityExecutorSeesAssignedAndUnassigned() {
        let m = TasksModel()
        m.ingest([t("mine", assignedTo: "me"), t("theirs", assignedTo: "other"), t("free")], now: 100)
        let v = m.visibleTasks(myUid: "me", canInstruct: false).map(\.id).sorted()
        XCTAssertEqual(v, ["free", "mine"])
    }

    func testVisibilityInstructorSeesAll() {
        let m = TasksModel()
        m.ingest([t("mine", assignedTo: "me"), t("theirs", assignedTo: "other")], now: 100)
        XCTAssertEqual(m.visibleTasks(myUid: "me", canInstruct: true).count, 2)
    }

    func testSetStatusOptimisticAndEmitsAction() {
        let m = TasksModel()
        m.ingest([t("a")], now: 100)
        var captured: WatchTaskAction?
        m.onAction = { captured = $0 }
        m.setStatus(m.tasks[0], to: "done", now: 200)
        XCTAssertEqual(m.tasks.first { $0.id == "a" }?.status, "done")
        XCTAssertEqual(captured?.taskId, "a")
        XCTAssertEqual(captured?.status, "done")
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Packages/StewardMDWatchCore && swift test --filter TasksModelTests`
Expected: FAIL — `TasksModel` undefined.

- [ ] **Step 3: Implement `TasksModel`**

```swift
import Foundation
import Combine

/// Drives the watch Tasks screen: rank (overdue → priority → recency), filter by
/// role/assignee, and optimistic status changes that write back via `onAction`.
@MainActor
public final class TasksModel: ObservableObject {
    @Published public private(set) var tasks: [WatchTask] = []

    /// Called with the change to relay to the phone (WCSession on the app side).
    public var onAction: ((WatchTaskAction) -> Void)?

    public init() {}

    private static let doneGrace: Double = 6 * 3600

    public func ingest(_ incoming: [WatchTask], now: Double = Date().timeIntervalSince1970) {
        var byID = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for t in incoming { byID[t.id] = t }
        let fresh = byID.values.filter { t in
            t.status != "done" || (t.ts.map { now - $0 < Self.doneGrace } ?? true)
        }
        tasks = Self.rank(Array(fresh), now: now)
    }

    public var openCount: Int { tasks.filter { $0.status != "done" }.count }

    public func visibleTasks(myUid: String?, canInstruct: Bool) -> [WatchTask] {
        if canInstruct { return tasks }
        return tasks.filter { $0.assignedToUid == nil || $0.assignedToUid == myUid }
    }

    public func setStatus(_ task: WatchTask, to status: String,
                          now: Double = Date().timeIntervalSince1970) {
        guard let i = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        let t = tasks[i]
        tasks[i] = WatchTask(id: t.id, groupId: t.groupId, patientId: t.patientId,
                             patientLabel: t.patientLabel, text: t.text, priority: t.priority,
                             status: status, assignedByName: t.assignedByName,
                             assignedToUid: t.assignedToUid, dueAt: t.dueAt, ts: t.ts)
        tasks = Self.rank(tasks, now: now)
        onAction?(WatchTaskAction(groupId: t.groupId, patientId: t.patientId,
                                  taskId: t.id, status: status))
    }

    static func rank(_ ts: [WatchTask], now: Double) -> [WatchTask] {
        ts.sorted { a, b in
            let ao = (a.dueAt.map { $0 < now } ?? false), bo = (b.dueAt.map { $0 < now } ?? false)
            if ao != bo { return ao }                       // overdue first
            let ap = priorityRank(a.priority), bp = priorityRank(b.priority)
            if ap != bp { return ap < bp }                  // then priority
            return (a.ts ?? 0) > (b.ts ?? 0)                // then recency
        }
    }

    private static func priorityRank(_ p: String) -> Int {
        switch p { case "immediate": return 0; case "high": return 1
                   case "moderate": return 2; default: return 3 }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test --filter TasksModelTests`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/ViewModels/TasksModel.swift Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/TasksModelTests.swift
git commit -m "feat(watch): TasksModel — rank, role/assignee filter, optimistic status"
```

---

### Task 5: Persist tasks in `AppGroupStore`

**Files:**
- Modify: `Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/AppGroupStore.swift`
- Test: `Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/ConnectivityTests.swift`

**Interfaces:**
- Produces: `AppGroupStore.saveTasks([WatchTask])`, `loadTasks() -> [WatchTask]`; also cleared by `clear()`.

- [ ] **Step 1: Failing round-trip test**

Append to `AppGroupStoreTests` in `ConnectivityTests.swift`:

```swift
    func testTasksRoundTrips() {
        let suite = "test.smd.appgroup.\(UUID().uuidString)"
        let store = AppGroupStore(suite: suite)
        XCTAssertTrue(store.loadTasks().isEmpty)
        let list = [
            WatchTask(id: "t1", groupId: "g", patientId: "p", patientLabel: "Bed 1",
                      text: "ABG", priority: "high", status: "pending", assignedByName: "Head",
                      assignedToUid: "u2", dueAt: nil, ts: 1)
        ]
        store.saveTasks(list)
        XCTAssertEqual(store.loadTasks().map(\.id), ["t1"])
        store.clear()
        XCTAssertTrue(store.loadTasks().isEmpty)
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd Packages/StewardMDWatchCore && swift test --filter AppGroupStoreTests`
Expected: FAIL — `saveTasks` undefined.

- [ ] **Step 3: Implement**

Add a key constant near `criticalsKey`:

```swift
    private let tasksKey = "smd.tasks"
```

Add methods after `loadCriticals()`:

```swift
    /// Round tasks relayed from the shared unit (persisted like the watchlist so
    /// the Tasks screen survives relaunch + patient-less syncs).
    public func saveTasks(_ tasks: [WatchTask]) {
        guard let d = defaults, let data = try? JSONEncoder().encode(tasks) else { return }
        d.set(data, forKey: tasksKey)
    }
    public func loadTasks() -> [WatchTask] {
        guard let d = defaults, let data = d.data(forKey: tasksKey) else { return [] }
        return (try? JSONDecoder().decode([WatchTask].self, from: data)) ?? []
    }
```

Add to `clear()`:

```swift
        defaults?.removeObject(forKey: tasksKey)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd Packages/StewardMDWatchCore && swift test --filter AppGroupStoreTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Packages/StewardMDWatchCore/Sources/StewardMDWatchCore/Connectivity/AppGroupStore.swift Packages/StewardMDWatchCore/Tests/StewardMDWatchCoreTests/ConnectivityTests.swift
git commit -m "feat(watch): persist relayed tasks in the App Group"
```

---

### Task 6: Wire tasks through the watch receiver + app

**Files:**
- Modify: `ios/StewardMDWatch/System/WatchServices.swift`, `ios/StewardMDWatch/System/WatchConnectivityManager.swift`, `ios/StewardMDWatch/StewardMDWatchApp.swift`

**Interfaces:**
- Consumes: `TasksModel`, `WatchTask`, `WatchTaskAction`, `AppGroupStore.save/loadTasks`.
- Produces: `WatchServices.tasks: TasksModel`; `WatchConnectivityManager` decodes `tasks`/`role`, persists + ingests, seeds on activate, and sets `tasks.onAction` to send a `taskStatus` user-info to the phone; `@Published role: String?`.

*(Not unit-tested — it wires singletons + WCSession. Verified by build + on-device. No test step.)*

- [ ] **Step 1: Add the shared model**

In `WatchServices.swift`, after the `watchlist` line:

```swift
    @MainActor static let tasks = TasksModel()
```

- [ ] **Step 2: Decode/persist/seed tasks + role and set the write-back sender**

In `WatchConnectivityManager.swift`, in `activate()` after the criticals seed:

```swift
        WatchServices.tasks.ingest(store.loadTasks())
        WatchServices.tasks.onAction = { [weak self] action in self?.sendTaskAction(action) }
```

Add a stored role near `lastReceived`:

```swift
    @Published private(set) var role: String?
```

In `apply(_:)`, after the criticals block:

```swift
        if let d = context["tasks"] as? Data, let t = try? JSONDecoder().decode([WatchTask].self, from: d) {
            store.saveTasks(t)
            WatchServices.tasks.ingest(t)
        }
        if let r = context["role"] as? Data, let s = try? JSONDecoder().decode(String.self, from: r) {
            role = s
        }
```

Add the sender (uses `transferUserInfo` — guaranteed background delivery):

```swift
    /// Relay a task-status change to the phone (→ SMD_ICU_GROUPS.setTaskStatus).
    func sendTaskAction(_ action: WatchTaskAction) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported() else { return }
        guard let data = try? JSONEncoder().encode(action),
              let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        var info = dict
        info["kind"] = "taskStatus"
        WCSession.default.transferUserInfo(info)
        #endif
    }
```

- [ ] **Step 3: Inject into the app**

In `StewardMDWatchApp.swift`, add near the other `@ObservedObject` singletons:

```swift
    @ObservedObject private var tasks = WatchServices.tasks
```

and add to the environment chain (after `.environmentObject(watchlist)`):

```swift
            .environmentObject(tasks)
```

- [ ] **Step 4: Build the core package (compile check)**

Run: `cd Packages/StewardMDWatchCore && swift build`
Expected: `Build complete!` (the watch-app files compile in Xcode; this validates the shared package).

- [ ] **Step 5: Commit**

```bash
git add ios/StewardMDWatch/System/WatchServices.swift ios/StewardMDWatch/System/WatchConnectivityManager.swift ios/StewardMDWatch/StewardMDWatchApp.swift
git commit -m "feat(watch): receive + persist + seed relayed tasks; wire write-back sender"
```

---

### Task 7: Tasks UI — screen, row, Home entry, deep link

**Files:**
- Create: `ios/StewardMDWatch/TasksView.swift`
- Modify: `ios/StewardMDWatch/RootListView.swift`, `ios/StewardMDWatch/System/AppRouter.swift`

**Interfaces:**
- Consumes: `WatchServices.tasks` (via `@EnvironmentObject TasksModel`), `WatchConnectivityManager.shared.role`, `WatchSessionStore` uid, `SMDPalette`, `SMDSpacing`.
- Produces: `RootDestination.tasks`; `TasksView`.

*(SwiftUI views are verified on-device, not unit-tested.)*

- [ ] **Step 1: Create `TasksView.swift`**

```swift
import SwiftUI
import StewardMDWatchCore

/// Head→JR tasks: the executor sees tasks assigned to them + unassigned unit
/// tasks (instructors see all), ranked overdue→priority→recency. Tap to move a
/// task to In progress / Done; the change writes back to the phone.
struct TasksView: View {
    @EnvironmentObject private var tasks: TasksModel
    @EnvironmentObject private var session: WatchSessionStore
    @ObservedObject private var conn = WatchConnectivityManager.shared

    private var canInstruct: Bool {
        ["head", "professor", "assistant", "senior_resident"].contains(conn.role ?? "")
    }
    private var visible: [WatchTask] {
        tasks.visibleTasks(myUid: session.session?.uid, canInstruct: canInstruct)
    }

    var body: some View {
        Group {
            if visible.isEmpty {
                ContentUnavailableView("No tasks", systemImage: "checklist",
                                       description: Text("New round tasks appear here."))
            } else {
                List(visible) { task in TaskRow(task: task) { tasks.setStatus(task, to: $0) } }
            }
        }
        .navigationTitle("Tasks")
    }
}

private struct TaskRow: View {
    let task: WatchTask
    let onStatus: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                PriorityChip(priority: task.priority)
                Spacer()
                if let by = task.assignedByName, !by.isEmpty {
                    Text(by).font(.caption2).foregroundStyle(SMDPalette.text2.color)
                }
            }
            Text(task.text).font(.body).foregroundStyle(SMDPalette.text1.color)
            if let label = task.patientLabel {
                Text(label).font(.caption2).foregroundStyle(SMDPalette.text2.color)
            }
            HStack(spacing: SMDSpacing.s) {
                if task.status != "done" {
                    Button(task.status == "progress" ? "Complete" : "In progress") {
                        onStatus(task.status == "progress" ? "done" : "progress")
                    }
                    .buttonStyle(.borderedProminent).tint(SMDPalette.teal.color)
                    if task.status != "progress" {
                        Button("Done") { onStatus("done") }
                            .buttonStyle(.bordered).tint(SMDPalette.success.color)
                    }
                } else {
                    Label("Completed", systemImage: "checkmark.circle.fill")
                        .font(.caption).foregroundStyle(SMDPalette.success.color)
                }
            }
        }
        .padding(.vertical, 2)
        .listRowBackground(SMDPalette.surface.color)
    }
}

private struct PriorityChip: View {
    let priority: String
    private var color: SMDColor {
        switch priority { case "immediate": return SMDPalette.critical
                          case "high": return SMDPalette.accent
                          case "moderate": return SMDPalette.info
                          default: return SMDPalette.text2 }
    }
    var body: some View {
        Text(priority.capitalized).font(.caption2).bold()
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(color.color.opacity(0.25), in: Capsule())
            .foregroundStyle(color.color)
    }
}
```

- [ ] **Step 2: Add the Home row + destination**

In `RootListView.swift`, add `tasks` to the enum (after `patients`):

```swift
    case criticalLabs, patients, tasks, wardSync, drugs, calculators, emergency
```

Add its `title` / `symbol` / `accent` / `feature` cases:

```swift
        case .tasks: return "Tasks"          // title
        case .tasks: return "checklist"      // symbol
        case .tasks: return SMDPalette.accent // accent
        case .tasks: return nil              // feature (always available)
```

Add the badge (open task count) — change the `RootRow` badge argument:

```swift
                    RootRow(destination: dest,
                            badge: dest == .criticalLabs ? labs.unacknowledgedCount
                                 : dest == .tasks ? tasksModel.openCount : 0,
                            locked: locked)
```

Add the model to the view and the destination switch:

```swift
    @EnvironmentObject private var tasksModel: TasksModel
```
```swift
            case .tasks: TasksView()
```

- [ ] **Step 3: Add the deep-link route**

In `AppRouter.swift` `navigate(_:)`, add:

```swift
        case "tasks": path.append(RootDestination.tasks)
```

- [ ] **Step 4: Compile check**

Run: `cd Packages/StewardMDWatchCore && swift build`
Expected: `Build complete!` (UI compiles in Xcode; core unaffected).

- [ ] **Step 5: Commit**

```bash
git add ios/StewardMDWatch/TasksView.swift ios/StewardMDWatch/RootListView.swift ios/StewardMDWatch/System/AppRouter.swift
git commit -m "feat(watch): Tasks screen + Home badge + deep-link route"
```

---

### Task 8: Relay tasks/role + handle write-back (`native-watch.js` + plugin + relay)

**Files:**
- Modify: `local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchConnectivityRelay.swift`, `WatchBridgePlugin.swift`, `native-watch.js`

**Interfaces:**
- Consumes: watch user-info `{kind:"taskStatus", groupId, patientId, taskId, status}`.
- Produces: context keys `tasks` (JSON `[WatchTask]`), `role` (JSON `String`); plugin event `taskStatus` to JS; `SMD_ICU_GROUPS.setTaskStatus` call.

- [ ] **Step 1: Phone receives task actions (`WatchConnectivityRelay.swift`)**

Add a notification name (next to `tokenRequested`):

```swift
    static let taskStatusRequested = Notification.Name("SMDWatchTaskStatusRequested")
```

Implement `didReceiveUserInfo`:

```swift
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard (userInfo["kind"] as? String) == "taskStatus" else { return }
        NotificationCenter.default.post(name: WatchConnectivityRelay.taskStatusRequested,
                                        object: nil, userInfo: userInfo)
    }
```

- [ ] **Step 2: Plugin re-emits to JS (`WatchBridgePlugin.swift`)**

Publish `tasks`/`role` in `publish()` — after the `criticals` handling. Read them:

```swift
        let tasks = call.getArray("tasks")
        let role = call.getString("role")
```
```swift
        let tasksData = tasks.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let roleData = role.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
```
Persist + add to context (mirror the criticals lines):
```swift
            if let t = tasksData { d.set(t, forKey: "smd.tasks") }
```
```swift
        if let t = tasksData { context["tasks"] = t }
        if let r = roleData { context["role"] = r }
```

In `load()`, observe the task-status notification (next to the `tokenRequested` observer):

```swift
        NotificationCenter.default.addObserver(
            forName: WatchConnectivityRelay.taskStatusRequested, object: nil, queue: .main
        ) { [weak self] note in
            self?.notifyListeners("taskStatus", data: (note.userInfo as? [String: Any]) ?? [:])
        }
```

Add the JS-facing method registration (in `pluginMethods`) is not needed — `taskStatus` is an event via `notifyListeners`.

- [ ] **Step 3: `native-watch.js` relays tasks/role + applies write-back**

Add a `tasks()` gatherer (flatten the group cache into `WatchTask` shape) and a `roleForRelay()`:

```javascript
  // Flatten every shared unit's tasks into the relay shape. assignedTo carries
  // the executor uid; role gates visibility on the watch.
  function tasks() {
    var out = [];
    try {
      Object.keys(_grp.patients).forEach(function (gid) {
        var pts = _grp.patients[gid] || [];
        var byId = {}; pts.forEach(function (p) { if (p && p.id) byId[p.id] = p; });
        Object.keys(_grp.tasks).forEach(function (key) {
          if (key.indexOf(gid + "/") !== 0) return;
          var pid = key.slice((gid + "/").length), p = byId[pid] || {};
          var label = [p.bed ? ("Bed " + p.bed) : null, p.name].filter(Boolean).join(" · ");
          (_grp.tasks[key] || []).forEach(function (t) {
            if (!t || !t.id) return;
            out.push({
              id: String(t.id),                       // raw Firestore task id (globally unique)
              groupId: String(gid), patientId: String(pid),
              patientLabel: label || null,
              text: String(t.text || ""), priority: String(t.priority || "moderate"),
              status: String(t.status || "pending"),
              assignedByName: t.assignedByName || null, assignedToUid: t.assignedTo || null,
              dueAt: (typeof t.dueAt === "number" ? Math.floor(t.dueAt / 1000) : null),
              ts: (typeof t.ts === "number" ? Math.floor(t.ts / 1000) : null)
            });
          });
        });
      });
    } catch (e) {}
    return out.slice(0, 100);
  }
  // The doctor's role in the FIRST unit that has one (used only for watch-side
  // visibility gating; instruct roles see all unit tasks).
  function roleForRelay() {
    try {
      var order = ["head", "professor", "assistant", "senior_resident", "junior_resident", "intern"];
      var best = null, bestRank = 99;
      Object.keys(_grp.role).forEach(function (gid) {
        var r = _grp.role[gid], idx = order.indexOf(r);
        if (idx >= 0 && idx < bestRank) { bestRank = idx; best = r; }
      });
      return best;
    } catch (e) { return null; }
  }
```

Note the id is `gid:pid:taskId`; the write-back must split it back. In `publish()`, add:

```javascript
      var tk = tasks(); if (tk.length) payload.tasks = tk;
      var role = roleForRelay(); if (role) payload.role = role;
```

Register the write-back handler in `start()` (next to the `tokenRequested` listener). The watch's `WatchTaskAction` carries `groupId`/`patientId`/`taskId` separately, where `taskId` is the raw Firestore id (== `WatchTask.id`):

```javascript
    try {
      if (p && p.addListener) p.addListener("taskStatus", function (a) {
        try {
          var api = groupsApi(); if (!api || !api.setTaskStatus) return;
          var gid = a.groupId, pid = a.patientId, tid = a.taskId, status = a.status;
          if (gid && pid && tid && status) api.setTaskStatus(gid, pid, tid, status);
        } catch (e) {}
      });
    } catch (e) {}
```

- [ ] **Step 4: Rebuild the bundle**

Run: `npm run build:www && npx cap copy ios`
Expected: `grep -c 'payload.tasks' ios/App/App/public/native-watch.js` → `1`.

- [ ] **Step 5: Commit**

```bash
git add native-watch.js package-lock.json ios/App/App/public/native-watch.js local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchConnectivityRelay.swift local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/WatchBridgePlugin.swift
git commit -m "feat(watch): relay tasks/role + write task-status changes back to Firestore"
```

- [ ] **Step 6: On-device verify (end-to-end)**

Assign a task on the phone to yourself → it appears on the watch Tasks screen → tap **In progress** then **Complete** → the phone's Rounds view + Firestore reflect the change.

---

## PHASE 3 — True push to the wrist

> These tasks touch **shared, volatile backend files** and require Xcode capability setup + a Cloudflare deploy (user-run). Read each backend file immediately before editing (the other session may have changed it). Land P3 last.

### Task 9: Watch registers for remote notifications + relays its token

**Files:**
- Modify: `ios/StewardMDWatch/System/` (the `WKApplicationDelegate` — `WatchAppDelegate`), `ios/StewardMDWatch/System/WatchConnectivityManager.swift`

- [ ] **Step 1:** In `WatchAppDelegate`, on `applicationDidFinishLaunching`, call `WKApplication.shared().registerForRemoteNotifications()`; implement `didRegisterForRemoteNotifications(withDeviceToken:)` to hex-encode the token and call `WatchConnectivityManager.shared.sendWatchPushToken(hex)`.
- [ ] **Step 2:** Add `sendWatchPushToken(_ token: String)` to `WatchConnectivityManager` — `transferUserInfo(["kind":"watchPushToken","token":token])`.
- [ ] **Step 3:** Commit: `feat(watch): register for APNs + relay the watch push token to the phone`.

*(Verified on device: token arrives at the phone — add a temporary log, then strip in Task 12.)*

### Task 10: Phone registers the watch token with the backend

**Files:**
- Modify: `local-plugins/.../WatchConnectivityRelay.swift` (handle `kind:"watchPushToken"` → notification), `WatchBridgePlugin.swift` (re-emit `watchPushToken` event), `native-watch.js`.

- [ ] **Step 1:** Mirror the `taskStatus` plumbing for a `watchPushToken` event.
- [ ] **Step 2:** In `native-watch.js`, on `watchPushToken`, POST to `/api/push/register-native` with `{ token, platform: "watch" }` and the bridged Firebase ID token (reuse the existing auth header used by other `/api/*` calls). Confirm the endpoint accepts `platform:"watch"` (it stores `platform` verbatim — no server change needed to register).
- [ ] **Step 3:** Rebuild bundle (`npm run build:www && npx cap copy ios`); commit.

### Task 11: Backend sends to the watch topic

**Files:**
- Modify: `functions/_apns.js`, `functions/_nativepush.js`
- Test: add a small unit test for topic selection if the repo has a functions test harness; otherwise document a `curl` against `/api/push/test`.

- [ ] **Step 1:** Read both files. In the APNs send path, select the topic by platform: `platform === "watch" ? "in.stewardmd.app.watchkitapp" : BUNDLE_ID`. Keep additive (a `topicFor(platform)` helper).
- [ ] **Step 2:** Ensure `sendNativeToAll(env, msg, { uid })` includes `platform:"watch"` tokens in its fan-out (it already iterates all of a uid's tokens — just don't filter watch out).
- [ ] **Step 3:** Commit: `feat(push): send APNs to the watch app topic for watch tokens`.

### Task 12: Fan task + critical pushes to the watch; deep-link on tap; cleanup

**Files:**
- Modify: `functions/_taskpush.js` (task assignment already targets the assignee uid — no change if it uses `sendNativeToAll({uid})`, which now includes watch tokens); the critical-lab push path similarly.
- Modify: watch `NotificationController` / payload handling to route a `route` field via `AppGroupStore.savePendingRoute`.

- [ ] **Step 1:** Confirm task-assign + critical push both fan out via a uid path that now includes watch tokens; add the `route` (`tasks`/`criticals`) to the payload if absent.
- [ ] **Step 2:** On the watch, when a remote notification with `route` arrives, `store.savePendingRoute(route)` so `AppRouter.consumePending()` deep-links on open.
- [ ] **Step 3: Strip ALL temporary diagnostics.** Remove every `NSLog("[SMD-Watch] ...")` added during debugging (relay, plugin, watch apply, push-token logs).

Run: `grep -rn "\[SMD-Watch\]" ios local-plugins` → expect no matches.

- [ ] **Step 4:** `cd Packages/StewardMDWatchCore && swift test` → all pass. Rebuild bundle. Commit: `chore(watch): wrist push fan-out + deep-link; strip diagnostics`.
- [ ] **Step 5:** Update `docs/APPLE_WATCH.md` + PR #500 description with the new capabilities.

---

## Self-review notes (author)

- **Spec coverage:** ward-sync → Task 2; drug fix → Task 1; unit-wide criticals → Task 2; tasks model/persist/UI/write-back → Tasks 3–8; wrist push → Tasks 9–12. All spec sections mapped.
- **Refinement vs spec §3:** relay iterates ALL of the doctor's units (not one "active" unit), better matching "ICU and my ward" and removing the `ICU.activeGroupId()` dependency entirely.
- **Type consistency:** `WatchTask.id` IS the raw Firestore task id (Firestore auto-ids are globally unique), so `TasksModel.setStatus` can pass `t.id` as the `taskId` and the relay emits `id: t.id` — no composite id, no separate `taskId` field. Patient watchlist ids stay composite (`gid:pid`) because patient ids are only unit-unique.
- **Deploy note:** P3 requires the user to add the Push Notifications capability to the watch target in Xcode and to deploy the Cloudflare functions; Swift/JS is written by the implementer, capability + deploy are user-run.
