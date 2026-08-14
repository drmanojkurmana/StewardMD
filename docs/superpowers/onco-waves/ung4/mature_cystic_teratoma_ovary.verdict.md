# Verdict: mature_cystic_teratoma_ovary.md

## 1. DOSE LEAK
None. Grepped the sidecar for `mg|auc|m2|q[0-9]|cycle|dose` and for all numeric tokens
(`[0-9]+[^ ]*`): only hits are "1-2" (FIGO grade descriptor "stage IA, grade 1-2 immature
teratoma", line 24) and "12th" (edition number in the citation, line 43). No mg / mg-m2 /
AUC / numbered schedule anywhere.

## 2. UNGROUNDED CLAIMS
Cross-checked against DeVita 12th ed (lines ~177960-178020 "The Adnexal Mass" section, and
~178370-178412 malignant germ cell tumor of the ovary section):

- Benign mixed cystic/solid ovarian masses incl. "dermoid cysts (i.e., cystic teratoma)"
  grouped with serous/mucinous cystadenoma — matches DeVita line 177980-177982. Grounded.
- Transvaginal ultrasound (complex vs simple, septations, solid components) drives operative
  decision; CT/MRI reserved for moderate-to-high suspicion of malignancy (omental
  caking/carcinomatosis) — matches DeVita lines 177985-177996 closely. Grounded.
- Malignant germ cell tumors of the ovary (dysgerminoma, yolk sac, immature teratoma, mixed,
  embryonal carcinoma, choriocarcinoma) treated with adjuvant bleomycin-etoposide-cisplatin
  except FIGO stage IA dysgerminoma and stage IA grade 1-2 immature teratoma — matches DeVita
  lines 178370-178383 near-verbatim (drug names only, no dose/schedule reproduced). Grounded.
- Fertility-preserving surgery favoured whenever germ-cell tumour biology permits — consistent
  with DeVita line 178372 ("fertility-preserving surgery is always an option for this disease,
  even when metastases are present"), for the malignant counterpart. Grounded as stated
  (sidecar correctly scopes it to "consistent with," not "DeVita states this for the benign
  lesion").
- All surveillance-interval, cystectomy-vs-oophorectomy, torsion/rupture-management, and
  marker-testing statements are explicitly self-tagged inline as "(general oncology standard,
  not from DeVita's section on this disease)". Appropriate disclosure, not fabrication.

One item is NOT tagged and I could not find it in the DeVita text search (grepped "malignant
transformation", "squamous cell carcinoma" + teratoma context — no ovarian-teratoma-specific
hit):
- Line 23: "Malignant transformation of a mature teratoma (almost always squamous cell
  carcinoma arising from the ectodermal component) is rare" — this is standard gynecologic-
  oncology teaching (well-established, uncontroversial) but it is the one specific claim in
  the doc that lacks the "(general oncology standard, not from DeVita...)" caveat that
  parallel claims elsewhere in the same document carry. Minor consistency gap, not a
  fabrication risk, but flag for R1 to either tag it the same way or confirm it's covered by
  the closing disclaimer in the "What DeVita is silent on" section.

No specific chemo regimen, trial, or statistic is asserted for the benign entity itself; the
draft agent's stated omissions (malignant-transformation rate, dosing, long-term
recurrence/marker stats for the benign lesion) hold up under my check — none appear in the
document.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." (line 43). Name only, no page numbers. Correct format.

## 4. VERDICT
CLEAN (ready for R1), with one minor nit: tag the squamous-cell-malignant-transformation
sentence (line 23) with the same "(general oncology standard, not from DeVita's section on
this disease)" caveat used elsewhere in the document, for internal consistency. This is a
labeling nit, not a grounding or dose-leak failure — does not block R1.
