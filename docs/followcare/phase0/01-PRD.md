# FollowCare AI — Product Requirements Document (PRD)
**Module:** FollowCare AI — Hospital Recovery Intelligence Platform
**Part of:** StewardMD · **Phase:** 0 (Product & System Design) · **Date:** 2026-07-28
**Status:** Draft for approval — no implementation until Phase 0 is approved.

> Source of truth: the FollowCare AI roadmap (Phase 0–5). This PRD restates and structures that vision; it does not redesign it.

---

## 1. Vision
Extend clinical care **beyond discharge**. Turn the highest-risk window in a patient's journey — the days and weeks after they leave the hospital — into a monitored, intelligent, and coordinated recovery pathway that lives inside StewardMD. FollowCare AI is not a patient app; it is a **Hospital Recovery Intelligence Platform** that clinicians and hospitals operate, and patients experience through a link.

## 2. Mission
Give every discharged patient a personalized, AI-guided recovery follow-up — delivered over SMS / email / WhatsApp and a secure browser portal (no app install) — while giving doctors a 30-second summary instead of 30 raw answers, and giving hospitals an operational and quality command center over recovery.

## 3. The problem
- **Post-discharge is a blind spot.** Once a patient leaves, the treating team loses visibility until a scheduled review — or a preventable readmission.
- **Manual follow-up doesn't scale.** Phone calls are ad-hoc, inconsistent, and unrecorded; a busy unit cannot call 128 discharged patients.
- **Readmissions are costly and often preventable** — driven by poor medication adherence, missed reviews, and unrecognized deterioration.
- **Patients won't install another app.** Engagement collapses when you ask a recovering patient to download software and create an account.
- **Hospitals lack recovery-level operational data** — completion rates, readmission trends, disease-specific recovery times, medication adherence.

## 4. Value proposition
| Stakeholder | Value |
|---|---|
| **Doctor** | Enroll in <30s; sickest-patients-first queue; 30-second AI recovery summaries; never reads raw answers; time saved. |
| **Hospital / leadership** | Recovery Operations Center; readmission reduction; quality dashboards; morning AI recovery brief; measurable KPIs. |
| **Patient** | No app; a simple branded link; a 2-minute check-in in their own language; reminders and reassurance; earlier help when needed. |
| **StewardMD (business)** | A strategic enterprise platform (not a messaging tool) that hospital groups pay for and that deepens the StewardMD ecosystem (MaiK, ThoreX, Kardiq, ICU, Antibiogram). |

## 5. Target users & stakeholders
Primary: **Physician, Resident**. Operational: **Nursing Staff, Care Coordinator, Quality Team**. Leadership: **Hospital Administrator, Medical Superintendent, CEO/COO**. External (via link only): **Patient, Caregiver**. Technical: **Hospital IT** (enterprise phases). Full persona set in `02-personas.md`.

## 6. Product principles (non-negotiable)
Clinical usefulness · Doctor productivity · Hospital workflow fit · Patient simplicity · Enterprise scalability · Security · Performance · Accessibility · Maintainability · Future AI expansion.

**Safety principle (inherited from StewardMD):** a deterministic clinical engine owns every clinical decision; the LLM only explains, summarizes, and phrases. FollowCare AI must **never** change prescriptions, diagnose definitively, stop medicines, alter antibiotics, or replace the treating doctor. It reinforces discharge instructions, detects concerning change, and escalates on predefined criteria.

## 7. Scope — what FollowCare is / is not
**Is:** a StewardMD module (doctor/hospital side) + a branded patient web portal (link-only) + a messaging + assessment + recovery-intelligence backend.
**Is not:** a patient-installed app; a diagnostic device; a telehealth video product (it can *route to* teleconsult); an EMR (it *integrates* with EMRs in Phase 4).

## 8. Functional requirements (by phase — summary; detail in each phase doc)
- **Phase 1 (Foundation / MVP):** FollowCare module in StewardMD; patient enrollment (auto-filled from patient data); disease follow-up templates (Pneumonia, Heart Failure, Diabetes, Hypertension, Stroke, COPD, Post-op, AKI, Dengue); SMS + email notification engine (WhatsApp interface-ready); secure OTP patient portal; dynamic-questionnaire assessment engine; medication & appointment reminders; recovery timeline; doctor dashboard; basic hospital dashboard; messaging logs; patient history; follow-up management (pause/resume/extend/close/archive); admin settings; security (OTP, encryption, audit, consent, RBAC, tenant isolation, session expiry); multi-tenant foundation.
- **Phase 2 (Adaptive Clinical AI):** adaptive conversation engine; disease-specific AI pathways; adaptive scheduling; Recovery Score™ + Recovery **Confidence** Score; recovery trend; AI clinical reasoning; AI doctor summary cards; red-flag detection; escalation engine; readmission risk; medication & appointment intelligence; multi-language; conversation memory; explainable AI; safety layer.
- **Phase 3 (Hospital Command Center):** doctor command center; AI smart queue; department/hospital/executive/quality dashboards; disease analytics; AI operational insights; nurse & care-coordinator dashboards; teleconsult queue; notification center (one digest); reporting engine; white-label; audit & compliance; Hospital Recovery Radar™ morning brief.
- **Phase 4 (Enterprise Integration):** hospital onboarding portal; full multi-tenant; EMR/FHIR/HL7/CSV integration; auto discharge detection; appointment/lab/pharmacy/billing integration; WhatsApp Business; full white-label; consent management; security & compliance framework; disaster recovery; enterprise monitoring; RBAC; no-code automation rules; enterprise reporting; public API layer; Digital Care Orchestrator™.
- **Phase 5 (Recovery Intelligence):** AI Recovery Twin™; predictive deterioration engine; readmission prevention AI; home-device/wearable integration; image-based follow-up (ThoreX/Kardiq/Fundus); cross-module intelligence; population health; research platform; executive AI briefing; Hospital Quality Index™; recovery pathway optimizer; home-healthcare integration; AI care coordinator; caregiver portal; continuous learning (governed); enterprise AI marketplace; international-ready (FHIR/ICD/SNOMED/LOINC).

## 9. Non-functional requirements
- **Scale:** ≥10,000 concurrent follow-up episodes (Phase 1 target); designed for millions of patients / thousands of hospitals.
- **Performance:** enroll <30s; first message <1 min; assessment <2 min; doctor summary loads instantly; dashboards near-real-time.
- **Security/compliance:** HIPAA-ready, DPDP-ready, GDPR-ready architecture; PHI encrypted at rest + in transit; RBAC; multi-tenant isolation; audit logging; consent; retention policies; rate limiting; never expose PHI in links/logs.
- **Reliability:** async/queue-based messaging; retries; delivery logging; graceful degradation (SMS↔email fallback); daily backups (Phase 4).
- **Accessibility:** WCAG-oriented; large touch targets; dark/light; multi-language patient UI; low-literacy-friendly emoji/voice options.
- **Maintainability:** modular/clean architecture; SOLID; repository + service-layer + provider abstraction (messaging, LLM, EMR all replaceable); DI; testable; reuse StewardMD infrastructure; no parallel systems; no duplication.

## 10. Success metrics
- **Phase 1 (activation):** enroll <30s · first message <1 min · assessment completion <2 min · doctor sees results instantly · dashboard auto-updates · ≥10k concurrent episodes.
- **Product (outcome):** follow-up completion % ↑ · 7/30-day readmission ↓ · average recovery days ↓ · medication adherence ↑ · patient engagement ↑ · teleconsult conversion.
- **Clinical safety:** 0 unsafe autonomous actions (never alters therapy); every escalation has transparent reasoning; low false-escalation rate with high red-flag recall.
- **Business:** hospitals adopt as enterprise platform; ecosystem attach (ThoreX/Kardiq/MaiK).

## 11. Product roadmap (phase gates)
`Phase 0 (design, this doc) → 1 (MVP) → 2 (adaptive AI) → 3 (command center) → 4 (enterprise) → 5 (intelligence platform).` Each phase is gated: a phase is not started until the previous is complete, reviewed, and approved. **Phase 1 gate:** a real doctor discharges a patient → patient gets the branded message → completes assessment on a phone with no app → doctor sees responses instantly in StewardMD → hospital monitors all active follow-ups from one dashboard.

## 12. Key risks (initial; expanded in the Phase 0 risk register)
- **Messaging deliverability** (SMS sender-ID/DLT in India; email spam) → provider abstraction + delivery logs + fallback.
- **PHI in links** → opaque tokens, OTP gate, no PHI in URL/SMS body.
- **Clinical safety / liability** → engine-owns-decision, safety layer, explainability, human-in-loop escalation.
- **Over-notification fatigue** → digest model, adaptive cadence.
- **Multi-tenant leakage** → strict tenant scoping + tests + audit.
- **Scope creep across phases** → hard phase gates; reuse-first.
- **Reuse vs build** → mandated repo reconnaissance (see `00-reuse-inventory.md`) before any new system.
