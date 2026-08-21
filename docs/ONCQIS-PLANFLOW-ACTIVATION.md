# ONCqis treatment-plan flow: activation runbook

**Status:** the reference half of ONCqis (The Cancer Library) is live and default-ON. The
**treatment-plan half** (FIND applicable protocol -> patient-specific digital protocol -> cycles ->
administration -> EMR) is BUILT and tested but intentionally **content-dead**: no chemotherapy protocol
is published `ACTIVE`, so the FIND step honestly shows "no applicable ACTIVE protocol - none published
yet." This is a deliberate safety default, not a bug. Turning it on = putting real chemotherapy dosing
in front of clinicians, which is the highest clinical-liability action in the app and must be an
explicit owner decision on specific, clinically-verified protocol data.

This runbook is the exact, minimal path to go live. Do NOT skip the clinical-verification gate.

## Why FIND is empty today (root cause)

- `functions/api/queue/[[path]].js`
  - L42: `const ONCO_PROTOCOLS = { rchop: RCHOP_TEMPLATE };`  (registry has one entry)
  - L60: `activeStandardProtocols()` returns only protocols whose `status === "ACTIVE"`.
- The recommend engine (`onco-recommend.js`) only ever considers `status === "ACTIVE"` protocols and
  reads these fields off each protocol: `diseaseId`, `stage`, `treatmentSetting`, `treatmentIntent`,
  `lineOfTherapy`, `biomarkers`, `evidence`, `regimen`, `protocolVersion`, `status`.
- The 124 files in `kb/protocols/*.json` use a DIFFERENT (flat) shape: `drugs` (not `regimen.drugs`),
  `intentOptions` (not `treatmentIntent`), `lifecycleState:"draft"` (not `status:"ACTIVE"`), and none
  carry `evidence.core` / `clearanceChecks` in the shape the activation gate wants. So even the one
  registered protocol (rchop) cannot be recommended or activated as-is.

Net: making the flow work is a **schema-unification + clinical-activation** task, per the approved
design spec `docs/superpowers/specs/2026-08-12-oncology-protocol-engine-design.md`. It is NOT a flag flip.

## The activation gate (already enforced, do not weaken)

`functions/_onco_store.js` `_activationGate()` blocks CONFIRM -> ACTIVE unless ALL hold:
1. every drug has a computed `final` dose,
2. `evidence.core[]` present,
3. `clearanceChecks[]` present,
4. no unresolved VERIFY fields,
5. protocol is non-`experimental` AND `lifecycleState === "active"`,
6. physician confirmation explicitly recorded.

This gate is correct and is the last line of defense. Keep it.

## Go-live steps (per verified protocol)

For EACH protocol in the tranche a qualified oncologist has signed off on (the clinical review this
session verified the doses for FOLFOX-4, FOLFIRINOX, R-CHOP, BEP, TCHP - re-confirm before shipping):

1. **Author a Standard Protocol object** conforming to `kb/schema/standard-protocol.schema.json`
   (required: `id, name, disease, diseaseId, regimen, evidence, protocolVersion, status`). Map the flat
   `kb/protocols/<id>.json` into it: `drugs` -> `regimen.drugs`, add `treatmentIntent`/`treatmentSetting`/
   `stage`/`biomarkers` for matching, add `evidence.core[]` with real citations, add `clearanceChecks[]`,
   resolve every VERIFY field. Keep the verified doses byte-identical to the reviewed source.
2. **Set `status: "ACTIVE"` and `lifecycleState: "active"`, `experimental: false`** ONLY on the
   signed-off objects. Everything else stays draft.
3. **Register it** in `ONCO_PROTOCOLS` (L42) alongside `rchop`.
4. **Do it behind a recovery point:** branch + git tag before the change; land behind the existing
   client flags `smd_onco_protocols` + `smd_onco_recommend` (both default OFF) so you can pilot with a
   few accounts before flipping the flags on for everyone.
5. **Server flag** `QUEUE_ONCO_WRITE` is already `"1"`; the write path is cap-gated (EMR_TREAT doctor /
   EMR_VITALS nurse) + suggest-and-confirm. Leave it.
6. **Verify end-to-end** against the mock, then a pilot: FIND shows the protocol -> SELECT builds the
   patient-specific matrix with computed doses + full lineage -> CONFIRM & ACTIVATE passes the gate ->
   cycles/administration -> EMR write (still falls back to the Tata PDF until the GHIS oncology payload
   is captured and verified; see `writePlanToEmr`).

## What this session already fixed (so activation starts from a clean base)

- Cycle-count contamination in 9 protocols (a mg dose had leaked into `cycles`, e.g. durvalumab 1500)
  corrected to clinically-derived planned counts, plus a hard clamp (0..60) in `_onco_store.js` and
  `onco-protocols.js` so no future data leak can render a runaway matrix.
- Dose rounding: oxaliplatin and irinotecan increments made fine enough (5 / 10 mg) to keep error <5%.
- Cumulative anthracycline/bleomycin caps: now ENFORCED when the caller supplies prior exposure
  (`params.priorCumulativeByDrug`), mirroring the opt-in carboplatin cap. Wire this input into the plan
  flow (from the patient's prior-cycle history) when you build cross-encounter cumulative tracking.
