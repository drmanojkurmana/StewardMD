# Prescription Generator — Design

**Date:** 2026-07-11 · **Status:** Approved design. Build safety-critical core first (tested), then UI.

## Goal
When MaiK answers a **treatment** question, offer **"Create Prescription."** On tap,
generate an **editable** prescription: regimen lines with drug, brand, dose, frequency,
duration — doses/brands **from the deterministic Drug Index first**, AI-filling only
the gaps (clearly flagged). The doctor edits freely, then prints/exports a signed Rx.

## Non-negotiable safety principle
**Doses and brands come from the Drug Index (`drugs.js`) + management KB FIRST.** Only
when a drug is absent from those may an AI-proposed value appear — and it is rendered
in a distinct **"⚠ unverified — confirm"** style and must be confirmed by the doctor.
The generated Rx is always a **draft the prescriber reviews, edits, and signs** — the
doctor is the responsible signer. Rationale: an LLM will confuse look-alike doses
(lubiprostone 8 mcg BD for IBS-C vs 24 mcg for CIC); trusted doses must stay trusted.

## Agreed decisions
1. **Dose/brand source:** DB-first; AI fills gaps but flags them.
2. **Output:** on-screen editable Rx **+ print/PDF** with a signature block.
3. **Identity:** **require the doctor's NMC reg before any Rx** (block + prompt to set it);
   signature = signed-in doctor's name + NMC reg. Future: auto-link to the NMC registry
   by name/ID (schema leaves a `nmcLinked` slot).
4. Only triggered from treatment answers.

## Components

### 1. `rx-build.js` — pure regimen→Rx mapping (SAFETY CORE, unit-tested)
- `buildRxLines(regimen, drugIndex)` → `[{ drug, brand, dose, freq, duration, source, unverified }]`.
  - `regimen`: `[{ name|generic, dose?, freq?, note? }]` derived from the grounded
    treatment (`pkg.treatment.default.drugRefs` compositions + `pkg.refs.drug`) and/or
    the KB management text; non-drug lines (e.g. "lifestyle modification") pass through
    as advice lines (`isAdvice:true`, no dose).
  - Match each drug to `drugIndex` by generic/brand (case-insensitive, normalized).
    - **Match:** `dose` = Drug Index `dose`, `brand` = first non-class brand, `source:"db"`, `unverified:false`.
    - **No match:** keep the regimen's own dose if present else null; `source:"ai"` or
      `"none"`, **`unverified:true`**.
  - Never invents a dose silently — a null/absent dose stays null (blank for the doctor).
- Pure, dependency-free, exhaustively tested (match, brand pick, gap-flag, advice line,
  normalization, dose passthrough, empty input).

### 2. `prescription.js` — client controller + editable UI (`window.SMD_RX`)
- `SMD_RX.canPrescribe()` → NMC reg present? `SMD_RX.open(context)` → build + show sheet.
- Reads doctor name from `SMD_ACCOUNT.profile()`, NMC reg from `stewardmd_nmc_reg_<uid>`.
- **NMC gate:** if no reg, show a "Set your NMC registration number to prescribe" prompt
  with an input that saves to `stewardmd_nmc_reg_<uid>`; block Rx until set.
- Editable Rx sheet: patient name/age (optional, not stored), regimen lines
  (edit drug/brand/dose/freq/duration, brand-swap dropdown from Drug Index, add/remove,
  reorder), signature block (Dr. <name>, NMC: <reg>), date. Unverified lines flagged.
- **Print/PDF:** a print stylesheet + `window.print()` on a clean Rx layout (clinic
  header, patient, Rx lines, signature, disclaimer). No new dependency.

### 3. MaiK integration (`home.js`)
- In `maikRenderAnswer`, when the answer is a **treatment** answer (question/topic intent
  is treatment, or `pkg.treatment` present), append a **"℞ Create Prescription"** chip.
  Tap → `SMD_RX.open({ topic, pkg })`. Deterministic (0 tokens); no effect on non-treatment answers.

### 4. NMC reg profile field (`home.js` Settings)
- A "Prescriber details" row: NMC registration number input, saved per-uid. Read by `SMD_RX`.
- Future-proof: store `{ nmcReg, nmcName, nmcLinked:false }`; a later NMC-registry link
  fills `nmcLinked`/verifies by name+id.

## Data flow
```
MaiK treatment answer ──► "℞ Create Prescription" chip
   └─ SMD_RX.open({pkg}) ─► regimen from pkg.treatment/refs + KB mgmt
        └─ buildRxLines(regimen, SMD_DRUGS.list())  (DB-first, gap-flag)
             └─ editable Rx sheet (NMC-gated) ─► edit ─► print/PDF (signed)
```

## Privacy / legal
- Patient name/age are **optional and NOT persisted** (typed onto the printed Rx only).
- Rx is a prescriber-reviewed draft; disclaimer on screen + print: "Draft prescription —
  verify every drug, dose and interaction; prescriber is responsible."
- No patient data leaves the device.

## Testing
- **Unit (node):** `buildRxLines` — DB match sets dose/brand; no-match flags unverified;
  advice line passthrough; brand excludes class tokens; normalization (case/spacing);
  regimen dose passthrough when DB missing; empty/garbage input.
- **Client:** NMC gate blocks until set; chip appears only on treatment answers.
- **Manual smoke:** "IBS-C Rx" → lifestyle line + drug lines; DB drugs (e.g. lactulose)
  carry trusted dose/brand; non-DB drugs (lubiprostone/psyllium) flagged unverified;
  edit + print; blocked until NMC reg set.

## YAGNI / out of scope
- e-prescribing/transmission, pharmacy integration, drug-interaction auto-check inside
  the Rx (the existing checker stays separate), controlled-substance workflows,
  cloud-stored prescriptions.

## Files
- `rx-build.js` (pure core) + `rx-build.test.mjs`.
- `prescription.js` (`window.SMD_RX`, UI, print) + `index.html` include + `sw.js` CACHE bump.
- `home.js` (Create-Prescription chip in MaiK answers; NMC reg Settings row).
