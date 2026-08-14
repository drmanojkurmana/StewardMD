# Oncology Treatment-Plan System - Implementation Plan

Source of truth: `docs/superpowers/specs/2026-08-12-oncology-protocol-engine-design.md` (approved v2). This plan follows that spec exactly. Where the spec and these grounded findings disagree, the spec wins on intent and the findings win on file paths and existing seams.

## Goal

Build a patient-specific oncology treatment-plan system. One Treatment Plan object drives three views (doctor matrix, nurse execution screen, printable PDF) and the EMR history. Ship a real vertical slice (R-CHOP, one regimen, end to end) before expanding the protocol library. Everything ships behind flag `smd_onco_protocols` (default OFF).

## Architecture

```
 PROTOCOL TEMPLATE (static repo JSON, version-locked)
 |
 ONCO DOSE ENGINE (onco-dose.js, pure + golden-tested)
 |
 TREATMENT PLAN (Firestore doc, single source of truth)
 |
 +-------------------+-------------------+
 v v v
 DOCTOR UI NURSE VIEW PROTOCOL PDF
 (opd-emr tab) (opd-emr view) (print/PDF reuse)
 +-------------------+-------------------+
 v
 EMR HISTORY (plan + cycles + administration, Firestore)
```

The app and the PDF share data, not presentation. The PDF is generated FROM the stored plan, never built first and embedded.

## Tech Stack (no new dependencies)

- Client: buildless ES5 IIFE modules at repo root, cache-busted with `?v=goldNNN`, assembled into `www/` by `scripts/build-www.sh`. New client modules follow the `voice-ambient.js` UMD shape (`window.SMD_X` + `module.exports`).
- Flags: `queue-flags.js` `DEFS` registry (`SMD_QUEUE_FLAGS.bool`).
- Server: Cloudflare Pages Functions under `functions/`, Firestore via the tiny REST client `functions/_fbfirestore.js`. No Firestore SDK, no SQL. NoSQL documents plus static JSON protocol files.
- Dose math reuse: `calculators.js` already has `bsa`, `crcl`, `ckdepi`, `calvert` (cat `Oncology`), but it exposes only `window.MEDCALC` and has NO `module.exports`, so it cannot be `require`d headlessly in Node tests. Decision below (Phase 1) re-derives the 4 formulas as trivial pure functions inside `onco-dose.js` with `calculators.js` line numbers cited as the source of truth. No new math dependency, no coupling a golden test to a large UI file.
- Tests: `node --test test/*.test.mjs` for pure logic; a CDP headless-browser harness (pattern of `test/run-abx-ui.mjs`) for UI suggest-and-confirm behavior.
- PDF: existing dual-path HTML to PDF pipeline (native `VisionOcr.htmlToPdf` via `window.SMD_NATIVE.sharePdfFromHtml`, web fallback hidden iframe + `window.print()`). No jsPDF.

---

## Global Constraints (copied from the spec, bind every task)

- **Single source of truth.** One Treatment Plan object drives the app UI, the nurse view, and the PDF. No duplicate dose logic, no separate PDF or nurse calculations.
- **Review-then-confirm-plan (not per-line confirm).** Every line (drug, dose, date) is reviewable and inspectable. The physician confirms the treatment plan (and each cycle before it goes READY). Any value that differs from the calculated value is an override requiring a reason, recorded with physician plus timestamp (audit). This replaces v1's confirm-every-line.
- **The engine flags; the clinician decides.** Dose-modification rules and clearance can flag, hold, or recommend, but the system never independently decides to administer, never auto-orders, never auto-writes to GHIS.
- **Never invent.** No drug, dose, rule, schedule, guideline, or citation without a provided source (NCCN plus the licensed textbook). Unverifiable values are surfaced as "verify," never guessed.
- **Dosing basis plus caps are data, not assumptions.** Per-drug basis (BSA, AUC, mg/kg, flat). Caps are protocol- or drug-defined (`none | protocol | drug | institutional`). There is no universal hidden BSA 2.0 cap.
- **Immutable version locking.** A Treatment Plan locks the exact Protocol Template version it was created from. Publishing a newer template version never alters existing plans or historical cycles.
- **Dose lineage is preserved end to end** (protocol, calculated, rounded, modified, confirmed, administered).
- **Reversible plus gated.** Behind flag `smd_onco_protocols` (default OFF) plus a git recovery point per wave. R1 clinical review mandatory and blocking. Golden regression on the dose math.
- **No PHI in logs or URLs.** Height, weight, creatinine, BSA, labs handled per existing PHI rules.
- **No em-dash in app-facing text.**

---

## PONYTAIL-LEAN choices (stated up front, baked into every phase)

1. **Version-locking via snapshot, not a registry.** When a plan is created, the entire chosen Protocol Template JSON is copied (snapshotted) into the plan document under `lockedTemplate`. No separate version-registry collection, no version-diffing service in v1. Publishing a new template file cannot touch existing plans because plans never re-read the template.
2. **Dose-modification rules are drawer NOTES in v1, not an evaluation engine.** The template carries `doseModificationRules[]` as human-readable text shown in the dose drawer and clearance panel. The engine does not parse or auto-apply them. The physician reads and decides. (Spec section 9 intent preserved: flag, do not decide. We simply do not build the evaluator yet.)
3. **Mosteller only.** DuBois is out of v1. `onco-dose.js` ships one BSA formula.
4. **Minimal cycle states first:** `planned | ready | administering | done | held`. The spec's fuller machine (`PLANNED -> DUE -> CLEARANCE -> PHYSICIAN CONFIRMED -> READY -> ADMINISTRATION -> COMPLETED`, alt `HELD/DELAYED/MODIFIED/CANCELLED`) is collapsed: DUE and CLEARANCE are computed views over a `planned` cycle, PHYSICIAN CONFIRMED is the transition into `ready`, ADMINISTRATION is `administering`, COMPLETED is `done`. `held` covers HELD/DELAYED/CANCELLED in v1 with a reason string. Add the finer states only if a workflow gap shows up.
5. **Caps are per-drug or per-protocol data with NO universal cap.** `caps: none | protocol | drug | institutional`, read from the template, never hardcoded.
6. **Reuse everything:** `/api/queue` router plus Firestore, `opd-emr.js` tabs, the existing PDF/print mechanism, the existing pure-module plus golden-test pattern. No new router, no new auth layer, no new Firestore client, no new dependency.

---

## SAFETY (non-negotiable, from spec - every phase inherits these)

- Suggest-and-confirm. The UI stages into local state, never writes through on selection.
- Review-then-confirm-plan (not per line). The physician confirms the whole plan and each cycle before READY.
- Any override of a calculated value requires a typed reason, stored with physician id and timestamp.
- Engine flags, clinician decides. No auto-order, no auto-administer, no silent GHIS write.
- Never invent. No dose, rule, or citation without a source. Citations read `NCCN <panel> v<ver>` plus the textbook name, no page numbers, original synthesis only.
- R1 clinical review is mandatory and blocking on the dose engine and on every regimen wave.
- Golden regression on the dose math must be green.
- No PHI in logs or URLs.
- Feature flag `smd_onco_protocols` default OFF; server write env gate `QUEUE_ONCO_WRITE` default unset (501).

---

## Reference block (the 16 required sections, findable in one place)

### R1. Firestore collections and static protocol JSON (NoSQL, this is not SQL)

This stack has no SQL and no canonical Patient collection. A patient is identified on documents by `ghisPatientId` (full MRN) plus `hospitalId`/`orgId`, doctor by `doctorUid`. All collections are flat, `q_` prefixed, no subcollections, filtered by a single scoping field via `fsQuery` (single-field equality only, then `.filter()` in JS). Deterministic ids where idempotency matters, `crypto.randomUUID().replace(/-/g,"")` otherwise.

- `q_onco_plans/{planId}` - Treatment Plan. Random `newId()`. Fields: `planId, hospitalId, orgId, doctorUid, ghisPatientId (mrn), protocolId, lockedVersion, lockedTemplate (full snapshot JSON), intent, patientParams{height,weight,bsa,age,sex,creatinine,renalFn,relevantLabs}, calculatedDoses[], physicianModifications[], confirmedDoses[], plannedCycles (int), plannedDates[], status, confirmations[], createdAt, updatedAt`.
- `q_onco_cycles/{planId}__{cycleNo}` - Cycle Instance. Deterministic id (same trick as `sessionId()`/`memberId()`: `sanitize(planId)+"__"+cycleNo`). Fields: `planId, cycleNo, day, plannedDate, state (planned|ready|administering|done|held), holdReason, clearance{status,checks[],resolvedBy,resolvedAt}, confirmedDrugs[], confirmedDoses[], administrationSequence[], createdAt, updatedAt`.
- `q_onco_admin/{id}` - Administration Record, append-mostly like `q_tickets`, random `newId()`, never mutated after finalized. Fields: `cycleId, planId, drugId, planned, actual, route, startTime, endTime, administeredBy (actor.id), prepared, administered, reaction, notes, status`.
- Audit: every mutating write calls `qAudit(env, {hospitalId, ...actor, action, meta})` to `q_events` (best-effort, never blocks). PHI values (patient name, mobile) are never placed in audit meta or logs; only MRN scoping and dose numbers.
- Static protocol templates: `kb/protocols/<id>.json`, one small file per protocol id, plain repo JSON (same trust tier as `kb/treatments/*.json`, NOT the AES-GCM encrypted Pro KB). Copied verbatim into `www/kb/protocols/` by `build-www.sh`. Fetched directly by the client, no `kb-loader.js` change.

### R2. Protocol-template JSON schema (static, `kb/protocols/<id>.json`)

```jsonc
{
 "id": "rchop",
 "diseaseId": "dlbcl",
 "name": "R-CHOP",
 "version": "2.1",
 "lifecycleState": "active", // draft|clinical_review|approved|active|superseded|retired
 "intentOptions": ["curative", "palliative"],
 "cycleLengthDays": 21,
 "cycles": 6,
 "caps": "protocol", // none|protocol|drug|institutional
 "source": {
 "nccn": "NCCN B-cell Lymphomas v2.2026",
 "textbook": "<textbook title, filled in Phase 2 from open item 1>"
 },
 "institution": { "provenance": "NCCN reference regimen", "approval": null },
 "premedications": [ { "name": "...", "notes": "..." } ],
 "supportiveCare": [ "..." ],
 "monitoring": [ "CBC before each cycle", "..." ],
 "clearanceChecks": [ "CBC/platelets", "renal", "liver", "prior-cycle status" ],
 "doseModificationRules": [ // NOTES ONLY in v1, rendered verbatim, not evaluated
 { "condition": "ANC < 1000", "action": "delay", "text": "Delay 1 week, re-check CBC." }
 ],
 "drugs": [
 {
 "id": "rituximab",
 "name": "Rituximab",
 "basis": "bsa", // bsa|auc|mgkg|flat
 "dosePerUnit": 375, // per m2 (bsa), per AUC (auc), per kg (mgkg), or absolute (flat)
 "unit": "mg/m2",
 "route": "IV",
 "days": [1],
 "caps": { "perDose": null, "cumulativeLifetime": null },
 "roundingRule": { "increment": 50 }, // mg increment; null = no rounding
 "modificationRules": [],
 "notes": ""
 }
 // ... doxorubicin carries caps.cumulativeLifetime for anthracycline tracking
 ]
}
```

`kb/schema/protocol.schema.json` mirrors `treatment.schema.json` so `kb/tools/validate-content.mjs` can gate it. Disease-to-protocol link: add `"protocolRefs": ["rchop", ...]` to `kb/diseases/<id>.json` (mirrors existing `treatmentRef`/`policyRef`). Each protocol carries its own `diseaseId` back-pointer.

### R3. Dose-engine module structure (`onco-dose.js`, pure functions, UMD, no DOM/fetch)

Formulas re-derived locally (2 lines each) with source citations, because `calculators.js` has no `module.exports` (verified). Cited source of truth per function:

- `bsaMosteller(hCm, wKg)` -> m2. `sqrt(hCm*wKg/3600)`. Source: `calculators.js:878-889`.
- `gfrCockcroft({age, wKg, scr, sex})` -> mL/min. `(140-age)*wKg/(72*scr)`, x0.85 female. Source: `calculators.js:539-552`.
- `calvert(auc, gfr)` -> mg. `auc*(min(gfr,125)+25)`. GFR capped at 125. Source: `calculators.js:2369-2381`.
- `roundDose(mg, rule)` -> mg. Round to `rule.increment`, else passthrough.
- `applyCap(mg, capSpec)` -> `{mg, capApplied}`. Only if the drug/protocol data defines a cap. No universal cap.
- `doseForDrug(drug, params)` -> a full **dose lineage** object:
 ```
 { drugId, basis, protocolDose, inputs{bsa|gfr|weight...}, calculated, rounded,
 capApplied, final, source, warnings[] }
 ```
 Dispatch on `drug.basis`: `bsa` -> `dosePerUnit*bsa`; `auc` -> `calvert(dosePerUnit, gfr)` (prompts/warns if creatinine missing); `mgkg` -> `dosePerUnit*wKg`; `flat` -> `dosePerUnit`. Then `roundDose`, then `applyCap`. Physician modification is layered on top by the caller (not the engine) and stored as `modified` + `reason`.
- `planDoses(template, params)` -> `calculatedDoses[]` for all drugs (drives the matrix and PDF from one call).
- Guards: missing height/weight/creatinine return an `ERR`-shaped result with a `warnings` entry, never a guessed number (never-invent).

### R4. Treatment-plan lifecycle

`Apply protocol (select ACTIVE template) -> snapshot template into plan (lockedTemplate + lockedVersion) -> auto-pull patient params from EMR -> planDoses -> REVIEW (every line inspectable, overrides need reason) -> Create Treatment Plan (status=draft) -> physician CONFIRM & ACTIVATE (status=active) -> attached to patient`. Plan `status: draft | active | completed | cancelled`. The plan never re-reads the template after creation (version lock by snapshot).

### R5. Cycle state machine (lean v1)

```
planned --(clearance resolved + physician confirm)--> ready
ready --(nurse starts)---------------------------> administering
administering --(complete cycle)--------------------> done
any --(hold/delay/cancel + reason)--------------> held
```
DUE and CLEARANCE from the spec are computed views over a `planned` cycle (due = plannedDate reached; clearance = the clearance object status). Scheduling: dates auto-generated from `cycleLengthDays` + start date; a delay recalculates future dates as a proposal shown to the physician, never silently applied.

### R6. EMR integration points

- `opd-emr.js`: add a 5th tab `["onco","Oncology","vaccines"]` in `tabsNav` (opd-emr.js:24-29); add `else if (active === "onco") body = head + oncoTab(st);` in `_render` (opd-emr.js:394-407); add onco actions in the delegated `onClick` (opd-emr.js:474-499) using the `cmd:arg` convention; add onco fields to `freshState()` (opd-emr.js:415).
- `queue.js`: `openAssessment(ticketId)` (queue.js:362-366) already forwards `tab`. Landing on onco = call `OPDEMR.openProfile({..., tab:"onco"})`. No new queue entry point required in v1 (optional dedicated action deferred).
- `/api/queue` router: add `seg === "onco"` route blocks in `functions/api/queue/[[path]].js` after `resolveActor`/gating (after line 189), reusing `resolveActor`/`requireOrgOrGlobal`/`requireSessionCap`. Import `functions/api/queue/_onco_store.js`.

### R7. Doctor UI component structure

- **Overview matrix** (primary): `oncoTab(st)` builds drug rows x cycle columns via the existing `section()` card wrapper (opd-emr.js:58) and the `<details class="oe-acc">` accordion (opd-emr.js:220-230) for per-cycle collapse. Cells are buttons `data-oe-act="onco-cell:<cycleNo>:<drugId>"` (mirrors `labRow`/`radRow` shape).
- **Contextual calc drawer**: clone the `st.report` drawer pattern. Add `st.doseDrawer` set on `onco-cell`, rendered by `doseDrawerView(st.doseDrawer)` appended in `_render` when open, closed by an `onco-drawer-close` action clearing `st.doseDrawer`. Shows the full dose lineage (protocol dose, BSA, calculation, rounding, previous cycle, modification, final confirmed) plus `[View protocol source] [View audit trail]`.
- **Apply-protocol flow**: reuse the `aiGroup`/`scribeRow` suggestion primitive (opd-emr.js:322-338). Render an `aiGroup("Oncology protocol", ...)` next to `provisional_diagnosis` with `data-oe-act="onco-apply:<protocolId>"`. The handler stages a plan into local `st.oncoDraft` (mirroring `scribeAcceptOne`/`appendPlan`), never writing through.
- **Review + confirm-plan**: a review panel over `st.oncoDraft` listing every calculated line; edits set an override + require a typed reason; `[Create & Activate]` fires one `confirmed()`-gated POST.

### R8. Nurse UI component structure

- Separate execution view inside `opd-emr.js` (or a small companion `onco-nurse.js` builder called by `oncoTab` when a nurse-role/nurse-tab is selected). "Today's Chemotherapy": patient / protocol / cycle / day header, a big clearance banner (green/amber/red from the cycle clearance object), then an ordered give-list (premed, then each drug with final confirmed dose and route, each a `[Start]` button `data-oe-act="onco-start:<cycleId>:<drugId>"`).
- Administration record table: actual dose | start | end | reaction | nurse, each row backed by a `q_onco_admin` write. `[Complete cycle]` transitions the cycle to `done`.
- No calculation in the nurse view. It reads confirmed doses off the plan/cycle only.

### R9. PDF generation architecture

Reuse the existing dual-path pipeline unchanged. New pure builder `onco-protocol-report.js` exports `buildProtocolSheet(plan, opts)` returning one `<!doctype html>...</html>` string (mirrors `thorex-report.js` `buildProDocument`, reuses its `PRO_CSS` `.page`/`@page`/`@media print` block for the 2-page sheet). Page 1 = protocol matrix + patient params. Page 2 = cycle detail, clearance table, dose-calculation trace/lineage, nursing administration record, confirmation, disclaimer. Export calls `window.SMD_NATIVE.sharePdfFromHtml(html, filename, title)` on native with the hidden-iframe `window.print()` fallback on web (copy the ~15-line `exportHtmlDoc` from `thorex-screens.js:1399-1424`). Built FROM the plan object, never embedded. No jsPDF, no native code change.

### R10. Audit and versioning architecture

Version locking by **snapshot into the plan** (`lockedTemplate` + `lockedVersion`), NO separate version registry in v1. Audit via the existing append-only `qAudit` to `q_events` on every mutating onco write (create plan, confirm plan, confirm cycle, override dose, administer). Overrides store `{ was, now, reason, by, at }`. Dose lineage is persisted on every confirmed drug line so protocol vs calculated vs modified vs administered is always reconstructable.

### R11. Permissions (doctor vs nurse)

Reuse the existing capability model (`requireOrgOrGlobal`, `requireSessionCap`, `authorizeOrg`). No new auth layer.

- **Doctor** (firebase actor, role admin/doctor, or org-scoped `EMR_TREAT`/new `ONCO_TREAT` cap): create plan, calculate, override with reason, confirm and activate plan, confirm a cycle to `ready`, print/PDF, view lineage and audit.
- **Nurse** (staff or org-scoped viewer/execution cap): read a `ready` cycle, record administration, mark reactions, complete a cycle. Cannot create plans, cannot change doses, cannot override, cannot confirm a cycle to `ready`.
- Every mutating onco write is triple-gated: client flag `smd_onco_protocols`, server env `QUEUE_ONCO_WRITE=1` (else 501), explicit client `confirm()` before POST.

### R12. Test cases

- **Dose-engine golden tests** (`test/onco-dose.test.mjs`, `node --test`): known BSA (height 170, weight 65 -> Mosteller 1.75 m2, assert to 2 dp); R-CHOP cyclophosphamide 750 mg/m2 x BSA then protocol rounding to a golden mg; Calvert AUC 5 with a known GFR and the GFR>125 cap; mg/kg and flat cases; missing-height and missing-creatinine return an `ERR`-shaped result with a warning and no number (never-invent); a cap-applied case and a cap-absent case.
- **CDP UI tests** (harness pattern of `test/run-abx-ui.mjs`): (a) suggest-and-confirm - applying a protocol stages into `st.oncoDraft` and NOTHING is POSTed until `[Create & Activate]`; assert zero network writes pre-confirm; (b) override-needs-reason - editing a calculated dose without a reason blocks the confirm; (c) nothing-applied-pre-confirm - no `q_onco_*` write and no GHIS call before physician confirm; (d) never-invent - a drug with no source in the template renders "verify," not a number.
- Golden regression must be green and is blocking. R1 clinical sign-off is blocking per wave.

### R13. Existing StewardMD files to MODIFY (exact paths)

- `queue-flags.js` - add `smd_onco_protocols: { type:"bool", def:false, query:"qonco", desc:"Oncology protocol treatment plans (P1)" }` to `DEFS` (line 18-24). (`qonco` alias is free.)
- `opd-emr.js` - tab tuple, `_render` branch, `onClick` cases, `freshState` fields, drawer view, export list additions.
- `queue.js` - none required in v1 (optional dedicated onco action deferred).
- `index.html` - add `<script src>` tags with `?v=goldNNN` for `onco-dose.js`, `onco-protocols.js`, `onco-protocol-report.js`; bump the shared cache-bust token.
- `functions/api/queue/[[path]].js` - add `seg === "onco"` route blocks + `import * as ONCO from "../../_onco_store.js"` (note: findings suggested engine at `functions/_onco_store.js`; keep it at `functions/` next to `_queue_engine.js`, imported with the same 2-dir-up relative path the router already uses).
- `scripts/build-www.sh` - one `mkdir -p "$WWW/kb/protocols"` (near line 14) + one `cp -R kb/protocols/. "$WWW/kb/protocols/"` (near line 79).
- `kb/diseases/<id>.json` (e.g. `dlbcl`/`acute_leukemia`) - add `protocolRefs[]`.
- `sw.js` - cache-bust token bump so the new bundle reaches installed apps (stale-while-revalidate).
- `kb-loader.js` / coverage-matrix build - NO change in v1 (protocols are raw copied JSON, not compiled into the encrypted KB; coverage-matrix wiring deferred).

### R14. NEW files to create (exact paths)

- `onco-dose.js` (repo root) - pure dose engine, UMD.
- `onco-protocols.js` (repo root) - client protocol loader + matrix/drawer/review builders (or fold builders into `opd-emr.js` `oncoTab`; keep the pure matrix builder `_buildOncoMatrix` here for testability).
- `onco-nurse.js` (repo root) - nurse execution view builder (optional split; can live in `onco-protocols.js` if small).
- `onco-protocol-report.js` (repo root) - pure PDF document builder.
- `functions/_onco_store.js` - Firestore I/O engine (copy `_queue_engine.js` pattern: sanitize, deterministic/random id, `fsGet`/`fsCommit`, `qAudit`).
- `kb/protocols/rchop.json` (and later waves) - static protocol templates.
- `kb/schema/protocol.schema.json` - validation schema.
- `test/onco-dose.test.mjs` - golden tests.
- `test/onco-store.test.mjs` - engine unit tests (pure helpers: id shaping, lineage, override recording).
- `test/run-onco-ui.mjs` - CDP UI test.

### R15. Migration strategy

- Flag `smd_onco_protocols` ships `def:false`; server env `QUEUE_ONCO_WRITE` unset (501) until owner flips it. Nothing is user-visible on release.
- All Firestore changes are additive new collections (`q_onco_plans`, `q_onco_cycles`, `q_onco_admin`). No existing data to migrate, no schema change to existing collections.
- Git recovery point (tag or branch) per wave before merging that wave.
- Rollback = flip the flag OFF (client) and leave `QUEUE_ONCO_WRITE` unset (server 501). The onco routes are inert until both are on.

### R16. Phase-by-phase implementation order (vertical-slice first)

Take ONE real protocol (R-CHOP) all the way through Phases 0 to 6 (data, engine, template + workflow, doctor UI, plan, cycle + nurse + clearance, PDF) before Phase 7 KB expansion and Phase 8 GHIS. This proves the single-source-of-truth pipeline end to end on real data before scaling content or wiring the hospital system.

---

## File Structure map

```
repo root/
 queue-flags.js (MODIFY: add smd_onco_protocols)
 opd-emr.js (MODIFY: onco tab, render, onClick, state, exports)
 index.html (MODIFY: script tags + cache-bust token)
 sw.js (MODIFY: cache-bust token)
 onco-dose.js (NEW: pure dose engine)
 onco-protocols.js (NEW: client loader + matrix/drawer/review builders)
 onco-nurse.js (NEW, optional: nurse view builder)
 onco-protocol-report.js (NEW: pure PDF builder)
 scripts/build-www.sh (MODIFY: copy kb/protocols)
 functions/
 _onco_store.js (NEW: Firestore I/O engine)
 api/queue/[[path]].js (MODIFY: onco route blocks)
 kb/
 protocols/rchop.json (NEW; more per wave)
 schema/protocol.schema.json (NEW)
 diseases/<id>.json (MODIFY: protocolRefs[])
 test/
 onco-dose.test.mjs (NEW)
 onco-store.test.mjs (NEW)
 run-onco-ui.mjs (NEW: CDP)
```

---

## Phase 0 - Data architecture + safety model (pure schema + validation, no UI)

**Goal.** Lock the four entities, the lean cycle state machine, version-lock-by-snapshot, provenance, and the dose-lineage shape as validated schema. No UI, no writes.

**Create:** `kb/schema/protocol.schema.json`, `kb/protocols/rchop.json` (skeleton with placeholder textbook title pending open item 1), `test/onco-store.test.mjs` (schema + pure-helper tests).
**Modify:** `queue-flags.js` (add the flag, `def:false`).

**Interfaces.**
- Produces: the R2 protocol schema and the R1 Firestore doc shapes (documented, validated by `validate-content.mjs`).
- Consumes: existing `kb/schema/treatment.schema.json` as the structural template.

**TDD steps.**
1. Write `kb/schema/protocol.schema.json` mirroring `treatment.schema.json`; require `id, name, version, lifecycleState, cycleLengthDays, cycles, caps, source.nccn, source.textbook, drugs[]`; each drug requires `id, name, basis (enum bsa|auc|mgkg|flat), dosePerUnit, unit, route, days[]`.
2. Author `kb/protocols/rchop.json` skeleton (drug list, days, basis, rounding, caps=`protocol`; doxorubicin `caps.cumulativeLifetime` set). Textbook title left as `"<pending>"` with a `ponytail:` note that Phase 2 fills it (open item 1).
3. Test: run `node kb/tools/validate-content.mjs` (or its schema-check entry) and assert `rchop.json` validates against `protocol.schema.json`.
4. Test (`onco-store.test.mjs`): assert the deterministic cycle id helper shape, e.g.

```js
import { test } from "node:test"; import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ONCO = require(join(HERE, "..", "functions", "_onco_store.js"));

test("cycle id is deterministic and sanitized", () => {
 assert.equal(ONCO._cycleId("TP-abc/123", 3), "TP-abc_123__3");
});
```
 (Engine file created in Phase 2; in Phase 0 this test is written and expected-red, or the helper is stubbed pure-only.)
5. Flag test: load `queue-flags.js` under Node, assert `bool("smd_onco_protocols")` is `false` by default.

**Recovery point:** tag `onco-p0` before merge.

---

## Phase 1 - Dose engine (pure, golden-tested, R1-blocking)

**Goal.** `onco-dose.js` computes BSA/AUC/mg-kg/flat with rounding and protocol/drug caps, returns full dose lineage, never invents.

**Create:** `onco-dose.js`, `test/onco-dose.test.mjs`.

**Interfaces.**
- Produces: `bsaMosteller(hCm,wKg) -> number`, `gfrCockcroft({age,wKg,scr,sex}) -> number`, `calvert(auc,gfr) -> number`, `roundDose(mg,rule) -> number`, `applyCap(mg,capSpec) -> {mg,capApplied}`, `doseForDrug(drug,params) -> lineage`, `planDoses(template,params) -> lineage[]`. UMD export `window.SMD_ONCODOSE` + `module.exports`.
- Consumes: plain objects only. No DOM, no fetch, no `window`.

**TDD steps.**
1. Golden BSA: `assert.equal(round2(bsaMosteller(170,65)), 1.75)`.
2. BSA dose + rounding: cyclophosphamide `{basis:"bsa",dosePerUnit:750,roundingRule:{increment:50}}` with bsa 1.54 -> calculated 1155 -> rounded 1150; assert `doseForDrug(...).final === 1150` and lineage carries `protocolDose:750, calculated:1155, rounded:1150`.
3. Calvert cap: `assert.equal(calvert(5, 130), 5*(125+25))` (GFR capped at 125).
4. Cockcroft female factor: assert x0.85 applied.
5. mg/kg and flat: assert straight multiply and passthrough.
6. Never-invent: `doseForDrug({basis:"auc",...}, {creatinine:null})` returns a result with `warnings` non-empty and `final == null` (no guessed dose); assert no numeric `final`.
7. Cap absent vs present: `applyCap(2000, {perDose:null})` -> `{mg:2000, capApplied:false}`; `applyCap(2000,{perDose:1500})` -> `{mg:1500, capApplied:true}`.
8. Run `node --test test/onco-dose.test.mjs`, all green. R1 clinical review on the engine (blocking).

**Recovery point:** tag `onco-p1`.

---

## Phase 2 - R-CHOP template + full workflow wiring (server engine, end to end on data)

**Goal.** One deeply verified protocol (R-CHOP) plus the template -> plan -> cycle -> administration flow, tested end to end at the data layer (not just math). R1.

**Create:** `functions/_onco_store.js`.
**Modify:** `functions/api/queue/[[path]].js` (onco route blocks), `kb/protocols/rchop.json` (fill verified content + textbook title from open item 1), `kb/diseases/<diseaseId>.json` (`protocolRefs`), `scripts/build-www.sh` (copy `kb/protocols`).

**Interfaces.**
- Produces (server): `POST /api/queue/onco/plan {hospitalId,ghisPatientId,protocolId,intent,patientParams}` -> creates `q_onco_plans` doc with `lockedTemplate` snapshot; `GET /api/queue/onco/plan?planId=`; `POST /api/queue/onco/plan/confirm {planId, overrides[]}`; `POST /api/queue/onco/cycle {planId,cycleNo}`; `POST /api/queue/onco/cycle/confirm {cycleId}` (planned->ready); `POST /api/queue/onco/admin {cycleId,drugId,actual,...}`; `POST /api/queue/onco/cycle/complete {cycleId}`.
- Produces (engine): `_onco_store.js` functions `createPlan`, `getPlan`, `confirmPlan`, `createCycle`, `confirmCycle`, `recordAdmin`, `completeCycle`, plus pure helpers `_cycleId`, `_snapshot`, `_recordOverride`. Each mutating fn calls `qAudit`.
- Consumes: `_fbfirestore.js` (`fsGet/fsQuery/fsCommit/wCreate/wUpdate`), `resolveActor`/`requireOrgOrGlobal`/`requireSessionCap` from the router, `oncoWriteEnabled(env)` gate.

**Gate.** `function oncoWriteEnabled(env){ return env && env.QUEUE_ONCO_WRITE === "1"; }` (mirrors `emrWriteEnabled`). Every mutating handler starts `if (!oncoWriteEnabled(env)) return json({error:"onco_write_disabled"},501);`.

**TDD steps.**
1. `onco-store.test.mjs`: `_snapshot(template)` deep-copies the template into the plan and a later template mutation does not change the snapshot (version-lock proof).
2. `_recordOverride` stores `{was,now,reason,by,at}` and throws if `reason` empty (override-needs-reason at the data layer).
3. Route smoke (against a Firestore test harness or mocked `fsCommit`): with `QUEUE_ONCO_WRITE` unset, every mutating route returns 501 and never calls `fsCommit`.
4. With gate on: create plan -> `lockedVersion` equals template version; confirm plan without a required override reason -> rejected; create cycle -> deterministic id; confirm cycle -> state `ready`; record admin -> `q_onco_admin` append + `qAudit` called; complete cycle -> state `done`.
5. Assert no PHI (patient name/mobile) in any `qAudit` meta or in any URL.
6. R1 clinical review on R-CHOP content (blocking).

**Recovery point:** tag `onco-p2`.

---

## Phase 3 - Protocol UI: matrix Overview + interactive dose drawer (flag-gated, CDP)

**Goal.** The Tata-style drug x cycle matrix as the primary doctor screen with a one-click contextual dose drawer. Read-only over a plan first.

**Create:** `onco-protocols.js` (`_buildOncoMatrix(plan) -> html`, drawer builder).
**Modify:** `opd-emr.js` (tab tuple, `_render` branch, `onClick` `onco-cell`/`onco-drawer-close`, `freshState` `oncoMatrix`/`doseDrawer`, export `_buildOncoMatrix`), `index.html` (script tag + token), `sw.js` (token).

**Interfaces.**
- Produces: `oncoTab(st) -> html` (uses `section()`, `<details class="oe-acc">`), `doseDrawerView(drawer) -> html` (lineage panel), pure `_buildOncoMatrix(plan)`.
- Consumes: `onco-dose.js` lineage, the plan object, `SMD_QUEUE_FLAGS.bool("smd_onco_protocols")`.

**Gating.** `oncoFlagOn()` wrapper mirroring `flagOn()` (opd-emr.js:410); `oncoTab` returns an empty/hidden state when off; tab tuple only pushed when needed (or always present but inert when flag off).

**TDD steps.**
1. Unit (`opd-emr.test.mjs`-style): `_buildOncoMatrix(fixturePlan)` returns HTML containing one row per drug and one column per cycle, and each cell button carries `data-oe-act="onco-cell:<cycleNo>:<drugId>"`.
2. Unit: `_render({tab:"onco", oncoMatrix:...})` includes the matrix; `_render` stays pure (no DOM/fetch).
3. CDP (`run-onco-ui.mjs`): open a patient on `tab:"onco"`, click a cell, assert the drawer opens with protocol dose + calculation + rounding + final, and that clicking a cell fires ZERO network requests (read-only drawer).
4. `node --test` green; CDP green.

**Recovery point:** tag `onco-p3`.

---

## Phase 4 - Patient Treatment Plan: apply protocol, review, confirm & activate

**Goal.** Apply an ACTIVE protocol to a real EMR patient, auto-pull params, review every line, override with reason, then physician confirm & activate.

**Modify:** `opd-emr.js` (apply-protocol `aiGroup` next to `provisional_diagnosis`, `onco-apply` action, review panel over `st.oncoDraft`, `confirmed()`-gated create-and-activate POST), `onco-protocols.js` (review builder, override capture).

**Interfaces.**
- Produces: `onco-apply:<protocolId>` handler stages `st.oncoDraft = { protocolId, params, calculatedDoses }`; review edits push `physicianModifications[]` with a required reason; `[Create & Activate]` -> `postWrite("/api/queue/onco/plan", body)` then `.../onco/plan/confirm`.
- Consumes: patient params from EMR (height, weight, BSA, age, labs, renal); `planDoses(lockedTemplate, params)`; the flag + `st.writeOn`.

**TDD steps.**
1. Unit: applying a protocol stages into `st.oncoDraft` and produces one calculated line per drug via `planDoses`.
2. Unit: editing a line without a reason leaves the confirm action disabled / rejected; with a reason, the modification is recorded as an override.
3. CDP suggest-and-confirm: apply protocol, assert NOTHING is POSTed until `[Create & Activate]`; assert exactly the plan-create + confirm calls fire on confirm, each behind a `confirm()` dialog.
4. CDP never-invent: a drug line with no source in the template renders "verify," not a fabricated dose.
5. Green unit + CDP.

**Recovery point:** tag `onco-p4`.

---

## Phase 5 - Cycle + clearance + nurse administration view

**Goal.** Cycle state machine (lean states), first-class pre-chemo clearance before READY, and the nurse execution screen with administration record.

**Create:** `onco-nurse.js` (or a section in `onco-protocols.js`).
**Modify:** `opd-emr.js` (nurse view render + `onco-start`/`onco-complete` actions), `functions/_onco_store.js` (clearance resolve, cycle confirm gating on clearance), `functions/api/queue/[[path]].js` (clearance + admin routes if not already in Phase 2).

**Interfaces.**
- Produces: nurse "Today's Chemotherapy" view (clearance banner + give-list + admin record table + complete-cycle), `POST /api/queue/onco/admin`, cycle `confirmCycle` blocked unless `clearance.status === "cleared"` and physician confirmed.
- Consumes: EMR labs for clearance checks (CBC/platelets, renal, liver, protocol-specific, prior-cycle status); the plan confirmed doses (nurse view never calculates).

**TDD steps.**
1. Unit: `confirmCycle` throws if clearance unresolved (cannot reach `ready`).
2. Unit: nurse view builder renders confirmed doses read from the cycle, and has no calculation code path (assert it never imports/calls `onco-dose`).
3. Unit: clearance status maps to green/amber/red banner correctly.
4. CDP: nurse records an actual dose + reaction, assert a single `q_onco_admin` write with a `qAudit`; complete cycle -> state `done`.
5. Green unit + CDP.

**Recovery point:** tag `onco-p5`.

---

## Phase 6 - Protocol PDF (2-page sheet from the plan)

**Goal.** Formal 2-page hospital PDF generated FROM the plan object, reusing the existing print/PDF mechanism.

**Create:** `onco-protocol-report.js` (`buildProtocolSheet(plan, opts) -> html`).
**Modify:** `opd-emr.js` (Print/PDF action calling `buildProtocolSheet` then the export helper), `index.html`/`sw.js` (token).

**Interfaces.**
- Produces: one `<!doctype html>...</html>` string, page 1 matrix + params, page 2 cycle detail + clearance + lineage trace + administration record + confirmation + disclaimer; reuses `PRO_CSS`.
- Consumes: the plan object; `window.SMD_NATIVE.sharePdfFromHtml` (native) / hidden-iframe `window.print()` (web).

**TDD steps.**
1. Unit: `buildProtocolSheet(fixturePlan)` returns a string starting `<!doctype html>` and containing both `.page` blocks, the drug x cycle matrix, and the safety disclaimer.
2. Unit: the PDF is built purely from the plan (assert the same dose numbers as the matrix, proving single source of truth, no recomputation in the builder).
3. Unit: no em-dash in the generated app-facing text.
4. CDP/manual: web print path opens the print dialog; native path is verified on device per the iOS build gotcha (find App.app, verify `?v=` token, uninstall then install).

**Recovery point:** tag `onco-p6`.

---

## Phase 7 - KB expansion (R1-gated waves)

**Goal.** Expand from R-CHOP to 130+ cancer diseases and their protocol library in R1-gated waves, grounded in the provided PDF + NCCN + textbook. Only after Phases 0 to 6 prove the pipeline.

**Create:** `kb/protocols/<id>.json` per regimen (many small files, never one aggregate, to dodge the 25 MiB Cloudflare deploy gotcha).
**Modify:** `kb/diseases/<id>.json` `protocolRefs[]`; optionally `kb/tools/build-coverage-matrix.mjs` to add a `protocolAvailable` dimension (deferred unless owner wants coverage tracking).

**Interfaces.**
- Produces: validated protocol templates, each with `source.nccn` + textbook citation (name only, no page numbers), lifecycle `active` only when R1-approved.
- Consumes: `onco-dose.js`, `_onco_store.js`, the UI/PDF from earlier phases (no new code per regimen, just data).

**TDD steps.**
1. Per wave: every new `kb/protocols/*.json` validates against `protocol.schema.json` (`validate-content.mjs`).
2. Per wave: a golden dose test for at least one drug in each new regimen (extends `onco-dose.test.mjs`).
3. Never-invent audit: every protocol has non-empty `source.nccn` and `source.textbook`; a script asserts no template ships without a citation (no citation -> cannot ship).
4. R1 clinical review per wave (blocking) before flag exposure.

**Recovery point:** tag per wave, e.g. `onco-p7-waveN`.

---

## Phase 8 - GHIS integration (draft-only, no silent writes)

**Goal.** Mirror the treatment plan / administration into GHIS only after the internal workflow is proven. Draft-only, clinician-confirmed, no silent writes.

**Modify:** `functions/api/ghis/[[path]].js` (or the onco routes) to add a draft-write path gated by BOTH `QUEUE_ONCO_WRITE` and the existing GHIS write env gate; `opd-emr.js` (a `confirm()`-gated "Send to GHIS (draft)" action).

**Interfaces.**
- Produces: a fail-closed draft write-back mirroring the existing GHIS Initial-Assessment draft route (501 when disabled), clinician-confirmed, never automatic.
- Consumes: the confirmed plan/cycle; the GHIS session/actor model.

**TDD steps.**
1. Unit: with the GHIS write env unset, the draft route returns 501 and never calls GHIS.
2. CDP: no GHIS call fires without an explicit clinician confirm; the payload is draft-status only.
3. Assert no PHI in URLs/logs on the GHIS path.
4. R1 + owner sign-off on scope (open item 5) before enabling.

**Recovery point:** tag `onco-p8`.

---

## Open items carried from the spec (block content phases, not scaffolding)

1. Exact textbook title for the citation label (needed to finalize `kb/protocols/*.json` `source.textbook` in Phase 2/7).
2. Regulatory/SaMD stance + disclaimer wording (PDF footer text, Phase 6).
3. Preferences: Mosteller confirmed as v1 default (DuBois deferred); default rounding policy per drug; confirmation there is no institution-wide cap (else add one as data).
4. Institution identity for approved variants (e.g. GIMSR) and R1/institutional approver.
5. Phase 8 scope: what (if anything) mirrors to GHIS.
