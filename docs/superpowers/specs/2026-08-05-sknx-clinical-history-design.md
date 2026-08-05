# SknX clinical history → LLM-reasoned differential

- **Date:** 2026-08-05
- **Module:** SknX (`vault/modules/SknX.md`)
- **Status:** design approved; spec for implementation planning
- **Flag:** rides the existing `smd_sknx_cloud` gate (def:false, validation-only). No new flag.

## Goal

Let the clinician optionally add a short structured **clinical history** (itch, scale, onset, danger
signs, site, ...) so the result reflects history + morphology, not the image alone. History does two
things: (1) feeds the existing deterministic red-flag/malignancy guardrail so danger signs force a
referral the image model can't trigger on its own (a real melanoma/cancer safety net); (2) is sent as
de-identified text to the existing LLM reasoner, which returns a history-adjusted differential + a
one-line rationale.

## Non-goals

- No new ML model / no retraining (that's a possible later phase, out of scope here).
- No raw image to the LLM (preserves sknx-llm invariant 1).
- History is never required; image-only stays a first-class path.
- Not a diagnosis. Educational, behind the validation flag.

## Flow (optional, either side)

- **Capture screen:** an optional "Add clinical history" affordance the clinician may fill before
  analyzing.
- **Result screen:** a "Refine with clinical history" button opening the same form; on submit, the
  analysis is re-run with the history and the result updates in place.
- History is saved with the case record and included in export (for validation).
- Any step is skippable; with no history the behaviour is exactly today's image-only path.

## Intake fields (all optional; chips/toggles, not a long form)

| Field | Options | Feeds |
|---|---|---|
| Itch | none / mild / severe | LLM |
| Scale | none / dry / greasy | LLM |
| Pain / tender | yes / no | LLM |
| Onset & course | acute (days) / subacute (weeks) / chronic (months) | LLM |
| Changing (size/color/shape) | yes / no | guardrail `evolving` + LLM |
| Bleeding / non-healing | yes / no | guardrail `bleeding`/`ulceration` + LLM |
| Rapidly growing | yes / no | guardrail `rapidGrowth` + LLM |
| Systemic (fever / mucosal / unwell) | yes / no | guardrail `systemicSymptoms` + LLM (SCAR) |
| Site | face · scalp · trunk · flexures · hands/feet · sun-exposed · widespread (multi) | LLM |
| Other (brief) | free text, "no names/IDs" reminder | LLM |
| Pigmented mole (optional expand) | asymmetry · border · color · diameter ≥6 mm | guardrail ABCDE |

The structured history is a plain object, e.g. `{ itch:"severe", scale:"greasy", onset:"chronic",
changing:true, bleeding:false, rapidGrowth:false, systemic:false, site:["flexures"], abcde:{...},
note:"..." }`.

## How history is used — two layers

### Layer 1 — deterministic guardrail (safety, always runs)

The danger-sign fields map to the engine's existing `features` object:
`changing→evolving`, `bleeding→bleeding`, `rapidGrowth→rapidGrowth`, `systemic→systemicSymptoms`,
plus ABCDE (`asymmetry`, `borderIrregular`, `colorVariegation`, `diameterMm≥6→diameter`, `evolving`).
`sknx-engines.makeAnalysis` already runs `redFlag(features)` and forces
`referral=true, rxEligible=false` on any red flag. So a benign-looking image + "changing + bleeding"
→ referral, regardless of the LLM. This is the melanoma/cancer safety net; it is not overridable by
the LLM.

### Layer 2 — LLM reasoning (the differential improvement)

Input (de-identified TEXT only): the image differential (labels + confidences) + the structured
history. Output: a **re-weighted differential restricted to the known condition vocabulary**, plus a
one-line rationale, plus an optional advisory "history suggests X (not seen on image) — assess"
that is display-only and can NOT set/clear referral. On any failure/offline → the image-only
differential is used unchanged (never blocks). Reuses the existing authenticated `functions/api/sknx`
Worker + `report-core.mjs` (a new `reason`/`rerank` action alongside `report`), same auth, rate limit,
no-body-logging, and no-image invariant.

## Result presentation (RESULTS FIRST — per owner)

Order top→bottom:
1. **Differential (primary).** If history was applied, show the history-adjusted list; a compact,
   collapsed "image-only" toggle lets the clinician see the delta (kept for validation).
2. **A specific finding, if any** — a referral or severe-reaction line. This is a RESULT (e.g. "Refer:
   possible malignancy" / "Possible severe reaction — check danger features"), kept visible but
   **concise** (one line + icon), not a full-width alert block.
3. **One-line rationale** when the LLM adjusted the list.
4. **Footer (concise, small):** a single muted line of caveats — "Experimental · educational, not a
   diagnosis · does not exclude skin cancer — correlate clinically." NO model names, sizes, or
   architecture in any user-facing copy (`Derm Foundation` / `HAM` / `59-condition` / `cloud model` all
   removed from the UI). The existing prominent experimental/cancer alert blocks are demoted into this
   footer line.

This reorder applies to the current result screen too (not just the history-adjusted view): the
differential leads; generic caveats become the concise footer.

## Safety invariants (extend sknx-llm's existing three)

1. No raw image to the LLM (unchanged).
2. LLM output can NOT override the deterministic guardrail: a referral stays a referral; `rxEligible`
   is only ever `!referral`.
3. LLM re-ranks WITHIN the known condition vocabulary; any out-of-vocabulary suggestion is advisory
   display text only, never a referral toggle.
4. De-identified: free-text is user-authored with a no-identifiers reminder; nothing else identifying
   is sent.
5. Educational framing + `smd_sknx_cloud` gate preserved. LLM re-ranking is a new diagnostic-influencing
   behaviour → requires R1 (clinical) + R2 (AI-safety) sign-off before the flag flips (same gate as the
   rest of SknX).

## Components / files

- **`sknx-history.js` (new):** the structured-history model + the intake form (render + read) + the
  `historyToFeatures(history)` mapping (pure, unit-tested). One clear purpose, no dependencies on the
  screens internals.
- **`sknx-screens.js`:** capture-screen "Add history" + result-screen "Refine with history" affordances;
  RESULTS-FIRST reorder + concise footer; render the history-adjusted section + rationale.
- **`sknx-screens.css`:** reordered layout; concise footer caveat style; demote the alert blocks.
- **`sknx-providers.js`:** thread an optional `history` through `analyze(image, entitlement, onStage,
  injected, history?)`; merge `historyToFeatures(history)` into `raw.features` before `makeAnalysis`
  (so the guardrail sees it on every engine, incl. cloud which sends `features:{}` today).
- **`sknx-engines.js`:** consumes `features` already; extend the `historyToFeatures` red-flag mapping if
  a field isn't covered. No guardrail-logic change beyond inputs.
- **`sknx-llm.js` + `functions/api/sknx/report-core.mjs` + `[[path]].js`:** a `rerank`/`reason` action:
  input {differential, history}, output {differential (in-vocab, re-weighted), rationale, advisory?};
  strict output validation (drop out-of-vocab conditions), offline fallback = input differential.
- **`index.html`:** add `sknx-history.js`; bump the sknx cache-bust token (sx10 → sx11).

## Testing

- `historyToFeatures`: each danger-sign field maps to the right `features` key (pure unit).
- Guardrail: benign image differential + `changing+bleeding` history → `referral:true, rxEligible:false`.
- LLM rerank contract: given a differential + history, returns an in-vocabulary re-weighted list; an
  out-of-vocab item is dropped/advisory; offline → returns the input differential unchanged.
- Invariant: an LLM rerank can NOT flip a referral case to `rxEligible`.
- Render: RESULTS-FIRST order; footer caveat is one concise line with no model names; history-adjusted
  section + image-only toggle present.
- CDP e2e (device): open form → submit history → adjusted result renders; red-flag history forces the
  referral line.

## Phasing

1. History model + `historyToFeatures` + guardrail wiring + the RESULTS-FIRST/footer reorder (no LLM) —
   ships the safety net + the UI fix, testable immediately.
2. The LLM `rerank` action + the history-adjusted differential + rationale.
3. (Later, out of scope) a trained image+history fusion model, if validation shows the rule/LLM layer
   is insufficient.
