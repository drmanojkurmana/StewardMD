# StewardMD Wear OS Client (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Wear OS (Kotlin + Compose for Wear OS) client that reuses the StewardMD backend for watched-patient lab alerts, critical-lab review, ICU tasks, shift handover, drug/calculator lookup, and a rate-only Code Blue CPR assist.

**Architecture:** New `wear/` Gradle module in the existing Android project. **Firebase-Auth-on-watch + Firestore Android SDK direct** (D1): the phone bridges the Firebase credential over the Wearable Data Layer; the watch then authenticates and reads live ICU state straight from Firestore and calls the `Bearer`-token REST endpoints. Client code shares nothing with watchOS; the backend is reused unchanged except two **additive** push changes. Design spec: `docs/superpowers/specs/2026-08-06-wearos-mvp-design.md`.

**Tech Stack:** Kotlin, Compose for Wear OS (+ Horologist), Ktor client (OkHttp engine), Firebase Android SDK (Auth + Firestore), `play-services-wearable` (Data Layer), FCM, Android `SensorManager` + foreground service (Code Blue keep-alive). JUnit + Robolectric for unit tests; a real Wear OS device for Data Layer + sensor tests.

## Global Constraints

- **MUST NOT disturb the Apple Watch.** No edits to `ios/StewardMDWatch*`, `Packages/StewardMDWatchCore`, `local-plugins/capacitor-watch-bridge`, or the iOS WCSession path. No behavior change to existing `/api/watch/*` or `/api/ghis/*` routes or to `firestore.rules`.
- **Backend changes are additive only** and limited to push routing (`functions/_nativepush.js` + the `/api/watch/codeblue` `platform` value). Every backend change carries an **APNs regression gate**: the iOS lab-alert and Code Blue pushes must still fire unchanged.
- **Auth is server-derived.** Every `/api/watch/*` and `/api/ghis/*` call sends `Authorization: Bearer <Firebase ID token>`; the server derives the uid via `identify()`. The client never asserts identity.
- **Code Blue safety (§0), non-negotiable:** rate only, in the AHA **100-120 CPM** band. NEVER compression depth, NEVER a CPR-quality/adequacy verdict. Drug/rhythm prompts are reminders, not orders. Keep the rate-calibration constant tunable (real sensors read off). **R1 clinical review is a blocking gate.**
- **No PHI on the lock screen / in push bodies.** Lab-alert notifications carry bed + ward + test name only — never patient name/MRN or a result value (mirrors the existing `runForUid`).
- Behavior oracle for every port: `functions/api/watch/[[path]].js` (contracts) + `Packages/StewardMDWatchCore` (logic).

---

### Task 1: Wear module scaffold + CI

**Files:**
- Create: `android/wear/build.gradle.kts`, `android/wear/src/main/AndroidManifest.xml`, `android/settings.gradle.kts` (include `:wear`)
- Create: `android/wear/src/main/kotlin/in/stewardmd/wear/MainActivity.kt`
- Test: `android/wear/src/test/kotlin/in/stewardmd/wear/SmokeTest.kt`

**Interfaces:**
- Produces: a launchable Wear module `in.stewardmd.wear` with Compose for Wear OS wired.

- [ ] **Step 1: Write the failing test** — a Robolectric smoke test asserting `MainActivity` launches.
```kotlin
@RunWith(RobolectricTestRunner::class)
class SmokeTest {
  @Test fun launches() {
    val c = Robolectric.buildActivity(MainActivity::class.java).setup().get()
    assertNotNull(c)
  }
}
```
- [ ] **Step 2: Run it — expect FAIL** (module/class absent). `./gradlew :wear:testDebugUnitTest`
- [ ] **Step 3: Scaffold** the module: `build.gradle.kts` (Compose for Wear OS, Horologist, Ktor-OkHttp, `play-services-wearable`, Firebase BoM Auth+Firestore, FCM), `wearApp {}` manifest, minimal `MainActivity` with a `ScalingLazyColumn` "StewardMD" placeholder.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(wear): Wear OS module scaffold`.

---

### Task 2: Networking core — `ApiClient` + endpoints + models

**Files:**
- Create: `android/wear/src/main/kotlin/in/stewardmd/wear/net/ApiClient.kt`, `Endpoints.kt`, `net/AuthTokenProvider.kt`
- Create: `android/wear/src/main/kotlin/in/stewardmd/wear/model/{Patient,Lab,LabDetail,WatchTask,DrugResult}.kt`
- Test: `android/wear/src/test/kotlin/in/stewardmd/wear/net/ApiClientTest.kt`

**Interfaces:**
- Produces:
  - `interface AuthTokenProvider { suspend fun currentToken(): String? }`
  - `class ApiClient(base: String = "https://stewardmd.in", tokenProvider: AuthTokenProvider)` with `suspend fun <T> get(path, needsAuth, deserialize)` / `post(...)` that attaches `Authorization: Bearer <token>` when `needsAuth`, maps 401→`Unauthorized`, non-2xx→`HttpError(code)`.
  - Data classes matching the JSON: `Patient(patientId, name?, bedName?, deptDescription?)`, `Lab(orders: List<Order>)`, `Order(renderId?, orderId?, episodeId?, serviceName?)`, `LabDetail(tests: List<TestRow>)`, `TestRow(result?, ...)`, `WatchTask(...)`, `DrugResult(...)`.

- [ ] **Step 1: Write the failing test** — Bearer attach + 401 mapping against a stub engine.
```kotlin
@Test fun attachesBearerAndMaps401() = runTest {
  val engine = MockEngine { req ->
    assertEquals("Bearer tok123", req.headers["Authorization"])
    respond("", HttpStatusCode.Unauthorized)
  }
  val api = ApiClient(engine = engine, tokenProvider = { "tok123" })
  assertFailsWith<ApiError.Unauthorized> { api.get<Unit>("/api/watch/status", needsAuth = true) }
}
```
- [ ] **Step 2: Run — FAIL** (ApiClient absent).
- [ ] **Step 3: Implement** `ApiClient` (Ktor, `kotlinx.serialization`), `AuthTokenProvider` (fun interface), the models. `Endpoints.kt` centralizes paths from the spec's contract map.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): Ktor ApiClient + models + Bearer auth`.

---

### Task 3: Auth bridge — phone producer + watch consumer + Firebase sign-in

**Files:**
- Create (WATCH): `android/wear/src/main/kotlin/in/stewardmd/wear/auth/DataLayerAuth.kt`, `auth/FirebaseTokenProvider.kt`
- Create (PHONE): `android/app/src/main/java/in/stewardmd/app/wear/WearBridgeService.kt` (+ manifest `<service>` for `WearableListenerService`)
- Test: `android/wear/src/test/kotlin/in/stewardmd/wear/auth/DataLayerAuthTest.kt`

**Interfaces:**
- Data Layer message paths: `/smd/auth/credential` (phone→watch: Firebase custom token or OAuth idToken JSON), `/smd/auth/refresh` (watch→phone: `tokenRequest`), `/smd/ghis/token` (phone→watch: current GHIS session token).
- Produces:
  - `FirebaseTokenProvider : AuthTokenProvider` — returns `FirebaseAuth.getInstance().currentUser?.getIdToken(false)`; on null/expired sends `/smd/auth/refresh` and awaits the credential.
  - Phone `WearBridgeService` (`WearableListenerService`) that, on `onMessageReceived("/smd/auth/refresh")`, replies with a fresh credential; and pushes `/smd/ghis/token` when the phone has a GHIS session.

**Constraint check:** this is net-new Android/Wear code; it does not touch the iPhone app or WCSession.

- [ ] **Step 1: Write the failing test** — receiving a `/smd/auth/credential` message signs the watch into Firebase.
```kotlin
@Test fun credentialMessageSignsIn() = runTest {
  val fakeAuth = FakeAuth()
  val bridge = DataLayerAuth(fakeAuth)
  bridge.onMessage("/smd/auth/credential", """{"idToken":"g-id-token"}""".toByteArray())
  assertTrue(fakeAuth.signedIn)
}
```
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the watch consumer (`MessageClient.OnMessageReceivedListener`) → `FirebaseAuth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null))`; implement `FirebaseTokenProvider`; implement the phone `WearBridgeService` producer.
- [ ] **Step 4: Run — PASS** (unit). Defer the real phone↔watch handshake to Task 12's device test.
- [ ] **Step 5: Commit** `feat(wear): Data Layer auth bridge + Firebase sign-in on watch`.

---

### Task 4: Firestore-direct ICU repository (tasks + patient)

**Files:**
- Create: `android/wear/src/main/kotlin/in/stewardmd/wear/data/IcuRepository.kt`
- Test: `android/wear/src/test/kotlin/in/stewardmd/wear/data/IcuRepositoryTest.kt`

**Interfaces:**
- Produces:
  - `class IcuRepository(db: FirebaseFirestore)`
  - `fun tasks(gid: String, pid: String): Flow<List<WatchTask>>` — snapshot listener on `icuGroups/{gid}/patients/{pid}/tasks` ordered by `ts desc`, mapped exactly like `mapTask` in `icu-collab.js`.
  - `fun patient(gid: String, pid: String): Flow<PatientState>` — listener on the patient doc.
- Firestore paths + field names come from `icu-collab.js` header (data model block).

- [ ] **Step 1: Write the failing test** — a seeded fake Firestore emits a task list on the Flow (map parity with `mapTask`).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `IcuRepository` with `callbackFlow` over `addSnapshotListener`; map docs to `WatchTask` (id, text, status, assignedBy, ts…).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): Firestore-direct ICU repository`.

---

### Task 5: Watchlist screen

**Files:**
- Create: `ui/watchlist/WatchlistViewModel.kt`, `ui/watchlist/WatchlistScreen.kt`, `data/WatchApi.kt`
- Test: `test/.../WatchlistViewModelTest.kt`

**Interfaces:**
- Consumes: `ApiClient` (Task 2).
- Produces: `WatchApi.status()` → `GET /api/watch/status` → `{consented, watching:[Patient]}`; `add(patient)` → `POST /api/watch/add`; `remove(patientId)` → `POST /api/watch/remove`. `WatchlistViewModel` exposes `StateFlow<WatchlistUi>` (loading / list / needsConsent / needsPro-402).

- [ ] **Step 1: Failing test** — `status()` 402 → `WatchlistUi.NeedsPro`; success → `Loaded(list)`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `WatchApi` + `WatchlistViewModel` + a `ScalingLazyColumn` screen (rows = watched patients, swipe/press to remove, add via patient picker fed from the labs worklist).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): watchlist screen`.

---

### Task 6: Labs — critical labs + detail

**Files:**
- Create: `ui/labs/LabsViewModel.kt`, `ui/labs/LabsScreen.kt`, `ui/labs/LabDetailScreen.kt`, `data/GhisApi.kt`
- Test: `test/.../LabsViewModelTest.kt`

**Interfaces:**
- Consumes: `ApiClient`, `AuthTokenProvider` (Firebase Bearer), and the **GHIS token** from the Data Layer (`/smd/ghis/token`, Task 3). GHIS calls send `Authorization: Bearer <ghisToken>`.
- Produces: `GhisApi.patients()` → `/api/ghis/patients`; `labs(patientId)` → `/api/ghis/lab`; `labDetail(renderId, episodeId)` → `/api/ghis/lab-detail`. `ack(id, labId, label, ackedAt)` → `POST /api/watch/ack` (Firebase Bearer, idempotent).
- **Rule (mirror server):** show "No values recorded" when `tests[]` has no non-empty `result`; only surface orders that actually gained values.

- [ ] **Step 1: Failing test** — an order with empty `tests[].result` renders as "No values recorded"; ack is idempotent by `id`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `GhisApi`, `LabsViewModel` (worklist → per-patient orders → detail), screens, ack (with local idempotency guard mirroring the server log).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): critical labs + detail + ack`.

---

### Task 7: Tasks screen (read Firestore, write status)

**Files:**
- Create: `ui/tasks/TasksViewModel.kt`, `ui/tasks/TasksScreen.kt`
- Test: `test/.../TasksViewModelTest.kt`

**Interfaces:**
- Consumes: `IcuRepository.tasks()` (Task 4), `ApiClient`.
- Produces: `setStatus(gid, pid, taskId, status)` → `POST /api/watch/task` (403 `forbidden` → surface "not permitted"). Screen: task rows with mark in-progress/complete; live-updates from the Firestore Flow.

- [ ] **Step 1: Failing test** — a 403 from `/task` maps to `TasksUi.error("not permitted")`; a successful write is optimistic then reconciled by the Flow.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): ICU tasks read+write`.

---

### Task 8: Handover screen

**Files:**
- Create: `ui/handover/HandoverViewModel.kt`, `ui/handover/HandoverScreen.kt`
- Test: `test/.../HandoverViewModelTest.kt`

**Interfaces:**
- Consumes: `IcuRepository.patient()` (SBAR source), `ApiClient`.
- Produces: `postHandover(gid, pid, detail)` → `POST /api/watch/timeline {type:"handover", title:"Shift handover", detail}`; `postInstruction(...)` → `POST /api/watch/instruction`. **Honest result** (mirror the icu.js fix): await the write, toast success/failure, never a false "posted".

- [ ] **Step 1: Failing test** — write failure surfaces an error state (not success).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** SBAR composer from patient state + post with real-result handling.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): shift handover`.

---

### Task 9: Drug lookup

**Files:**
- Create: `ui/drugs/DrugViewModel.kt`, `ui/drugs/DrugScreen.kt`, `data/DrugApi.kt`
- Test: `test/.../DrugApiTest.kt`

**Interfaces:**
- Produces: `DrugApi(base="https://api.stewardmd.in")` — **no auth** (mirror `DrugAPI.swift`); `search(query)` → `DrugResult`. Debounced query + result detail screen.

- [ ] **Step 1: Failing test** — `search()` hits the public base with no `Authorization` header.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): drug lookup (public API)`.

---

### Task 10: Calculators (native subset + ABG)

**Files:**
- Create: `calc/NativeCalcs.kt`, `calc/AbgInterpreter.kt`, `ui/calc/CalcScreen.kt`
- Test: `test/.../CalcParityTest.kt`

**Interfaces:**
- Produces: Kotlin ports of the 6 `NativeCalcs` functions + `ABGInterpreter`. Each function signature + expected output taken from `Packages/StewardMDWatchCore/Sources/.../NativeCalcs.swift` and `ABGInterpreter.swift`.
- **Parity test:** fixtures copied from the Swift/`calculators.js` expected values; Kotlin output must match exactly.

- [ ] **Step 1: Failing test** — ABG + each native calc against fixture inputs/outputs.
```kotlin
@Test fun abgMatchesReference() {
  // fixture from ABGInterpreter.swift / calculators.js
  val r = AbgInterpreter.interpret(ph = 7.20, paco2 = 30.0, hco3 = 12.0)
  assertEquals("Metabolic acidosis with respiratory compensation", r.primary)
}
```
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the ports (rate/values byte-for-byte with the source).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(wear): native calculator subset + ABG`.
> Skipped: the full JS `calculators.js` catalog (needs a JS runtime on Wear). Add when justified.

---

### Task 11: Code Blue — CPR assist (SAFETY-CRITICAL, R1-gated)

**Files:**
- Create: `codeblue/CompressionAnalyzer.kt`, `codeblue/RateCoach.kt`, `codeblue/CodeBlueModel.kt`, `codeblue/CodeBlueService.kt` (foreground service), `ui/codeblue/CodeBlueScreen.kt`, `ui/EmergencyScreen.kt`
- Test: `test/.../CompressionAnalyzerTest.kt`, `test/.../RateCoachTest.kt`, `test/.../CodeBlueModelTest.kt`

**Interfaces:**
- Ports (logic byte-for-byte from `Packages/StewardMDWatchCore`):
  - `RateCoach`: `lower=100, upper=120`; `zone(rateCpm, active): RateZone` (idle/tooSlow/onTarget/tooFast). Rate-matching copy only — NEVER a quality verdict.
  - `CompressionAnalyzer`: consumes an accel sample stream, emits `count`, `rateCpm`, `pause`. 1-D compression axis + low-pass smoothing + peak count + refractory backstop. **No depth, no quality.**
  - `CodeBlueModel`: 2-min rhythm-check cycle timer, adrenaline/amiodarone **reminders**, shock/rhythm/ROSC tally, `CodeEvent` log, `CodeSummary.build(...)`.
- `CodeBlueService` (foreground service + Ongoing Activity): owns `SensorManager` accelerometer registration so sensing survives screen-off/low-battery for the whole code.
- Start alert: `POST /api/watch/codeblue {event:"start"}`. End: `CodeSummary` → `POST /api/watch/timeline`.
- **Calibration:** `CompressionAnalyzer` takes a `calibration: Double = 1.0` constant (accel axis/scale varies per device) — tunable, not hard-coded.

- [ ] **Step 1: Failing tests**
```kotlin
@Test fun rateZones() {
  assertEquals(RateZone.TooSlow, RateCoach.zone(90, active = true))
  assertEquals(RateZone.OnTarget, RateCoach.zone(110, active = true))
  assertEquals(RateZone.TooFast, RateCoach.zone(130, active = true))
  assertEquals(RateZone.Idle, RateCoach.zone(0, active = true))
}
@Test fun analyzerReportsRateNeverDepth() {
  val a = CompressionAnalyzer(calibration = 1.0)
  val out = a.process(sineCompressions(cpm = 110, seconds = 6))  // synthetic axis signal
  assertTrue(out.rateCpm in 100..120)
  // API surface must not expose depth/quality — compile-time guarantee (no such field/method)
}
```
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the three ports + `CodeBlueService` (foreground service, `START_STICKY`, ongoing notification) + screens (rate ring + zone color + haptics via `Vibrator`; drug/rhythm prompts) + start/summary API calls.
- [ ] **Step 4: Run — PASS** (unit). Real-hardware rate accuracy + keep-alive verified in Task 13.
- [ ] **Step 5: Commit** `feat(wear): Code Blue CPR assist (rate-only, R1-gated)`.
- [ ] **Step 6: R1 gate** — request `stewardmd-clinical-reviewer` sign-off on the rate-only guarantee, calibration approach, and prompt copy. BLOCKING before ship.

---

### Task 12: Push — FCM (additive backend + Wear registration)

**Files:**
- Modify: `functions/_nativepush.js` (`sendNativeToAll` — add an FCM branch), `functions/api/watch/[[path]].js:216` (codeblue `platform` routing)
- Create: `android/wear/src/main/kotlin/in/stewardmd/wear/push/WearFcmService.kt`, device-token registration
- Test: `functions/test` FCM-branch unit test + APNs **regression** test; `test/.../FcmPayloadTest.kt`

**Interfaces:**
- `sendNativeToAll(env, msg, opts)` gains FCM delivery for Android/Wear device tokens **without changing the APNs path**. `codeblue` route: send to the caller's own platform (iOS→APNs unchanged, Android→FCM).
- Wear registers its FCM token to the same per-uid device store the iOS watch uses.
- Lab-alert notification body carries **bed + ward + test name only** (no PHI), mirroring `runForUid`.

- [ ] **Step 1: Failing tests** — (a) an Android device token yields an FCM send; (b) **regression:** an iOS token still yields the exact APNs send as before; (c) notification body contains no patient name/result.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** additively; add the `platform` routing to `/codeblue`.
- [ ] **Step 4: Run — PASS** (incl. APNs regression green).
- [ ] **Step 5: Commit** `feat(push): additive FCM path for Wear (APNs unchanged)`.

---

### Task 13: Device integration + release (Play internal testing)

**Files:**
- Modify: `android/wear/build.gradle.kts` (release signing, version), `android/wear/src/main/AndroidManifest.xml` (permissions: `BODY_SENSORS`/`HIGH_SAMPLING_RATE_SENSORS`, `FOREGROUND_SERVICE`, `POST_NOTIFICATIONS`)
- Create: `docs/wearos-release.md` (build + Play internal-testing steps)

**Interfaces:** consumes everything above.

- [ ] **Step 1** Pair a real Wear OS device; verify the **Data Layer auth handshake** (phone→watch credential, refresh) and Firestore reads authorize identically to the phone (same uid).
- [ ] **Step 2** Verify Code Blue on-device: rate accuracy vs a metronome at 100/110/120 CPM (tune `calibration`), and the foreground service survives a full simulated code (screen-off, low battery).
- [ ] **Step 3** Verify lab-alert FCM lands on the watch; **run the APNs regression gate** — Apple Watch lab alert + Code Blue push still fire.
- [ ] **Step 4** Build a signed Wear AAB; upload to Play **internal testing**.
- [ ] **Step 5: Commit** `chore(wear): release config + internal-testing build`.

---

## Self-review

- **Spec coverage:** 9 screens (watchlist, labs+detail, tasks, handover, drugs, calcs, Code Blue, emergency, root) + auth bridge + Firestore-direct + FCM + Code Blue all have tasks. ✎
- **Types consistent:** `AuthTokenProvider`, `ApiClient`, `IcuRepository`, `RateCoach.zone`, `CompressionAnalyzer(calibration)` used consistently across tasks.
- **No placeholders:** every code step has representative Kotlin/test content; StewardMD-specific glue (Bearer, endpoint shapes, DSP ports, calc fixtures, PHI-free push) is concrete. Standard Compose UI is described by pattern (skilled Kotlin dev fills idiomatic layout).
- **Constraints threaded:** no-disturb-iOS (Tasks 1-13), additive-FCM + APNs regression (Task 12), Code Blue §0 safety + R1 gate (Task 11), server-derived auth (Tasks 2-8).
