# R1 CLINICAL-SAFETY REVIEW — malt_lymphoma (EMZL / MALT lymphoma)

VERDICT: APPROVE

Reviewer: R1 clinical-safety gate. Source of record: DeVita, Hellman & Rosenberg,
Cancer: Principles & Practice of Oncology, 12th ed. Adversarial verdict present
(malt_lymphoma.verdict.md) = CLEAN.

## 1. SAFETY — PASS
No unsafe, misleading, or absolute directive found. Every therapeutic statement is
hedged ("generally," "may," "should be considered," "preferred modality") and routed
through MDT planning. Specific checks:
- H. pylori eradication as first-line for gastric EMZL is correctly gated on
  t(11;18)-negative status, with RT named as the fallback for H. pylori-negative,
  t(11;18)-positive, or non-regressing disease. This is the safety-critical branch and
  it is stated correctly — it does not tell a clinician to rely on antibiotics when
  t(11;18)+ (the poor-responder subset).
- Watch-and-wait for advanced/asymptomatic disease is appropriately conditioned on
  absence of symptoms/organ impairment, not presented as passivity in the face of
  progression.
- "some of which may represent cures" and the 89% 5-yr OS figure are hedged outcome
  statements, not promises.
- Transformation surveillance (rapidly enlarging mass, ulceration, new organ-impairing
  presentation → rebiopsy) is present and correct — no missed red-flag.
No false-negative safety gap identified.

## 2. GROUNDING — PASS
All DeVita-attributed claims verified consistent with standard of care and confirmed by
the adversarial pass against Ch. 67 (EMZL + Nodal MZL sections) and Table 38.7. No
fabricated or outdated regimen. The BTK inhibitor / PI3K inhibitor / CD19 CAR-T
paragraph is explicitly and honestly scoped to "marginal zone lymphoma as a category"
rather than being over-attributed to EMZL specifically — this matches how DeVita
presents it (under Nodal MZL). No claim is mis-attributed to DeVita; the non-DeVita
extrapolations (watch-and-wait rationale, surgery-not-curative framing,
post-eradication surveillance practice, MDT referral) are each inline-labelled "general
oncology standard, not from DeVita." Attribution integrity is intact.

## 3. DOSE-FREE — PASS
No numeric dose leaked. No mg, mg/m2, AUC, Gy/cGy, or numbered schedules. "Low-dose"
appears only as a qualitative descriptor. The only numerals are outcome/epidemiology
statistics (89% 5-yr OS, "two thirds" stage I/II) and genetic/antigen identifiers
(t(11;18), API2-MALT1, CD20, CD19, PI3K) — none are doses. DeVita's actual RT doses
were correctly omitted.

## 4. SCOPE — PASS
Framed as decision-support: stage/site-driven, MDT-planned, referral-triggered. No
directive language that oversteps into prescribing.

## 5. ADVERSARIAL FLAGS — NONE OUTSTANDING
Verdict is CLEAN with no unresolved ISSUES. Nothing to relabel; no DeVita-for-a-claim-
not-in-DeVita problem. No bar to approval.

## Advisory (non-blocking)
- The inline sourcing parentheticals ("general oncology standard, not from DeVita's
  section on this disease...") are meta-commentary about provenance. They are honest and
  correct, but read awkwardly inside a clinician-facing management field. Consider moving
  provenance notes to a non-rendered comment/metadata layer so the narrative body stays
  clean. Style only — does not affect safety, grounding, or attribution.

goldens changed: no (intended: n/a — this is new KB narrative content, no engine/golden
outputs altered)
