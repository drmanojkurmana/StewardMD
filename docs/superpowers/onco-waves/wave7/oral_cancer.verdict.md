# Verdict: oral_cancer.md (Wave 7)

1. DOSE LEAK: none. All numbers in the file are percentages (90/95% histology, DOI thresholds
   in mm, T-stage numbers, lymph-node level numbers I-V, lymph node yield count 18, edition/chapter
   numbers 12/27) — no mg, mg/m2, AUC, Gy, or numbered drug schedule anywhere.

2. UNGROUNDED CLAIMS (minor, not dangerous):
   - "oral submucous fibrosis" listed alongside leukoplakia/erythroplakia as a premalignant
     lesion warranting surveillance (line 18-19) — not found in DeVita's Ch. 27 text (leukoplakia,
     erythroplakia, CIS, lichen planus are mentioned; submucous fibrosis is not). Real entity,
     uncontroversial (well-established premalignant condition, esp. relevant in the India context),
     but not DeVita-sourced as written.
   - "fails to heal within a few weeks should be biopsied" (lines 17-18, 119) — DeVita lists
     "nonhealing ulcer" as a presenting symptom but does not give an explicit time threshold;
     the "few weeks" framing is the sidecar author's clinical generalization, not a DeVita quote.
     Clinically reasonable/uncontroversial, just not literally sourced.
   - Recurrent/metastatic systemic therapy (chemo, EGFR-targeted, immunotherapy) is explicitly
     and correctly self-flagged in the sidecar as "general oncology standard, not from DeVita's
     section on this disease" — this is disclosed, not a fabrication.

3. CITATION: present — "DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed. (Chapter 27, Cancer of the Oral Cavity)." No page numbers. Correct.

4. Verification detail: spot-checked against DeVita Ch. 27 (grepped/read lines ~62881-64260 of the
   source text) for every specific numeric/clinical claim in the sidecar. All of the following were
   found verbatim or near-verbatim in DeVita and are accurately represented:
   - 90-95%+ of oral tumors are SCC (DeVita: 95%).
   - MDT composition (H&N surgery, rad onc, med onc, radiology, pathology + dentists/SLP/dietician/PT).
   - Imaging workup (CT maxillofacial/neck/chest or PET-CT + diagnostic neck CT; MRI for dental
     artefact/PNI/marrow involvement) — matches almost word for word.
   - Surgery-first default across subsites; RT adjuvant; CRT added for adverse pathology; RT alone
     carries higher risk of soft tissue/bone necrosis, dental damage, xerostomia vs. surgery for
     early FOM/oral cavity lesions — matches DeVita's FOM section almost verbatim.
   - Lip cancer: surgery vs. RT equipoise for early lesions; surgical excision preferred up to
     ~2 cm not involving the commissure; RT reasonable for commissure/>2cm/upper lip — matches
     DeVita's Lip section verbatim.
   - Single positive node upstages to at least stage III and roughly halves overall survival —
     matches DeVita's Neck Treatment section verbatim ("upstaged to at least stage III and overall
     survival decreases by 50%").
   - DOI >2mm → increased occult neck disease risk → at least ipsilateral elective neck treatment;
     T3 with DOI >10mm → consider contralateral elective treatment; T2-T4a cN0 → at least
     ipsilateral elective treatment — matches DeVita's Depth of Invasion section verbatim.
   - cN0 elective levels I, IIa, III always addressed, IIb/IV strongly considered — matches DeVita
     verbatim.
   - cN+ levels I-IV always, level V added for multilevel disease — matches DeVita verbatim.
   - Bilateral neck treatment triggers: FOM origin/extension, soft palate/base of tongue extension,
     within 1cm of midline, DOI >10mm; ipsilateral-only candidates: RMT/hard palate/alveolus/buccal
     without midline extension — matches DeVita's Bilateral Neck Treatment section verbatim.
   - Level I-III neck dissection should yield >=18 nodes; lower yield linked to worse locoregional
     control (DeVita actually states this yield "doubles overall survival" — the sidecar's phrasing
     is a conservative understatement of DeVita, not an inflation, so not a fabrication concern).
   - Follow-up: ulcer in tumor bed within ~2 years of RT could be recurrence or necrosis; trial of
     conservative management if it looks like necrosis; failure to resolve or rolled/elevated border
     -> biopsy; negative biopsy doesn't rule out recurrence, repeat/deep biopsy may be needed —
     matches DeVita's Follow-Up and Management of Recurrence sections verbatim.
   - RT failure salvaged by surgery; surgical failure occasionally salvaged by re-resection +
     postop RT; neck soft-tissue recurrence rarely curable by any procedure; new nodal disease in an
     untreated neck managed by neck dissection + postop RT/CRT — matches DeVita verbatim.

   No specific regimen, trial name, or statistic in the sidecar was found to be invented or
   misattributed; the two items in section 2 above are generalizations/additions beyond the
   literal DeVita text but are uncontroversial and non-dangerous (no dose, no drug regimen).

VERDICT: CLEAN (ready for R1) — with two minor non-blocking notes (submucous fibrosis mention and
"a few weeks" ulcer threshold are sidecar-author generalizations, not literal DeVita quotes; both
are clinically uncontroversial and carry no dose/regimen risk).
