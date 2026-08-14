# StewardMD Oncology - Standard Protocol -> Treatment Plan Architecture

> Implementation plan. PLAN ONLY - no production clinical code is written until the owner approves this document. Everything ships behind OFF flags, reversible, R1-gated. Terminology: the operational object is a **StewardMD Standard Protocol** (never "NCCN/DeVita/Harrison Protocol"); no endorsement claims; no scraping/reproduction of copyrighted sources; VERIFY, never infer; StewardMD suggests, the physician decides; no silent select / reconcile / modify / activate / EMR-write.

**Goal:** Turn the existing onco chemo engine into a patient-specific protocol-recommendation + treatment-plan system: Patient/EMR -> diagnosis+phenotype -> recommend applicable Standard Protocols -> compare current evidence -> physician selects -> patient-specific digital protocol (Tata matrix) -> dose+date calc with full lineage -> physician edit/confirm -> Treatment Plan -> confirm & activate -> EMR -> nurse administration -> administration record.

**Approach:** Reuse the substantial engine already built (Phases 0-6 + Phase 8). Add only what is missing: a rich Standard Protocol schema, a recommendation/eligibility engine, layered evidence + guideline overlay + divergence UI, structured EMR write, and the full versioning/status lifecycle. Re-map the 15 preserved draft regimens into the new schema rather than mass-promoting them.

---

## 0. Current state (what already exists - do NOT rebuild)

| Capability | Where | Status |
|---|---|---|
| Dose engine (Mosteller BSA, Cockcroft-Gault, Calvert AUC, mg/kg, flat; per-drug/protocol caps; rounding; **dose lineage**; never-invent) + opt-in hardening (creatinine floor, AIBW, carbo cap) | `onco-dose.js` (+ `test/onco-dose*.test.mjs`) | Built, golden-tested, R1-cleared |
| Lifecycle store: Standard-Protocol-template snapshot -> Treatment Plan -> Cycle -> Administration; `_snapshot` (version-lock template into plan), `_canTransition` (planned/ready/administering/done/held), `confirmPlan` (applies overrides onto confirmed lineage), `_nurseTemplate` (strips dose formulas for nurse read), `_recordOverride` | `functions/_onco_store.js` (+ `test/onco-store.test.mjs`) | Built |
| Write-gated API routes (`QUEUE_ONCO_WRITE`, CAPS EMR_TREAT/EMR_VITALS/QUEUE_VIEW): `POST onco/plan\|plan/confirm\|cycle\|cycle/confirm\|cycle/clearance\|cycle/start\|cycle/complete\|admin`, `GET onco/plan` (doctor), `GET onco/cycle` (nurse) | `functions/api/queue/[[path]].js` | Built |
| Drug x cycle **matrix** + read-only dose drawer + apply/review/override panels (`window.SMD_ONCOUI`) | `onco-protocols.js` | Built (matrix exists; needs Tata header + recommend/compare flow) |
| Nurse execution view ("Today's Chemotherapy", zero dose-calc) | `onco-nurse.js` | Built |
| Tata-inspired 2-page PDF from the plan object | `onco-protocol-report.js` | Built |
| Standard Protocol template schema (skeleton) | `kb/protocols/rchop.json` + `index.json` | Built (thin - needs expansion) |
| Onco workbench: Home, staging, CTCAE, IO-tox, RECIST, tall-man, evidence, favorites | `onco-home.js` + `onco-{staging,ctcae,iotox,recist,tallman,evidence,favorites}.js` | Built, flag-OFF |
| 15 preserved draft protocol JSONs (of the 62+3 generated) | `docs/superpowers/onco-protocols-draft/*.json` | Preserved, NOT promoted |

**Implication:** objects B (Treatment Plan), C (Cycle), D (Administration), the dose lineage, suggest-and-confirm, nurse view, PDF, and snapshot-versioning are already in place and separated. The plan's new work is concentrated in object **A (rich Standard Protocol)**, the **recommendation engine**, the **evidence/guideline/divergence layer**, **structured EMR write**, and the **full status lifecycle**.

## Global Constraints (bind every task)

- StewardMD Standard Protocol terminology only; provenance shown, endorsement never claimed; no copyrighted-source reproduction/scraping.
- Never invent/infer a dose or a required field. Missing source support -> field value `VERIFY` (a real, visible state), never a guess.
- StewardMD suggests; physician decides. No silent select / evidence-reconcile / dose-modify / future-cycle change / activate / GHIS-EMR write.
- Full dose lineage always visible: protocol dose -> patient input -> calculated -> rounding/cap/mod -> proposed -> physician-confirmed -> administered. Original calculation is never destroyed.
- Four objects stay strictly separate: Standard Protocol / Treatment Plan / Cycle Instance / Administration Record.
- Standard Protocols are versioned + status-gated (DRAFT -> R1 CLINICAL REVIEW -> INSTITUTIONAL APPROVAL -> ACTIVE -> SUPERSEDED -> RETIRED). Existing Treatment Plans keep the exact version they were created with.
- Everything behind OFF feature flags; reversible; R1 review mandatory + blocking on any clinical logic/content; no PHI in logs/URLs.

---

## Multi-tenant / platform-agnostic architecture (no hard-coded hospital)

StewardMD Oncology is a hospital-agnostic platform (India-wide, many hospitals). No hospital is hard-coded as owner or approver. Three strictly-separated layers:

```
STEWARDMD CLINICAL PROTOCOL   (global, platform-owned, evidence-informed)
        -> HOSPITAL-SPECIFIC IMPLEMENTATION  (per-tenant overlay)
                -> PATIENT TREATMENT PLAN     (patient-specific instance)
```

- The StewardMD Clinical Protocol is owned by StewardMD. A hospital overlay never modifies the global protocol; it configures a tenant implementation of it: formulary, preferred drug/biosimilar, local availability, administration workflow, local approval requirements, local supportive-care + dose-modification policy (where institutionally approved).
- Reuses the tenant pattern ALREADY in the repo: `kb/schema/policy-overlay.schema.json` + `kb/policies/<HOSPITAL>.json` (e.g. `GIMSR.json`) already model "hospital as a keyed overlay". Hospital implementations follow the same shape, keyed by `hospitalId`.
- Versioning: core = `Breast HER2+ Stage II v2.1`; tenant implementation = `v2.1-<HOSPITAL>` (e.g. `v2.1-HOSPITAL-A`, `v2.1-GIMSR`). Same evidence, tenant-specific config. A hospital-impl becomes a different StewardMD core protocol only if the clinical evidence itself differs.
- Two approval axes (replaces the single "institutional approval"):
  - **CLINICAL APPROVAL** - StewardMD platform-level R1 + clinical governance of the global protocol version.
  - **HOSPITAL APPROVAL** - a tenant hospital's local sign-off of its implementation overlay.
- A new StewardMD core version NEVER silently overwrites a hospital's local implementation; Phase J batch impact runs at both core and per-hospital level, and the hospital decides.
- Existing Treatment Plans stay locked to BOTH the exact core protocol version AND the hospital-implementation version used at creation.
- GIMSR is only ever a configured tenant (like any hospital) - never hard-coded in schema/permissions/evidence/approval/UI. Existing GIMSR ASP-policy + GHIS integration is preserved as that tenant's data.

Schema impact (folds into Phase A): new `HospitalImplementation` object (`hospitalId`, `baseProtocolId`, `baseProtocolVersion`, overlay fields, `hospitalApprovalStatus`, version `vX.Y-<HOSPITAL>`); Standard Protocol carries `clinicalApprovalStatus` (platform) distinct from hospital approval; Treatment Plan carries `hospitalId` + `hospitalImplementationVersion` alongside `sourceProtocolVersion`; permissions add `INSTITUTIONAL_APPROVER` as a per-tenant role for any hospital; System Admin holds no clinical/hospital approval authority.

## Data model (the four objects + evidence)

### A. StewardMD Standard Protocol (reusable knowledge object) - `kb/protocols/<id>.json` (schema expanded)
Extends the current `rchop.json` shape with:
- Identity/indication: `disease`, `diseaseId`, `histology`, `stage[]`, `biomarkers` (e.g. `{HER2:"positive", ER:"negative", PR:"negative"}`), `treatmentSetting` (neoadjuvant/adjuvant/metastatic/…), `treatmentIntent` (curative/palliative), `lineOfTherapy`.
- Eligibility: `eligibilityCriteria[]` (structured, machine-matchable), `exclusionCriteria[]` (where source-supported; else omitted, not invented).
- Regimen (already present): `drugs[]` (basis, dosePerUnit, unit, days, route, caps, roundingRule, modificationRules, notes), `cycleLengthDays`, `cycles`, `premedications`, `supportiveCare`, `monitoring`, `clearanceChecks`, `doseModificationRules`, `intentOptions`.
- Evidence + status: `evidence` (see below), `protocolVersion` (semver), `status` (DRAFT/R1_REVIEW/INSTITUTIONAL_APPROVAL/ACTIVE/SUPERSEDED/RETIRED), `supersededBy`/`supersedes`, `clinicalReviewStatus`, `institutionalApprovalStatus`.
- Any required field a source does not support = literal `"VERIFY"` + a `verifyFields[]` list (blocks ACTIVE until resolved).

### Evidence / provenance model (per protocol) - layered, not flat
```
evidence: {
  core:        [{ source:"DeVita 12th ed", locator:"internal ref", fields:[...] }, { source:"Harrison 22nd ed", ... }],
  guideline:   [{ source:"NCCN <panel>", version:"<ver>", date:"<date>", status:"current|superseded", fields:[...], licensed:true }],
  institutional:[{ hospitalId, source:"<hospital> implementation overlay", version, approvedBy, date }],   // per-tenant, keyed by hospitalId; never a hard-coded hospital
  divergence:  [{ field, sources:[{name,version,value}], note, resolution:"clinical-review-required" }]
}
```
Rules: core evidence is not "permanently current"; a guideline overlay can mark a protocol `UPDATE AVAILABLE`; divergences are surfaced, never auto-reconciled.

### B. Patient Treatment Plan (already in `_onco_store.js`; extend)
Single source of truth for doctor view / nurse view / PDF / EMR. Adds: `sourceProtocolId` + `sourceProtocolVersion` (immutable snapshot), `patientPhenotype` (dx/stage/biomarkers/intent), `evidenceSnapshot` (the exact evidence shown at selection), `auditHistory[]`.

### C. Cycle Instance & D. Administration Record (already in `_onco_store.js`; keep). Extend audit only.

### Audit record (per override, never destroys original)
`{ field, original, modified, reason, physicianId, timestampServer }` - appended to `Treatment Plan.auditHistory`; the original calculated dose remains in the lineage.

---

## Phased tasks (each ends with an independently testable deliverable; unit + CDP tests; behind OFF flags; R1 on clinical logic/content)

### Phase A - Standard Protocol schema + validator + migration of preserved drafts
- A1. Define the expanded Standard Protocol JSON schema (above) + extend `kb/tools/validate-content.mjs` protocol validator (eligibility present, evidence layered, status enum, VERIFY fields flagged, dose-leak/never-invent rules, no endorsement strings).
- A2. Re-map the 15 preserved drafts (`docs/superpowers/onco-protocols-draft/`) into the new schema: fill what the source supports, mark every unsupported required field `VERIFY`, attach layered evidence (core=DeVita/Harrison lines). Output stays in a staging dir; nothing promoted.
- A3. Build the **inventory** (section 19): per candidate regimen -> disease/histology/stage/biomarker/line/intent/candidate-regimen/source-evidence/dose-completeness/guideline-status/institutional-status/R1-status. This is the artifact that decides Wave 1.
- Deliverable: schema + validator + 15 re-mapped drafts (all VERIFY-flagged) + inventory table. No promotion.

### Phase B - Protocol recommendation engine (NEW)
- B1. `onco-recommend.js` (pure, testable): input = patient phenotype (diseaseId, histology, stage, biomarkers, setting, intent, key clinical params); output = ranked list of ACTIVE Standard Protocols whose `eligibilityCriteria` match, each with match rationale + evidence status. Never auto-selects; "1 applicable protocol identified" still requires physician review.
- B2. Server route `GET onco/recommend` (QUEUE_VIEW read; reads ACTIVE protocols + patient phenotype). No writes.
- Deliverable: recommendation engine + route + unit tests (eligibility match/no-match, single-match still reviewable, ineligible exclusion).

### Phase C - Evidence layers, guideline overlay, divergence UI (NEW)
- C1. Evidence/provenance model in the schema (Phase A) + `onco-evidence.js` extended to render Core/Guideline/Institutional layers with version/date.
- C2. Guideline **overlay**: when a guideline entry marks a newer/preferred regimen, show `UPDATE AVAILABLE` (core vs current, why-differ, sources) with actions [CONTINUE STANDARD PROTOCOL] [SELECT UPDATED REGIMEN] [REVIEW EVIDENCE]. Never silently replaces.
- C3. **Evidence divergence** view: when sources differ, show EVIDENCE DIVERGENCE (source 1 / source 2 / difference / clinical-review-required) + physician selection recorded with which source/version supported the choice.
- Deliverable: layered evidence render + overlay + divergence UI (CDP-tested, flag-OFF).

### Phase D - Doctor flow: Find -> Compare -> Select -> patient-specific digital protocol (Tata matrix)
- D1. "FIND STANDARD PROTOCOLS" entry from the patient/EMR context (opd-emr onco tab) -> calls recommend -> APPLICABLE STANDARD PROTOCOLS list ([VIEW DETAILS][COMPARE][SELECT]).
- D2. COMPARE view (side-by-side regimens + evidence status).
- D3. On SELECT: generate the patient-specific digital protocol = Tata longitudinal matrix (patient/dx/stage/biomarkers/BSA/intent/protocol/version/cycles header + Drug x Cycle matrix with D1/D1-D5/D8 and X/Not-Scheduled), reusing `onco-protocols.js` matrix + `onco-dose.js`. Actions: [EDIT][VIEW CALCULATION][VIEW EVIDENCE][COMPARE GUIDELINE][PRINT/PDF][CREATE TREATMENT PLAN].
- Deliverable: doctor find/compare/select + patient-specific matrix (CDP-tested, flag-OFF).

### Phase E - Structured editing + audit
- E1. Structured per-cell/per-dose edit (not free-form): original calculated dose retained, modified dose + reason (select/enter) + physician + timestamp appended to auditHistory; lineage intact. Extends existing `_recordOverride`.
- Deliverable: structured edit + audit + tests (original never destroyed; override requires reason).

### Phase F - Treatment Plan create + confirm & activate (extend existing store)
- F1. [CREATE TREATMENT PLAN] from the patient-specific protocol -> `createPlan` (already snapshots the protocol version). Persist phenotype + evidenceSnapshot + sourceProtocolVersion.
- F2. [CONFIRM & ACTIVATE TREATMENT PLAN]: physician reviews the whole plan (cells reviewable, not each mandatory); pre-activation gate = required calcs complete + required evidence present + clearance info available + no unresolved VERIFY + physician confirmation recorded. Reuses `confirmPlan` + `_canTransition`.
- Deliverable: create + activate with the pre-activation gate + tests.

### Phase G - EMR structured write (extend routes; NO silent auto-write)
- G1. [ADD TO EMR] after activate: write structured fields where the existing GHIS/EMR integration supports them (diagnosis, treatment plan, regimen, cycle schedule, planned + confirmed meds/doses, dates, protocol version, physician confirmation, status); graceful fallback (PDF attach) where a structured field is unsupported. Reuses the write-gated route pattern; preserves NO_SILENT_AUTO_WRITE + PHI rules.
- Deliverable: structured EMR write path (write-gated, fallback, audited) + tests.

### Phase H - Nurse workflow + PDF (already built; wire to new plan)
- H1. Confirm `onco-nurse.js` renders per-cycle/day Today's Treatment from the activated plan (clearance, confirmed dose, route, START/ADMINISTERED, actual dose/times/nurse/reaction/notes -> Administration Record). Mostly done; verify against the new plan shape.
- H2. Confirm `onco-protocol-report.js` PDF is generated from the same Treatment Plan object (never recomputes a dose). Add the evidence/version + nursing-admin section per the Tata layout.
- Deliverable: nurse + PDF verified against the new plan (CDP-tested).

### Phase I - Versioning, permissions, first Wave
- I1. Status lifecycle transitions + review gates (DRAFT->R1->INSTITUTIONAL->ACTIVE->SUPERSEDED->RETIRED); new version never mutates an ACTIVE one; existing plans keep their snapshot.
- I2. Permissions: recommend/view = QUEUE_VIEW; create/activate = EMR_TREAT; nurse admin = EMR_VITALS; protocol authoring/approval = a new gated cap. Activation of any Standard Protocol to ACTIVE stays a human (R1 + institutional) gate.
- I3. **Wave 1**: from the Phase-A inventory, propose a small, fully-verified first set (chosen by clinical frequency + source completeness + safety + general-adult-oncology relevance + full verifiability) for R1 + your review. Start small and highly verified; do not pick a number arbitrarily.
- Deliverable: versioning + permissions + a proposed Wave 1 list for your approval.

### Phase J - Oncology Knowledge & Protocol Update Center (admin module) - NEW

The authoring/maintenance backbone that keeps the library current for years. Built into the existing **`admin/`** surface + **`functions/_adminauth.js`**, gated by a new cap **`ONCO_KB_ADMIN`** + flag **`smd_onco_kb_admin` (def:false)**. NOT exposed to ordinary doctors/nurses. AI = the approved Vertex/Gemini via the existing **`/api/ai/extract`** route (+ `_ai_usage.js` budget); it is an evidence-analysis + draft-generation assistant, NEVER the clinical decision maker.

**CRITICAL SAFETY PIPELINE (enforced structurally):**
`UPLOAD PDF -> AI ANALYSIS -> PROPOSED CHANGES -> HUMAN CLINICAL REVIEW (R1) -> INSTITUTIONAL APPROVAL -> NEW VERSION -> ACTIVATE`.
Structurally impossible path: `UPLOAD -> AI auto-modifies ACTIVE`. AI output only ever lands in a **Proposed Protocol Version** object; ACTIVE protocols are immutable to AI. Every write on this path is audited.

**New objects (Firestore + `kb/`):**
- **Evidence Source Document** - uploaded guideline/reference PDF + metadata (title, org, version, date, disease areas) + stored file + provenance. No scraping; you upload licensed docs.
- **Proposed Protocol Version** - an AI-drafted diff against a named ACTIVE Standard Protocol version; status `AI_PROPOSED -> R1_REVIEW -> INSTITUTIONAL_APPROVAL -> ACTIVE | REJECTED`; never mutates the ACTIVE doc.
- **Change Record** (per structured change) - `{ type: new-drug|removed-drug|dose|schedule|indication|biomarker|supportive-care|monitoring|other, field, oldValue, proposedValue, sourceLocation (exact page/section/line in the uploaded doc), aiConfidence, reviewerDecision: accept|reject|edit|VERIFY, reviewer, timestamp }`.
- **Update Impact Report** (batch) - one upload -> scan of all relevant ACTIVE protocols -> categorized results + counts.
- Full **audit trail**: upload -> AI analysis -> proposed changes -> reviewer decisions -> activation.

**Sub-phases:**
- J1. Admin shell + permissions: onco-KB admin section in `admin/`, `ONCO_KB_ADMIN` cap in `_adminauth.js`, protocol library with search/filter (by disease/stage/biomarker/status/review-due) + per-protocol version history (immutable prior versions). (caps 1,2,16,21 review-dates)
- J2. Evidence source library + upload: upload guideline/reference PDFs, store + metadata, list/search. Licensed uploads only; no scraping; no endorsement claims. (caps 3,4)
- J3. AI ingestion (reuse `/api/ai/extract`): extract document metadata, disease areas, regimens, doses, schedules, and clinically-relevant changes, EACH with exact source-location provenance; unsupported/unclear fields -> `VERIFY`, never hallucinated. New-drug detection when a drug is absent from the current KB. (caps 5,6,7,22,23)
- J4. Structured change detection + comparison vs ACTIVE: diff proposed vs currently-active Standard Protocol; classify each change (new/removed drug, dose, schedule, indication, biomarker, supportive-care, monitoring); detect evidence conflict/divergence across sources. Produces a **Proposed Protocol Version**, never edits ACTIVE. (caps 8,9,10,21,22)
- J5. Human review workspace: side-by-side old vs proposed; per-change accept/reject/edit/VERIFY; R1 clinical reviewer workflow then institutional approval workflow; activation only after required approvals. Immutable previous versions; existing Treatment Plans stay locked to their original version; new patients use the new ACTIVE version; existing patients get an `UPDATE AVAILABLE` notification (via Phase C overlay), never auto-modified. (caps 11,12,13,14,15,16,17,18,19)
- J6. **protocolUpdateJob (batch impact analysis)** - the maintainability core: on a new guideline upload, a server job compares it against ALL relevant ACTIVE protocols and emits an **Update Impact Report**, e.g.:
  ```
  NCCN Breast Cancer Guideline v2027 uploaded -> 17 Standard Protocols potentially affected
    4  dose/schedule change
    3  new treatment option
    2  indication change
    1  drug withdrawn
    7  no material change
  per protocol: NO CHANGE | UPDATE AVAILABLE | EVIDENCE DIVERGENCE | NEW DRUG | CLINICAL REVIEW REQUIRED
  ```
  The oncology committee then works the affected protocols from the report. No protocol is modified automatically. (caps 8,9,24 + the batch requirement)
- J7. Full audit trail + review-due dashboard: every upload/analysis/proposed-change/decision/activation logged immutably; protocols carry review dates + review-due status surfaced to the committee. (caps 20,24)

- Deliverable: admin update-center with the enforced upload->AI->propose->review->approve->activate pipeline, batch Update Impact Report, and full audit - all flag-OFF, no AI auto-modification of ACTIVE data, R1 + institutional gates mandatory.

---

## 24-area coverage map (section 23)

1. Modify: `onco-protocols.js`, `onco-evidence.js`, `functions/_onco_store.js`, `functions/api/queue/[[path]].js`, `kb/tools/validate-content.mjs`, `queue-flags.js`, `opd-emr.js` (onco tab entry).
2. New: `onco-recommend.js`, `onco-protocol-schema` docs, guideline-overlay + divergence UI (in `onco-evidence.js`/`onco-protocols.js`), inventory tool, draft->schema remap tool.
3. Schema changes: expanded Standard Protocol; Treatment Plan gains phenotype/evidenceSnapshot/sourceProtocolVersion/auditHistory (Firestore docs; additive, backward-compatible).
4-7. Standard Protocol / Treatment Plan / Cycle / Administration schemas: as in Data Model (A/B/C/D).
8. Recommendation engine: Phase B (`onco-recommend.js` + `GET onco/recommend`).
9. Evidence/provenance model: layered evidence object (Phase A/C).
10. Guideline overlay model: `evidence.guideline[]` + UPDATE-AVAILABLE overlay (Phase C).
11. Conflict-resolution UI: EVIDENCE DIVERGENCE view (Phase C).
12. Dose-engine integration: reuse `onco-dose.js` unchanged (lineage preserved); protocols feed it.
13. Tata longitudinal matrix UI: Phase D (extend `onco-protocols.js`).
14. Patient-specific protocol generation: Phase D.
15. Doctor edit/confirm workflow: Phase E + F.
16. PDF generation: Phase H (`onco-protocol-report.js`, from the plan object only).
17. EMR integration: Phase G (structured, gated, fallback, no silent write).
18. Nurse workflow: Phase H (`onco-nurse.js`).
19. Versioning: Phase I (status lifecycle + snapshot retention).
20. Audit trail: Phase E (+ existing `_recordOverride`), never destroys original.
21. Permissions: Phase I (CAPS model).
22. Test strategy: per phase - `node --test` unit tests for pure logic (recommend, schema validate, dose lineage, versioning) + real headless-Chrome CDP tests for each UI (find/compare/select, matrix, edit, overlay, divergence, nurse) + adversarial dose-verify + R1 clinical review on all protocol content; golden dose tests stay unchanged.
23. Migration/backward-compat: additive Firestore fields; existing (skeleton) rchop plan flow keeps working; the 15 drafts are re-mapped, not force-promoted; old Treatment Plans keep their snapshot.
24. Rollback/flags: new flags all def:false (`smd_onco_recommend`, `smd_onco_evidence_overlay`, `smd_onco_kb_admin`, plus reuse `smd_onco_protocols`); Phase J gated additionally by the `ONCO_KB_ADMIN` cap (not doctors/nurses); each phase independently revertable; git tags per phase; nothing to `main` until you approve.

## Phase J safety invariants (explicit)
- AI (Vertex/Gemini via `/api/ai/extract`) can ONLY write to a Proposed Protocol Version + Change Records; it can never touch an ACTIVE protocol, a Treatment Plan, or a dose in a live plan.
- Activation of any new protocol version requires R1 clinical review AND institutional approval (two human gates); no auto-activation.
- Every extracted change carries exact source-location provenance; unsupported fields = VERIFY; new drugs flagged, never silently added.
- Prior versions immutable; existing Treatment Plans locked to their snapshot; existing patients get UPDATE AVAILABLE (physician decides), never auto-modified.

---

## Integration: RTF workflow + video-recording Onco workbench = ONE system

Two things are merged into a single StewardMD Oncology system, not separate silos:
- Clinical Workflow + Knowledge Center (this plan's Phases A-J, matching your workflow RTF).
- The already-built Onco workbench from the video recording (reference tools): Onco Home hub, calculators/formulas (MEDCALC onco: BSA, CrCl/GFR, Calvert AUC, ECOG/Karnofsky, Khorana), AJCC/TNM staging, CTCAE toxicity grading, IO toxicity (irAE), RECIST response, drug info + interactions + tall-man, favorites.

How the workbench tools PLUG INTO the workflow steps (woven in, not bolted on):
- Staging (AJCC/TNM) + biomarkers -> the patient PHENOTYPE that drives the recommendation engine eligibility match (Phase B).
- Calculators (BSA/CrCl/Calvert/ECOG) -> patient PARAMETERS feeding the dose engine at the patient-specific dose+date step (Phase D).
- CTCAE toxicity grading -> a structured dose-modification reason in the physician edit (Phase E) + monitoring/clearance + the nurse "reaction" field (Phase H).
- IO toxicity (irAE) -> supportive-care/monitoring layer for immunotherapy regimens.
- RECIST -> longitudinal response assessment tracked across the Treatment Plan's cycle timeline.
- Drugs + interactions + tall-man -> the drug layer of every Standard Protocol + the Tata matrix rendering.
- Onco Home -> the single hub: reference tools (standalone) + "Find Standard Protocols" (clinical-workflow entry) + (admins only) the Knowledge Center.

## Deltas folded in from the workflow RTF (beyond the earlier plan)
- Evidence Layer 2 (current overlay) = NCCN AND ASCO AND ESMO AND peer-reviewed evidence, where legitimately available (not NCCN-only). Layer 1 core = DeVita / Harrison / approved textbooks. Layer 3 = hospital/institutional implementation overlay (any tenant, keyed by hospitalId; GIMSR is only one configured hospital, never the default owner).
- SOURCE-AGNOSTIC (RTF section 38): the architecture must NOT depend on NCCN's proprietary order-template format. The Standard Protocol is StewardMD's own object; it must operate on DeVita + Harrison + approved guidelines + institutional protocols and accept new authorized evidence later WITHOUT redesign. (This corrects the earlier NCCN-template-centric framing - NCCN is one optional evidence input, never a dependency.)
- "Why was this protocol suggested?" transparent rationale on every recommendation (phenotype + matching criteria + current evidence + supporting sources) - added to Phase B/D.
- Roles (Phase I permissions, explicit): Doctor / Nurse / Protocol Author / Clinical Reviewer / Institutional Approver / System Admin. System Admin does NOT automatically get clinical approval authority.
- Knowledge-update AI (Phase J) gets NO PHI: only the guideline PDF + the existing Standard Protocol; never patient name / MRN / clinical data. Patient-specific recommendation may use patient data internally via the app's approved PHI/security path.
- Machine-readable provenance per clinical rule: drug / dose / source / version / locator (page+section) / evidence-status / reviewed-by / protocol-version.
- Protocol review schedule fields: lastReviewedAt / nextReviewAt / reviewInterval / reviewedBy / evidenceVersion; status "REVIEW DUE" (review-due != invalid).
- Admin dashboard metrics (J1): ACTIVE / DRAFT / R1 / institutional counts, updates-available, guideline-uploads, clinical-review-required, protocols-due-for-review.
- Protocol Library table + actions (J2): disease / protocol / version / status / evidence / last-review / update-flag; VIEW / COMPARE / CREATE DRAFT UPDATE / VIEW SOURCES / VIEW HISTORY / RETIRE.
- THE GOLDEN RULE (governs the whole module): AI may discover, extract, compare, explain, propose. AI may NOT authorize, activate, prescribe, modify an ACTIVE protocol, or silently alter a patient's plan. The physician/institution is the decision authority.

## Phase J sub-phases aligned to the workflow (J1-J14)
J1 Admin Oncology Dashboard | J2 Protocol Library | J3 Evidence Library | J4 Guideline PDF ingestion | J5 AI evidence extraction (Vertex/Gemini via /api/ai/extract, NO PHI) | J6 Batch protocol impact analysis (Update Impact Report) | J7 Clinical diff (vN vs vN+1) | J8 Proposed version generation (never edits ACTIVE) | J9 Clinical review (R1) | J10 Institutional approval | J11 Activation | J12 Existing-patient UPDATE AVAILABLE notification | J13 Review-due system | J14 Audit/reporting.

## Sources: present vs needed (no scraping; you supply licensed material)
- Present + usable now: DeVita (full text), Harrison (full text), NCCN **Appendices A-I** (conventions/supportive-care/dose-math only), your Tata protocol sheet.
- Needed for NCCN-grounded regimen doses: the **per-disease NCCN Chemotherapy Order Template** documents and/or NCCN Guidelines - you download them (licensed) and drop them locally; I ingest, never scrape, never claim endorsement.
- Hospital/institutional layer: any hospital tenant's approved implementation overlay when provided (GIMSR is one such tenant, not the platform owner).

## What I will NOT do without your go
- Promote any of the 15 drafts to production KB.
- Mark any Standard Protocol ACTIVE (stays R1 + institutional human gate).
- Any EMR/GHIS write, any dose auto-modify, any guideline auto-replace.
- Touch `main` or ship any of this - all flag-OFF until you approve.

## Open decisions for you
1. Approve this architecture (or mark changes).
2. Wave 1 scope: approve starting from the inventory's most-verifiable, highest-frequency set (I will propose the specific list after Phase A's inventory) - not an arbitrary count.
3. NCCN/ASCO/ESMO guideline docs + any hospital's institutional protocol overlay: provide when ready to move protocols from "textbook-grounded, VERIFY" to guideline/hospital-grounded (any tenant, not GIMSR-specific).

**STOP - awaiting your approval of this plan before any production code.**
