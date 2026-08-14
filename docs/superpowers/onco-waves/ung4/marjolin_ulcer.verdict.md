# Adversarial verification — marjolin_ulcer.md

1. DOSE LEAK: none. Only numeric string in the file is "12th" (edition number, in the citation line) — not a dose/mg/mg-m2/AUC/schedule number.

2. UNGROUNDED CLAIMS: none found. Grepped DeVita for "Marjolin", "burn scar", "scar carcinoma", "chronic ulcer", "osteomyelitis sinus" — zero hits confirming the draft agent's claim that DeVita has no dedicated section on this entity. The sidecar is explicit and consistent about this gap: every clinical statement is tagged "general oncology standard, not from DeVita's section on this disease," and the "Deliberately omitted" section correctly withholds any Marjolin-specific regimen, drug name, trial, or statistic. Cross-checked the generic claims it does make against DeVita's actual cutaneous SCC coverage (which DOES exist in the text, just not tied to Marjolin ulcer specifically):
   - Wide local excision / margin clearance as primary curative treatment — supported (DeVita cutaneous SCC/head-neck SCC chapter, "wide local excision" throughout).
   - Regional lymph node dissection for proven/suspected nodal disease — supported (DeVita covers neck dissection/lymph node dissection extensively for cutaneous SCC).
   - Adjuvant radiotherapy for high-risk features / positive margins / nodal disease — supported (DeVita discusses adjuvant RT for cutaneous SCC/head-neck SCC).
   - Systemic therapy for advanced/metastatic cutaneous SCC = platinum chemo, EGFR-targeted agents, checkpoint inhibitors (cemiplimab, pembrolizumab) — supported (DeVita explicitly names cemiplimab/pembrolizumab checkpoint blockade and EGFR-targeted agents for advanced/metastatic cutaneous SCC, e.g. lines ~225602–225688). The sidecar correctly does NOT claim this is Marjolin-specific or DeVita-attributed for Marjolin, and does not name a dose/schedule.
   - Burn-scar SCC behaving more aggressively / higher nodal metastasis risk than typical cutaneous SCC — this is standard dermatology/plastic-surgery teaching (Rook's), not found in DeVita, but sidecar does not attribute it to DeVita; uncontroversial guideline-standard claim, acceptable.
   No fabricated trial names, response-rate statistics, or invented regimens were found anywhere in the file.

3. CITATION: present. Closing line cites "DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." by name only, no page numbers, and honestly discloses the entity is not covered in a dedicated section there; also names NCCN Guidelines for Squamous Cell Skin Cancer as the basis for the general statements.

4. VERDICT: CLEAN (ready for R1).
   No dose leak, no fabricated Marjolin-specific claims, honest and repeated disclosure of the DeVita coverage gap, generic surgical-oncology/cutaneous-SCC statements independently check out against DeVita's actual (non-Marjolin) SCC content. Only soft note for R1: this entry leans more heavily on "general oncology standard" framing than a typical DeVita-grounded sidecar since the source text has no dedicated section — that's appropriately flagged, not a defect, but R1 may want a secondary named source (e.g., NCCN SCC guideline version/date) beyond the generic mention already given.
