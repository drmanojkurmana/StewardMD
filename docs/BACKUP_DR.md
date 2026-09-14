# StewardMD — Backup & Disaster Recovery (P1)

Never open to 1000+ doctors without a **tested restore path**. This covers all three data stores.
Principle: use each platform's built-in PITR (don't hand-roll backup crons) + keep one off-platform
cold copy.

## 1. Cloudflare D1 (stewardmd-nmc, stewardmd-updates, stewardmd-connect)
**Built-in:** D1 has automatic **Time Travel** — 30-day point-in-time recovery, no setup.
- Inspect:  `wrangler d1 time-travel info <db>`
- Restore to a timestamp:  `wrangler d1 time-travel restore <db> --timestamp <ISO8601>`
  (or `--bookmark <id>`). Restores the whole DB to that point.
**Off-platform cold copy:** `scripts/backup-d1.sh` exports all three DBs to SQL. Run weekly from CI or a
trusted box (`wrangler login` first) and archive the output to storage you control (a second cloud / R2
in a different account). Restore a cold copy into a fresh DB: `wrangler d1 execute <db> --file <sql>`.

### 1a. The WardSynQ audit trail on restore (P2.17)
`connect_audit_event` refuses UPDATE and DELETE (triggers in `db/connect_schema.sql`), and every audit row the
WardSynQ record repository writes has a hash-chain link in `wardsynq_audit_chain` (`functions/db/wardsynq_schema.sql`,
`functions/_wardsynq/audit-chain.js`). Admin Center > Security review and System health verify the newest rows.
- **Triggers do not stop a restore.** Time Travel and a cold-copy import work below them. That is expected; the
  chain is what shows what a restore changed.
- **A Time Travel restore rewinds the rows and their links together**, so the chain verifies as intact afterwards.
  That does NOT prove nothing was lost: every audit row written after the restore point is gone. The chain head is
  copied to KV at most hourly (`anchorHead`, `wsq:auditanchor:<tenant>`), outside the database, so once an anchor
  newer than the restore point exists, System health and Security review report the trail as **truncated** or
  **rewritten**. After a legitimate restore that report is correct and expected, and it stays until the anchor log
  is acknowledged. To acknowledge it, once the restore is confirmed legitimate and written up:
  1. Record the restore in the incident log (`docs/INCIDENT_RESPONSE.md`) and keep its incident reference.
  2. Open Admin Center > Security review > Audit retention > Tamper evidence. The outside-copy line names
     the break; only the hospital owner sees the acknowledgement form (a StewardMD platform owner may do
     it in their place). Do not acknowledge a difference nobody can explain: ask the information
     governance lead first.
  3. Enter why the database was restored (at least 20 characters, no patient details) and the incident
     reference, review the read-back, and confirm. The old anchor log is archived unchanged under
     `wsq:auditanchor:<tenant>:archived:<time>` and never deleted, a fresh log restarts from the newest
     row, and the acknowledgement itself is written to the audit trail. System health and Security review
     then read up, naming who acknowledged the restore, when, and under which incident.
  Do not delete the KV key by hand, because it is the evidence of what was lost.
  **Before restoring**, note the number of chained rows shown in Security review > Audit retention > Tamper evidence and
  take a manual export (`scripts/backup-d1.sh`). After restoring, the difference is the audit rows the restore
  discarded; keep that export as the record of them.
- **Never merge rows from a cold copy back into a restored database.** New writes continue from the restored
  head, so link numbers after the restore point are reused by a different history. Re-inserting old rows either
  collides on the chain's primary key or shows as a break. Restore a copy side by side and compare instead.
- **Restoring a cold copy into a fresh DB:** apply `db/connect_schema.sql` then `functions/db/wardsynq_schema.sql`
  (both re-runnable), import, then confirm the four triggers exist:
  `SELECT tbl_name, name FROM sqlite_master WHERE type='trigger'` should list `connect_audit_event_no_update`,
  `connect_audit_event_no_delete`, `wardsynq_audit_chain_no_update`, `wardsynq_audit_chain_no_delete`.
  Run the same check after applying the schema with `wrangler d1 execute --file` the first time.
- Rows written before the chain existed are unchained and cannot be verified; link 1 names the newest of them.
- Nothing deletes audit rows for retention. `wardsynq.auditRetentionYears` is shown in Security review and is
  informational only.

## 2. Firestore (patient/ICU/clinical docs)
**Enable PITR** (Firebase console → Firestore → **Point-in-time recovery: ON**) — 7-day continuous
recovery. Restore via `gcloud firestore databases restore`.
**Scheduled managed export** (durable, > 7 days): set up a daily export to a GCS bucket —
`gcloud firestore export gs://<bucket>` on a Cloud Scheduler job (this is a GCP-side cron, NOT a
Cloudflare Worker — Firestore managed export targets GCS). Retain 30–90 days.
Restore: `gcloud firestore import gs://<bucket>/<export>`.
**The hospital event log is chained too (G3).** `q_events` rows (sign-ins, staff and hospital setting changes,
queue and billing acts) are linked per hospital (`functions/_q_audit_chain.js`): row `q_events/<key>__c<seq>` with
`prevHash`/`rowHash`, head in `q_audit_chain_head/<key>`. A PITR restore or an import rewinds rows and head
together, so the chain verifies afterwards while every later row is gone; the same rules as 1a apply (note the
head seq before restoring, never merge old rows back in, acknowledge the anchor break only for a planned
restore). Rows written before linking began are shown as unlinked in Security review, never as verified.

## 3. Cloudflare KV (MAIK_KV — usage counters, remote config, client-error log, audit)
KV holds operational metadata (no PHI), mostly TTL'd. It has no native export; if you want a copy, a
periodic `wrangler kv:key list` + `get` dump script is enough (low priority — nothing here is
irreplaceable). Note: `remote:config` is the one KV value worth keeping a copy of.

## 4. R2 (FollowCare media / attachments)
R2 objects are durable; enable **bucket versioning** for accidental-overwrite protection, and consider
cross-account replication for the DR copy.

## Restore drill (do this BEFORE launch, then quarterly)
1. Pick a recent timestamp. `wrangler d1 time-travel restore stewardmd-connect --timestamp <T>` into a
   **staging** DB (never rehearse against prod).
2. Firestore: restore a managed export into a **staging** database; verify a known patient's docs.
3. Confirm the app reads the restored data end-to-end.
4. Record RTO (time to restore) + RPO (data-loss window) and file them in vault/Infra.md.

## Ownership
- Weekly: `scripts/backup-d1.sh` (automate in CI). Monthly: verify Firestore export ran + a spot restore.
- Before any risky migration/deploy: take a manual D1 export + note the Time Travel bookmark.
