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

## 2. Firestore (patient/ICU/clinical docs)
**Enable PITR** (Firebase console → Firestore → **Point-in-time recovery: ON**) — 7-day continuous
recovery. Restore via `gcloud firestore databases restore`.
**Scheduled managed export** (durable, > 7 days): set up a daily export to a GCS bucket —
`gcloud firestore export gs://<bucket>` on a Cloud Scheduler job (this is a GCP-side cron, NOT a
Cloudflare Worker — Firestore managed export targets GCS). Retain 30–90 days.
Restore: `gcloud firestore import gs://<bucket>/<export>`.

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
