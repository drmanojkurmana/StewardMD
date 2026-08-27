---
tags: [module, education, regulatory]
flag: smd_pglog
default: ON (testers)
status: built, flag-ON for testers, R1 not run
built: 2026-08-27
---
# NMC Logbook — the PG digital logbook

The e-logbook **PGMER-2023 §5.2(v)–(vi) requires every Indian PG resident to maintain**: updated
weekly, authenticated monthly by the postgraduate guide. Phase 1 is **PG only**. UG/CBME is
deliberately **not built** — the engine carries `programmeType` so it can be added without a rewrite.

> **The authority for every regulatory claim is `NMC_PG_LOGBOOK_REQUIREMENTS.md` at the repo root.**
> It maps `NMC source → clause → verbatim quote → digital feature → evidence → verification → report`
> for every requirement the module implements. If a requirement appears in a pack and not in that
> file, it is a bug. Read it before changing anything here.

## The one sentence that explains the design

A PG logbook entry is a document a University examiner relies on, and **PGMER-2023 §9.2(c) puts a
monetary penalty on the named faculty / HoD / Dean who submits a false record**. So the guarantees
are throws at the data layer, not disabled buttons.

## Flag + default

| Flag | Def | What it does |
|---|---|---|
| `smd_pglog` | **ON** | Master. Off = a COMPLETE no-op (no root, no fetch, no CSS). Same tester rationale as `smd_clinix` / `smd_surgx`. |
| `smd_pglog_server` | ON | `/api/pglog` sync. Off = on-device drafts only, and the UI says so. |
| `smd_pglog_ai` | ON | MaiK assist. Advisory only — see [[#AI]]. Off changes no number. |
| `smd_pglog_faculty` | ON | Faculty / HOD / Academic-Cell surfaces (server still cap-gates). |
| `smd_pglog_attendance` | ON | §5.6 attendance records. |
| `smd_pglog_reports` | ON | The 11 reports. |
| `smd_pglog_demo` | **OFF — NEVER SHIP ON** | Seeds **fabricated** residents, entries and verifications locally. Fabricated verified records in an official training logbook are precisely what §9.2(c) penalises. Local-only; the server has no demo path. |
| `smd_pglog_verify_sla_days` | 7 | **CONFIG, not NMC.** NMC's only cadence is monthly authentication. |
| `smd_pglog_attest_grace_days` | 7 | CONFIG, not NMC. |

## Key files

| File | What it is |
|---|---|
| `pglog-model.js` | **THE PURE CORE.** Entities, the verification state machine, progress/cadence, attendance, exam checklist, assessment scoring, PHI scrubbing. Imported by the server too — the rules exist once. |
| `pglog-curriculum.js` | Pack registry, flatten/resolve, the **deterministic** requirement matcher. |
| `pglog/curricula/*.json` | 15 specialty packs + 2 common packs + a PGMER-only fallback. Data, not code. |
| `pglog/assessment-templates.json` | DOPS / shift WPBA / clinical WPBA / appraisal, taken from the NMC proformas. |
| `pglog-store.js` | Client: account-scoped local drafts, offline queue, API. |
| `pglog-screens.js` | Router + every screen (resident / faculty / HOD / Academic Cell). |
| `pglog-reports.js` | 11 pure report builders + print/CSV. |
| `pglog-ai.js` | Advisory assist. Two of its six functions are pure and have no AI at all. |
| `functions/_pglog_store.js` | Firestore I/O + the org-RBAC gate + `publicEntry()` (the privacy boundary). |
| `functions/_pglog_templates.js` | **Generated.** The server's own scoring contract, so a forged client template cannot inflate a mark. |
| `functions/api/pglog/[[path]].js` | The API router. |
| `scripts/build-pglog-curricula.mjs` | Emits the packs. **Add a new specialty here**, never by hand-editing JSON. |
| `scripts/build-pglog-templates.mjs` | Regenerates `_pglog_templates.js` from the JSON. |

## The invariants (and where they are enforced)

All in `pglog-model.js`, so they hold for the UI, the API and any future importer:

1. `verify()` **throws** if the actor is the entry's author. Namespace-tolerant (`fb:` / raw / case).
2. `returnEntry()` throws on an empty reason.
3. `applyEdit()` throws on a `verified` entry.
4. `amend()` snapshots the whole prior document into `revisions[]`, then re-opens verification.
5. `softDelete()` throws on a `verified` entry. Deletion is never hard.
6. `assess()` throws if the assessor is the assessee, or on a partially-scored form.
7. Attestation ids are deterministic + `wCreate` — **a month can be signed exactly once.**

**Two independent locks on "a resident cannot approve their own record":** `pg_resident` holds no
`PGLOG_VERIFY` cap at all, *and* the model throws. Neither alone is trusted.

## RBAC

Extends the **existing** `functions/_queue_roles.js` — no parallel permission system. New caps
`PGLOG_*`; new roles `pg_resident`, `pg_faculty`, `pg_hod`, `academic_cell`. Membership + scope come
from the existing `q_members` + `authorizeOrgAccess()`.

**`admin` is deliberately NOT granted verify/assess/attest** — the same separation the ONCQIS
approval caps already use. Signing a trainee's clinical record is not a technical-admin power.

## Privacy — the thing to not break

This is an educational logbook, **not a second EMR**.

- The entry schema has **no field** for a patient name, phone, address or Aadhaar.
- `sanitizeCaseRef()` strips a name / mobile / Aadhaar / email typed into the case-reference box,
  **on write, server-side too**. It keeps MRN-shaped tokens.
- Age is a **band**, never a DOB.
- `publicEntry(e, audience)` is the boundary. `self` / `verifier` / `hod` see clinical detail;
  **`aggregate` (Academic Cell, department summary, every export) sees counts and categories only.**
- Notifications and audit rows carry ids and kinds, never a case reference or a diagnosis.

## AI

`pglog-ai.js`. Advisory, labelled, and structurally unable to do the forbidden things:

- Suggestions are filtered against the **resolved pack** — an id not in it is dropped. The AI cannot
  mint a requirement.
- **No function creates, edits, submits or verifies an entry.** `pglog-store.saveDraft` is not imported.
- Progress is computed from **verified entries only**, by pure code.
- `incomplete()` and `reminders()` are **pure, with no AI at all** — a reminder about a regulatory
  deadline must be right, not plausible.

## Gotchas

- **Only VERIFIED entries count toward progress.** A resident cannot move their own bar. Submitted
  work is reported separately as `pending` so it does not look lost.
- **A requirement with no NMC number gets no denominator and no progress bar.** Most NMC specialty
  curricula say *"a specified number"* — specified by the department. Inventing a target there is the
  single easiest way to make this module lie.
- **Cadence ≠ total.** "Journal club: once a fortnight" is measured against what is expected *by
  today*, not against the whole course.
- **A matcher with no discriminator matches nothing** — otherwise a `target: 100` requirement
  silently completes itself off unrelated entries. There is a test for this.
- **Attendance has two provenances.** The 80% is PGMER §5.6 (gazette). The 751/501-day figures are
  from the PGMEB FAQ — a **secondary source we could not fetch as a primary PDF**. They carry
  different grades and the UI shows which. Do not merge them.
- **The DRP semester window is a WARNING, not a block.** A State's posting schedule is not the
  resident's to fix, and refusing the record would make the logbook less true.
- **Test on port 8994, not 8991.** Another worktree's `serve.mjs` on the shared port silently serves
  *its* copy of the app — that is how this module's UI test once "failed" 48 assertions against code
  it was never looking at. See [[two-claude-sessions-one-folder]].

## Tests

| File | Covers |
|---|---|
| `test/pglog-model.test.mjs` | 47 — every invariant, dates, privacy, progress, cadence, attendance, eligibility, attestation, assessment |
| `test/pglog-curriculum.test.mjs` | 29 — **provenance**: every requirement names a source + clause; every numeric target appears in its own quote; no invented procedure counts |
| `test/pglog-server.test.mjs` | 31 — store flow against an in-memory Firestore, RBAC, the privacy projection, exactly-once attestation, the server template contract |
| `test/run-pglog-ui.mjs` | 48 — real headless Chrome: flag-off no-op, mount, drafts offline, provenance rendering, packs over HTTP, reports, navigation |

Run: `node --test test/pglog-*.test.mjs` and `node test/run-pglog-ui.mjs`.

## Status / what is NOT done

- **R1 clinical review has not been run.** Nothing here is a dose or a clinical decision, but the
  content is regulatory and an R1 pass on the requirement mapping is still owed before a non-tester
  release.
- **Native rebuild not done.** Web deploys do not reach installed apps ([[Native app delivery]]).
- **The PGMEB FAQ primary PDF was not obtainable** — see the open items in
  `NMC_PG_LOGBOOK_REQUIREMENTS.md` §10.
- **PG-MSR 2023/2024 is a scanned image PDF**, so no MSR-derived requirement is claimed anywhere.
- **~20 broad specialties and all DM/M.Ch have no pack** — they fall back to `generic-pg`, which
  carries the PGMER requirements and *says* no specialty pack is loaded.
- **UG/CBME not built**, by instruction.

## Adding a specialty

1. Fetch the NMC curriculum PDF, extract the logbook / assessment / procedure clauses.
2. Add the pack to `scripts/build-pglog-curricula.mjs` with a **verbatim quote per requirement**.
3. `node scripts/build-pglog-curricula.mjs`
4. `node --test test/pglog-curriculum.test.mjs` — it will refuse any number that is not in its quote.
5. Add the source row to `NMC_PG_LOGBOOK_REQUIREMENTS.md` §10.
