# Insulin Management Module — Design Spec

- **Date:** 2026-08-02
- **Owner:** Diwakar (physician-owner)
- **Branch:** `claude/insulin-module`
- **Master flag:** `smd_insulin` (default **OFF**)
- **Status:** Approved for build (design). High-risk sub-modules default OFF, owner controls the gate.

## 1. Purpose

A native Insulin Management module for StewardMD: a clinical decision-support tool
for clinicians that recommends insulin doses/regimens transparently, always leaving
the final decision to the treating physician. It integrates into the existing app
(no standalone screen, no duplicated infrastructure) and matches StewardMD's design
language, theming, offline behavior, accessibility, and performance standards.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Patient data | **Extend `SMD_CASES`** with an `insulin` sub-object. Name/age/sex/notes only; **no MRN/DOB** (matches the app's deliberate no-PHI stance). Local + Firestore mirror, per-uid. |
| v1 scope | **Everything**: core calculators + pediatric + DKA + conversion + insulin DB + dashboard + safety engine + settings + tests. |
| Framing | **Active recommender, physician decides.** Tool proposes a dose/regimen; every recommendation is stamped AI-assisted; nothing is accepted without explicit physician confirm. |
| High-risk gating | DKA + pediatric ship behind sub-flags + `SMD_XACCESS` access-code gate, default OFF. Owner flips flags. |

## 3. Safety contract (drives every screen)

1. Persistent banner on every recommendation: **"AI-assisted recommendation — the treating physician makes the final decision."**
2. **Confirm-before-accept** on every dose. Nothing auto-applies. The module never writes or changes a prescription (honors the FollowCare rule).
3. **Full transparency**, no hidden math: input summary → formula → intermediate values → rounding (pre & post) → result → assumptions → clinical notes → references. Rendered via the live `{html}` result path in the calculator registry.
4. Critical warnings (hypoglycemia risk, max-dose exceeded, insulin stacking) **hard-interrupt** and require explicit acknowledgment before confirm is enabled.
5. DKA + pediatric use **institution-configurable protocol objects**, never hardcoded magic numbers, and their flags stay OFF until the owner enables them.

## 4. Architecture — strict layer separation

All buildless ES5 IIFEs, `?v=goldNNN` cache-bust, assembled by `scripts/build-www.sh`.

| Layer | File | Responsibility | Testable headless |
|---|---|---|---|
| Calc engine | `insulin-engine.js` | Pure dose math. No DOM/storage. Returns full step breakdown. | ✅ `node --test` |
| Safety engine | `insulin-safety.js` | Pure. `(context, input, result) → typed, severity-ranked warnings`. | ✅ |
| Insulin DB | `insulin-db.js` | Pure data array (rapid → short → intermediate → long → ultra-long → premix → concentrated). Update without code changes. | ✅ |
| Conversion | `insulin-convert.js` | Guided, protocol-configurable switch workflows. | ✅ |
| Data/storage | extends `SMD_CASES` `insulin` sub-object + append-only dose log | Persistence + audit trail. | ✅ |
| Flags | `insulin-flags.js` | `smd_insulin` master (OFF) + `smd_insulin_dka` / `smd_insulin_peds` sub-gates. | ✅ |
| UI shell | `insulin.js` + `insulin.css` | Overlay module `window.INSULIN = {open, close, isOn}`. motion.dev transitions. | browser test |

Engine/safety/DB/conversion are pure and independently testable. Registered
calculators are also reachable via the existing `MEDCALC.run(id, inputs)` headless API.

## 5. Data model

Extend the case object (rides existing local + cloud persistence):

```
insulin: {
  dxType, pregnancy, renal, hepatic, steroids, regimen,
  tdd, icr, isf, targetGlucose, maxBolus, maxDaily, dia, units
}
```

**Dose history = append-only audit log**, `users/{uid}/insulinDoses/{id}` (local +
Firestore, private per-uid via existing `firestore.rules`):

```
{ inputs, outputs, calculatedDose, confirmedDose, editedDose,
  uid, ts, warnings[], engineVersion, calcId }
```

## 6. Calculation engine

Every function returns:

```
{ result, unit, rounded, steps:[{label, expr, value}],
  formula, assumptions:[], clinicalNotes:[], refs:[] }
```

Functions: meal bolus · correction · combined (with IOB subtraction) · **IOB /
active insulin** (linear + curve model; the model used is a stated assumption) ·
weight-based basal/TDD initiation · ISF/ICR (extends existing `insulin_rules`;
exposes 1800-vs-1500 and 500-vs-450 rule choice as a stated assumption) · pediatric
*(gated)* · DKA *(gated, protocol object)*. Rounding configurable 0.5 / 1 unit; both
pre- and post-rounding values shown. Canonical unit mg/dL with inline `/18` mmol/L
conversion echoed in output (matches app convention).

## 7. Safety engine — warning taxonomy

Severities: `info · caution · warning · critical`. Detects: hypoglycemia, severe
hyperglycemia, missing required inputs, IOB stacking, large correction dose,
pregnancy, pediatric, renal impairment, liver disease, exercise adjustment,
max-dose exceeded, unknown/absent insulin params. `critical` → interrupt +
acknowledge before confirm. Color-coded to existing theme tokens.

## 8. UI (motion.dev, deliberately not templated)

Overlay module reusing `window.Motion` (spring transitions, `prefers-reduced-motion`
safe — mirrors `dialog-motion.js` / `syndromes-motion.js`). Screens:

- **Dashboard** — patient summary, current & target glucose, active insulin (IOB),
  recent calculations, quick actions, dose history, safety alerts.
- **Calculator** — large touch targets, steppers/chips over typing, live transparent
  step panel, confirm gate.
- **Insulin select / compare** — pick current + intended insulin, concentration,
  device; side-by-side comparison; selection influences timing + safety messaging.
- **Conversion** — current insulin → dose → target → reason → suggested regimen
  (configurable protocol) → monitoring advice → follow-up. Never raw math; explains
  assumptions; requires confirm.
- **Settings** — units (mg/dL / mmol/L), rounding (0.5 / 1u), target glucose, max
  bolus, max daily dose, institution defaults, theme integration.

Dark/light via existing CSS vars, offline via localStorage, responsive phone + tablet.

## 9. Insulin database (Phase 2 data)

Data-driven array; each insulin: generic name, brand names, manufacturer, class,
strength (U100/U200/U300/U500), onset, peak, duration, injection timing, route,
device compatibility, pregnancy info, pediatric approval, renal/liver
considerations, storage, clinical notes, references, regional availability
(India, US, UK, Australia, Canada, Middle East). Searchable by generic, brand,
manufacturer, concentration, country, class. Designed for updates without code changes.

## 10. Flags, navigation, registration

- `insulin-flags.js`: `smd_insulin` (default OFF) + `smd_insulin_dka` / `smd_insulin_peds` (default OFF, access-gated).
- Home tile in `home.js` `rnav-grid`, flag-gated inline (mirrors KardioX tile).
- Dispatch via `ACT` map in `home.js`; optional `SMD_XACCESS.gate` for high-risk sub-modules.
- Scripts registered in `index.html` (flags before module, both `defer`, after `home.js`).
- Git recovery tag before the flag is ever defaulted on.
- Add `vault/modules/Insulin.md` note (flag+default, key files, deps, gotchas).

## 11. Testing

- Unit: engine + safety, edge cases (zero, negative, extreme glucose, missing inputs).
- Golden-regression cases for every calculator (locked expected outputs).
- Offline (localStorage), integration, validation.
- Headless-browser UI test (CDP / `run-abx-ui.mjs` harness) before any "it works" claim.

## 12. Build sequence (backend first)

1. `insulin-engine.js` + unit tests
2. `insulin-safety.js` + unit tests
3. Data model + dose log + audit + tests
   — **demo checkpoint: engine + one calculator screen wired end-to-end**
4. Remaining calculators + dashboard + settings
5. Insulin DB + comparison + selection
6. Conversion
7. Gated DKA + pediatric (protocol-configurable, owner flips flag)

## 13. Future-proofing (no refactor required later)

Engine stays pure; the case `insulin` context object is the single source of truth.
CGM / OCR / AI-assisted / Health Connect / Apple Health / FHIR / multilingual all
feed the same context object or read the same engine outputs — additive, not a rewrite.
