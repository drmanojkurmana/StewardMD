# FollowCare AI — API Design
Phase 0 deliverable #16. All under `functions/api/followcare/[[path]].js` (Pages Functions `params.path` sub-router; `/api/*` is not middleware-gated → each endpoint self-authorizes). FHIR-ready (Phase 4 exposes FHIR resources). Every request is tenant-scoped, RBAC-checked, consent-gated, metered, audit-logged. JSON in/out; no PHI in URLs.

## Auth per surface
- **Clinician/admin** (`/doctor`, `/hospital`, `/analytics`, `/reports`): `Authorization: Bearer <Firebase ID token>` → `identify()` + FollowCare role check (`isFcMember(hospitalId, uid, role)`).
- **Patient portal** (`/patient/*`): **no login** — opaque signed `token` (episode-scoped) + **OTP session** (short-lived). Rate-limited, enumeration-safe (reuse `reset-request` pattern).
- **Cron/admin jobs** (`/reminders/run`, `/rollup/run`, `/webhooks/*`): `X-Admin-Token` (`ownerOK`) or provider-signed webhook.

## Doctor / clinician API
| Method · path | Purpose |
|---|---|
| `POST /doctor/enroll` | Create episode from a patient (auto-filled). Body: `{patient, diagnosis, dischargeDate, phone, email?, caregiverPhone?, language, pathwayId, followUpDuration, treatingDoctorUid, department}` → `{episodeId}`; captures consent, schedules assessments, enqueues first message |
| `GET /doctor/episodes?status=&risk=&dept=` | Dashboard/queue list (tenant+role scoped); sortable by urgency |
| `GET /doctor/episodes/:episodeId` | Timeline, responses, adherence, recovery trend, summary card |
| `POST /doctor/episodes/:episodeId/action` | `pause|resume|extend|close|archive`; `{days?}` |
| `POST /doctor/episodes/:episodeId/ack` | Acknowledge an alert/escalation (audited) |
| `GET /doctor/summary/:episodeId` | AI 30-second doctor summary (P2; reuse `_summarize.js`) |
| `GET /doctor/digest` | Morning digest payload (P3) |
| `GET/POST /doctor/pathways` | List / edit disease pathway templates (versioned, RBAC) |

## Patient portal API (link-only, no PHI in URL)
| Method · path | Purpose |
|---|---|
| `POST /patient/session/start` | Body `{token}` → sends OTP to the episode's phone (reuse OTP engine + new SMS); returns `{otpSent:true}` (enumeration-safe) |
| `POST /patient/session/verify` | `{token, code}` → short-lived patient session; `{ok, branding, patientFirstName}` |
| `GET /patient/assessment` | Next assessment (dynamic questionnaire P1 / adaptive P2) in patient's language |
| `POST /patient/assessment` | Submit answers → engine scores + escalation; returns patient-facing message + next check-in (or urgent advice if Red) |
| `POST /patient/medication` | `{date, meds:[{name,status,reason?}]}` adherence |
| `GET /patient/appointments` · `GET /patient/timeline` | View next review / recovery timeline |
| `POST /patient/upload` (P5) | Wound photo → R2 (`api/kardiox` pattern) |
| `POST /patient/consent` · `POST /patient/optout` | Record consent / STOP |

## Hospital / admin API
| Method · path | Purpose |
|---|---|
| `GET/PUT /hospital/config` | Branding, sender ID, timezone, languages, follow-up policies |
| `GET/POST/DELETE /hospital/members` | Manage doctors/nurses/roles (RBAC) |
| `GET /hospital/dashboard` | Active/completed/pending/high-risk/completion%/avg-days |
| `GET /hospital/departments` · `GET /hospital/quality` · `GET /hospital/executive` | P3 dashboards |
| `GET /hospital/radar` | Recovery Radar™ morning brief (P3/P5) |
| `POST /hospital/onboard` | Provision tenant (extends `hospitalRequests→hospitalsApproved`) |

## Notifications / messaging API
| Method · path | Purpose |
|---|---|
| `POST /reminders/run` (cron) | Sweep due assessments/missed → **enqueue** to `FOLLOWCARE_Q` (admin-token) |
| `POST /webhooks/resend` · `/webhooks/sms` · `/webhooks/whatsapp` | Provider status → update `fc_messages` delivery log |
| `GET /messages?episodeId=` | Delivery log (sent/delivered/failed/opened) |

## Analytics / reports API
| Method · path | Purpose |
|---|---|
| `GET /analytics/disease` · `/analytics/kpi` · `/analytics/benchmark` | Recovery/readmission/adherence/engagement; own-history benchmarking |
| `GET /analytics/insights` | AI operational insights (P3, LLM over rollups) |
| `POST /reports/export` | `{scope, format: pdf\|excel\|csv, range}` → R2 signed URL |
| `POST /rollup/run` (cron) | Nightly Firestore→D1 rollup |

## Future EMR / FHIR (Phase 4)
| Method · path | Purpose |
|---|---|
| `POST /emr/discharge` | EMR/HL7/FHIR discharge event → auto-enroll |
| `GET /fhir/CarePlan/:episodeId` · `/fhir/Communication` · `/fhir/QuestionnaireResponse/:assessmentId` | FHIR resource views (read) |
| `POST /fhir/subscribe` | Webhook subscription for status write-back |
| `GET /emr/summary/:episodeId` | Structured summary for EMR write-back |

## Cross-conventions
- **Errors:** `{error, reason, message}` + HTTP status (402 needs-pro, 429 quota/rate, 403 tenant/role, 410 expired token).
- **Idempotency:** enrollment + message-send carry idempotency keys (KV send-once).
- **Versioning:** `Accept: application/vnd.followcare.v1+json`; additive changes only.
- **Rate limiting:** per-tenant + per-IP (extend `_usage.js`).
- **Metering:** AI endpoints call `checkQuota`/`recordUsage` (`followcare` type).
- **Audit:** every mutating clinician/admin call writes `auditLog`.
- **PHI:** opaque tokens only; masked recipients in logs; consent enforced before any patient contact.
- **Provider abstraction:** messaging via `MessagingProvider`, EMR via an `EMRAdapter` interface (FHIR/HL7/CSV) — both swappable (SOLID/repository/service-layer per the tech principles).
