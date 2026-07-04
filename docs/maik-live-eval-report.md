# MaiK Live-Provider Eval — Bounded Run (owner-approved)

_First evaluation against the **real** deployed provider (Gemini via `/api/ai/explain` on stewardmd.in). Dataset: `test/maik-eval/live-cases.json`; runner: `test/maik-eval/run-live-eval.mjs`; raw: `test/maik-eval/live-results.json`. This scores clinical-**element coverage** + safety/output heuristics on real answers — it is **not** a clinician's certification of correctness._

## Scope & bound
- Unauthenticated headless client = **guest** → daily quota. Run naturally bounded: **4 of 6 cases answered, 2 quota-blocked** (expected; not worked around — that would need an admin override/secret I did not touch).
- ~4 real provider calls. **Token/cost estimate:** ~2k tokens/call (grounded prompt in + ~250–350-word answer out) ≈ **~8k tokens total** — negligible cost.

## Results (real answers)

| Case | Topic | Clinical elements | Narration leak | Raw-ID | Markdown leak | Sources shown |
|---|---|---|---|---|---|---|
| L-01 | acute cholangitis | **67%** (missing: sepsis-resuscitation emphasis) | none ✅ | none ✅ | none ✅ | yes ✅ |
| L-02 | DKA | **100%** (fluids · insulin · potassium) | none ✅ | none ✅ | none ✅ | yes ✅ |
| L-03 | bacterial meningitis | **100%** (empiric abx · dexamethasone · LP/CSF) | none ✅ | none ✅ | none ✅ | yes ✅ |
| L-04 | hyperkalemia | **100%** (Ca²⁺ · insulin/dextrose · removal) | none ✅ | none ✅ | none ✅ | yes ✅ |
| L-05 | organophosphate | — | — | — | — | quota-blocked ⏸ |
| L-06 | cholangitis follow-up | — | — | — | — | quota-blocked ⏸ |

**Average clinical-element coverage (answered): 92%** (3 of 4 at 100%).

## Key findings
1. **The original screenshot bug is gone on the live provider.** Zero answers contained the "no specific question posed" / "the retrieved knowledge contains…" narration leak. Every answer addressed the asked topic directly.
2. **No raw internal IDs, no markdown/JSON leakage, sources shown** on all four — output hardening holds against the real model.
3. **Answers are complete, not truncated.** Each is a coherent ~250–350-word structured answer (~1150–1300 chars, well under the 1400-token cap). An automated "truncated" flag fired on all four but was a **false positive** — it read the bubble's trailing "Show more ▾ / Sources ▸" UI text as a mid-sentence cut. Decisive counter-evidence: 3 answers reached **100%** element coverage including the *last* pillars (e.g. dialysis for hyperkalemia, LP/CSF for meningitis), which a truncated answer could not. The heuristic has been corrected (strips bubble chrome before the punctuation check) for future authorized runs.
4. **One content item for clinician review:** the cholangitis answer led with source control + antibiotics but under-emphasized **sepsis resuscitation** (67% element coverage). Either a real emphasis gap or a strict regex — flagged for clinician review, not auto-judged.

## Honest verdict
On this bounded sample the live MaiK answers are **on-topic, leak-free, source-attributed, complete, and cover the key management pillars (92% avg)**. That is a real, encouraging first clinical-structural signal — **but not** a clinical-accuracy certification: N=4, and true correctness/safety needs a **clinician review** of the full answers.

## Blockers to a fuller score
- **Guest quota** caps an unauthenticated run at a handful of cases. A full Tier-1 clinical run needs either an **authenticated session** or a **temporarily raised eval quota** (owner action) — no secrets used here.
- **Clinician sign-off** on the answers (esp. dosing and the cholangitis sepsis-resuscitation emphasis) before claiming clinical quality.

## Recommended next
1. Owner provides an authenticated eval path (or raises the eval-account quota) → run the full ~30-case Tier-1 clinical set live.
2. Clinician reviews the captured answers (`live-results.json`) against the rubric (factual support, completeness, prioritisation, safety).
3. Address the cholangitis sepsis-resuscitation emphasis if the reviewer confirms the gap (prompt nudge or KB weighting — no fabricated content).
