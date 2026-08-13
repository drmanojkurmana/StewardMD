# Verdict: penile_cancer.md (Wave 8)

## 1. DOSE LEAK
None. Grepped for `mg`, `mg/m2`, `AUC`, `Gy` — zero hits. The only bare numbers present are:
- "2-cm proximal margin" (surgical margin, not a drug dose) — line 17
- "12 to 18 months" / "5 years" (follow-up time windows) — lines 19, 55, 56
- Stage labels (T1-T4, cN0-cN3, pN0-pN3) — staging nomenclature, not dosing
None of these are drug doses, mg/m2, AUC, or numbered cycle counts. Clean.

## 2. UNGROUNDED CLAIMS
One real finding:

- **Line 43, chemotherapy-guideline "disagreement" claim** — the sidecar states: *"this remains a point of disagreement between national consensus guidelines, which recommend adjuvant chemotherapy for pN2-3 disease, and some European guidance."* This is **not what DeVita says**. DeVita's actual text: "adjuvant chemotherapy is recommended by national consensus **and EAU guidelines** for both pN2 and pN3 penile carcinomas" — i.e., national consensus and EAU *agree* on chemo for pN2-3. The controversy DeVita describes is that *some individual authors/studies* argued against adjuvant chemo in pN2 based on the 743-patient retrospective series, not a national-consensus-vs-EAU guideline split. The guideline vs. guideline disagreement DeVita actually documents is for **adjuvant RT** (national consensus recommends it for pN2-3, EAU does not) — a few lines later in the same source, and the sidecar correctly describes *that* one in its own Adjuvant Radiation paragraph (line 45). It appears the RT guideline-disagreement framing was miscopied onto the chemotherapy paragraph, fabricating a guideline split for chemo that DeVita does not support. This is a specific, checkable clinical claim that is wrong, not just an uncontroversial simplification — worth a fix before R1.

Everything else checked (TIP regimen response rates described qualitatively, TPF adjuvant use, EGFR-inhibitor/cetuximab investigational status, PD-L1 checkpoint-inhibitor rationale, cN0/cN1-3 nodal management algorithm, DSNB + ultrasound, modified vs. complete ILND, RT margin/dose-fractionation omissions, verrucous carcinoma RT avoidance rationale, T1-T3 margin-reduction rationale, metastatic-disease prognosis/second-line toxicity statements) is well supported by the DeVita "Penile Cancer" section (lines ~165475-166050 of devita.txt) and appropriately keeps DeVita's specific drug names, percentages, and dose numbers out of the sidecar. The two inline notes flagging the PD-L1/checkpoint-inhibitor rationale and the follow-up-interval statement as "general oncology standard, not from DeVita" are accurate self-disclosures, not fabrications.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES

- Fix the chemotherapy-guideline paragraph (line 43) — it misattributes to chemotherapy the guideline disagreement (national consensus vs. EAU) that DeVita documents only for adjuvant RT. DeVita states national consensus AND EAU agree on adjuvant chemo for pN2-3; the actual controversy DeVita cites is individual authors arguing against chemo in pN2 based on one retrospective series, not a guideline-body split. Either remove the "point of disagreement between... guidelines" framing for chemo or restate it accurately (individual-study skepticism, not guideline conflict).
- No dose leak found.
- No other ungrounded/fabricated regimens, trials, or statistics found on spot-check against DeVita Chapter 46 ("Cancer of the Urethra and Penis," Penile Cancer section).
- Citation line present and correctly formatted.

Recommend: draft agent (or R1) corrects the one misattributed claim before this moves forward; the rest of the sidecar is solidly grounded.
