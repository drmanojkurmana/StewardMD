# FollowCare AI — User Personas
Phase 0 deliverable #2. For each: goals · pain points · daily workflow · FollowCare usage · permissions (RBAC role in brackets).

---

## 1. Physician / Consultant — "Dr. Manoj" `[doctor]`
- **Goals:** discharge safely; know which patients are deteriorating without calling everyone; reduce readmissions; save time.
- **Pain points:** no visibility post-discharge; can't call 100+ patients; readmissions blamed on the team; drowning in data.
- **Daily workflow:** rounds → discharges → OPD → reviews. FollowCare must fit in seconds between tasks.
- **FollowCare usage:** enroll at discharge (auto-filled); open the **Doctor Command Center** once/morning; act on the **AI Smart Queue** (sickest first); read **30-second summary cards**; pause/extend/close episodes; receive one morning digest.
- **Permissions:** full access to *their own* patients' episodes; enroll; manage follow-up; view assessments/summaries/trends; acknowledge alerts; cannot see other doctors' patients unless department-shared.

## 2. Resident / Registrar — "Dr. Anjali" `[resident]`
- **Goals:** cover the consultant's list; triage overnight deterioration; learn.
- **Pain points:** juggling many patients; unclear who to escalate; after-hours ambiguity.
- **Workflow:** ward + on-call. Needs the smart queue + red-flag alerts to triage.
- **FollowCare usage:** monitor department/unit queue; first responder to Orange/Red escalations; escalate to consultant; document actions.
- **Permissions:** department-scoped patient access; enroll on behalf of consultant; acknowledge alerts; cannot change follow-up policy or hospital settings.

## 3. Nursing Staff — "Sister Lakshmi" `[nurse]`
- **Goals:** close the loop on medication problems and missed check-ins; make the calls the system flags.
- **Pain points:** unstructured call lists; no record of who was contacted.
- **Workflow:** the **Nurse Dashboard** work queue — today's calls, medication issues, pending reviews, photo reviews.
- **FollowCare usage:** work the queue; log call outcomes; flag medication-unavailable to doctor; trigger reminders.
- **Permissions:** task-scoped patient view (assigned/queued); log outcomes; cannot close episodes or alter clinical plan; cannot change settings.

## 4. Care Coordinator — "Ravi" `[coordinator]`
- **Goals:** book appointments/labs, chase reminders, keep patients on pathway.
- **Pain points:** manual coordination; missed follow-ups slip through.
- **Workflow:** **Care Coordinator Dashboard** — who needs a call, appointment booking, lab reminder, medication clarification.
- **FollowCare usage:** coordinate next actions; book/reschedule (Phase 4 integrations); nudge non-responders.
- **Permissions:** logistics-scoped (contact info, appointments, adherence); no clinical decisioning; no settings.

## 5. Quality Team — "Dr. Sneha (QI)" `[quality]`
- **Goals:** monitor readmissions, completion, recovery times; drive improvement projects.
- **Pain points:** data scattered; no recovery-level metrics; manual report assembly.
- **Workflow:** **Quality Dashboard** + exportable reports for QI meetings.
- **FollowCare usage:** 7/30-day readmission, completion, adherence, recovery-duration trends; AI operational insights; benchmarking vs own history; export PDF/Excel/CSV.
- **Permissions:** hospital-wide **aggregate/de-identified** analytics; read-only; no individual clinical actions; no PHI export beyond governance.

## 6. Hospital Administrator — "Mr. Prasad" `[admin]`
- **Goals:** configure the hospital; manage doctors/departments/roles; branding; deploy at minimal effort.
- **Pain points:** IT silos; setup friction; another vendor to manage.
- **Workflow:** **Admin Settings / Onboarding Portal** — logo, theme, email domain, SMS sender ID, WhatsApp, departments, doctors, roles, languages, follow-up policies.
- **FollowCare usage:** onboard the hospital; white-label; manage users/roles; set reminder timings & policies; view compliance/audit.
- **Permissions:** hospital-scoped admin (config, users, branding, policies, audit); **no clinical data access** by default (separation of duties); can grant roles.

## 7. Medical Superintendent / Leadership — "Dr. Rao (MS)" `[superintendent]` / CEO-COO `[executive]`
- **Goals:** hospital-wide recovery oversight; quality; strategic KPIs.
- **Pain points:** no single recovery view; can't interpret dozens of graphs.
- **Workflow:** **Hospital / Executive Dashboard** + **Recovery Radar™** morning brief.
- **FollowCare usage:** one-page AI recovery brief; hospital recovery index; readmission reduction; department drill-down.
- **Permissions:** hospital-wide aggregate + (MS) escalation oversight; executive = high-level KPIs only (no raw PHI).

## 8. Hospital IT — "Mr. Khan" `[hospital_it]` (Phase 4)
- **Goals:** integrate with EMR; SSO; security/audit; monitoring.
- **FollowCare usage:** EMR/FHIR/HL7 config; API keys; monitoring; DR.
- **Permissions:** integration/config + monitoring; no clinical data; audited.

## 9. Patient — "Mr. Kumar" `[patient — external, link-only, no app]`
- **Goals:** recover; know what to do; get help early; not be confused.
- **Pain points:** discharge instructions forgotten; unsure if symptoms are normal; language barriers; won't install an app.
- **Workflow:** receives branded SMS/email → taps link → OTP → 2-minute check-in → done.
- **FollowCare usage:** OTP verify; conversational assessment (emoji/voice, own language); medication confirm; appointment view; recovery timeline; upload wound photo (Phase 5).
- **Permissions:** access **only their own** episode via signed token + OTP; no login/account; session-scoped; consented.

## 10. Caregiver — "Mrs. Kumar" `[caregiver — external, link-only]` (Phase 5 portal; Phase 1 caregiver number for reminders)
- **Goals:** help the patient adhere; know red flags; get emergency advice.
- **FollowCare usage:** receives reminders/red-flag/emergency advice; caregiver dashboard (Phase 5) with patient consent.
- **Permissions:** consent-gated subset of the patient's episode; reminders + red flags only unless broader consent.

---
### RBAC role set (feeds Security & API design)
`doctor · resident · nurse · coordinator · quality · admin · superintendent · executive · hospital_it · patient(ext) · caregiver(ext)` — each hospital-scoped (tenant). Least-privilege; separation of duties (admin ≠ clinical PHI). Detailed permission matrix in `15-security-architecture.md`.
