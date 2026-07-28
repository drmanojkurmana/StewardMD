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

## Phase-2 enhancements (NEW — 2026-07-28)
**1. Diagnosis Mapping Engine (deterministic, NO LLM).** A centralized `DiagnosisMapper` (`followcare-diagnosis.js`)
maps any discharge diagnosis to ONE of **26 curated recovery pathways** — ICD-10 code first (when present),
then normalized free-text synonyms, then a safe **Generic Follow-up** fallback. Many names collapse to one
pathway (Alcoholic Liver Disease / HCV Cirrhosis / Decompensated CLD → CLD; CAP / Aspiration Pneumonia →
Pneumonia; NSTEMI → ACS; DKA → Diabetes; ...). An unmapped diagnosis now enrols into Generic instead of being
blocked. Both the app and the server (CSV bulk-enrol) delegate to the same mapper. Fully unit-tested; the
mapper's every target pathway is asserted to exist.

**2. Automatic language detection + multilingual patient interfaces.** `followcare-i18n.js` detects the
patient's regional language deterministically from the GHIS state/city/address (full state→language matrix:
AP/Telangana→Telugu, TN→Tamil, Karnataka→Kannada, Kerala→Malayalam, Odisha→Odia, Maharashtra→Marathi,
Gujarat→Gujarati, WB→Bengali, Punjab→Punjabi, Assam→Assamese, the Hindi belt→Hindi, unknown→English). The
enrol form auto-selects it (12-language picker, still editable). The patient portal shows a one-time
**"Would you like to continue in <language>?"** prompt (Continue / English / Choose another), stores the
choice server-side (`langConfirmed`) so it's **never asked again** unless changed via the in-portal language
switcher, and renders SMS/WhatsApp/portal/questions from a **reviewed** translation registry — English is the
guaranteed fallback (NO runtime machine translation). English + Hindi + **Telugu** are reviewed; the other
nine languages fall back to English until a reviewer fills them in (adding a language = adding one column).

## Phase-2 enhancement — Doctor Action Center (NEW)
Doctors communicate with patients from StewardMD after reviewing a FollowCare assessment, flag
`smd_followcare_actions` (default ON), additive + fails-closed. A **🩺 Doctor Actions** button on the patient
detail opens a premium bottom sheet with: **Send Instruction** (free text + AI-suggested draft the doctor must
approve + favourite/reusable templates), **Ask Question**, **Request Photo**, **Request Vitals** (8 selectable
measurements, structured + range-validated), **Request Earlier Review**, **Video Consultation (Coming Soon,
disabled)**, **Send Educational Material**, **Emergency Advice** (high-priority, confirm-before-send), **Close
Episode** (recovered/transferred/lost/expired/other), and **Communication History** (full chronological log,
delivery/read status). The **One-Click AI Response** suggests a disease-aware reply from the latest assessment;
**the doctor always reviews/edits/discards — nothing is ever sent automatically** (deterministic template now,
Vertex/Gemini seam ready). Patients read/acknowledge/reply/upload/submit-vitals in the **portal inbox** (no app,
multilingual). Architecture: one encrypted communication log (`fc_comms`, bodies AES-GCM at rest) + an immutable
`fc_events` audit row per action; notifications reuse the SMS/WhatsApp dispatcher + i18n registry; photos go to
Cloudflare R2. Modules: `followcare-comms.js` (pure model, 12 tests), `functions/_followcare_comms.js` (server),
routes `/action /comms /draft /media` (doctor) + `/inbox /respond /upload` (patient-token). Recovery tag
`pre-followcare-actions`.

**Owner step for photos:** bind an R2 bucket named for FollowCare as **`FOLLOWCARE_R2`** on the Pages project
`stewardmd` (Settings → Functions → R2 bindings). Until then Request-Photo degrades gracefully (the upload
route returns `media_not_configured`/503; every other action works). No PHI in object keys.

## Before real-patient rollout (owner — non-blocking for "ready", important for scale/compliance)
1. **Clinician sign-off** on all **26 pathways'** red-flag thresholds (the safety core; the original 9 were
   reviewed, the 17 new ones — asthma/TB/ACS/CLD/sepsis/… + Generic — carry provisional thresholds).
   Also review the reviewed **Telugu** clinical strings before wide Telugu rollout.
2. **WhatsApp: move Green-API → a BSP** (AiSensy/Interakt/Gupshup) for scale — Green-API is unofficial/pilot
   (ban risk). Same `custom` adapter, just new URL/creds.
3. **Rotate the credentials that appeared in chat**: Green-API instance token, 2Factor API key, GHIS login.
4. Optional: register a **2Factor DLT template** if you want SMS as a fallback channel.

## Not done (deliberately)
- **GHIS address → language** is best-effort: the demographics scrape now also returns a short address
  snippet for language detection, but the exact GHIS field labels aren't verified live for every hospital, so
  detection can fall back to English + the manual picker (the portal first-run prompt is the guaranteed path).
- Reviewed clinical translations for **9 of 12 languages** (Tamil/Kannada/Malayalam/Marathi/Gujarati/Bengali/
  Punjabi/Odia/Assamese) — scaffolded, fall back to English until a human reviewer fills the registry.
- Full P2–P5 depth items already documented in `docs/followcare/PHASES-COMPLETE-REPORT.md` (LLM narrative,
  EHR/HL7 live connectors, ML models) — scaffolded, external-dependency.

The deployed product runs on Cloudflare independent of your Mac. I left the Mac on so the work + deploys
completed; nothing further needs it.
