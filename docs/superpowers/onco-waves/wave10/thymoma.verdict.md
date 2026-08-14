# Adversarial verification — thymoma.md

1. DOSE LEAK: none. Grepped for all digits in the sidecar; the only numeric-adjacent tokens are R0/R1/R2 (resection-completeness notation, not dose) and stage labels (I/II/III/IV/IVA). No mg, mg/m2, AUC, Gy, %, cycle count, or numbered schedule anywhere.

2. UNGROUNDED CLAIMS: none found. Cross-checked every specific claim against DeVita 12th ed, Ch. 32 "Neoplasms of the Mediastinum" (thymic neoplasms section, lines ~76600-78240 of the source text):
   - Masaoka-Koga/TNM staging as treatment driver, R0 resection as strongest prognostic factor, open vs. minimally-invasive thymectomy, partial-vs-total thymectomy controversy + MG-reoperation risk — all directly stated.
   - Stage I no-PORT / stage II mixed-evidence PORT (conflicting SEER/ChART vs. SEER-subgroup/ITMIG series, individualized by margin/histology) — matches text almost verbatim.
   - Cryoablation indication/caveat re: high-flow vascular structures, and expectant monitoring alternative — matches verbatim.
   - Stage III/IV: extended resection details (pericardium/phrenic nerve/chest wall/lung/diaphragm), R1/R2 survival benefit vs. biopsy alone, stage IVA P/D and EPP at high-volume centers — all supported.
   - PORT benefit in resected III/IV per ITMIG, response differing by histologic subtype (lymphocytic vs. epithelial component) — supported.
   - Platinum + anthracycline backbone as most active combination regimen, combination > single-agent response rates — supported (CAP backbone discussion).
   - Multimodality induction-chemo → surgery → adjuvant RT ± consolidation sequence, with incomplete completion rates in some trials — matches MD Anderson/JCOG9606 series (qualitatively, no numbers reproduced).
   - Concurrent chemoradiotherapy for unresectable disease — supported (ECOG trial, SBRT phase 2).
   - Corticosteroids acting on lymphocytic (not epithelial) component — supported verbatim.
   - Recurrent/refractory: repeat resection regardless of local/regional/distant (ITMIG finding of no OS difference by site) — supported.
   - Second-line multikinase/angiogenesis TKIs + mTOR inhibition (sunitinib, everolimus) and somatostatin analogs ± steroid with unclear rationale — supported (Table 32.6, octreotide/lanreotide sections).
   - Anti-PD-1 activity in TETs but caution re: autoimmune paraneoplastic flare (esp. with MG history) — supported by pembrolizumab/nivolumab trial data (serious autoimmune AEs, MG exacerbation in a subset).
   - KIT rarity in thymoma vs. thymic carcinoma, targeted therapy more relevant in thymic carcinoma — actually directly supported by DeVita's own text (KIT in 2-10% of TC, "only rarely" in thymoma; sunitinib response 26% TC vs. 6% thymoma), even though the sidecar conservatively self-flags this as "general oncology standard, not from DeVita's section on this disease" for the "more consistent activity" wording. This is over-cautious labeling, not a fabrication — no issue.
   - Paraneoplastic syndromes (MG most common, thymoma-associated MG responds less well to surgery than MG without thymoma; pure red cell aplasia; Good syndrome/hypogammaglobulinemia) — all directly supported, including the specific "MG patients with thymoma do not respond as well to surgery" line.
   - Thymic carcinoma section (less-defined optimal approach, aggressive multimodality favored, R0 goal, PORT trend toward benefit especially incomplete resection, neoadjuvant chemo in small series) — matches verbatim.
   - Surveillance-schedule and the second KIT/multikinase-in-TC line are both explicitly self-flagged inline as "general oncology standard, not from DeVita's section" — honest disclosure, correctly used since DeVita's chapter indeed does not specify a surveillance interval.

3. CITATION: present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." Name only, no page numbers. Correct.

4. VERDICT: CLEAN (ready for R1).
   - No dose leak.
   - No fabricated regimens/trials/statistics; every substantive claim traced to the DeVita thymic-neoplasms chapter, and the two claims that go slightly beyond the reviewed text are explicitly self-flagged inline as general-standard rather than DeVita-sourced (one of which, on closer check against the source, is actually also DeVita-supported — an overly cautious flag, not an error).
   - Citation format correct.
