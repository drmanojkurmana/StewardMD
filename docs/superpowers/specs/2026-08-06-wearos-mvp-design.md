# StewardMD Wear OS Client — MVP Design

**Date:** 2026-08-06
**Status:** Draft for review
**Scope:** A first-slice Wear OS (Kotlin + Compose for Wear OS) client that reuses the existing
StewardMD backend. The Apple Watch app is native watchOS/SwiftUI (`ios/StewardMDWatch` +
`Packages/StewardMDWatchCore`) and shares **zero client code** with Wear OS; the **backend is 100%
reusable**. This spec covers the MVP client only — not full parity.

## Goal

Ship a useful Wear OS app for the clinician's wrist that reuses the existing StewardMD API: watched-patient
lab alerts, critical-lab review, ICU tasks, shift handover, and drug/calculator lookup. Defer the
expensive, safety-reviewed features (Code Blue/CPR, timers, tiles) to phase 2.

## Hard constraint — MUST NOT disturb the Apple Watch

The existing watchOS app (`ios/StewardMDWatch`, `Packages/StewardMDWatchCore`, the WCSession bridge, and
its APNs alerts) must remain **byte-for-byte unaffected**. This build is new-platform code + additive
backend only:
- **No edits** to `ios/StewardMDWatch*`, `Packages/StewardMDWatchCore`, `local-plugins/capacitor-watch-bridge`,
  or the iOS WCSession path.
- **No changes** to existing `/api/watch/*`, `/api/ghis/*` behavior or to `firestore.rules` (the Wear app
  is an additional consumer of the same contracts and the same uid/membership gating).
- Shared backend changes are limited to **push routing** and must be **strictly additive**, leaving the
  iOS APNs paths byte-for-byte unchanged: (a) `_nativepush.js` `sendNativeToAll` gains an **FCM** branch;
  (b) the `/api/watch/codeblue` route's hard-coded `platform:"ios"` is relaxed to route to the caller's
  own platform. Regression gate: confirm the iOS **lab alert** and **Code Blue** pushes still fire before/
  after.
- Android phone-app changes (Data Layer bridge) are isolated from the iPhone app + Apple Watch pairing.
- **Code Blue safety rule travels with the port:** rate only, **never** compression depth or a CPR-quality
  verdict (design §0). No exception, on any platform.

## MVP screen set

| # | Screen | Purpose |
|---|--------|---------|
| 1 | Root list | Navigation hub (watchlist / labs / tasks / handover / drugs / calcs) |
| 2 | Watchlist | The doctor's watched patients + add/remove |
| 3 | Critical labs + detail | New/critical lab results for a watched patient, acknowledge |
| 4 | Tasks | Live ICU round tasks; mark in-progress/complete |
| 5 | Handover | Compose + post an SBAR shift handover to the unit |
| 6 | Drug lookup | Dose/interaction lookup (public, no auth) |
| 7 | Calculators | Native calculator subset (ABG + top scores) |
| 8 | **Code Blue (CPR assist)** | Rate-only compression coach + code timer/log + phone alert |
| 9 | Emergency | Quick entry to Code Blue |

## Architecture decision (KEY — needs sign-off)

**Recommended: Firebase Auth on the watch + Firestore Android SDK direct.**
- The phone bridges the Firebase **credential/ID token** to the watch over the **Wearable Data Layer**
  (`DataClient`/`MessageClient`). The watch signs in to Firebase → gets its own auth.
- With auth on the watch: **live ICU reads** (tasks, patient state, handover source) use the **Firestore
  Android SDK directly** — the same collections the phone subscribes to — and **all `Bearer`-token REST
  endpoints** (`/api/watch/*`, `/api/ghis/*`) work directly.
- This **eliminates the `relayState` protocol** the iOS app uses (phone subscribes to Firestore and
  forwards state over WCSession). On Wear that protocol would be net-new code on both sides; Firestore
  SDK on Wear OS removes it. **Less code, fewer moving parts.**

**Alternative (rejected for MVP): mirror the iOS relay** — phone owns all Firestore, forwards `relayState`
to the watch. More custom protocol, more phone-app coupling. Only revisit if Firebase Auth on Wear OS
proves unreliable in testing.

> **Open decision D1:** confirm Firebase-Auth-on-watch + Firestore-direct. Everything below assumes it.

Still required over the Data Layer regardless: the **Firebase token/credential** and the **GHIS session
token** (`ghisToken`) — the watch does not hold GHIS credentials (those stay server-side for the cron).

## Endpoint contract map (all exist today — verified in `functions/api/watch/[[path]].js`)

Auth for every `/api/watch/*` and `/api/ghis/*` call: `Authorization: Bearer <Firebase ID token>`
(server derives the owning uid via `identify()` — client never asserts identity).

| Screen | Method + path | Request | Response / notes |
|--------|---------------|---------|------------------|
| Watchlist | `GET /api/watch/status` | — | `{ consented, watching:[...] }` |
| Watchlist | `POST /api/watch/enable` | `{ ghisUserId, ghisPassword, patient, consent:true }` | Pro-gated (402 `needs-pro`); consent required |
| Watchlist | `POST /api/watch/add` | `{ patient }` | must already be consented (403 `not-consented`) |
| Watchlist | `POST /api/watch/remove` | `{ patientId }` | drops creds when list empties |
| Watchlist | `POST /api/watch/forget` | — | delete creds + all watches |
| Labs | `POST /api/ghis/login` | `{ userId, password }` | `{ token }` (or receive `ghisToken` via Data Layer) |
| Labs | `GET /api/ghis/patients` | Bearer GHIS token | worklist → bed/ward per patientId |
| Labs | `GET /api/ghis/lab?patientId=` | Bearer GHIS token | `{ orders:[...] }` |
| Labs | `GET /api/ghis/lab-detail?renderId=&episodeId=` | Bearer GHIS token | `{ tests:[...] }` (values or "No values recorded") |
| Labs | `POST /api/watch/ack` | `{ id, labId, patientLabel, ackedAt }` | idempotent per `id`; audit log |
| Tasks | read | Firestore SDK (ICU unit tasks) | live subscription (per D1) |
| Tasks | `POST /api/watch/task` | `{ gid, pid, taskId, status }` | membership-gated (403 `forbidden`) |
| Handover | `POST /api/watch/timeline` | `{ gid, pid, type, title, detail }` | append-only audit event |
| Handover | `POST /api/watch/instruction` | `{ gid, pid, text, priority }` | writes instruction + fans push to unit |
| Drugs | `GET https://api.stewardmd.in/...` | — (public, no auth) | reuse `DrugAPI` contract |
| Calcs | on-device | — | native subset (see below) |
| Code Blue | `POST /api/watch/codeblue` | `{ event:"start" }` | pushes "CODE BLUE" alert to the clinician's own phone Command Center |
| Code Blue | `POST /api/watch/timeline` | `{ gid, pid, type, title, detail }` | end-of-arrest `CodeSummary` saved to the chart |

**Backend gaps for the MVP (small):**
- **Push transport:** watch lab alerts go out APNs-only via `sendNativeToAll`. Wear needs **FCM** data
  messages. Add an FCM path + register the Wear device's FCM token. (~2-3 days server + client.)
- **Code Blue push:** `POST /api/watch/codeblue` hard-codes `platform:"ios"` (line 216). Relax it
  **additively** so the alert reaches the caller's **own** platform — Android phone via FCM — leaving
  the iOS APNs push byte-for-byte unchanged.
- Everything else in the table already serves the iOS watch unchanged.

## Phone-side (Android app) work

The Android phone app must gain a **Wearable Data Layer listener/producer**:
- Push the Firebase credential/ID token to the watch (and refresh on `tokenRequest`).
- Push the current `ghisToken` when the phone has a live GHIS session.
- (Optional) favorites/recents sync — defer to phase 2.

This is net-new Android code and the **highest-risk MVP item** (touches the shipping phone app).

## Calculators (MVP subset)

iOS runs the full `calculators.js` catalog via JavaScriptCore over a relayed-JS channel, plus 6 native
calcs (`NativeCalcs`). MVP: **port the 6 native calcs + ABG interpreter to Kotlin** and ship a curated
top-N. **Defer** the full JS-relay catalog (would need an embedded JS runtime on Wear).
→ skipped: full calculator catalog; add when a JS runtime on Wear is justified.

## Code Blue / CPR assist (MVP — SAFETY-CRITICAL)

Port of the watchOS CPR assistant. **Rate only — NEVER compression depth or CPR-quality/adequacy
verdicts** (WatchCore design §0; `CompressionAnalyzer` header: "No quality/depth — counts + rate +
pause only"; `RateCoach`: "strictly rate-matching guidance"). This constraint is non-negotiable and
carries verbatim into the Kotlin port.

- **Compression sensing:** `CompressionAnalyzer`/`CompressionDetecting` → Kotlin over Android
  `SensorManager` (accelerometer / linear-acceleration). Port the 1-D-axis + low-pass + peak-count +
  refractory-backstop DSP. Output: count + estimated rate (CPM) + pause detection only.
- **Rate coach:** `RateCoach` → Kotlin. AHA band **100-120 CPM** (`lower=100, upper=120`); zones
  too-slow / on-target / too-fast drive haptics + copy. Rate-matching only, never "good CPR".
- **Code timer/log:** `CodeBlueModel`/`CodeBlueState`/`CodeEvent`/`CodeSummary` → Kotlin. 2-minute
  rhythm-check cycles, adrenaline/amiodarone **reminders** (prompts, not orders), shock + rhythm +
  ROSC tally, event log. End-of-arrest `CodeSummary` → `POST /api/watch/timeline` (exists).
- **Keep-alive:** watchOS uses a HealthKit workout session so sensing survives mid-code. Wear OS =
  a **foreground service + Ongoing Activity** (optionally Health Services `ExerciseClient`) so the OS
  never kills compression sensing during a code.
- **Start alert:** `POST /api/watch/codeblue {event:"start"}` → pushes "CODE BLUE" to the clinician's
  **own phone** Command Center (see backend gap below).
- **Haptics:** rate-zone haptic feedback via `Vibrator`/Wear haptics (mirrors `SMDHaptic`).

**R1 clinical review is BLOCKING** for this feature (accelerometer calibration on real Wear hardware —
a real sensor reads off, so leave the rate-calibration constant tunable, not hard-coded — plus the
rate-only guarantee and the drug/rhythm-prompt copy).

## Tech stack

- Kotlin + **Compose for Wear OS** (Horologist for scaffolding/rotary input).
- **Ktor or OkHttp** client (mirrors `APIClient`: Bearer attach, 401 handling).
- **Firebase Android SDK** (Auth + Firestore) — Wear OS supported.
- **Wearable Data Layer** (`play-services-wearable`) for the token/ghisToken bridge.
- **FCM** for lab-alert push.
- No KMP for the MVP (single target); revisit if an Android-phone core emerges.
  → skipped: KMP shared module; add when a second Kotlin consumer exists.

## Out of scope (phase 2)

Sepsis/Procedure timers, Tiles + Complications + Smart-Stack-equivalent, full JS calculator catalog,
favorites/recents Data-Layer sync, Siri/AppIntents. (Code Blue is now **in** the MVP.)

## Risks / open decisions

- **D1 (blocking):** Firebase-Auth-on-watch + Firestore-direct vs. iOS-style relay. Recommended: direct.
- **R1:** Data Layer token bridge reliability (phone force-quit, watch reconnect) — the make-or-break.
- **R2:** GHIS token lifetime on the watch (short-lived; needs refresh-via-bridge or re-login path).
- **R3:** Firestore security rules already gate ICU by unit membership — confirm they pass for a
  watch-authenticated session identically to the phone (they should; same uid).
- **R4 (blocking, Code Blue):** compression-rate accuracy on real Wear hardware — accelerometer axis +
  calibration differ per device, so the rate constant must stay a tunable, and R1 must sign off on the
  rate-only guarantee + prompt copy before ship. Foreground-service keep-alive must survive a full code
  (screen-off, low battery) without the OS killing sensing.

## Testing

- Unit: model (de)serialization, calc parity vs `NativeCalcs`/`calculators.js` fixtures, Bearer attach.
- Instrumented: Data Layer token bridge (phone↔watch), Firestore rules pass for watch uid.
- Manual on a real Wear OS device (emulator can't exercise the Data Layer pairing well).
- Reuse `functions/api/watch` + `StewardMDWatchCore` as the behavior oracle.

## Effort (MVP)

~**6-7.5 weeks**, one experienced Wear OS/Kotlin dev. Foundation (auth bridge + Firebase/Firestore +
networking) ~2 weeks; the 7 non-emergency screens ~2 weeks; FCM push + polish ~0.5-1 week; **Code Blue
CPR assist ~1.5-2 weeks** (accelerometer DSP port + foreground-service keep-alive + timer/log +
haptics). Excludes the R1 clinical re-validation of Code Blue (blocking gate, runs in parallel).
