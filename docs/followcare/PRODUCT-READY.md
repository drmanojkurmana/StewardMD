# FollowCare AI — PRODUCT READY (handoff)

**Status: LIVE on production, flag ON, verified.** `/api/followcare/ready → {"ready":true}`. All 164 repo
tests green. This is the state you asked to have ready.

## What works right now (end-to-end, verified live)
1. **Enroll from the ICU/Ward Discharge Creator** — open a patient's Discharge Creator → **🩺 FollowCare**
   button → enroll form opens **pre-filled**: patient name, recovery pathway (auto-mapped from the final
   diagnosis), discharge date. Doctor types the **mobile number** once (see "Phone" below), ticks consent → link.
   Also enrollable from the home **FollowCare tile**.
2. **Patient gets a WhatsApp** with their check-in link — sent from **your own WhatsApp Business number**
   (Green-API), automatically by the **daily cron** (09:00 IST), or the doctor can Copy/Share it immediately.
   English + Hindi.
3. **Patient opens the link** (no app, no login) → answers the check-in → the **deterministic engine** scores
   recovery, detects red flags, sets escalation (green/yellow/orange/red), predicts readmission risk, and shows
   a safe message (red → "seek urgent care now").
4. **Doctor monitors** on the FollowCare board: patients ranked by escalation, % readmission risk, AI
   recommendation, trend, per-day timeline + recovery-intelligence; a **de-identified push** fires on red/orange.
5. **Daily automation**: the cron sends due links + reminders, escalates missed check-ins, and (when a retention
   period is set) prunes old data.

## The phone field — NOW auto-fills from GHIS ✅
Solved. The mobile isn't on the GHIS worklist, but it **is** in the `POST /Doctor/Home/Searchnew` response
(the patient-details page). `/api/ghis/demographics?recordNo=<MR>-<IPMR episode>` posts Searchnew and extracts
the primary contact number — **verified live** returning real patients' mobiles. At discharge, if the patient
came from GHIS Ward Sync, `openFollowCareEnroll` calls `GHIS.fetchPhone(mr)` (3.5s timeout so it never blocks)
and the enrol form pre-fills the **phone** too — alongside name + pathway + date. Still fully editable, and it
falls back to manual entry if GHIS is offline or the number isn't found.

## Live configuration (already set)
- Pages `stewardmd`: `FOLLOWCARE_TOKEN_SECRET`, `FOLLOWCARE_PHI_KEY` (both active — `/ready` is true).
- WhatsApp: `FOLLOWCARE_WA_PROVIDER=custom` + Green-API URL/body + `FOLLOWCARE_MSG_CHANNEL=whatsapp` (verified sending).
- SMS (fallback, currently bypassed): `FOLLOWCARE_SMS_PROVIDER=twofactor` + `TWOFACTOR_API_KEY`.
- Firestore deny-all rules deployed; Worker cron `30 3 * * *` live.

## Before real-patient rollout (owner — non-blocking for "ready", important for scale/compliance)
1. **Clinician sign-off** on the 9 pathways' red-flag thresholds (the safety core; reviewed but needs your OK).
2. **WhatsApp: move Green-API → a BSP** (AiSensy/Interakt/Gupshup) for scale — Green-API is unofficial/pilot
   (ban risk). Same `custom` adapter, just new URL/creds.
3. **Rotate the credentials that appeared in chat**: Green-API instance token, 2Factor API key, GHIS login.
4. Optional: register a **2Factor DLT template** if you want SMS as a fallback channel.

## Not done (deliberately)
- GHIS phone auto-fill (fragile server-side scrape — dropped; manual entry instead).
- Full P2–P5 depth items already documented in `docs/followcare/PHASES-COMPLETE-REPORT.md` (LLM narrative,
  8-language clinical translation, EHR/HL7 live connectors, ML models) — scaffolded, external-dependency.

The deployed product runs on Cloudflare independent of your Mac. I left the Mac on so the work + deploys
completed; nothing further needs it.
