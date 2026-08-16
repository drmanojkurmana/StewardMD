# FollowCare AI Voice Fallback — Phase 1 Design

**Status:** approved (owner, 2026-08-16). Branch `feat/followcare-voice`.
**Scope of this doc:** Phase 1 only — the entire Cloudflare-side FollowCare
integration, flag-gated and unit-tested in this repo, with real dialing MOCKED.
Phase 2 (RunPod voice service: Plivo + IndicConformer STT + Indic Parler-TTS +
call state machine + gemini-flash slot-filling) and Phase 3 (provisioning +
controlled real calls) get their own specs.

## 1. Problem

A discharged patient who ignores the digital FollowCare check-in (link +
reminder) currently just escalates silently. V1 adds: **if they still don't
respond, place at most one short AI wellbeing call per day, only inside a
configured window, reusing the existing FollowCare clinical engine, and escalate
worsening patients / route an explicitly requested ambulance to the hospital.**

## 2. Non-goals

No rebuild of FollowCare. No second medical-reasoning system. No generic AI
receptionist. No appointment bot. No autonomous diagnosis/prescription. No
ambulance auto-dispatch. Everything is additive and disable-able via
`FollowCare → Settings → AI Voice Follow-up → OFF` (and the client flag
`smd_followcare_voice`, default OFF).

## 3. Key reuse decisions (from codebase inspection)

The FollowCare "AI" is a **deterministic JS engine that already runs
server-side** inside Cloudflare Functions. Phase 1 reuses it wholesale:

| Need | Reused existing thing |
|---|---|
| "Patient hasn't responded" signal | schedule + `lastDayDone` (same idea as `plan()` in `_followcare_dispatch.js`) |
| Per-day question script for the call | `Assessment.buildAssessment(pathwayId, day)` (Phase 2 reads it) |
| Classify answers → escalation | `Assessment.scoreAssessment` → `Engine.assess` (authoritative) |
| Who to notify | `Schedule.escalationToNotify(level)` |
| Keep a prior red visible | `worstEsc` / `peakEscalation` |
| Adaptive next check-in | `AI.nextInterval` |
| Dial number | `decPHI(env, ep._phi.phoneEnc)` (guardian if `isMinor`) |
| Doctor alert | `notifyClinician` (de-identified native push) |
| Send to a number (ambulance) | `sendSms` / `sendWhatsApp` (same channel pick as `sendPatientMessage`) |
| Firestore | `_fbfirestore` (`fsGet/fsQuery/fsCommit/wCreate/wUpdate`, nested maps supported) |
| Auth (cron) | `ownerOK` (`X-Admin-Token`) |
| Multi-tenant | `hospitalId` on every record; `resolveDoctorHospital(uid)` |

**A completed voice call is a real check-in:** `submitVoiceResult` writes
`fc_assessments/{episodeId}_{day}` exactly like the portal submit, so it advances
`lastDayDone`, runs the same engine, and fires the same escalation/notify path.
The digital response always wins the race (create-if-absent precondition).

## 4. Architecture (Phase 1)

```
Cloudflare Worker cron ── POST /admin/run-voice ──► runVoiceScheduler
                                                        │ scan active/escalated episodes
                                                        │ per-hospital settings (fc_hospitals)
                                                        │ voiceEligible + withinWindow + guardOncePerDay
                                                        │ count>0 → GPU-start decision (Phase 2 dials)
                                                        ▼ write fc_voice_calls (status=scheduled), set lastVoiceDate
Doctor UI ── POST /voice/call ──► queueVoiceCall (manual; same guards, 1/day hard cap)
Patient link ── POST /voice/optout ──► voiceOptOut=true

[Phase 2 RunPod service] ── POST /voice/result (X-Voice-Token) ──► submitVoiceResult
        answers → Assessment.scoreAssessment → advance episode + fc_assessments
        + fc_voice_calls outcome/redFlag/patientStatement/summary
        + escalation → notifyClinician
        + ambulanceRequested → notifyAmbulance (hospital contact) + doctor alert
```

The live call turn-loop is **not** in Cloudflare (Pages Functions are
short-lived). Working assumption for Phase 2: a Python orchestrator co-located
with STT/TTS on the RunPod GPU box, calling `/voice/*` over HTTP. Cloudflare stays
the source of truth. (Owner left the "call loop location" question open; confirm
at Phase 2 spec time.)

## 5. Data model (minimal additions)

**`fc_episodes/{id}`** — add 3 fields:
- `voiceOptOut` (bool) — patient opted out of calls.
- `lastVoiceDate` (string `YYYY-MM-DD` in hospital tz) — the 1-call/day guard key.
- `lastVoiceMs` (int) — last call attempt time.

**`fc_voice_calls/{callId}`** (new) — per-call record (spec §25):
```
id, episodeId, hospitalId, dayOffset, lang,
scheduledMs, startedMs, endedMs, durationMs,
status,            // scheduled|ringing|in_progress|completed|no_answer|cancelled|technical_failure|skipped
attemptNumber, trigger,  // "auto" | "manual"
outcome,           // improving|same|worsening|unknown
redFlag (bool), doctorReview (bool), ambulanceRequested (bool),
patientStatement,  // exact worst patient statement (clinical, not identifier)
summary, createdMs
```

**`fc_hospitals/{hospitalId}`** (new) — per-hospital settings (nested maps):
```
voice: { enabled(bool), morningStart, morningEnd, eveningStart, eveningEnd,
         tz, maxConcurrent, fallbackHours },   // maxCallsPerDay HARD-CODED to 1
ambulance: { enabled(bool), contactName, phone, method },   // method: sms|whatsapp
updatedMs
```
Defaults: windows 09–10 / 17–18, tz `Asia/Kolkata`, maxConcurrent 5,
fallbackHours 24, ambulance disabled.

Raw audio is never stored (spec §24) — Phase 2 deletes STT input after
transcription; only structured result + patient statement + summary persist.

## 6. Pure module `followcare-voice.js` (client+server, dependency-free)

Mirrors `followcare-schedule.js` (IIFE + `module.exports`). All decisions live
here so both the browser badge and the server scheduler agree, and everything is
unit-tested with no I/O:

- `defaultSettings()` / `normalizeSettings(raw)` — merge defaults, **clamp
  maxCallsPerDay to 1**, coerce/validate window hours + tz.
- `tzDateKey(ms, tz)` — `YYYY-MM-DD` in tz (via `Intl.DateTimeFormat`).
- `withinWindow(ms, settings)` — is `ms` inside a call window (tz-aware).
- `nextCallWindow(ms, settings)` — `{ startMs, within }`: now if inside a window,
  else the next window start. tz→UTC via `Intl` offset (exact for no-DST zones
  like IST; ±1h ceiling at a DST transition — acceptable, `ponytail:` noted).
- `guardOncePerDay(ep, ms, tz)` — `{ ok, reason }`; ok only if
  `tzDateKey(ms) !== ep.lastVoiceDate`.
- `voiceEligible(ep, ms, settings, opts)` — `{ eligible, reason }`. Eligible when:
  voice enabled, not opted out, status not recovered/closed, there is a due
  unanswered check-in (`dueAtMs<=now && dayOffset>lastDayDone`), and the earliest
  such check-in is at least `fallbackHours` old (patient ignored link+reminder).
  `opts.manual` skips the fallbackHours wait (doctor may initiate) but keeps every
  other guard.

## 7. I/O layer `functions/_followcare_voice.js` (thin)

- `getHospitalSettings(env, hospitalId)` / `setHospitalSettings(env, hospitalId, patch, actor)`.
- `voiceStatusForEpisode(env, ep, settings, now)` → `{ eligible, reason,
  lastCallMs, lastOutcome, calledToday, status }` for the UI + `/episode`.
- `queueVoiceCall(env, ep, settings, now, {manual})` → guards (enabled, not opted
  out, not recovered/closed, a due unanswered check-in exists, `guardOncePerDay`,
  `voiceEligible`), writes `fc_voice_calls` (`scheduled`, `scheduledMs =
  nextCallWindow`), sets `lastVoiceDate`/`lastVoiceMs`. Returns
  `{ ok, callId, scheduledMs, within }` or `{ ok:false, error }`
  (`already_called_today` / `already_responded` / `voice_disabled` / `opted_out` / `not_eligible`).
- `runVoiceScheduler(env, now, opts)` → scan active+escalated, cache settings per
  hospital, enqueue eligible episodes inside the window up to `maxConcurrent`,
  compute the **GPU-start decision** (`gpuWouldStart = queued>0`). Phase 1 does
  **not** place calls (dialing mocked); returns `{ scanned, eligible, queued,
  gpuWouldStart, hospitals }`.
- `submitVoiceResult(env, episodeId, payload, meta)` → reuse the engine exactly
  like `submitPortalAssessment`: score answers, write `fc_assessments/{id}_{day}`
  (exactly-once — digital wins the race), advance the episode, write the
  `fc_voice_calls` outcome/redFlag/doctorReview/patientStatement/summary, set
  `lastVoiceDate`/`lastVoiceMs`, and on `ambulanceRequested` call
  `notifyAmbulance`. Fires `meta.notify(ep, level)` (route passes `notifyClinician`).
- `notifyAmbulance(env, ep, settings, info)` → if `ambulance.enabled` + phone,
  send the hospital contact a message (patient name, phone, hospital, discharge
  date, problem, time, case id) via the configured channel; audit
  `ambulance_requested`; push the doctor. **Never dispatches** — only notifies
  after explicit patient confirmation captured in the call.

## 8. Routes (`functions/api/followcare/[[path]].js`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/voice/call {episodeId}` | clinician (owns episode) | manual queue; 1/day enforced |
| GET | `/voice/settings` | clinician | current per-hospital voice+ambulance settings |
| POST | `/voice/settings {voice,ambulance}` | clinician | save settings |
| POST | `/voice/optout {t}` | patient token | set `voiceOptOut` |
| POST | `/admin/run-voice` | `ownerOK` (cron) | run the voice scheduler |
| POST | `/voice/result {...}` | `X-Voice-Token` or `ownerOK` | RunPod posts call result |
| GET | `/episode?id=` (augment) | clinician | add `episode.voice` block |

`voiceServiceOK(request, env)` = `ownerOK` OR `X-Voice-Token ===
FOLLOWCARE_VOICE_SERVICE_TOKEN` (constant-time). This is the RunPod service's
credential (a trust boundary — not skipped).

## 9. Flag + worker cron

- `followcare-flags.js`: `smd_followcare_voice { def:false, query:"fcvoice" }`.
- Server master gate: settings `voice.enabled` per hospital + `isConfigured(env)`;
  in prod the scheduler is inert until a hospital enables voice.
- `worker/wrangler.jsonc`: add cron lines at the UTC starts of the IST windows
  (`30 3 * * *` already exists = 09:00 IST reuse for morning; add `30 11 * * *` =
  17:00 IST for evening). `worker/src/index.js`: `POST /api/followcare/admin/run-voice`
  on those crons. Per-hospital tz gates inside the handler, so hospitals in other
  tz still only get called in their own window.

## 10. UI (`followcare.js`)

- `voiceEnabled()` helper (mirrors `actionsEnabled()`).
- API methods: `queueCall`, `voiceSettingsGet`, `voiceSettingsSet`.
- `renderDetail`: "AI Follow-up Call" status card (copy the intel-box template) +
  "AI Call Patient" button; disabled with "Already called today" when
  `episode.voice.calledToday`. Only shown when `voiceEnabled()`.
- A reachable **Voice & ambulance settings** screen (dashboard entry point), since
  the existing hospital form only renders on first-time setup.

## 11. Safety rules (hard-coded — spec §28)

1. Max 1 call/patient/day (`guardOncePerDay`, `maxCallsPerDay` clamped to 1) — doctor cannot bypass.
2. Never call if patient responded (due-unanswered check + create-if-absent race).
3. Never call outside windows (`withinWindow` / `nextCallWindow`).
4. Never prescribe / change meds / diagnose — engine only scores; voice only reads.
5. Never auto-dispatch ambulance — `notifyAmbulance` only after explicit confirmation.
6. Worsening/red → `notifyClinician`.
7. Patient opt-out (`/voice/optout`).
8. Patient's exact statement kept for the doctor (`patientStatement`).
9. Low confidence → `needsReview` (engine already sets it).

## 12. Test plan (Phase 1)

- `test/followcare-voice.test.mjs` (pure, no I/O — matches existing test style):
  `normalizeSettings` clamps maxCallsPerDay to 1; `tzDateKey`/`withinWindow`/
  `nextCallWindow` correct across IST windows and day boundaries; `guardOncePerDay`;
  `voiceEligible` truth table (opted out, disabled, nothing due, within fallback
  window, manual override, recovered).
- Existing `npm test` suite stays green.

Deeper I/O paths (`submitVoiceResult` engine reuse, ambulance notify) are covered
by the pure eligibility/settings tests + manual review here; a Firestore-mock
integration test is deferred to Phase 2 when the live path exists (the repo's
current tests likewise avoid mocking Firestore).
