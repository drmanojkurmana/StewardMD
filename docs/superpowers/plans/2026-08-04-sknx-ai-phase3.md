# SknX AI — Phase 3: Clinician-Confirmed Rx + Consent + R1 Gate — Plan

> Phase 3 adds the ONE clinically-loaded capability the owner asked for: a prescription affordance.
> It is built **reversible and OFF by default** behind its own flag `smd_sknx_rx`, and it NEVER
> prescribes autonomously. The Rx pad is the existing, already-shipped `window.SMD_RX` (prescription.js) -
> SknX only assembles a KB-grounded *draft regimen* that a verified clinician confirms, edits, and signs.
> The flag stays OFF until R1 (clinical) sign-off; this phase does not flip it.

**Goal:** When (and only when) the analysis is `rxEligible` (general inflammatory/infective read, NOT a
referral/malignant lesion) AND the user is a verified prescriber AND `smd_sknx_rx` is on, offer a
"Draft prescription" action on the result screen that opens `SMD_RX.open()` pre-filled with an
educational, KB-grounded first-line regimen for the top differential. Everything is clinician-confirmed.

**Hard clinical guardrails (each has a test):**
1. **Never on referral/malignant.** If `analysis.referral === true` or `analysis.rxEligible !== true`,
   there is NO Rx affordance, at any entitlement, with any flag. (Reuses the Phase-1 malignancy guardrail.)
2. **Never autonomous, never patient-facing.** SknX only *drafts*; `SMD_RX.open()` requires the clinician
   to confirm/edit/sign. `SMD_RX.canPrescribe()` (doctor verification via SMD_VERIFY/NMC) must be true.
3. **KB-grounded, no invented drugs.** The draft regimen comes only from the curated
   `SKNX_RX_REGIMENS` map (R1-reviewable, first-line educational options with class + typical form),
   never from the LLM. If a differential has no curated regimen, no draft is offered (referral/advice only).
4. **Flag OFF by default** (`smd_sknx_rx` def:false); flipping requires R1 clinical review + R3-DPDP
   consent sign-off (documented in the decisions log and vault). This phase must not flip it.

**Global constraints (inherit Phase 1/2):** ES5 IIFE + dual export; `window.SMD_SKNX_*`; no em-dash in UI;
behind `smd_sknx` + v2beta + the new `smd_sknx_rx`; tests `node --test test/sknx-*.test.mjs`; the CDP e2e
(`test/run-sknx-ui.mjs`) must still prove NO `.sknx-rx` on a melanoma/referral case, and now ALSO prove an
Rx draft affordance appears ONLY on a benign rxEligible case when the flag+verification are on.

---

### Task 1: `sknx-flags.js` - register `smd_sknx_rx` (OFF)
**Files:** modify `sknx-flags.js`, `test/sknx-flags.test.mjs`.
Add `smd_sknx_rx: { type:"bool", def:false, query:"sknxrx" }` with a comment that the flag is R1-gated
and must not ship on without clinical sign-off. **Tests:** defaults false; `?sknxrx=1` / localStorage "1" enable it.

### Task 2: `sknx-rx.js` - KB-grounded draft-regimen assembler + eligibility gate
**Files:** create `sknx-rx.js`, `test/sknx-rx.test.mjs`.
**Interface:**
- `SMD_SKNX_RX.eligible(analysis, deps) -> bool` - true ONLY when `analysis && analysis.rxEligible === true
  && analysis.referral !== true && flag smd_sknx_rx on && deps.canPrescribe()`. `deps.canPrescribe` defaults
  to `window.SMD_RX && SMD_RX.canPrescribe`. (Pure/injectable so it is node-testable.)
- `SMD_SKNX_RX.draftFor(label) -> { topic, regimen:[{name, class, form, note, isAdvice}], sources:[] } | null`
  from a curated `SKNX_RX_REGIMENS` map keyed by normalized condition (psoriasis, eczema, acne, tinea,
  urticaria, impetigo, rosacea, contact dermatitis, ...). Each regimen is a first-line educational option
  (class + typical topical form, NO patient-specific dose - the clinician sets that in the pad). Conditions
  that must refer (melanoma/bcc/scc/cellulitis) return `null`. `sources` reuse `sknx-evidence.retrieve([label])`.
- `SMD_SKNX_RX.openDraft(analysis, deps)` - guard with `eligible()`; if ok, `SMD_RX.open({ topic, regimen })`
  from `draftFor(topDifferential.label)`; else no-op. Never throws.
**Tests:** `eligible()` false when referral true / rxEligible false / flag off / not a prescriber (each case);
true only when all hold. `draftFor("melanoma") === null`; `draftFor("psoriasis")` has >=1 regimen entry, each
with a `class`, and its `sources` all carry a url. NO hardcoded patient dose string (assert no `/\d+\s?mg/` in
any regimen `name`/`note`). `openDraft` on a referral analysis calls SMD_RX.open ZERO times (spy dep).

### Task 3: wire the guarded Rx affordance into the result screen
**Files:** modify `sknx-screens.js` (result screen), `index.html` (register `sknx-rx.js` after `sknx-report.js`),
extend `test/run-sknx-ui.mjs`.
Only when `SMD_SKNX_RX.eligible(analysis)` is true, render a single secondary action
`<button class="sknx-rx" data-act="sknx-rx-draft">Draft prescription</button>` (this is the FIRST time a
`.sknx-rx` element may exist - the Phase-1/2 e2e that asserts its absence now asserts absence *on referral*
and presence *only* on an eligible benign case with flag+verification on). Clicking calls
`SMD_SKNX_RX.openDraft(analysis)`. A one-line consent/education note sits under the button ("Draft only.
You confirm, edit, and sign every prescription. Not patient facing."). **Tests (e2e):** with `?sknx=1&sknxrx=1`
and a stubbed verified prescriber, a benign mock shows exactly one `.sknx-rx` draft button; the melanoma mock
shows ZERO `.sknx-rx`; clicking the draft button invokes `SMD_RX.open` (stub/spy).

### Task 4: consent + DPDP + R1 gate documentation (no flag flip)
**Files:** `vault/modules/SknX.md` (create/update), `vault/decisions/Decisions.md` (append the Rx-gate decision),
`docs/superpowers/specs/2026-08-03-sknx-ai-design.md` (note Phase-3 delivered, flag OFF pending R1).
Record: `smd_sknx_rx` ships OFF; the blocking conditions before it can ever flip on
(R1 clinical review of `SKNX_RX_REGIMENS`; R3-DPDP consent + retention note for any stored prescription;
R7 release gate). No code flips the flag here.

## Self-review checklist
- Rx affordance impossible on referral/malignant or without verification/flag (Task 2 + Task 3 tests).
- Draft regimens are curated + cited, never LLM-sourced, never a fixed patient dose (Task 2 tests).
- The Phase-1/2 e2e still passes (no `.sknx-rx` on melanoma), plus the new eligible-only presence test.
- `smd_sknx_rx` def:false; the flag is NOT flipped; R1/R3/R7 gate documented.

---

## R1 clinical review — VERDICT: GO (merge as flag-OFF, R1-gated scaffold)
Reviewed 2026-08-04. Malignancy referral guardrail (`sknx-engines.js`) untouched; eligibility gate triple-layered and correct; flag ships OFF (no production flip); 87 sknx unit + 23 CDP e2e green.

**Addressed in this branch (post-review hardening):**
- HIGH: `eligible()` now also requires `analysis.lesion` (the v2beta dual-engine malignancy screen must have RUN and cleared) - no Rx on a tier without the screen.
- MED: pad dose-injection - REGIMENS drug names kept qualified (never a bare generic); a test locks the contract.
- MED: potent-steroid site caveat (psoriasis) + retinoid pregnancy caveat (acne) added as advice lines.
- LOW: impetigo aligned to NICE first-line (topical hydrogen peroxide) + "widespread/bullous -> oral" caveat; tinea "scalp/nail -> oral" caveat.

**Pre-flip conditions (BEFORE `smd_sknx_rx` is ever flipped on - not required for this flag-OFF merge):**
1. R1 clinical sign-off on the final `REGIMENS` map (incl. the caveats above).
2. R3-DPDP review: the pad writes prescriber/clinic identity and the draft topic is a diagnosis.
3. R7 release gate: consider an access-code/entitlement gate for `smd_sknx_rx` (as ThoreX/KardioX use) rather than a bare URL/localStorage flip.
4. stewardmd-security-reviewer pass on the Rx path before flip.
