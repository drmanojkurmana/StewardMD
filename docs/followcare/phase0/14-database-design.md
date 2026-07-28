# FollowCare AI — Database Design
Phase 0 deliverable #14. Store choices reuse StewardMD's existing backends; the models are new (no episode/assessment entity exists today). Every record is **tenant-scoped by `hospitalId`**.

## Store allocation (reuse existing backends)
| Data | Store | Why |
|---|---|---|
| Episodes, assessments, adherence, appointments, recovery-score series, tasks, timeline, membership | **Firestore** (project `stewardmd-498ec`) | primary PHI store; real-time listeners for dashboards; `_fbfirestore.js` CRUD + `icuGroups` rules pattern |
| Hospital/tenant config, roles, branding, disease-pathway templates (published) | **Firestore** (+ D1 mirror for analytics) | config + relational rollups |
| Messaging delivery log, analytics rollups, reporting | **D1** (`FOLLOWCARE_DB`) | queryable time-series, exports; `_updates_repo.js` template |
| OTP codes, per-episode reminder cursors, send-once idempotency, rate limits | **KV** | self-expiring (`expirationTtl`), fast; `_watch.js`/`_lifecycle.js` pattern |
| Wound photos, report PDFs, attachments | **R2** (`followcare-media`) | blobs; `api/kardiox` upload/lifecycle pattern |
| Message queue | **Cloudflare Queue** (`FOLLOWCARE_Q`) | async fan-out at scale |

**Keys:** server-issued, tenant-prefixed, opaque. `episodeId = fc_<ulid>`; `patientKey = pt_<hash(hospitalId+mrn|phone)>` (stable across devices/days — fixes today's client-minted `"p"+Date.now()`); `assessmentId`, `msgId` = ULIDs. Timestamps = integer ms-epoch (repo convention).

## Firestore ERD (tenant-scoped)
```
followcare/{hospitalId}                                  (tenant root — config)
  ├─ config: { name, branding{logoUrl,theme,footer}, senderId, timezone,
  │            languages[], followUpPolicies, updatedBy, updatedAt }
  ├─ members/{uid}: { uid, role, name, departments[], addedBy, joinedAt }     ← icuGroups pattern
  ├─ pathways/{pathwayId}: { …disease template (see 10-disease-library)… , version, active, editableBy }
  ├─ patients/{patientKey}: { hospitalId, mrn(masked), name(enc), phone(enc), email(enc),
  │                           language, caregiverPhone(enc), consentRef, createdAt }   ← PHI encrypted
  └─ episodes/{episodeId}
       ├─ { hospitalId, patientKey, diagnosis, dischargeDate, expectedRecoveryDays,
       │     pathwayId, pathwayVersion, treatingDoctorUid, department,
       │     status: active|paused|completed|archived, escalationLevel, recoveryScore,
       │     recoveryConfidence, readmissionRisk, trend, nextAssessmentAt, createdAt, updatedAt }
       ├─ assessments/{assessmentId}: { dayOffset, scheduledAt, completedAt, channel,
       │     answers{qId→value}, redFlags[], escalation, recoveryScore, confidence, reasons[],
       │     llmSummary?, by:"patient", ttl? }
       ├─ adherence/{dayId}: { date, meds:[{name,status:taken|skipped|unavailable,reason?}] }
       ├─ appointments/{apptId}: { type, when, doctor, status, source }
       ├─ scores/{ts}: { recoveryScore, confidence, trend }     (longitudinal series)
       ├─ tasks/{taskId}: { text, assignedRole, status, by, completedBy, due }   ← icuGroups tasks
       ├─ timeline/{eid}: { ts, type, title, detail, by, byRole }  (append-only, TTL)  ← audit-adjacent
       └─ messages/{msgId}: { channel, template, status, providerMsgId, sentAt, to(masked) }
consent/{hospitalId}/patients/{patientKey}: { policyVersion, acceptedAt, scope, withdrawnAt? }
auditLog/{hospitalId}/events/{eid}: { actorUid, actorRole, action, targetEpisode, ts, ip(masked) }   ← server-written, immutable
```
**Rules (deny-by-default, model on `firestore.rules icuGroups`):** every `followcare/{hospitalId}/**` read/write gated by `isFcMember(hospitalId)` + role; patient docs deletable only by admin; `assessments`/`timeline`/`auditLog` **append-only** (`update,delete:if false`); `auditLog` + `consent` server-written only (`allow read,write:if false`, service account bypasses); patient-portal writes go through server API (service account), never client SDK.

## D1 schema (analytics + delivery log)
```sql
-- messages delivery log (webhook-updated)
CREATE TABLE fc_messages ( id TEXT PRIMARY KEY, hospital_id TEXT, episode_id TEXT,
  channel TEXT, template TEXT, status TEXT,           -- queued|sent|delivered|failed|opened
  provider_msg_id TEXT, to_masked TEXT, error TEXT, ts INTEGER, updated_ts INTEGER );
CREATE INDEX ix_fc_msg_ep ON fc_messages(episode_id); CREATE INDEX ix_fc_msg_hosp_ts ON fc_messages(hospital_id, ts);

-- analytics rollup (nightly job aggregates Firestore → D1 for fast dashboards/exports)
CREATE TABLE fc_episode_rollup ( id TEXT PRIMARY KEY, hospital_id TEXT, department TEXT,
  disease TEXT, status TEXT, enrolled_ts INTEGER, completed_ts INTEGER,
  recovery_days INTEGER, adherence_pct INTEGER, readmitted_7d INTEGER, readmitted_30d INTEGER,
  completion INTEGER, escalations INTEGER );
CREATE INDEX ix_fc_roll_hosp ON fc_episode_rollup(hospital_id, disease, status);
```
Conventions (repo standard): TEXT PKs, INTEGER epoch-ms, INTEGER 0/1 booleans, denormalized scalars for fast filters, explicit indexes. D1 degrades to KV if unbound (`_updates_repo.js` pattern).

## KV keys
`fc:otp:<episodeId>` (TTL 600) · `fc:remind:<episodeId>` (cursor) · `fc:sentonce:<episodeId>:<dayOffset>` (idempotency) · `fc:rl:<hospitalId>:<id>` (rate limit, extends `_usage.js` keying with tenant segment).

## PHI / encryption / retention
- Patient name/phone/email/mrn **encrypted at rest** (AES-GCM, `_watch.js` pattern; per-tenant key). No PHI in tokens, URLs, SMS bodies, or logs (masked recipients only).
- **Retention:** episode data retained per hospital policy; assessments/timeline carry TTL where appropriate; DSAR delete via `privacyRequests` extension; soft-delete window (existing `softDeleteDays`).
- **Indexes:** Firestore single-field-equality only (`fsQuery` uses auto-indexes — no composite indexes needed for the hot paths: episodes by `hospitalId`+`status`, by `treatingDoctorUid`, `nextAssessmentAt`). Analytics/joins live in D1.

## Migrations / provisioning
- Firestore: no migration files (schema-on-write) + a versioned `firestore.rules` deploy (separate `firebase deploy --only firestore:rules`).
- D1: `functions/db/followcare_schema.sql` (repo migration style) + binding `FOLLOWCARE_DB` in `wrangler.toml` **under `[env.production]`** (KV/D1 bindings live there).
- KV namespace `FOLLOWCARE_KV` (or reuse `MAIK_KV` fallback chain). R2 `followcare-media` bound in Pages dashboard.
