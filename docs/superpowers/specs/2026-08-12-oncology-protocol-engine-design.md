# Oncology KB Expansion + Chemotherapy Protocol Engine — Design

**Status:** DRAFT for owner review. No code or clinical content is generated until this spec is approved.

**Goal:** Expand StewardMD's cancer coverage to full depth (all-cancer diseases: solid + heme + breast), and add a TATA-Memorial-style **chemotherapy protocol engine** that lets a clinician assign a regimen to a diagnosed patient, computing per-drug doses (BSA/AUC/etc.) and generating a cycle schedule — delivered as **reviewable, clinician-confirmed decision support**, never as an auto-generated order.

**Why:** Oncology is today the KB's biggest depth gap (130 Oncology diseases, only 3 with any treatment depth; cancer also spans ~290 Hematology + a Breast bucket). This turns "what is this cancer / what to rule out" into "here is the guideline-backed regimen and a computed, confirmable dosing plan."

---

## Global Constraints (bind every task in the plan)

- **Suggest-and-confirm, always.** Every computed dose and every cycle date is a DRAFT. The oncologist reviews, may edit, and must explicitly confirm each value before it becomes anything actionable. Nothing is auto-applied to a patient, auto-ordered, or auto-sent to GHIS.
- **Never invent.** No dose, schedule, drug, guideline, or citation appears unless it is grounded in a provided source (the licensed textbook and/or NCCN). Anything not verifiable against a source is surfaced as a "verify" flag, never guessed. This is the hard rule of the existing KB, made stricter for cytotoxics.
- **Correct dosing basis per drug — never "everything by BSA."** BSA (Mosteller) is the default for most cytotoxics; **carboplatin uses AUC/Calvert**; some agents are mg/kg; some are flat-dosed; some capped. The dosing basis is a per-drug field, not an assumption.
- **Citations:** show `NCCN <panel> (v<version>)` and the textbook as **"<Textbook name>"** only — **no page numbers** (per licensing instruction). Content is **original synthesis**, not reproduction or close paraphrase of the source prose.
- **Reversible + gated:** everything behind feature flag `smd_onco_protocols` (**default OFF**) + a git tag recovery point before each wave. Made permanent only on owner approval.
- **Clinical review is mandatory + blocking:** R1 (clinical safety) signs off every regimen batch and the dose-engine math; golden-regression protects the dose math from silent drift.
- **No PHI in logs/URLs.** Height/weight/creatinine/BSA are clinical data — handled per existing PHI rules; not logged, not put in URLs.
- **No em-dash in app-facing text** (existing convention).

---

## Non-goals (v1)

- Auto-prescribing or transmitting orders without clinician confirmation.
- Replacing pharmacy verification, or being the system of record for administration.
- Regulatory clearance (see "Regulatory" — flagged as an owner decision, not built here).
- Genomic/biomarker-driven regimen *selection* logic (we link biomarker-gated regimens, but selection stays the clinician's).

---

## Architecture

Five units, each testable in isolation:

1. **Regimen/protocol library** (`kb/protocols/*.json`) — the data: each regimen's drugs, dosing basis, schedule pattern, cycles, indications, source citations. This is also the "cancer KB content" deliverable.
2. **Dose engine** (`onco-dose.js`, pure functions, no DOM) — BSA (Mosteller + DuBois option), Calvert/AUC, mg/kg, flat; caps; rounding. Golden-regression tested. The dangerous core, isolated and hand-verified.
3. **Disease→protocol link** — maps KB cancer disease ids to applicable regimens (many-to-many), with intent (curative / adjuvant / neoadjuvant / palliative) and any biomarker gate shown as a note.
4. **Protocol UI** (in the OPD/EMR surface) — disease → pick regimen → enter height/weight (or type values manually) → see computed draft doses + schedule with the formula and inputs shown → clinician confirms each line.
5. **Patient assignment + scheduler** — from the confirmed plan, generate draft cycle dates (e.g. q21d × 6) editable for count-delays/holidays; optionally mirror the confirmed plan into the patient timeline as a draft note. Behind the flag.

---

## Data model — regimen schema (sketch, finalized in the plan)

```
{
  "id": "breast-ac-t",
  "name": "AC-T (dose-dense)",
  "indications": ["breast-cancer-her2neg-early"],   // KB disease ids / cancer types
  "intent": "adjuvant",
  "source": { "nccn": "Breast Cancer vX.YYYY", "textbook": "<Textbook name>" },
  "cycleLengthDays": 14,
  "cycles": 4,
  "biomarkerGate": "HER2-negative",                  // shown as a note, not auto-decided
  "drugs": [
    { "name": "Doxorubicin", "basis": "bsa", "dose": 60, "unit": "mg/m2", "route": "IV",
      "days": [1], "caps": { "cumulativeLifetime": { "warn": 450, "hard": 550, "unit": "mg/m2" } },
      "adjust": { "hepatic": "..." }, "notes": "..." },
    { "name": "Cyclophosphamide", "basis": "bsa", "dose": 600, "unit": "mg/m2", "route": "IV", "days": [1] }
    // ... carboplatin example would use "basis":"auc","auc":5 (Calvert), not bsa
  ],
  "premeds": [...], "monitoring": [...], "redFlags": [...]
}
```

---

## Dose computation rules (the core — every value is shown with its formula and requires confirm)

- **BSA (Mosteller):** `BSA = sqrt(height_cm * weight_kg / 3600)`. DuBois offered as an alternate.
- **BSA-based dose:** `dose = dose_per_m2 * min(BSA, cap)`. Cap default **2.0 m²** (owner-set), overridable only with an explicit reason (audited).
- **Carboplatin (Calvert):** `dose_mg = AUC * (GFR + 25)`. GFR via Cockcroft-Gault (needs age, sex, weight, serum creatinine), with a GFR cap (e.g. 125 mL/min). If creatinine is missing, the engine prompts — it does not assume.
- **mg/kg:** `dose = dose_per_kg * weight` (capping option).
- **Flat / fixed:** used verbatim from the regimen.
- **Rounding:** to a practical/vial increment (configurable per drug).
- **Cumulative caps:** track within-course cumulative dose; anthracyclines warn/hard-flag against lifetime limits, with a manual "prior anthracycline exposure" input for v1 (true lifetime tracking needs cross-visit history — a later phase).
- **Sanity bounds:** each drug carries a plausible min/max per-dose; a computed value outside bounds is flagged, not shown as final.
- Every computed dose renders **the formula, the inputs used, and the source** so the clinician can verify at a glance.

## Scheduling

- From `cycleLengthDays`, `cycles`, and each drug's `days`, generate cycle dates from a chosen start date → a draft calendar. Clinician edits for count recovery, holidays, delays. No auto-commit.

---

## Phases (the plan expands these into bite-sized tasks)

**Phase 1 — Dose engine + schema + seed regimens.** Build `onco-dose.js` (pure, golden-tested across BSA / Calvert-AUC / mg-kg / flat / caps / rounding) and the regimen schema, seeded with ~6 regimens chosen to exercise every dosing basis (e.g. AC-T, CHOP, FOLFOX, carbo/paclitaxel [AUC], a mg/kg agent, a flat-dose biologic). **R1 review + golden regression before anything else.** This proves the math is right on a small, hand-checked set.

**Phase 2 — Cancer KB + protocol library content (ultracode fan-out).** Expand all-cancer diseases (overview→management, cited) and populate the regimen library from the PDF + NCCN, in **waves by cancer type**, each wave: fan-out drafting grounded in specific PDF sections → adversarial clinical verification → **R1 sign-off** → merge → coverage-matrix rebuild → git recovery point. This is where the Workflow/ultracode fan-out runs, pointed at your source.

**Phase 3 — Protocol UI (suggest-and-confirm).** Disease → regimen picker → dose calculator (height/weight or manual) → draft plan with formulas shown → per-line confirm. Behind `smd_onco_protocols`. CDP test proves nothing is applied pre-confirm.

**Phase 4 — Patient assignment + scheduler.** Confirmed plan → draft cycle dates (editable) → optional draft mirror to the patient timeline. Heaviest safety gating.

---

## Sourcing & citation

- Content is **original synthesis** grounded in NCCN + the licensed textbook. No verbatim/near-verbatim reproduction of either source's prose (attribution is not a license; NCCN prose is copyrighted).
- Display: `NCCN <panel> v<version>` + `<Textbook name>` (no page numbers).
- **"Latest guideline":** guideline versions come from the provided sources. Assistant knowledge cutoff is Jan 2026; any version claimed beyond what the sources state is marked "verify version" for the owner, never fabricated.

---

## Testing & safety

- **Golden regression** for `onco-dose.js`: hand-verified cases per dosing basis, caps, Calvert, rounding. A change that alters any golden dose fails CI.
- **R1 clinical review** on the dose engine and every regimen wave (mandatory + blocking).
- **CDP UI test:** asserts a computed plan is never applied/ordered before explicit per-line confirm; manual edits survive; nothing writes to GHIS without confirm.
- **Never-invent assertion:** regimen/disease content with no source citation cannot ship.

---

## Regulatory (owner decision, flagged not built)

A tool that computes and assigns cytotoxic doses/schedules to patients is very likely a regulated medical-device (SaMD) function (CDSCO India; FDA/EU-MDR abroad). The suggest-and-confirm, clinician-in-the-loop model with visible formulas and a disclaimer is the defensible decision-support posture; auto-prescribing is not. Owner decides the regulatory stance; this spec assumes decision-support-only.

---

## Open items (needed before Phase 2 content generation)

1. **The PDF** on disk (path) + the **exact textbook title** for the citation label.
2. **NCCN** confirmed as the guideline source (was written "NCCM").
3. Regulatory/SaMD stance + the disclaimer wording to show in the protocol UI.
4. Preferences: BSA cap default (2.0 m²?), rounding policy, DuBois vs Mosteller default.
5. v1 scope of Phase 4: keep the plan in-app, or mirror a draft into GHIS?
