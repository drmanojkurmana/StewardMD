# Patient Identity 2.0: Migration Blueprint

Wave 1, Master Engineering Plan Sections 51-53. Universal StewardID / Ni-Key / QR / Barcode Patient Identity 2.0.

Companion documents: [identity audit](PATIENT-IDENTITY-AUDIT.md), [architecture blueprint](PATIENT-IDENTITY-ARCHITECTURE.md), [patient journeys](PATIENT-JOURNEYS.md).

Guiding constraint: the hospital never stops. Every step below is deployable independently, reversible, and safe to run while OPD queues, wards, pharmacy, and billing are live.

## Step 1. Identity adapter layer

Map legacy GHIS `MRN` and `episodeId` to canonical `stewardId` and `encounterId` in exactly one module per runtime, before any consumer is migrated.

### 1.1 What gets built

A server adapter (`functions/_identity_adapter.js`, name provisional) and a client adapter (one ES5 IIFE, e.g. `identity-adapter.js`) exposing the same translation surface:

```js
// Legacy -> canonical (read path)
adaptTicketToIdentity(ticket)     // { ghisPatientId, ghisEpisodeId, visitId, mrn, ... }
                                  // -> { stewardId|null, encounterId|null,
                                  //      identifiers[], identityStatus }
// Canonical -> legacy (write path to foreign systems)
adaptIdentityToGhis(stewardId, encounterId, orgId)
                                  // -> { patientId, episodeId, visitId }
                                  //    (the shapes GHIS endpoints expect today)
adaptIdentityToConnect(...)       // same for Connect pull-context / worklist shapes
```

Translation tables (new Firestore collections, written only by the adapter):

- `patient_index/{system}__{issuer}__{normalizedValue}` to `{ stewardId, identifierStatus }`. Seeded lazily (Step 3); every successful legacy-keyed lookup that resolves to a stewardId writes its row.
- `encounter_alias/{system}__{episodeId}` to `{ encounterId }`. Same lazy seeding.

### 1.2 Mapping rules (normative)

| Legacy field(s) | Canonical target | Rule |
|---|---|---|
| `mrn` (hospital-issued) | `identifiers[] { system: <workplace: ghis\|connect\|external>, value }` | Value stored verbatim; normalized copy in the index. |
| `mrn` (`SMD-<CLINIC>-NNNNN`) | `identifiers[] { system: "stewardmd", issuer: orgId }` | Recognized by `isClinicMrn` before stewardId classification. |
| `mrn` (`TMP-NNNNNN`) | `identifiers[] { system: "provisional", status: active }` + person `identityStatus: provisional` | Recognized by `isProvisionalMrn`. Resolvable, flagged. |
| `ghisPatientId` | Same as `mrn` hospital-issued, `system: "ghis"` | When both `mrn` and `ghisPatientId` are present and differ, both are indexed; the GHIS value is marked `emrKey: true` (the value GHIS lookups need). |
| `ghisEpisodeId` / `visitId` | `encounter.episodeAliases[]` | Both preserved verbatim; the mirror fallback (`queue.js:766-767`) is replaced by alias lookup. |
| `patientId` OPD slug (`orgId__mrn`) | Lookup key only, never stored on new rows | Adapter strips the org prefix, resolves the MRN half through the identifier index. |
| `patientId` WardSynQ subject | `encounterId` correlation via ward stay record | Ward stays gain an explicit `encounterId` back-pointer; the subject id remains the ward row key. |
| NFC/QR/barcode legacy payloads (`?uid=`/`?mrn=`/`?scan=`/`?patientid=` + raw MRN) | Carrier rows backfilled as `type` + `migrated: true`, token = original payload hash | Old tags keep scanning. Reissue on next presentation is encouraged but not forced. |
| `displayId` | Dropped at the boundary | Adapter computes display from identifiers per station; stored `displayId` values are ignored once the consumer migrates. |

### 1.3 What "done" means for Step 1

- The adapter modules exist, are unit-tested (mapping table above, every row, both directions), and are the only importers of the new index collections.
- Zero consumers migrated yet. This step adds code and collections; it changes no behavior. Safe to deploy and leave.

## Step 2. Backward compatibility guarantees

No breaking changes for existing OPD sessions or GHIS endpoints, during migration or after.

### 2.1 API compatibility

- Every existing endpoint keeps its request and response shapes. Fields that 2.0 deprecates (`displayId`, bare `patientId` slugs, `ghisEpisodeId` as canonical) remain populated by the adapter until retirement (Step 4). New fields (`stewardId`, `encounterId`, `identityStatus`, `identifiers[]`) are additive.
- `functions/_queue_engine.js` `addTicket` keeps accepting `{ mrn, patientId, ghisPatientId, ghisEpisodeId, visitId }`. Internally it resolves through the adapter and stores both the legacy fields (for old readers) and the canonical links (for new readers). Dual-write, single-read-migration: readers move one at a time; writers write both until Step 4.
- GHIS endpoints receive byte-identical payloads to today. `adaptIdentityToGhis` is covered by golden tests generated from pre-migration traffic shapes (record/replay of existing test fixtures, not production data).

### 2.2 Session compatibility

- Live OPD sessions (`q_sessions`, `q_tickets`) are never rewritten by migration. Tickets created before a consumer migrates keep resolving through the legacy fields the adapter also writes. A patient mid-queue during a deploy sees no change: their ticket's legacy fields are intact, and the canonical links are added on next touch (lazy, Step 3).
- The workplace invariant (`ghisToken === null` for clinic/Connect sessions; EMR routing by workplace, `queue.js` `openTicketEmr`) is preserved verbatim until the resolver-based router passes the verification criteria, then the router switches in one flagged deploy with instant rollback (flag off restores legacy routing).

### 2.3 Carrier compatibility

- Every NFC tag, label, and wristband in the field keeps working: legacy payloads resolve through backfilled carrier rows (Step 1.2, last row) and the four legacy deep-link params stay accepted permanently (`uid`, `patientid`, `scan`, `mrn`). "Permanently" means: removing a legacy param is a breaking change requiring the Step 4 retirement process, not a cleanup.
- New issuance (post-migration) uses opaque tokens + `sid` param. Old and new carriers coexist indefinitely; the registry does not distinguish them except by `migrated: true` for reporting.

### 2.4 Client compatibility (native apps and cached web)

- Old native bundles (pre-2.0 `www/`) and stale service-worker caches keep working against migrated servers: they use legacy fields, which remain populated. No forced update is tied to migration.
- Feature flags gate every consumer migration (`identity2.<consumer>`, default off, flippable per org). A flag flips only after that consumer's verification criteria pass (Step 4.1).

## Step 3. Lazy migration vs batch backfill

### 3.1 Default: lazy migration on next presentation

Existing patients receive stewardIds when they next present, not before:

1. Patient presents with any legacy credential (MRN typed, old tag scanned, GHIS worklist import).
2. Adapter resolves the legacy key. Index miss + legacy record found: mint stewardId, attach all known legacy values as identifiers, write index rows, emit `patient.registered` with `migration: "lazy"`.
3. Reissue carriers opportunistically: front desk offers a new label + NFC write during the same visit (one extra tap, not a separate queue). Old carriers keep working regardless.
4. Encounter linkage: today's ticket/visit attaches to the new stewardId; historical artifacts (old tickets, ward stays, invoices) are linked by scheduled backfill of pointers only (Step 3.3), never by rewriting the artifacts.

Why lazy: it bounds the blast radius to patients actually in the building, it verifies identity face-to-face (the strongest dedupe signal available), and it requires no downtime and no mass rewrite of foreign keyspaces.

### 3.2 Batch backfill: narrow, explicit, and audited

Batch jobs are allowed only for these three cases, each a separate reviewed script with dry-run output:

1. Index seeding for GHIS worklist imports: pre-resolve the day's expected GHIS patient list into index rows so morning check-in does not stampede the mint path. Seeding writes index rows only; stewardIds are still minted at presentation (or minted in batch only for rows with a verified unique key: GHIS patient id + hospital code).
2. Pointer backfill on historical artifacts: add `stewardId`/`encounterId` pointers to old tickets, stays, and invoices where the legacy key resolves unambiguously. Artifacts whose keys are ambiguous are left untouched and reported; a human resolves them or they stay legacy-keyed forever.
3. Carrier registry backfill for legacy payloads still in circulation (Step 1.2): hashed-token rows so old tags resolve without adapter string-parsing at read time.

Batch rules: idempotent (re-runnable, keyed writes), rate-limited (Firestore write budget respected; metering unaffected), dry-run first (counts + 50 sample rows reviewed), and every batch emits one summary audit record (job id, rows written, rows skipped-ambiguous, operator).

### 3.3 What is never backfilled

- Foreign keyspaces (GHIS ids, Connect refs, ABHA addresses) are never rewritten. We index them; the issuing system owns them.
- Clinical content (notes, vitals values, dispense records) is never touched by migration. Only identity pointers are added, and only where unambiguous.
- Staff identity (`doctorDirectory`) is out of scope entirely.

## Step 4. Verification criteria before retiring legacy fallback paths

Legacy paths retire one at a time, in this order: (1) client collection-length clinic-MRN mint, (2) `patientId || mrn || t.id` ticket fallback, (3) episode/visit mirror fallback, (4) stored `displayId` reads, (5) legacy carrier string-parsing at read time (replaced by registry rows). Each retirement requires all of the following.

### 4.1 Per-path criteria

1. The replacement has run behind its flag for at least one full clinical week (7 days) at every pilot org, with the flag on for all stations.
2. Dual-write/read telemetry shows zero reads of the legacy path from migrated consumers for 7 consecutive days (measured server-side: adapter counters `legacy_read.{path}` at zero; client version telemetry confirms no pre-flag bundle active at pilot orgs).
3. Ambiguity and failure budgets hold: `ambiguous` resolutions under 0.5% of manual entries, `unresolved` scans explainable (unknown token = genuinely new/foreign tag, sampled and reviewed), zero `serial-mismatch` denies overturned on review as false positives.
4. Wrong-record drill passes: seeded test patients (dedicated test org, synthetic data only) run Journeys 1-8 end to end, including provisional-to-verified promotion, merge-then-resolve, revoke-then-scan, cross-org deny, and offline-then-sync. All assertions green, including the negative ones (revoked scan names nobody; denied cross-org leaks nothing).
5. Rollback rehearsed: the flag-off path is deployed to staging and verified to restore legacy behavior within one config change, with no data loss (dual-written fields intact).

### 4.2 Retirement mechanics

- Retire by deleting the fallback and its tests' legacy branches in one commit, behind the already-on flag (flag removal follows in a second commit after 7 clean days). Never "comment out and leave": dead fallback code is reactivated by the next merge conflict.
- Keep the golden tests for foreign-system payload shapes (Step 2.1) permanently. They are the contract with GHIS/Connect, not migration scaffolding.
- Keep the legacy deep-link params (`uid`, `patientid`, `scan`, `mrn`) and legacy payload carrier rows permanently (Step 2.3). Physical tags outlive software versions.
- Publish a retirement note per path (what was removed, telemetry window, drill results) in the repo handoff log so a future incident review can trace behavior changes.

### 4.3 Pilot and rollout sequence

1. Staging org + synthetic patients: all journeys, all drills.
2. One pilot hospital (GHIS workplace) + one pilot clinic (native workplace): flags on, dual-write verified, front-desk staff trained on the new screens (identity card, candidate picker, revoked-carrier script).
3. Remaining orgs in cohorts, one cohort per week, gated on the previous cohort's 7-day telemetry.
4. Legacy path retirements begin only after the last cohort's telemetry window closes.

Rollback at any stage: flags off restore legacy behavior; dual-written data means nothing migrated is lost; stewardIds already minted are simply unused until flags return. Minted-but-unused ids are harmless (they are never reused, and lazy migration re-discovers them via the index).
