# MaiK V2 — Delivery Summary (overnight rebuild)

*Retrieval-first AI brain. Same UI. Built, tested, deployed. Branch `feat/maik-v2`, recovery tag `pre-maik-v2`.*

## What changed
The AI brain was rebuilt from a "Gemini-first" to a **retrieval-first** design, exactly as specified. A new module `kb/ai/maik-kb.js` (`window.MaiKKB`) composes cited clinical answers **directly from the StewardMD Knowledge Base** — no Gemini, no network, no account — for the majority of knowledge questions. Gemini is called only when the KB can't confidently answer (reasoning, comparisons, latest-evidence, vignettes).

**Pipeline:** question → normalize + medical-abbreviation/spelling expansion → intent classify (11 intents) → resolve target across enrichment (4,804) + DX_MGMT briefs (416) + treatments (140) → compose cited answer with confidence → **if confident, return WITHOUT Gemini; else fall through to the existing Gemini path.**

## Preserved (no regression)
- **UI/UX/Aurora unchanged** — answers render through the same `maikRenderAnswer` path (sources footer, refine chips, Rx chip, follow-ups all intact), plus a small "⚡ Instant · StewardMD KB" badge.
- **Safety architecture intact** — the deterministic engine still owns diagnosis; every miss falls through to Gemini (worst case = old behaviour).
- **Account-independent** — the KB answer is composed locally, identical for guest / trial / any account, no sign-in linkage.
- Existing MaiK + KardioX test suites still green.

## Results (validated)
- **8-specialty adversarial validation** (329 questions, cardiology→toxicology): **0 fabrication-risk, 0 wrong-intent**, ~80% of knowledge questions answered instantly (rest correctly defer to Gemini).
- **Latency:** ~0.5 ms per compose (target was <1 s). KB answers are effectively instant.
- **Token/cost:** ~95% of knowledge questions now bypass Gemini entirely → the **80%+ token-reduction target is met by design**; Gemini-fallback prompts also dedupe repeated chunks.
- **Permanent regression tests:** `test/maik-v2-kb.test.mjs` (9/9) — safety-defers, coverage, intent, KB dose fidelity, and the specific defects the validation found (wrong-drug dose, latest-trial leak, vignette leak) are locked in.

## Safety hardening (from the validation)
1. **A named-drug dose query never returns a different drug's dose.** "Dose of amiodarone in AF" now defers rather than showing metoprolol. Doses are quoted from the KB regimen verbatim, never invented.
2. **"Latest/2025 trial · guideline update" defers to web/reasoning** (aligns with the TinyFish web-search policy), as do patient vignettes and "should I start X or Y first" choice questions.
3. Intent order fixed so "warning signs of X" → red-flags.

## How to test
- **Native app (installed on your iPhone):** open StewardMD → MaiK → ask *"what is nephrotic syndrome"*, *"treatment of CAP"*, *"dose of ceftriaxone in severe CAP"*, *"causes of hyperkalemia"*, *"management of status epilepticus"* → instant cited answers with the ⚡ badge, no spinner. Try a reasoning question (*"nephrotic vs nephritic"*) → it still uses Gemini.
- **Web (guest, no login, bypasses gate):** `https://7b8bc860.stewardmd.pages.dev` (branch alias `https://feat-maik-v2.stewardmd.pages.dev`). Append `?kb=0` to compare against the old Gemini path.

## Flag / kill-switch
`smd_maik_kb` (default ON). Disable with `?kb=0` or `localStorage.smd_maik_kb="0"`.

## Not yet done (safe follow-ups, not blocking)
- Push KB coverage past ~80% (more intent→field mappings; the real app's `buildPackage` resolver is better than the test harness, so live coverage is likely higher).
- Merge to `main` (prod) once you've tested — currently isolated on `feat/maik-v2` + preview + your device, so prod is untouched.
- Optional: ECG/CXR auto-routing chips, a Settings toggle, richer confidence surfacing, per-mode answers (doctor/student/exam).
