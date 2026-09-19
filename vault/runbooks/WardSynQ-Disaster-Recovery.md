# WardSynQ disaster recovery

What to do when the record store is lost, corrupted or unreachable, and what a ward does in the
meantime. Written to be followed at 04:00 by somebody who did not write it.

**Scope.** The WardSynQ clinical record (`wardsynq_record`, `wardsynq_idempotency` in the
`stewardmd-connect` D1). Not the OPD queue, not Firestore, not the native app bundle.

---

## 0. The first decision: is this an outage or a data loss?

| Symptom | It is | Go to |
|---|---|---|
| API returns 5xx, or nothing; data believed intact | **Outage** | §1 downtime |
| Reads succeed but a chart is missing versions | **Data loss** | §2 restore |
| `record_read_failed` on every write, brand-new deploy | **Schema not applied** | §4 |

Do not restore during an outage you have not diagnosed. A restore over a healthy database is the
one action in this document that can destroy data, and an outage does not need it.

---

## 1. Downtime: keeping the ward running

**Take the pack before you need it.** Ward screen → *Downtime pack* → Print. It is a point-in-time
copy: who is in which bed, allergies, active medicines with their due times, outstanding critical
results, last vitals, and space to write in.

- It is generated from the live record, so it can only be taken while the system is **up**. A ward
  that prints one at the start of every shift has one when it matters.
- Every page is stamped with the generation time and says, in words, that anything recorded after
  that instant is not on it.
- A page whose allergies or medicines could not be read says so **on the page**. An empty allergy
  line is never printed for a failed read - that would read as "no known allergies".
- It writes nothing. There is no "downtime mode" to enter or leave.

**During the outage:** record everything on paper - drug, dose, route, time, signature.

**Coming back up:** enter the paper record. Doses given during downtime are recorded through the
ordinary eMAR path with their real administration times; the record is append-only, so a
retrospective entry is a normal write with a `recordedAt` that differs from its `effectiveAt`.

---

## 2. Restore

### 2a. What the backup is

Every row of `wardsynq_record` as JSON Lines, one row per line, each carrying a digest over its
identity and body. The store is **append-only**, so a backup is only ever missing the tail - there
is no such thing as a row that changed after it was backed up.

Export from the live database:

```
wrangler d1 execute stewardmd-connect --remote --json \
  --command "SELECT * FROM wardsynq_record ORDER BY seq" > wardsynq-record.json
```

`wardsynq_idempotency` is **not** worth backing up. It exists so a retried write within a request
window does not create a second version; after a restore every client has long since given up, and
an empty table is correct.

### 2b. Verify before you write anything

`functions/_wardsynq/backup.js` → `verifyPlan(text)`. It refuses a restore it cannot show to be
complete, and it names what is wrong:

| `reason` | What it means | What to do |
|---|---|---|
| `version_gap` | A resource has versions 1, 2, 4 - version 3 existed and is gone | **Stop.** See §2d |
| `unparseable` | A line is not JSON, usually a file cut off mid-write | Re-export |
| `digest_mismatch` | A row's content is not what was written | Re-export; if it repeats, escalate |
| `incomplete_row` | A required column is missing | Re-export |
| `duplicate_version` | The same version twice | Two dumps concatenated - use one |

A version gap is the important one, and it is the one a row count cannot see: a dump can be the
right length, parse perfectly, and still be missing a version of one resource. The restored chart
would answer every query and would deny a clinical fact somebody recorded.

### 2c. Restore

```
wrangler d1 execute stewardmd-connect --remote --file functions/db/wardsynq_schema.sql
```

then insert the verified rows. **Do not carry `seq` across** - it is assigned by the destination and
its values will differ; only the write ORDER is meaningful, and `ORDER BY seq` on export preserves it.

### 2d. If there is a gap

Versions are never renumbered to close a gap. A renumbered chain passes every check and describes a
history that did not happen. Restoring a short chain is a decision for a human who knows what was
lost, and it must be recorded as an incident with the affected resource ids from the `version_gap`
problems.

---

## 3. The rehearsal

`test/wardsynq-restore.test.mjs` is not a description of this procedure, it **performs** one, in CI:
the shipped schema is applied to a real SQLite database, versioned records are written through the
real `D1Repository`, the store is exported, **the database is destroyed**, a fresh one is built from
the shipped schema, the dump is restored, and every version is read back through the same repository
and compared.

It also proves the three unsafe restores are caught: a version gap, a truncated file, a changed body.

Last verified: 2026-09-07, green.

**What the rehearsal does NOT prove** - stated because a rehearsal that overclaims is worse than
none:

- It has never been run against the **production** D1. It exercises the same SQL and the same
  repository, not the same database or the same `wrangler` invocation.
- There is no scheduled backup. Nothing takes the export automatically; §2a is a command somebody
  has to run. **This is the largest open item in this document.**
- RPO and RTO are therefore **undefined**. With no schedule there is no bound on how much would be
  lost.

---

## 4. Schema not applied

The failure mode that already cost a night on 2026-09-07: the schema had never been applied to the
production D1, so every write failed on its first read with `record_read_failed` surfacing to the
device as a 502, and the code was correct throughout.

```
wrangler d1 execute stewardmd-connect --remote --file functions/db/wardsynq_schema.sql
```

Additive and idempotent (`CREATE TABLE IF NOT EXISTS`). Remember `--remote`; without it wrangler 4
silently uses the local miniflare database.

---

## 5. What is deliberately not here

On-premise deployment and a hot standby are excluded by the owner's instruction, not by oversight.
Cloudflare D1 is the single point of failure and this document does not pretend otherwise: a
region-level D1 outage is an **outage** (§1), not something a restore fixes.
