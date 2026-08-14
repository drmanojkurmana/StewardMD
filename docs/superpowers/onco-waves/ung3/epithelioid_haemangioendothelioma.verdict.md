# Adversarial Verification Verdict — Epithelioid Haemangioendothelioma (EHE)

Sidecar: `docs/superpowers/onco-waves/ung3/epithelioid_haemangioendothelioma.md`
Checked against: `/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt`
- Bone/soft tissue chapter, lines 213563-213576 ("Epithelioid Hemangioendothelioma")
- Hepatic tumours chapter, lines 111800-111835 ("Epithelioid Hemangioendothelioma" / other primary liver tumors)

## 1. DOSE LEAK
None. Grepped for `mg/m2|mg/kg|[0-9]+ ?mg|AUC ?[0-9]|q[0-9]+w|every N (day|week)|cycle|dose|schedule` in the sidecar — zero matches. The only numbers present are survival-range statistics (4 months-28 years / "27 years" / "<20%"), which are outcome data, not treatment doses. Clean.

## 2. UNGROUNDED CLAIMS
Two claims are stated as plain fact in the "grounded" overview paragraph without the sidecar's own "(General oncology standard, not from DeVita's section on this disease)" caveat label that it correctly applies elsewhere — inconsistent sourcing discipline:

- **"pulmonary involvement is common"** (line 4). DeVita's bone/soft-tissue section only says metastases "may occur in lung, lymph nodes, and bone" — no frequency claim, and neither section describes a primary-pulmonary form of EHE at all (grepped for "pulmonary epithelioid", "IVBAT", "intravascular bronchioloalveolar" — zero hits in devita.txt). Pulmonary EHE (formerly IVBAT) is real, well-established medical knowledge, but it is not supported by the cited DeVita passages and is not flagged as an added-from-general-knowledge claim the way other extrapolations in the doc are.
- **"does not necessarily represent conventional metastatic dissemination"** (line 4, re: multifocal disease). This is an interpretive synthesis — DeVita states multifocality is "often observed" (bone/soft tissue) and separately that "presence of metastatic disease does not seem to influence survival" and is not a contraindication to resection/transplant (hepatic section) — but DeVita never states that multifocal lesions are biologically distinct from metastatic spread. Plausible clinical inference, but presented as sourced fact rather than labeled as such.

Everything else checks out against the text:
- Survival range "a few months to almost three decades" ≈ DeVita's "4 months to 28 years" — match.
- "one untreated patient survived many years without metastasis" ≈ DeVita's "one patient who received no treatment survived for 27 years without evidence of metastasis" — match.
- "<20 percent of patients die of disease" (soft tissue/bone) — verbatim from DeVita.
- "short observation period... to help decide between observation, ablation, resection, or transplant" — near-verbatim from DeVita hepatic section.
- "metastatic disease does not appear to worsen survival... not a reason to withhold resection or transplantation" — matches DeVita hepatic section closely.
- "Chemotherapy, VEGF-pathway inhibitor therapy, and immune checkpoint inhibitors have all been used... evidence base is limited" — matches DeVita hepatic section ("Systemic therapies... include chemotherapies, VEGF inhibitors, and ICIs; however, larger studies... are needed"). Note: contrary to the draft agent's self-report that ICI wasn't DeVita-grounded, it actually IS directly supported by the hepatic-chapter text — not an issue, just a correction to the draft's provenance note.
- "phase II trial... antiangiogenic agent... slows progression or partial response in the majority" — matches DeVita's bevacizumab phase II sentence; the sidecar deliberately genericizes the drug name to "antiangiogenic (anti-VEGF) agent" rather than naming bevacizumab. Not wrong, just a stylistic omission of a real DeVita-cited specific (worth a sanity check against the sidecar-wave's own convention on whether drug names are meant to be preserved when not a dose).
- The mTOR-inhibitor/interferon-alpha/palliative-RT/imaging-frequency content is correctly labeled as general-standard, not-from-DeVita — good discipline there, just inconsistently applied to the two overview claims above.

## 3. CITATION
Present. Line 35: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES
Not a fabrication problem (no invented trials/drugs/statistics, no dose leak, citation format correct) — but two specific claims in the overview paragraph blend DeVita-sourced material with an unlabeled inference and an unsupported-by-DeVita detail ("pulmonary involvement is common"; "does not necessarily represent conventional metastatic dissemination"). Recommend either (a) softening/removing these two clauses, or (b) moving them into the document's existing "(General oncology standard, not from DeVita's section on this disease)" caveat pattern so the DeVita-grounded vs. general-knowledge boundary stays consistent throughout, before R1 sign-off.
