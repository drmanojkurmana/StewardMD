# Kardia source data licences

Checked with curl on 2026-10-24. Each entry below records the exact version seen on the live page, the licence stated there, whether commercial use is allowed, the attribution text required, and the URL read. Where a fact could not be confirmed on the page, it is recorded as not verified rather than guessed.

## PTB-XL (real 12 lead ECGs for Learn and drills)

* Page read: https://physionet.org/content/ptb-xl/
* Version seen: 1.0.3, published 2022-11-09, DOI of this version https://doi.org/10.13026/kfzx-aw45
* Licence seen: Creative Commons Attribution 4.0 International Public License, full text at https://physionet.org/content/ptb-xl/view-license/1.0.3/
* Access: open access, anyone can access the files under the licence terms
* Commercial use: allowed. CC BY 4.0 permits commercial use provided attribution is kept
* Attribution text required: cite the dataset paper and keep the licence notice. Citation shown on the page: Wagner, P., Strodthoff, N., Bousseljot, R., Samek, W., and Schaeffter, T. (2022). PTB-XL, a large publicly available electrocardiography dataset (version 1.0.3). PhysioNet. https://doi.org/10.13026/kfzx-aw45
* Verdict: shippable in a paid app with the citation and a CC BY 4.0 credit line

## CirCor DigiScope (real heart sounds)

* Page read: https://physionet.org/content/circor-heart-sound/
* Version seen: 1.0.3, published 2022-05-10, DOI of this version https://doi.org/10.13026/tshs-mw03
* Licence seen: Open Data Commons Attribution License version 1.0, full text at https://physionet.org/content/circor-heart-sound/view-license/1.0.3/
* Access: open access, anyone can access the files under the licence terms
* Commercial use: allowed with attribution kept. The ODC Attribution licence permits commercial use provided attribution is kept
* Attribution text required: cite the dataset paper and keep the attribution statement. Citation shown on the page: Oliveira, J., et al. (2022). The CirCor DigiScope Phonocardiogram Dataset (version 1.0.3). PhysioNet. https://doi.org/10.13026/tshs-mw03
* Verdict: shippable in a paid app with the citation and an ODC Attribution credit line

## CAMEO (real echo images, 9 standard views)

* Page read: https://ieee-dataport.org/documents/descriptor-cardiac-multi-view-echo-dataset-cameo
* Version seen: not verified. The page shows DOI https://doi.org/10.21227/kvaz-eh57 with a submission date in August 2025 and a page update in July 2026, but states no version number
* Licence seen: not verified. The page requires an IEEE DataPort subscription to access the files and states no Creative Commons or other licence text, so the plan note that it is listed as CC BY 4.0 could not be confirmed
* Access: subscription gated on IEEE DataPort, not open access
* Commercial use: not verified
* Attribution text required: not verified. The page names Lee, Lei and co authors in its citation block but the exact required wording was not confirmed
* Has video: yes. The page states each view folder holds a dynamic echocardiographic figure in DICOM format covering at least three complete cardiac cycles, plus two still frames for end diastole and end systole. The 9 views are A2C, A3C, A4C, PLAX, PSAX at apical, aortic, mitral and papillary levels, and S4C
* Name clash warning: the HuggingFace dataset amu-cai/CAMEO is an unrelated audio collection under a non commercial share alike licence, not this echo dataset, so it must not be used as a substitute source
* Verdict: not shippable. No files enter the repo until the rights holder confirms a commercial use licence in writing

## Summary for WP12

PTB-XL and CirCor DigiScope are cleared for WP12 import with attribution. CAMEO stays out until its licence is confirmed, which matches the plan gate that non commercial datasets never enter the repo.

## Echocardiographer.org (real echo teaching cines for Scan Lab gap views)

* Page read: https://www.echocardiographer.org/about-3 (Re-use-of-Materials section)
* Version seen: About page naming Atif Qasim, MD MSCE; video pages /tte-psax, /tte-plax-rvinflow, /tte-plax-rvoutflow, /tte-subcostal-greatvessels, /tte-suprasternal and other TTE pages read 2026-10-26
* Licence seen: site permission, exact words: "I hope you use these materials to educator yourself and others. Feel free to use any of the content here and on my youtube channel for free, but please provide credit to this site and me or other authors." (typo "educator" as on the page)
* Access: open access, anyone can use the content for free
* Commercial use: allowed. The statement grants free use with no non-commercial restriction, provided credit is given
* Attribution text required: credit to the site and to Atif Qasim (or other authors). Quoted verbatim in each of the 17 kardia/media/credits.json attributions added 2026-10-26, with the source video URL
* Verdict: shippable in a paid app with the credit line kept; adaptations (masking overlays, re-encoding) permitted under the grant

## CASE TOF supplements (first real-echo tetralogy of Fallot cine)

* Page read: https://pmc.ncbi.nlm.nih.gov/articles/PMC13494407/ (article XML via Europe PMC)
* Version seen: Schreier M, Stanley HM, Chen JM, Starc J, Nuri M, Rogers LS, Mercer-Rosa L. Tetralogy of Fallot and Complete Atrioventricular Septal Defect with Absent Atrial Component. CASE: Cardiovascular Imaging Case Reports (2026). DOI 10.1016/j.case.2026.04.006. Supplement Videos 2 (mmc2.mp4, 618050 bytes) and 3 (mmc3.mp4, 1850769 bytes)
* Licence seen: CC BY 4.0 ("This is an open access article under the CC BY license"), full text at https://creativecommons.org/licenses/by/4.0/
* Access: open access; binaries fetched from the publisher CDN (PMC /bin links sit behind a proof-of-work challenge)
* Commercial use: allowed with attribution kept
* Attribution text required: author list, article citation and CC BY 4.0 notice, recorded in the 2 kardia/media/credits.json attributions added 2026-10-26
* Verdict: shippable in a paid app with the credit line kept
