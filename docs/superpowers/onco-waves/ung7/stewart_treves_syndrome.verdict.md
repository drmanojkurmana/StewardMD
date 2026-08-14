# Verdict: stewart_treves_syndrome.md

**1. DOSE LEAK:** none. No mg, mg/m2, AUC, cycle count, or numbered schedule anywhere in the sidecar.
The only numbers present are epidemiologic/prognostic stats (50% mortality by 15 months, 10-30%
5-year survival, <5 cm lesion-size cutoff, "four" clinical variants) — all non-dosing and all
directly sourced from DeVita's Cancer of the Skin chapter, not a leaked regimen.

**2. UNGROUNDED CLAIMS:** none found to be fabricated. Cross-checked every specific claim against
DeVita 12th ed (Sarcoma chapter ~L213580-213608 and Cancer of the Skin/Angiosarcoma section
~L226185-226280):
- Four clinical variants (head-and-neck/idiopathic, lymphedema-associated, radiation-induced,
  epithelioid) — matches verbatim.
- Wide excision as treatment of choice; complete excision associated with lower recurrence but
  histologically negative margins don't reliably prevent recurrence due to multifocality — matches.
- Amputation (shoulder disarticulation / hemipelvectomy) recommended when extremity disease can't
  be limb-sparing-resected — matches DeVita's wording closely.
- Postoperative RT considered in essentially all resected cases; retrospective survival benefit —
  matches.
- Anthracycline- and taxane-sensitivity, paclitaxel-based regimen favorable in isolated lymphatic
  spread — matches (DeVita explicitly names paclitaxel here, so the sidecar's parenthetical is grounded,
  not an invented specific).
- Neither chemo nor radical RT improves OS in metastatic/palliative setting — matches verbatim.
- No universally accepted staging system — matches verbatim.
- Metastatic sites (lung, liver, lymph nodes, spleen, brain) — matches verbatim.
- Prognostic correlates (lesion size, depth of invasion, mitotic rate, age) — matches.
- Prognosis stats (50% mortality/15mo, 10-30% 5-yr survival, <5cm better survival) — matches, and
  sidecar correctly flags these as cutaneous-AS-wide rather than Stewart-Treves-specific, which is
  accurate to how DeVita presents them.
- VEGF/KDR/FLT4/MYC paragraph — content matches DeVita's molecular-biology paragraph, and the
  sidecar correctly declines to promote it to a treatment recommendation. Minor imprecision: the
  sidecar's inline annotation says this is "not from DeVita's section on this disease" — it actually
  is from DeVita's angiosarcoma section (which covers the lymphedema-associated variant), just
  presented there as background biology rather than therapy. Not a fabrication, just a slightly
  mislabeled provenance note; the substantive claim (background, not an established treatment line)
  is correct and appropriately conservative.

No drug, trial, or statistic in the sidecar was unsupported by the DeVita text, and no invented
regimen names, trial IDs, or response-rate numbers were introduced.

**3. CITATION:** Present — "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice
of Oncology, 12th ed." Name only, no page numbers. Correct format.

**4. VERDICT: CLEAN (ready for R1)**

Minor non-blocking note for R1: the VEGF-pathway provenance annotation ("not from DeVita's section
on this disease") is slightly inaccurate — it IS in DeVita's angiosarcoma section, just as molecular
background rather than a treatment recommendation. Wording could be tightened but does not
constitute fabrication or an ungrounded claim; no dose leak, no invented regimens/trials/statistics.
