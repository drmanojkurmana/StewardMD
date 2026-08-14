# StewardMD Shared Clinic EMR — Phase 0 Architecture Map

> Model 2 (Shared Clinic): local-first, encrypted, multi-device EMR for clinics/small hospitals
> with **no existing EMR**. Google Drive is the **encrypted sync/backup transport, not the live DB**.
> Extends Personal OPD / My Clinic — not a second system. **Strictly generic — no ONCQIS/oncology.**
> Read-only Phase 0 audit; **no code written yet.** Recovery/flag plan below.

## 0. The finding in one line

**~60% of the "clinic platform" already exists.** The genuinely new work is concentrated in three
places: (1) an **encrypted Drive-delta sync engine**, (2) a **writable local store + per-record
versioning/change-journal**, and (3) **per-device authorization**. Everything else — auth, clinic
membership, RBAC, invites, self-serve tenant, member revoke, the EMR UI + data model + clinical
modules + AES encryption + Drive plumbing — is reusable.

## 1. The architecture: control plane (StewardMD) + data plane (clinic's Drive)

This is exactly your §36, and the existing code already splits this way:

- **Control plane — StewardMD backend (REUSE; tiny, non-PHI metadata):** who is in the clinic, their
  role, which devices are authorized, sync/audit bookkeeping. No patient data. Lives in the existing
  Cloudflare Pages Functions + Firestore/D1.
- **Data plane — the clinic's Google Drive (MUST-BUILD sync):** encrypted patient records + encounter
  deltas. PHI is encrypted before upload; StewardMD never stores it. Each device keeps its own local
  encrypted store; Drive carries encrypted deltas between devices.

## 2. §46 audit — existing modules, reuse vs must-build

| # | Subsystem | Where (file) | Verdict |
|---|---|---|---|
| 1 | Overall architecture | buildless PWA (ES5 IIFEs, `www/` via build-www) + Cloudflare Functions + Firestore/D1 | reuse |
| 2 | Personal OPD / My Clinic | `personal-clinic.js` (`SMD_CLINIC`, localStorage) + `opd-emr.js` `source:"local"` | **extend** |
| 3 | Google Drive | `native-auth.js` `SMD_getDriveToken` (scope `drive.file`) + `personal-clinic.js` list/upload/download REST | reuse plumbing; **rethink multi-user access** |
| 4 | Encryption | `personal-clinic.js` AES-256-GCM + PBKDF2-SHA256 (200k), WebCrypto, Keychain password | reuse; **extend to per-record + per-device keys** |
| 5 | Local storage/DB | 100% `localStorage` (patient index + per-patient docs). SQLite dep is **read-only drug DB only** | **must-build writable store** |
| 6 | Patient/encounter model | `personal-clinic.js` {patient, latest, consults[]}; `opd-emr.js` `ASSESS_SCHEMA`+`buildAssessPayload`; SCCM canonical `_connect/canonical/model.js` (scaffolding "wired Phase 2 onward"); `_opd_model.js` | reuse model; **must-build ids+version** |
| 7 | Authentication | Firebase `SMD_AUTH` (`app.js`); server `identify()` → `fb:<uid>` (`_usage.js`, `_fbauth.js`) | reuse |
| 8 | OPD Queue | `queue.js` + `functions/_queue_*` (Firestore): ticket/session model, status lifecycle, RBAC, `q_events` audit | reuse |
| 9 | Reusable modules | `SMD_RX` (prescription.js), `MEDLIST`, `SMD_VVITALS` (voice-vitals.js), `SMD_ASSESS` (assessment-schema.js), `detectInvestigations`, `VOICE_MAP`/`_voiceMerge`, timeline | reuse |
| 10 | **Required new modules** | local writable store + per-record model; change journal; encrypted Drive-delta sync engine; conflict detection/merge; device-authz table+guard; `source:"shared"` EMR branch; shared-clinic org mode; sync UI + admin sync console | **must-build** |
| 11 | Migration risks | Personal OPD (single-device) must keep working; convert-to-shared must back up first + verify before deleting originals | see §5 |
| 12 | Security risks | clinic Drive credential distribution; device revoke can't remote-wipe a local copy (only cut future sync + app-lock); single shared key today | see §5 |
| 13 | Sync risks | whole-file last-write-wins today = silent clobber the moment two devices share a clinic; delta ordering, offline reconvergence, clinical-field conflicts | see §5 |
| 14 | Implementation sequence | §4 below | — |

## 3. What already exists (do NOT rebuild)

**Clinic management is already built — twice.** Two production-shaped membership + RBAC planes:
- **Connect Enterprise (D1 `CONNECT_DB`):** `connect_tenant`, `connect_membership(user_id,tenant_id,role)`,
  invites, roles (owner/admin/clinician/auditor), `selfCreateTenant` ("any doctor adds their own
  hospital", capped 25/owner), `removeMember`, `requireCan()` fail-closed. (`functions/_connect/enterprise/*`)
- **OPD Queue org plane (Firestore):** `q_orgs`/`q_departments`/`q_opds`/`q_rooms`/`q_members`/`q_users`,
  Org→Dept→OPD→Room hierarchy, human codes `SMD-XXXXXX`, scoped membership, `_queue_roles` capability
  matrix (`admin/doctor/supervisor/nurse/reception/…`, `emr.vitals` vs `emr.treat`), `_opd_auth` staff
  email+PIN login, `setMemberActive(false)` = live revoke. (`functions/_opd_org*.js`, `_queue_roles.js`)

So spec §7 (team management), §8 (join), §17-19 (RBAC), §34 (onboarding), §33 (owner add member) map
onto existing endpoints. **Decision D1: pick ONE plane (recommend the OPD `q_orgs`/`_queue_roles`
Firestore plane — clinical roles + staff login + revoke) and don't add a third.**

**The EMR itself is already built + reusable via one seam.** `opd-emr.js` is `source`-switched
(`ghis`|`local`), both bound to a 2-method contract `localStore = {getConsult, saveConsult}`. Add a
`source:"shared"` branch pointing at a synced store behind that seam and the whole assessment UI +
`ASSESS_SCHEMA` + Rx + investigations + vitals come along. The **SCCM canonical model** (`patient()`,
`encounter()`, `condition()`, `observation()`, `documentReference()`, …) is scaffolding whose header
says it is "a contract, wired in Phase 2 onward" — this is that use.

**Encryption + Drive plumbing exist** (AES envelope, Keychain password, `drive.file` token, list/upload/
download REST). **Device identity exists** (`SMD_DEVICE.getId()`).

## 4. What must be built (the real work)

1. **Writable local store** behind the `localStore` seam — today patient data is `localStorage` only.
   *Decision D3:* IndexedDB (zero new native, buildless-friendly) vs writable SQLite (dep exists, better
   at scale). Recommend a clean store interface starting on IndexedDB, SQLite droppable later.
2. **Per-record model:** stable ids + `version` + `authorUid` + `updatedAt` on **patients AND encounters**
   (encounters today are anonymous unshift-only array entries — no id, no version).
3. **Change journal:** append-only per-device change log (`changeId, clinicId, recordId, entityType,
   op, version, deviceId, userId, timestamp`) — the delta feed (spec §13).
4. **Encrypted Drive-delta sync engine:** incremental (NOT whole-file), ~15s while active + event-driven
   (open/foreground/reconnect/save/manual), encrypt each delta, upload/download deltas, merge, converge
   offline. Reuses the AES envelope + Drive REST; the sync loop itself is new (spec §11-12).
5. **Conflict detection + merge:** optimistic version per record; deterministic merge for safe non-clinical
   fields; **clinical fields never silently overwrite** — surface a conflict card, keep both in audit
   (spec §14-15). The unused Firestore `wUpdate({updateTime})` primitive is the reference pattern.
6. **Per-device authorization:** a `devices` table (mirror `setMemberActive`) + one guard clause in the
   authz gate; enrollment + revoke (spec §17-18, §32). This is the only *new* control-plane piece.
7. **`source:"shared"` EMR branch** + a "Shared clinic" org mode in the queue source chooser + the sync
   status UI + admin sync console (spec §25-28).
8. **Clinic Drive access model** — *Decision D2 below (the big one).*

## 5. Critical decisions before Phase 1

- **D1 — Membership plane.** Two exist. Recommend the OPD `q_orgs`/`_queue_roles` Firestore plane.
- **D2 — Clinic Drive access (the load-bearing decision).** `drive.file` scope only sees files the app
  created *for that Google account*. For a shared clinic, member devices must sync to the **clinic's**
  Drive. Options:
  - **(a) One clinic Google Drive account** whose OAuth is distributed to authorized devices at
    enrollment; PHI is encrypted so the account holds only ciphertext. Simplest; matches "the clinic's
    Google Drive"; per-user security comes from Firebase identity + device-authz, not Drive ACLs. **Recommended.**
  - (b) Google Shared Drive — proper multi-user, but needs Google Workspace ($) + broader scope.
  - (c) `drive` (full) scope + a shared folder — broader permission prompt.
- **D3 — Local store tech.** IndexedDB (recommended start) vs writable SQLite.
- **D4 — Conflict unit.** Record-level with field-level conflict detection (per your dose-conflict
  example). Confirm.

## 6. Migration + safety

- **Do not break Personal OPD.** Shared Clinic is additive: `Personal Clinic → Create/Join Shared Clinic`.
- **Convert flow:** back up the encrypted Personal OPD data → create clinic dataset → import → verify →
  only then stop treating it as personal. Never delete originals until verified (spec §38).
- **Everything flag-gated:** `smd_shared_clinic` (default OFF) + a git recovery tag before Phase 1.
  Reversible per the repo's non-negotiable convention.
- **Revocation reality:** a revoked device keeps its last local copy (can't remote-wipe an offline DB);
  what we CAN do is cut future sync (device-authz guard) + enforce app-lock/biometric + rotate the clinic
  key so future deltas are unreadable to it. Document this honestly (spec §18, §32).

## 7. Re-scoped phase plan (your 16 phases, adjusted for reuse)

| Your phase | Reality | Effort |
|---|---|---|
| 0 Audit | **DONE (this doc)** | — |
| 1 Data model | per-record ids+version+author; change-journal schema | new |
| 2 Clinic creation + owner | mostly wire `selfCreateTenant`/`q_orgs` create + a simple UI | small (reuse) |
| 3 Team + RBAC | wire existing `members`/`_queue_roles` + role UI | small (reuse) |
| 4 Device authorization | new `devices` table + guard + enroll/revoke UI | new (small) |
| 5 Encrypted clinic dataset | reuse AES envelope; clinic-key handshake at enroll | reuse+new |
| 6 Incremental sync engine | **the core build** — journal → encrypt delta → Drive → merge | new (large) |
| 7 15s + event-driven sync | timers + lifecycle hooks around the engine | new |
| 8 Conflict detection | version compare + clinical-field conflict card | new |
| 9 Sync UI | status chip + Sync Now + pending count | new (small) |
| 10 Shared OPD queue | reuse `_queue_*` engine + statuses in shared mode | reuse |
| 11 Shared records/encounters | `source:"shared"` behind the `localStore` seam | reuse+wire |
| 12 Documents / lazy load | metadata local, encrypted blob in Drive, fetch-on-demand | new |
| 13 Admin sync console | devices + last-sync + pending/conflicts view | new (small) |
| 14 Backup/restore/recovery | reuse restore-from-Drive + device re-enroll | reuse+wire |
| 15 Security hardening | key mgmt, device revoke, app-lock, review | new |
| 16 Testing + migration | node --test + CDP; convert-flow tests | throughout |

**Net:** the heavy new work is Phases 1, 4, 6, 8, 12 (data model, device-authz, sync engine, conflict,
documents). Phases 2, 3, 10, 11, 14 are mostly reuse/wiring because the backend + EMR already exist.

## 8. Recommendation

Build the **control plane on the existing OPD org/RBAC Firestore plane** (add only a `devices` table),
keep the **data plane in the clinic's single Drive account (D2a), fully encrypted**, and land the
**sync engine incrementally** behind the `localStore` seam so the existing EMR UI is reused wholesale —
all under `smd_shared_clinic` (OFF) with a recovery tag. Await decisions D1-D4 before Phase 1.
