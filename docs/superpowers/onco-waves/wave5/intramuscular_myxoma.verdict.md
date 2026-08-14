# Adversarial verification verdict — intramuscular_myxoma.md

## 1. DOSE LEAK
None. Grepped for numeric mg/mg-m2/AUC/Gy/cycle/q-day-week patterns — zero matches. The only numeric-adjacent content is qualitative ("marginal excision", "periodic follow-up") with no doses or schedules.

## 2. UNGROUNDED CLAIMS
None found that are both unsupported by uncontroversial guideline-standard oncology practice AND presented as if DeVita-sourced. All treatment/monitoring/referral content (marginal excision as curative standard, observation option for asymptomatic clearly-benign lesions, no role for chemo/RT, Mazabraud fibrous-dysplasia managed separately, cellular-variant handled like low-grade sarcoma pending pathology) is explicitly and consistently tagged inline as "(general oncology standard, not from DeVita's section on this disease)" rather than attributed to DeVita. These are uncontroversial, standard-of-care statements for a benign, non-metastasizing soft tissue tumor (consistent with WHO soft tissue tumor classification and standard orthopedic oncology practice) — not specific unverified regimens, trial results, or statistics.

No drug names, trial names, or statistics (e.g., recurrence rate percentages) are asserted anywhere in the sidecar — the draft agent correctly omitted these for lack of grounding, which is the right call given DeVita's silence on management.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

Spot-check against DeVita source text (lines 213807–213819 of devita.txt, "Myxoma" section under Tumors of Uncertain Differentiation) confirms the sidecar's DeVita-attributed diagnostic claims are accurate and non-fabricated:
- Rare tumor, adults, large extremity muscles — matches verbatim.
- Spindle cells without nuclear atypia, abundant myxoid stroma — matches.
- Not highly vascular, does not enhance on MRI (may be T2-hyperintense) — matches.
- Cellular myxoma variant resembling myxofibrosarcoma on biopsy — matches.
- GNAS1 mutations as diagnostic aid (common in myxoma vs. myxofibrosarcoma) — matches (DeVita refs footnote 279; sidecar does not fabricate a different mechanism).
- Mazabraud syndrome (multiple myxomas + fibrous dysplasia) — matches.
- DeVita's "Myxoma" section indeed contains no treatment/management sentence — confirmed by reading the full paragraph; it transitions directly to "Deep Angiomyxoma" with no interposed therapy content. The sidecar's claim that DeVita is silent on management for this specific tumor is accurate.

## 4. VERDICT
CLEAN — ready for R1.

Notes for R1: this is a benign-tumor sidecar where DeVita provides only diagnostic/histologic grounding and no therapeutic content; all management guidance is correctly flagged as general-standard rather than DeVita-sourced, which is the intended fallback behavior when the source text doesn't cover treatment for a given entity.
