# Review Orchestrator
_How reviewers are selected, sequenced, and gated when a change lands. Keep it automatic and lean: run only what the diff needs, block only on real risk._

## Selection algorithm (per change)
1. **Compute the changed surfaces** from the diff (globs in `REVIEW_MATRIX.md`).
2. **Assemble the reviewer set** = union of triggered reviewers.
3. **Mark mandatory vs optional:**
   - **Mandatory (blocking):** R1 on any clinical surface; R3 on any auth/data/network/secret surface; R2 on any AI surface.
   - **Optional (advisory unless they raise a Critical):** R4, R5, R6 on their surfaces.
   - **Gate:** R7 runs only at ship/flag/deploy time and requires R1 + R3 clear.
4. **Run in dependency order** (below), passing each reviewer only its scope.
5. **Aggregate:** dedupe overlaps, keep confidence ≥ 80, group Critical / Important / Advisory.
6. **Merge decision:** any **Critical from a mandatory reviewer → block**. Important → fix or explicitly accept with rationale. Advisory → optional.

## Dependency chains (run order; a blocked upstream stops the chain)
```
Clinical-engine change:
  R1 Clinical Safety & Evidence  ──(if AI-assisted)──▶ R2 AI Safety
        │ (blocks on false-neg / golden shift)              │
        ▼                                                    ▼
  R3 Security & Privacy (if PHI touched)  ────────────▶  R7 Release (gate)

AI / model / prompt change:
  R2 AI Safety ──▶ R3 Security & Privacy (PHI/secrets) ──▶ (R1 if clinical framing) ──▶ R7

Auth / data / network change:
  R3 Security & Privacy ──▶ R7 Release

Native / UI change:
  R4 Platform & Reliability ──▶ R5 Clinical UX & Accessibility ──▶ R6 Performance (if hot-path) ──▶ R7

Release / deploy:
  [R1 clear] + [R3 clear] ──▶ R7 Release  →  GO / GO-WITH-FIXES / NO-GO
```

## Blocking criteria (the only things that stop a merge/ship)
- **R1 Critical:** false negative, wrong dose/interaction/score, unintended golden change, deprecated guideline, alert downgraded.
- **R2 Critical:** actionable prompt injection, PHI to provider/logs, cross-patient leakage, confident output on garbage input.
- **R3 Critical:** committed/shipped secret, PHI in logs/URLs/local storage, plaintext clinical transport, auth bypass, cross-user Firestore read.
- **R7 NO-GO:** any mandatory reviewer's Critical unresolved, missing golden run, missing/invalid privacy manifest, 25 MiB asset, debug/logging on in prod.
- R4/R5/R6 Criticals **also block** (crash on critical path, unreadable clinical value, 25 MiB deploy-breaker) — but these surface via their reviewer, not a separate gate.

## Cadence
- **Per PR / pre-merge:** the routed mandatory + optional reviewers.
- **Pre-ship:** R7 gate.
- **Periodic (monthly / on major refactor):** R4 runs an **Architecture pass** (module boundaries, duplication, tech debt) — not per-PR, to stay lean.
- **On dependency updates:** R3 dependency pass.

## Human-in-the-loop
Reviewers advise; a human (or the orchestrating Claude session) makes the merge call. Mandatory Criticals require an explicit human override with a logged reason — never silent.
