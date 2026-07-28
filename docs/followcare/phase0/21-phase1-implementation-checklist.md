# FollowCare AI — Phase 1 Implementation Checklist
Phase 0 deliverable #9 (final output). Ordered, reuse-first build plan for Phase 1 (MVP: "Discharge → Recovery → Doctor Dashboard"). **Do not start until Phase 0 is approved.** Each item marks R(euse)/E(xtend)/B(uild).

## 0. Foundations (do first)
- [ ] **B** Feature flag `smd_followcare` (default OFF) + `followcare-flags.js` (ThoreX-flags pattern); recovery tag before merge.
- [ ] **B** Bindings under `[env.production]`: `FOLLOWCARE_DB` (D1), `FOLLOWCARE_KV`, R2 `followcare-media`, Queue `FOLLOWCARE_Q`; secrets `SMS_API_KEY`, `SMS_SENDER_ID`, `FOLLOWCARE_ENC_KEY`.
- [ ] **B** `functions/db/followcare_schema.sql` (`fc_messages`, `fc_episode_rollup`); apply.
- [ ] **B** `firestore.rules` FollowCare block (tenant + role gated, append-only assessments/timeline/audit); deploy `firebase deploy --only firestore:rules`.
- [ ] **B** Tenant model: `hospitalId` on every record; provisioning via extended `hospitalRequests→hospitalsApproved`; `isFcMember` rule helpers (icuGroups pattern).

## 1. Data & API skeleton
- [ ] **R** `functions/api/followcare/[[path]].js` router (params.path); reuse `_fbfirestore`, `_fbadmin`, `identify`, `ownerOK`.
- [ ] **B** Episode/patient/assessment/adherence/appointment/score/message models (`14-database-design.md`); **server-issued `patientKey`/`episodeId`**.
- [ ] **B** Central `auditLog` writer (service account); **E** per-tenant rate limits (extend `_usage.js` keys).

## 2. Enrollment (Modules 1–2)
- [ ] **E** Home tile `data-act="followcare"` + `ACT.followcare` (`home.js`); sidebar toggle; `<script defer>` in `index.html`.
- [ ] **B** `followcare.js` (`#followcareRoot`, `.fc-*`, ThoreX template) + `followcare-screens.js` + `followcare.css`.
- [ ] **B** Enroll screen (auto-fill from patient data) → `POST /doctor/enroll`; **R** consent capture (SMD_CONSENT patient variant); PHI **encrypt-at-rest** (`_watch.js` AES-GCM).

## 3. Disease templates (Module 3)
- [ ] **B** 9 pathway templates (Pneumonia, HF, Diabetes, HTN, Stroke, COPD, Post-op, AKI, Dengue) as data (`10-disease-library`), versioned, doctor-editable, i18n-keyed. Red-flags/escalation as data (generic engine).

## 4. Assessment engine (Module 6)
- [ ] **B** Dynamic questionnaire renderer (patient portal) + `POST /patient/assessment`.
- [ ] **B** Deterministic `RecoveryEngine` v1 (score + red-flags + escalation level + confidence; `reasoning.js gate()` / `icu-autoscores {__missing}` pattern). *(Adaptive AI is Phase 2.)*

## 5. Messaging (Modules 4, 12)
- [ ] **R** Email via `_email.js`; **E** hospital/doctor branding params + "Powered by StewardMD".
- [ ] **B** `_sms.js` (India provider) + unified `MessagingProvider` interface + `channelConfigured`.
- [ ] **B** Queue producer + consumer Worker (`queue(batch)`, retries, DLQ); **E** cron line + `worker/src/index.js scheduled()` → `/api/followcare/reminders/run` (enqueues).
- [ ] **B** Delivery-log store + Resend/SMS webhooks (`/webhooks/*`); **R** send-once idempotency (KV).

## 6. Patient portal (Modules 5, 7, 8, 9)
- [ ] **B** `functions/followcare/p/[token].js` branded HTML shell (standalone-page/COMING_SOON template); add path to `_middleware.js PUBLIC_PAGES`.
- [ ] **R+B** Patient **phone OTP**: reuse OTP engine (tokenless `reset-request` template, keyed `fc:otp:<episodeId>`) + new SMS delivery; **R** `.smdea-otp` UI.
- [ ] **B** Assessment · medication check-in · appointment/timeline · thank-you/urgent-advice screens (`rds-*` + `fc-chart/fc-timeline`).

## 7. Doctor & hospital dashboards (Modules 10, 11, 13, 14)
- [ ] **R** Dashboard from ICU-board pattern (stat strip, filter chips, severity cards, bottom nav); `GET /doctor/episodes` + `/episodes/:id`.
- [ ] **B** Patient timeline (assessments/responses/adherence/trend); follow-up mgmt (pause/resume/extend/close/archive).
- [ ] **B** Basic hospital dashboard (active/completed/pending/high-risk/completion%/avg-days) + nightly `/rollup/run`.

## 8. Admin & security (Modules 15, 16)
- [ ] **B** Admin Settings (branding, templates, language, reminder timings, members/roles, policies).
- [ ] **E** RBAC roles (nurse/admin/superintendent) in `_entitlements`/`_features`; **R** consent + audit + tenant isolation + session expiry + encryption.

## 9. Quality gates (run for every module, per your mandate)
- [ ] TypeScript/JS validation · ESLint · unit tests · integration tests (offline-testable, deps-injected — `_entitlements`/`_auth-anchor` pattern).
- [ ] **Security review** (PHI never in URL/SMS/logs; tenant isolation tests; OTP throttle/lockout; consent gate).
- [ ] Accessibility review (48px, contrast, dark/light, multi-language, screen-reader).
- [ ] Performance review (enroll <30s, first msg <1min, assessment <2min, 10k concurrent episodes via queue).
- [ ] Dead-code / duplicate-code / regression review (reuse-first; no parallel systems).

## Phase 1 exit gate (from the roadmap — all must pass)
1. A real doctor discharges + enrolls a patient (<30s).
2. Patient receives the branded FollowCare message (<1 min).
3. Patient completes the assessment on a phone **without installing an app** (<2 min).
4. Doctor sees responses instantly in StewardMD.
5. Hospital monitors all active follow-ups from one dashboard.
6. System handles ≥10,000 concurrent follow-up episodes.
→ **Stop. Produce the Phase 1 report. Await approval before Phase 2.**
