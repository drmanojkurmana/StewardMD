# Adversarial verification verdict — extramammary_paget_disease

## 1. DOSE LEAK
None. Grepped the sidecar for `mg`, `mg/m2`, `AUC`, `Gy`, `cycles`, `q_w`/`q_d` schedule patterns — zero hits. Only numbers present are epidemiologic percentages (5%, ~40%, 7-24%, 12-14%) that are directly quoted/paraphrased from DeVita's own text, not dosing.

## 2. UNGROUNDED CLAIMS
DeVita's EMPD coverage (verified by grep + read) is limited to two short passages: anal/perianal Paget disease (~line 133474-133490) and vulval EMPD (~line 172793-172796). Cross-checking the sidecar's treatment-modality claims against those passages:

- **Grounded and accurate:** surgery as mainstay, multifocal/subclinical spread driving positive margins and recurrence, ~5% progression to invasive disease with up to ~40% invasive if untreated, tubo-ovarian association 7-24%, GI association 12-14%, "exclude invasive growth" for vulval Paget, need for imaging/endoscopy to rule out synchronous internal malignancy. All match DeVita closely.
- **NOT found in the quoted DeVita passages (ungrounded against this source, though not exotic):**
  - "topical therapy, photodynamic therapy, or radiotherapy" as non-surgical options for extensive in-situ disease — DeVita's EMPD text says nothing about topical/PDT/RT modalities; this is general dermatologic-oncology knowledge, not sourced to DeVita.
  - "Radiotherapy... as an adjunct after surgery for invasive, margin-positive, or nodal disease" — same issue, not stated in the DeVita excerpts for EMPD.
  - "Systemic therapy... follows the site-specific pathway (e.g., anorectal or urothelial adenocarcinoma protocols)" — plausible extrapolation but not explicit in the EMPD passages (DeVita's anal-adenocarcinoma-as-rectal-cancer treatment discussion is a different, non-Paget section).
  - Penoscrotal and axillary EMPD site-specific guidance (urology referral/urothelial workup, axillary as an affected site) — DeVita's EMPD discussion covers only anal/perianal and vulval; penoscrotal/axillary aren't mentioned at all, so these are outside-knowledge additions.
  - Note: none of these are specific regimens/trials/statistics — they're general modality/referral statements consistent with uncontroversial guideline-standard dermatologic oncology practice, so they don't rise to fabrication, but they are not actually traceable to the DeVita text as the "omitted" section implies (that section undersells what's ungrounded — it names only Mohs-vs-WLE data, RT technique, and systemic regimens as omitted, but doesn't flag that the RT/topical/PDT modality claims and penoscrotal/axillary content already in the body are also outside DeVita's EMPD coverage).

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES (minor, not blocking)
No dose leak, no fabricated drug names/trials/statistics — the core epidemiologic claims are accurate and DeVita-sourced. The issue is scope-creep beyond DeVita's actual (narrow, anal+vulval-only) EMPD coverage: general treatment-modality statements (topical/PDT/RT as options, RT as adjunct, systemic therapy following site pathways) and site coverage (penoscrotal, axillary) are asserted in the body as if established, but are not present in the DeVita passages and the file's own "omitted" disclosure doesn't flag them as extrapolated. Recommend R1 either (a) trim those modality/site claims to match DeVita's actual scope, or (b) explicitly mark them as general-knowledge additions beyond DeVita in the omission note. Not a fabrication/dose-leak failure — safe to proceed to R1 with this caveat noted.
