# WardSynQ incident response: when a dependency fails

One playbook per dependency. Each one has the same five parts: how you find out, what to do first,
what the ward does meanwhile, how to roll back, and who decides.

Restore and backup mechanics are in [BACKUP_DR.md](BACKUP_DR.md). This file does not repeat them; it
says when to use them.

## Where the signal comes from

- **Admin Center > System health** (STAFF_ADMIN only). Backed by `GET /api/queue/ward/system-health?orgId=<org>`.
  Every dependency is probed for real under a 3 second timeout and shows Up, Degraded or Down, when it was
  checked, and what it means on the ward. A probe that failed or timed out is Down, never Up. If the card
  itself says "could not be loaded", treat every dependency as unknown, not healthy.
- `GET /api/wardsynq/health` (no sign-in): record store only. Answers 503 when the store cannot be queried.
- `GET /api/queue/ready` (no sign-in): `documentStorage.state` is `ok`, `not_configured` or `failed`, from a
  real save, read and delete of a 2-byte test object, cached ten minutes.
- **Admin Center > Security review > Data protection**: last backup receipt and last restore test.

## Roles used below

- **Hospital administrator**: a member with `staff.admin` (the admin role). Declares downtime for the
  hospital and tells the wards.
- **Nurse in charge / consultant on the ward**: decides what is done on paper for each patient.
- **Deployment owner**: whoever holds the Cloudflare account and the `wrangler` login for the `stewardmd`
  Pages project. Decides on a deploy rollback or a database restore. A restore always loses writes after
  the restore point, so it is never done without the hospital administrator agreeing the time.

## Rollback options (shared by every playbook)

1. **Bad deploy**: Cloudflare dashboard > Workers & Pages > `stewardmd` > Deployments, pick the last good
   production deployment, "Rollback to this deployment". Pushing to `main` redeploys, so also revert the
   bad commit (`git revert <sha>` and push) or the next push brings it back. `wrangler pages deployment list
   --project-name stewardmd` shows what is deployed.
2. **Bad data in D1** (`stewardmd-connect` holds the WardSynQ record and its audit trail): D1 Time Travel,
   exactly as in [BACKUP_DR.md section 1](BACKUP_DR.md). Rehearse against staging first; a restore replaces
   the whole database with its state at that time.
3. **Bad data in Firestore** (hospital, staff, rota): PITR or managed export restore,
   [BACKUP_DR.md section 2](BACKUP_DR.md).

After any restore, record it under Security review > Data protection > Record a restore test, so the
evidence exists.

---

## 1. Patient record store (D1 `stewardmd-connect`)

- **Detection**: System health "Patient record store" Down or Degraded; `/api/wardsynq/health` returns 503;
  every chart open or save fails on the ward.
- **Immediate action**: Check `/api/wardsynq/health` detail. "the record schema is not present" means a
  database was replaced or a migration was not applied: stop and call the deployment owner. "could not be
  queried" with a recent deploy: roll back the deploy (option 1). Check Cloudflare status for D1.
- **On the ward meanwhile**: charts cannot be opened and nothing saves, including observations and
  medicines given. Use paper charts and the last printed downtime pack (Ward > Downtime pack; it is a copy
  stamped with the time it was printed, and anything after that time is not on it). Keep paper MAR and
  observations; enter them once the store is back, with the real times.
- **Rollback**: deploy rollback if a deploy caused it; D1 Time Travel only if data is damaged, never just
  because the store is unreachable.
- **Who decides**: hospital administrator declares downtime; deployment owner decides rollback or restore.

## 2. Hospital, staff and sign-in store (Firestore)

- **Detection**: System health "Hospital, staff and sign-in store" Down. If this store is fully down the
  System health card itself fails to load, because every request checks staff access there first: a card
  that "could not be loaded" while `/api/wardsynq/health` is 200 points here.
- **Immediate action**: check Firebase status and the Firestore console for the project. Do not change
  staff roles or PINs while it is failing; those writes may be partial.
- **On the ward meanwhile**: sign-in fails and ward screens refuse requests. Staff already on a screen
  will be refused on their next action. Paper charts and the last printed downtime pack, as in section 1.
- **Rollback**: deploy rollback if a deploy caused it; Firestore PITR only for damaged data.
- **Who decides**: hospital administrator declares downtime; deployment owner decides on restore.

## 3. Document storage (S3-compatible, `DOC_S3_*` settings)

- **Detection**: System health "Document storage" Down; `/api/queue/ready` `documentStorage.state` is
  `failed` (with the step that failed) or `not_configured`.
- **Immediate action**: `failed` at `put` or `get` with a 403 usually means the access key was rotated or
  revoked; with `NoSuchBucket`, the bucket name or endpoint changed. `not_configured` means a setting is
  missing from the deployment. The deployment owner fixes the setting; nothing in the app changes it.
- **On the ward meanwhile**: uploads fail and existing documents cannot be opened; charting continues.
  Keep paper originals (consent forms, outside reports) until uploads work, then upload them.
- **Rollback**: none needed for data. If a deploy changed the settings, roll back the deploy.
- **Who decides**: deployment owner.

## 4. MaiK clinical AI gateway

- **Detection**: System health "MaiK clinical AI" Down (no configured provider answered) or Degraded (one of
  several providers not answering, or MaiK turned off for the hospital).
- **Immediate action**: if it should be on, check Admin Center > MaiK clinical AI for the configured
  providers. A Google provider failing usually means the `GEMINI_API_KEY` binding was rotated or its quota
  is exhausted; a hospital model server failing means that server is off or unreachable from the internet.
  If answers look wrong rather than absent, turn MaiK off for the hospital in the same tab.
- **On the ward meanwhile**: AI summaries and drafts fail. Charting, prescribing and the safety checks do
  not depend on MaiK and continue. Write notes by hand in the chart as usual.
- **Rollback**: turning MaiK off is the rollback. No data restore is involved.
- **Who decides**: hospital administrator (turning it off or on); deployment owner (keys and bindings).

## 5. Background event queue (outbox)

- **Detection**: System health "Background event queue" Degraded (oldest waiting event 15 minutes or more,
  or events that failed for good) or Down (60 minutes or more).
- **Immediate action**: the queue is drained by the background run (section 6), so check that first; a
  stalled queue with a stalled background run is one problem. Events that failed for good (`dead`) have no
  retry screen: the deployment owner reads `lastError` on the `_wardsynq_outbox` rows.
- **On the ward meanwhile**: nothing changes. Saved clinical records are not affected; only follow-on
  events queued beside saved consultations wait.
- **Rollback**: deploy rollback if a deploy started the failures. No restore.
- **Who decides**: deployment owner.

## 6. Background run (critical-result escalation and outbox)

- **Detection**: System health "Background run" Down (no run recorded, or none for 60 minutes) or Degraded
  (last run 15 minutes ago or more, or part of the last run failed).
- **Immediate action**: the run happens on ordinary ward traffic, at most once every two minutes per
  hospital, after a ward request finishes. It does not run if the deployment sets `WSQ_TICK_OFF=1`, and its
  last run can only be recorded where the `MAIK_KV` binding exists. Opening any ward screen triggers a run;
  check the card again after two minutes. If it stays Down with traffic, check the Pages function logs for
  `wsq tick failed`.
- **On the ward meanwhile**: unacknowledged critical results are not escalated again. Phone every critical
  result to the responsible clinician directly and record the call, as you would on paper.
- **Rollback**: deploy rollback if a deploy caused it.
- **Who decides**: deployment owner; the nurse in charge decides who is phoned.

## 7. Backup and restore test

- **Detection**: System health "Backup and restore test" Down (no backup receipt, the last backup older than
  the hospital's recovery point objective, no restore test, or a failed restore test) or Degraded (no
  objective configured, or the last restore test was partial). The same verdict is on Security review >
  Data protection.
- **Immediate action**: take a backup (the export at `GET /api/queue/ward/backup`, then record its receipt
  with `POST /api/queue/ward/backup`), run the restore drill in [BACKUP_DR.md](BACKUP_DR.md) into staging,
  and record the restore test on the Security review tab.
- **On the ward meanwhile**: nothing changes today; charting continues. The risk is that recent records
  might not be recoverable if the store were lost.
- **Rollback**: not applicable; this is the evidence rollback depends on.
- **Who decides**: deployment owner runs the backup and drill; hospital administrator owns the recovery point
  objective (`wardsynq.rpoMinutes`).
