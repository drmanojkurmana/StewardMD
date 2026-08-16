# FollowCare Voice — Phase 1 implementation plan

TDD where the unit is pure; thin I/O layers reviewed against the reuse map in
`PHASE1-design.md`. Order:

1. **Pure module (test-first).**
   - Write `test/followcare-voice.test.mjs` (truth tables for eligibility,
     tz-window math, once-per-day guard, settings normalization).
   - Implement `followcare-voice.js` until green. Dual-export IIFE, no deps.

2. **I/O layer** `functions/_followcare_voice.js` — settings CRUD, status,
   `queueVoiceCall`, `runVoiceScheduler` (GPU-start decision, dialing mocked),
   `submitVoiceResult` (reuse `Assessment.scoreAssessment` + advance episode +
   `fc_voice_calls`), `notifyAmbulance`. Delegates every decision to the pure
   module + existing `_followcare.js` helpers.

3. **Routes** in `functions/api/followcare/[[path]].js` — `/voice/call`,
   `/voice/settings` GET/POST, `/voice/optout`, `/admin/run-voice`,
   `/voice/result` (+ `voiceServiceOK`), and `episode.voice` on `/episode`.

4. **Flag** — one line in `followcare-flags.js` (`smd_followcare_voice`, OFF).

5. **Worker cron** — evening cron line in `worker/wrangler.jsonc` + branch in
   `worker/src/index.js` → `POST /api/followcare/admin/run-voice`.

6. **UI** — `followcare.js`: `voiceEnabled()`, API methods, status card + call
   button in `renderDetail`, and a reachable voice/ambulance settings screen.

7. **Verify** — `npm test` green; commit; push; report + Phase 2/3 handoff.

## Files touched
- new: `followcare-voice.js`, `functions/_followcare_voice.js`,
  `test/followcare-voice.test.mjs`, `docs/followcare/voice/*`
- edit: `followcare-flags.js`, `functions/api/followcare/[[path]].js`,
  `followcare.js`, `worker/wrangler.jsonc`, `worker/src/index.js`

## Deferred to Phase 2/3
RunPod Python voice service (Plivo media + IndicConformer STT + Indic Parler-TTS
+ call state machine + gemini-flash slot-filling), `TelephonyProvider`/`STTProvider`/
`TTSProvider`/`GpuProvider` real impls + `GpuProvider.start/stop`, signed provider
webhook, provisioning (Plivo KYC, RunPod, secrets, DNS), controlled real calls.
