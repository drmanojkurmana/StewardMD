# StewardMD Watch — Mirror the Phone + Head→JR Task Flow

- **Date:** 2026-07-20
- **Status:** Approved (design); pending implementation plan
- **Branch:** `claude/stewardmd-apple-watch-integration-974f68`
- **Related:** PR #500 (native watch app), `docs/APPLE_WATCH.md`

## 1. Context & problem

The native Apple Watch app relays data from the iPhone over WatchConnectivity. Three
gaps make the watch an incomplete mirror of the phone, and one capability is missing
entirely:

1. **Ward Sync shows 1 patient of 5.** `native-watch.js` builds its watchlist from the
   *local, this-device* ICU roster (`ICU.listPatients()` = `loadRoster`) plus the
   open patient and a GHIS fallback. In **group mode** the real unit roster lives in
   Firestore and is exposed via `window.SMD_ICU_GROUPS.subscribePatients(gid)`. The
   relay never reads it, so only the locally-saved/open patient reaches the watch.
2. **Drug search returns nothing.** The watch decodes `DrugSearchResult.brands` as
   `[String]?`, but the Worker (`https://api.stewardmd.in/search`) returns `brands` as
   an **integer count** (e.g. `"brands": 2679`). The type mismatch throws during decode
   of `DrugSearchResponse`, so every query yields zero results.
3. **Critical alerts are open-patient-only.** Criticals are derived solely from
   `ICU.state().alerts` (the currently-open patient). Alerts on the other unit patients
   are never relayed. (Persistence across relaunch is already fixed — commit `a0c5320f`.)
4. **No task flow.** The phone's ICU group mode has a full per-patient **task** system
   (`assignedBy`/`assignedTo`/`status`/`completedBy`, role-gated instructing). None of it
   surfaces on the watch, so a Head cannot push a task to a Junior's wrist and get a
   tap-to-complete.

## 2. Goals & non-goals

### Goals
- The watch's **My Patients** shows every patient in the clinician's active shared unit.
- **Drug search** works.
- **Critical Labs** shows alerts across the whole unit, not just the open patient.
- A **Tasks** surface on the watch: the Junior sees tasks assigned to them (and
  unassigned open tasks on their unit's patients), and can mark them **in progress** or
  **complete** — the completion writes back to Firestore.
- **True APNs push to the wrist** for task assignments and critical labs, independent of
  whether the phone is foregrounded/reachable.

### Non-goals (YAGNI)
- **Creating/assigning** tasks from the watch. Assignment stays on the phone (senior
  roles, awkward on a small screen). The watch is view + complete/in-progress only.
- Free-form clinician-to-clinician chat/DM (does not exist on the phone; out of scope).
- On-call rota / shift scheduling (no data model exists; the `onCall` field stays a stub).
- Server-side Firestore access (Admin SDK on the Worker). All group reads/writes stay on
  the phone's existing client SDK.

## 3. Architecture

**Approach A — phone-relay, thin watch client.** The phone remains the only Firestore
client; the watch renders relayed snapshots and sends back small action commands.

```
Firestore (icuGroups/{gid})                 Apple Watch
      │  client SDK (SMD_ICU_GROUPS)              ▲
      ▼                                           │ WCSession applicationContext
  native-watch.js  ──── publish(context) ───► WatchBridge plugin ──► WatchConnectivityRelay
  (subscribe patients/tasks/members)                                        │
      ▲                                                                     ▼
      │  SMD_ICU_GROUPS.setTaskStatus(...)                        WatchConnectivityManager.apply
      └──── plugin "taskStatus" listener ◄── didReceiveUserInfo ◄── transferUserInfo (write-back)

  APNs (existing backend)  ──── push to watch APNs topic ───►  wrist buzz (alert layer)
```

Three planes, deliberately separated:

- **Data plane (phone → watch):** existing `updateApplicationContext` (coalesced,
  latest-wins). New context keys: `tasks`, `role` (and `members` if needed for labels).
- **Action plane (watch → phone):** `WCSession.transferUserInfo` for task-status
  write-back — **guaranteed, FIFO, background delivery** even when the phone app is not
  foregrounded (more reliable than `sendMessage`, which requires immediate reachability).
  The watch marks the task optimistically and queues via the existing `AckQueue` pattern.
- **Alert plane (backend → watch):** APNs push to the watch app's own token/topic. Wakes
  the wrist; the data plane then reconciles the authoritative state.

### Finding the active unit without touching `icu.js`
The relay determines the active group from the **public** `SMD_ICU_GROUPS.subscribeGroups`
(returns the user's units + `myRole`) combined with the stored active-unit preference
(the same localStorage key icu.js already uses). It must **not** read `icu.js` private
state. *Fallback:* if the active group id cannot be derived from public surfaces, add a
single read-only accessor `ICU.activeGroupId()` (one line) — the only permitted `icu.js`
change, chosen for minimal collision risk with the parallel Experimental Access work.

## 4. Component design

### 4.1 Phone: watch-relay group subscriptions (`native-watch.js`, additive)
- On auth + when group mode is active, resolve the active `gid` + `myRole`, then hold live
  subscriptions: `subscribePatients(gid)` and, per patient, `subscribeTasks(gid, pid)`
  (or reuse the board-level task listeners). Cache the latest snapshots in module scope.
- `publish()` gains, when data exists (never overwriting with empties):
  - `watchlist` — merged from **shared patients** (primary) + open patient + local roster,
    deduped by name+bed. Existing `WatchlistEntry` shape (adds nothing).
  - `criticals` — derived from **every** shared patient's `state` (alerts/scores), tagged
    `Bed · Name`, plus the open patient. Existing `LabAlert` shape.
  - `tasks` — flattened list across the unit's patients (see 4.4 for shape + filter).
  - `role` — the clinician's role in the active unit (drives which tasks show + gating).
- Republish on any snapshot change (debounced), on foreground, and on token refresh.
- Tear down subscriptions on sign-out / unit change (no leaks, no sync loops — mirror the
  existing `grpTeardownPatient` discipline; the relay **only reads**, never writes to
  Firestore except via the explicit write-back handler in 4.2).

### 4.2 Phone: write-back handler (`WatchConnectivityRelay.swift` + plugin + JS)
- `WatchConnectivityRelay` implements `didReceiveUserInfo`. On `kind == "taskStatus"` it
  posts a `Notification` carrying `{gid, pid, taskId, status}` (same decoupled pattern as
  the existing `tokenRequested`).
- `WatchBridgePlugin` observes it and `notifyListeners("taskStatus", payload)`.
- `native-watch.js` listens for `taskStatus` and calls
  `SMD_ICU_GROUPS.setTaskStatus(gid, pid, taskId, status)`. The resulting Firestore change
  flows back to the watch through the normal data plane, confirming the optimistic update.

### 4.3 Watch: models & persistence (`StewardMDWatchCore`)
- New `WatchTask: Codable, Sendable, Identifiable, Equatable, Hashable`:
  `id, patientId, patientLabel, text, priority (immediate|high|moderate|low),
  status (pending|progress|done), assignedByName, assignedToUid, dueAt: Double?,
  ts: Double?`.
- New `@MainActor TasksModel: ObservableObject` — `@Published tasks`, `ingest([WatchTask])`
  (merge by id + rank: overdue → priority → recency; drop `done` older than 6h, matching
  the phone's Rounds view),
  `openCount`, and `setStatus(_:to:)` that updates optimistically + enqueues the write-back.
- `AppGroupStore` — add `save/loadTasks` (+ include in `clear()`), mirroring watchlist/
  criticals, so Tasks survives relaunch and patient-less syncs.
- `DrugSearchResult.brands`: change `[String]?` → `Int?` (matches the API; the field is a
  count, shown as "N brands"). No other drug change.

### 4.4 Watch: task visibility & UI
- **Visibility rule:** show tasks whose `assignedToUid == myUid`, plus **unassigned** open
  tasks on patients in the active unit. If the clinician's role is an instructing role
  (`head/professor/assistant/senior_resident`), show **all** open unit tasks.
- New `TasksView` (list, ranked; empty state) + `TaskRowView` (patient label, text,
  priority chip, due, assigned-by). Row actions: **In progress** and **Complete**;
  completed rows show completer + time and fall out of the list after the 6h grace window.
- Home (`RootListView`) gains a **Tasks** row with an open-count badge (like Critical Labs).
- App Intent / deep link so a task push opens straight to `TasksView`.

### 4.5 Wrist push (watch APNs + backend)
- **Watch app:** add the **Push Notifications** capability + entitlement; register for
  remote notifications on launch; obtain the watch APNs token.
- **Token relay:** the watch sends its token to the phone (`transferUserInfo`
  `{kind:"watchPushToken", token}`); the phone registers it via the existing
  `POST /api/push/register-native` with **`platform:"watch"`** (uid comes from the verified
  Firebase token, as today). No new registration endpoint.
- **Backend (additive):** `saveNativeToken` already stores `platform`. `sendNativeToAll` /
  `_apns.js` branch on `platform === "watch"` to send with the **watch app's APNs topic**
  (`in.stewardmd.app.watchkitapp`) instead of the phone topic. `_taskpush.js`
  (`notifyNewInstruction`) and the critical-lab push additionally fan out to the assignee's
  watch token(s). Changes are strictly additive (new platform branch + topic constant) to
  limit collision risk on shared push files.

## 5. Message & data contracts

- **Context (phone → watch), new keys** (all optional, JSON `Data`, latest-wins):
  - `tasks`: `[WatchTask]`
  - `role`: `String` (active-unit role)
- **User-info (watch → phone):**
  - `{kind:"taskStatus", gid, pid, taskId, status}` where `status ∈ pending|progress|done`
  - `{kind:"watchPushToken", token}`
- **APNs (backend → watch):** existing task/critical payloads, sent to `platform:"watch"`
  tokens with topic `in.stewardmd.app.watchkitapp`; payload carries a deep-link route
  (`tasks` / `criticals`) consumed via `AppGroupStore.savePendingRoute`.

## 6. Isolation & risk

- **Do not modify the Experimental Access work.** All changes are additive and gated on the
  existing native/`SMD_ICU_GROUPS` flags; the web build and existing native flows are
  untouched.
- Prefer **public** `SMD_ICU_GROUPS` / `ICU` surfaces over `icu.js` internals; the only
  permitted `icu.js` edit is the optional one-line `activeGroupId()` accessor.
- **Shared-file risk:** the push backend (`_apns.js`, `_nativepush.js`, `_taskpush.js`) is
  shared. Keep edits additive (platform branch + topic). If the other session is editing
  these, land the watch-push phase (P3) last to ease merging.
- **No duplicated backend/networking:** group reads/writes reuse the phone's client SDK; no
  server-side Firestore.
- Capacitor gotcha: any `native-watch.js` change requires `npm run build:www && npx cap
  copy ios` to reach the app bundle. This must run after every JS edit.

## 7. Testing

- `StewardMDWatchCore` unit tests (macOS, `swift test`):
  - `TasksModel` ranking (overdue → priority → recency), done-grace filtering, optimistic
    `setStatus` + queued write-back, visibility filter (assigned-to-me vs unit-wide by role).
  - `AppGroupStore` tasks round-trip + `clear()`.
  - Criticals dedup/merge across multiple patients.
  - `DrugSearchResponse` decode against the **real** payload shape (`brands` as `Int`).
- Backend: unit test the `platform:"watch"` topic branch in the push builder.
- Manual on-device: relay shows all unit patients; drug search returns results; unit-wide
  criticals; assign on phone → task on watch → tap complete → Firestore + phone reflect it;
  push buzzes the wrist with the phone backgrounded.
- Strip the temporary `[SMD-Watch]` diagnostic NSLogs before the final PR.

## 8. Phasing (one spec, shippable increments)

- **P1 — Mirror fixes.** Relay shared patients (all 5); fix `brands` decode; unit-wide
  criticals. Small, high-confidence; makes the watch a faithful mirror.
- **P2 — Tasks.** `WatchTask`/`TasksModel` + persistence; relay tasks + role; `TasksView` +
  Home badge; `transferUserInfo` write-back → `setTaskStatus`. Delivers see + tap-complete.
- **P3 — Wrist push.** Watch APNs capability + token relay + registration; backend
  watch-topic branch; task/critical fan-out to the watch token; deep-link on tap.

## 9. Assumptions & open questions

- **Assumption:** the active group id is derivable from public `SMD_ICU_GROUPS.subscribeGroups`
  + the stored active-unit preference. If not, the one-line `ICU.activeGroupId()` accessor is
  added (§3 fallback).
- **Assumption:** the watch app can register for remote notifications with its own bundle id
  and the backend APNs auth key covers that topic (same team/key, different topic string).
- **Open (P3):** whether `_taskpush.js`/push files are actively edited by the Experimental
  Access session — if so, sequence P3 to land last to minimize merge conflicts.
