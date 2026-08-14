# Adversarial verification — sebaceous_carcinoma.md

**Grounding check:** DeVita 12th ed, "SEBACEOUS CARCINOMA" section (Incidence/Etiology + Prognosis and Management), lines ~226371-226457 of devita.txt. Cross-checked every clinical claim in the sidecar against this passage.

## 1. DOSE LEAK
None. Grepped for mg, mg/m2, AUC, Gy, cycles, numbered schedules — found none. All numbers present are anatomic/margin measurements, percentages, and staging labels, not drug doses:
- Margins: "1 to 3 mm" (recurrence), "5 mm" / "5mm to 6mm" (no-recurrence / recommended)
- Age threshold "<60" (Muir-Torre risk factor)
- Metastasis rate "up to 20%"
- Mortality range "9% to 50%"
- Recurrence "up to around a third of cases"
- Lesion size "<1 cm" (favorable prognosis)
- Stage label "T2c or higher" (AJCC eyelid staging, SLNB threshold)
None of these are systemic-therapy dosing — correct per DeVita, which gives no chemo/targeted-agent regimen for this disease at all.

## 2. UNGROUNDED CLAIMS
None found. Every specific claim traces to the DeVita passage:
- ~25% extraocular sites → matches "Approximately 25% of cases of SC involve extraocular sites"
- Muir-Torre / Mayo MTS risk score / MLH1/MSH2/MSH6 / age<60 / >1 sebaceous neoplasm / personal-family Lynch history → matches directly
- Margin data (1-3mm recurs, 5mm no recurrence; WLE 5-6mm recommended) → matches the frozen-section margin-control study cited
- Mohs vs WLE favorable comparison → matches ("local RRs of ≤12%" for MMS vs "as high as 36%" for WLE); sidecar appropriately omits the specific percentages and just says "meaningfully lower," which is a safe paraphrase, not a fabrication
- RT as case-report-level option, poorly-differentiated SC series → matches
- No dedicated extraocular staging system; AJCC eyelid staging; T2c+ → SLNB → matches verbatim
- Metastasis up to 20% (lungs/liver/brain/bones/nodes), mortality 9-50% → matches verbatim
- Periocular worse than extraocular; lower eyelid/orbital extension → higher mortality; <1cm lesions favorable (analogous to early SCC) → all matches
- Two items are explicitly flagged inline by the draft agent as NOT DeVita-sourced (nodal dissection as standard management of confirmed nodal disease; surveillance being a "general oncology standard" with no DeVita-specified interval) — correctly labeled as general practice rather than misattributed to the source.
- Systemic/advanced disease section correctly states DeVita gives no regimen and does not invent one (no checkpoint inhibitor, no chemo agent named) — this is the right behavior, not an omission to fault.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT
**CLEAN — ready for R1.**

No dose leak, no fabricated regimens/trials/statistics, all specific numbers/claims trace to the cited DeVita passage, non-DeVita general-oncology-standard statements are explicitly flagged as such inline, and the systemic-therapy gap is honestly disclosed rather than fabricated.
