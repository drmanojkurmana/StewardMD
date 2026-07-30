---
tags: [module, clinical]
status: live
flag: smd_followcare (+ _actions) default ON, fails-closed
---
# FollowCare

Flagship **Hospital Recovery Intelligence** — post-discharge follow-up. Patients **never install the app**
(link-only: WhatsApp / portal). Multi-tenant. Phases 0–5 + Doctor Action Center all live on `main`.

## Key files
- `functions/_followcare_dispatch.js` + `functions/api/followcare` — pathways, portal, comms
- 26-pathway **deterministic DiagnosisMapper** (NO LLM) + auto multilingual detection
- Doctor Action Center: 10 actions, AI-approve drafts, encrypted `fc_comms` log + audit, portal inbox, R2 photos

## Hard rules (safety)
- NEVER change prescriptions, diagnose definitively, stop medicines, or replace the treating doctor.
- DiagnosisMapper is deterministic (no LLM). Generic pathway must NEVER block enrollment.
- No PHI in URLs / SMS / logs.
- Retention **7 days** post-recovery (DPDP §8(7)) — `FOLLOWCARE_RETENTION_DAYS`.

## Owner TODO
clinician sign-off on thresholds · reviewed non-en/hi/te translations · bind `FOLLOWCARE_R2` for photos · rotate exposed creds · BSP for WhatsApp scale.

## Gotchas
- Fixed a live portal crash: Motion `spring()` in `pop()` escaped try/catch → "Connection problem" for unconfirmed non-English patients.
Deps: [[Infra]] (R2, WhatsApp) · [[Decisions]] (retention).
