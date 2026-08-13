# Oncology Treatment-Plan System — Design Spec (v2)

**Status:** DRAFT for owner review. No code or clinical content is generated until approved.
**Supersedes:** v1 (dose-calculator framing). This v2 reframes the product per owner amendment (Tata-style longitudinal protocol + patient treatment-plan system).

## What we are actually building

Not a chemotherapy calculator. A **patient-specific oncology treatment-plan system** where:
- the **Tata-style protocol sheet** is the printable representation,
- the **interactive multi-cycle matrix** is the doctor's main view,
- the **cycle administration screen** is the nurse's operational view,
- and a single **Treatment Plan** object is the one source of truth behind all three (app, nurse view, PDF) and the EMR history.

**Core mental model:**
```
Protocol Template   = reusable clinical template (R-CHOP v2.1)
Treatment Plan      = patient-specific instance of a template (Rajesh Kumar -> R-CHOP v2.1)
Cycle Instance      = a scheduled instance of the plan (Cycle 3 / Day 1 / 20-Aug-2026)
Administration Record = what actually happened (planned vs actual, per drug)
Protocol PDF        = printable representation of the same Treatment Plan
```

Guideline source: **NCCN (nccn.org)** + the owner's licensed textbook. Citations show `NCCN <panel> v<ver>` + `"<Textbook name>"`, no page numbers, original synthesis only.

---

## Global Constraints (bind every task in the plan)

- **Single source of truth.** One Treatment Plan object drives the app UI, the nurse view, and the PDF. No duplicate dose logic, no separate PDF/nurse calculations.
- **Review-then-confirm-plan (not per-line confirm).** Every line (drug/dose/date) is *reviewable* and inspectable; the physician confirms the **treatment plan** (and each cycle before it goes READY). Any value that differs from the calculated value is an **override** requiring a reason, recorded with physician + timestamp (audit). This replaces v1's "confirm every line."
- **The engine flags; the clinician decides.** Dose-modification rules and clearance can flag/hold/recommend, but the system never independently decides to administer, never auto-orders, never auto-writes to GHIS.
- **Never invent.** No drug, dose, rule, schedule, guideline, or citation without a provided source (NCCN + textbook). Unverifiable values are surfaced as "verify," never guessed.
- **Dosing basis + caps are data, not assumptions.** Per-drug basis (BSA/AUC/mg-kg/flat). Caps are **protocol- or drug-defined** (`none | protocol | drug | institutional`) — there is **no universal hidden BSA 2.0 cap**.
- **Immutable version locking.** A Treatment Plan locks the exact Protocol Template version it was created from. Publishing a newer template version never alters existing plans or historical cycles.
- **Dose lineage is preserved end-to-end** (protocol -> calculated -> rounded -> modified -> confirmed -> administered).
- **Reversible + gated.** Behind flag `smd_onco_protocols` (default OFF) + a git recovery point per wave. R1 clinical review mandatory + blocking; golden-regression on the dose math.
- **No PHI in logs/URLs.** Height/weight/creatinine/BSA/labs handled per existing PHI rules.
- **No em-dash in app-facing text.**

## Non-goals (v1 of the product)

Auto-prescribing/administration; replacing pharmacy verification; being the administration system of record for the hospital; regulatory clearance (flagged, owner decision); automated regimen *selection* (biomarker gates are shown as notes, selection stays the clinician's).

---

## 1. Core entities (Phase 0 locks these)

**A. Protocol Template** (not patient-specific): `id, name (R-CHOP), version, lifecycleState, drugs[], cycleLengthDays, cycles, premedications[], supportiveCare[], monitoring[], doseModificationRules[], caps, source{nccn, textbook}, institution{provenance, approval}`.
Each `drug`: `name, basis (bsa|auc|mgkg|flat), dosePerUnit, unit, route, days[], caps{perDose?, cumulativeLifetime?}, roundingRule, modificationRules[], notes`.

**B. Patient Treatment Plan** (attached to the patient EMR): `id (TP-...), patientId, protocolTemplateId + lockedVersion, intent, patientParams{height, weight, bsa, age, sex, creatinine, renalFn, relevantLabs}, calculatedDoses[], physicianModifications[], confirmedDoses[], plannedCycles[], plannedDates[], status, confirmations[]`.

**C. Cycle Instance:** `planId, cycleNo, day, plannedDate, state, clearance{}, confirmedDrugs[], confirmedDoses[], administrationSequence[], holds/delays[], actualAdministration[]`.

**D. Administration Record** (per drug, per cycle): `planned, actual, startTime, endTime, nurse, reaction, notes, prepared, administered`.

Dose lineage (kept on every drug line):
```
Protocol dose -> Calculated -> Rounded -> Physician-modified -> Confirmed -> Administered
```
If any two differ, the reason is visible.

---

## 2. Architecture — one source of truth

```
                 PROTOCOL ENGINE (dose math, pure + golden-tested)
                              |
                       TREATMENT PLAN  (the single object)
                              |
          +-------------------+-------------------+
          v                   v                   v
      APP UI              NURSE VIEW            PROTOCOL PDF
   (interactive)        (execution)           (printable)
          +-------------------+-------------------+
                              v
                         EMR HISTORY (plan + actuals)
```
App and PDF share data, not presentation: the app is an interactive dashboard; the PDF is a formal hospital document. The PDF is generated FROM the treatment plan, never built first and embedded.

---

## 3. App UI

**Header (always):** `Mr. Rajesh Kumar | DLBCL, Stage III, Curative | R-CHOP v2.1, 6 cycles, Active`.

**Tabs:** `Overview | Cycle View | Dose Calculation | Clearance | Administration | Documents` with a `... | Print/PDF | Edit Plan` action.

**Overview = the longitudinal matrix (primary screen).** Drug rows x cycle columns, exactly like the Tata sheet:
```
Drug              Dose & Administration    C1     C2     C3   ...  Cn
Rituximab         375 mg/m2 IV             D1 ✓   D1 ✓   D1        D1
Cyclophosphamide  750 mg/m2 IV             D1 ✓   D1 ✓   D1        D1
...
Prednisolone      100 mg PO D1-5           D1-5✓  D1-5   D1-5      D1-5
```
Cells are interactive. Click a cell -> **dose calculation drawer** (contextual side panel), not a page change:
```
Cyclophosphamide
Protocol dose: 750 mg/m2   BSA: 1.54 m2
Calculation: 750 x 1.54 = 1,155 mg
Rounding (protocol-defined): 1,150 mg
Previous cycle dose: 1,150 mg   Modification: None
Final confirmed: 1,150 mg
[View calculation] [View protocol source] [View audit trail]
Confirmed by: Dr. ___
```
So the paper sheet's simplicity is preserved; the software power is one click away.

**Apply-Protocol workflow (how a plan is created):**
```
Diagnosis (DLBCL) -> Oncology -> Applicable protocols -> select R-CHOP
 -> auto-pull patient params from EMR (height, weight, BSA, age, labs, renal)
 -> calculate -> REVIEW (every line inspectable; overrides need reason)
 -> Create Treatment Plan -> Physician CONFIRM & ACTIVATE -> plan attached to patient
```

---

## 4. Nurse view (separate, execution-only)

"Today's Chemotherapy": patient / protocol / cycle / day, big **clearance status** (green/amber/red), then only what to give:
```
CLEARANCE  🟢 Cleared
1. Premedication              [Start]
2. Rituximab        700 mg IV [Start]
3. Cyclophosphamide 1,150 mg IV [Start]
...
ADMINISTRATION RECORD  actual dose | start | end | reaction | nurse
[ COMPLETE CYCLE ]
```
No manual calculation, no navigating the whole oncology system. Doctor sees intelligence (why this dose, what changed, parameters, cleared?); nurse sees execution (what/how much/route/when/administered/reaction).

---

## 5. Pre-chemotherapy clearance (first-class, before READY)

A cycle cannot reach READY until clearance is resolved: `CBC/platelets, renal, liver, protocol-specific tests, prior-cycle status, physician fitness-to-proceed` -> `🟢 CLEARED | 🟠 REVIEW REQUIRED | 🔴 NOT CLEARED`. Pulls from the EMR so the nurse never hunts for labs.

## 6. Cycle state machine

```
PLANNED -> DUE -> CLEARANCE -> PHYSICIAN CONFIRMED -> READY -> ADMINISTRATION -> COMPLETED
alt: HELD | DELAYED | MODIFIED | CANCELLED
```

## 7. Scheduling (auto, but visible and never silent)

Dates generated from protocol interval + start date (e.g. C1 20-Aug -> +21d -> C2 10-Sep ...). A delay recalculates future dates as a **proposal** shown to the physician; the schedule is never silently changed.

---

## 8. Dose engine (the dangerous core — pure, golden-tested)

- BSA Mosteller default (`sqrt(h_cm*w_kg/3600)`), DuBois alternate.
- BSA dose = `dosePerM2 * BSA`, then apply the drug/protocol cap **if the data defines one** (no universal cap).
- Carboplatin/AUC Calvert: `AUC * (GFR + 25)`, GFR via Cockcroft-Gault; prompts if creatinine missing.
- mg/kg, flat/fixed as specified.
- Rounding: protocol/drug-defined increment.
- Per-drug sanity bounds + cumulative-lifetime tracking (anthracyclines) with a manual prior-exposure input in v1.
- Every value renders formula + inputs + source.

## 9. Dose-modification rules (first-class)

```
Condition -> Check -> Possible protocol action: continue | reduce | hold | delay | discontinue | recalculate
```
The engine evaluates and **flags "review required"**; the physician decides. It never independently reduces/holds/administers.

## 10. Institutional protocols, lifecycle, version locking

- Provenance chain: `NCCN/reference regimen -> institutional review -> institution-approved protocol (e.g. GIMSR R-CHOP v1.3) -> StewardMD ACTIVE`. Reference provenance is never lost.
- Lifecycle: `DRAFT -> CLINICAL REVIEW -> APPROVED -> ACTIVE -> SUPERSEDED -> RETIRED`. Only ACTIVE templates are selectable for new plans.
- Version locking: a plan created on v2.1 stays on v2.1 forever, even after v2.2 publishes.

---

## 11. Printable Protocol PDF (best of both reference sheets)

Formal hospital document, generated from the Treatment Plan, looks nothing like the app.

**Page 1 — Protocol matrix:** header (Patient, MRN, Age/Sex, Diagnosis, Stage, Intent, Protocol+version, Planned cycles, Treatment Plan ID, Start date, Status) + patient-specific parameters (Height, Weight, BSA, Creatinine, Renal function) + the longitudinal drug x cycle matrix (day markers + per-cycle calculated dose) + Legend / Schedule / Safety notes.

**Page 2 — Cycle detail & administration:** cycle header (Cycle n of N, Day, Planned date, Status, BSA/weight/renal, physician status) + pre-chemo clearance table + dose-calculation trace/lineage (Drug | basis | inputs/formula | calculated | rounding/modification | final confirmed) + nursing administration record (Seq | drug | final confirmed | prepared | administered | actual | start | end | nurse | reaction) + physician confirmation & next-cycle + deviation/hold + safety disclaimer.

---

## 12. Sourcing, testing, regulatory (unchanged intent from v1)

- Original synthesis from NCCN + licensed textbook; cite by name, no page numbers; no verbatim reproduction.
- Golden regression on the dose engine; R1 clinical review on the engine and every regimen wave; CDP tests prove nothing is applied/ordered before physician confirm and that overrides capture a reason; never-invent assertion (no citation -> cannot ship).
- Regulatory: a plan-computing/scheduling tool is likely SaMD (CDSCO/FDA/MDR). Decision-support-with-clinician-confirmation posture + disclaimer; owner decides regulatory stance.

---

## 13. Implementation phases (revised)

- **Phase 0 — Data architecture + safety model.** The four entities, cycle state machine, version locking, provenance, dose-lineage shape. Pure schema + validation. (No UI.)
- **Phase 1 — Dose engine.** BSA/AUC/mg-kg/flat/rounding/protocol-caps, golden-tested + R1.
- **Phase 2 — 6-10 deeply verified protocols + the full workflow** (template -> plan -> cycle -> administration), tested end-to-end, not just the math. R1.
- **Phase 3 — Protocol UI.** Tata-style matrix Overview + interactive dose drawer. Flag-gated. CDP test.
- **Phase 4 — Patient Treatment Plan.** Apply protocol to a real EMR patient; review + confirm & activate.
- **Phase 5 — Cycle + clearance + nurse administration view.** State machine + clearance + administration record.
- **Phase 6 — Protocol PDF.** Two-page sheet generated from the same plan.
- **Phase 7 — KB expansion (ultracode fan-out).** 130+ cancer diseases + protocol library in R1-gated waves, grounded in the PDF + NCCN.
- **Phase 8 — GHIS integration.** Only after the internal workflow is proven; draft-only, clinician-confirmed, no silent writes.

## 14. Open items (needed before content phases)

1. Exact **textbook title** for the citation label (PDF is at `~/Downloads/StewardMD_Chemo_Protocol_Sheet_Tata_Inspired.pdf` + concept on Desktop; the actual clinical-content textbook PDF still to be provided for Phase 2/7).
2. Regulatory/SaMD stance + disclaimer wording.
3. Preferences: Mosteller vs DuBois default; default rounding policy; whether any institution-wide cap exists (else none).
4. Institution identity for approved variants (e.g. GIMSR) and who signs the R1/institutional approval.
5. Phase 8 scope: what (if anything) mirrors to GHIS.
