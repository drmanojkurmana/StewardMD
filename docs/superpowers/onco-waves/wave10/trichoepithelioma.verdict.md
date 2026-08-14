# Verdict: trichoepithelioma.md

1. DOSE LEAK: none. Only digit occurrences in the file are "12th ed." (line 4, line 79) — the DeVita
   edition number, not a dose/mg/AUC/schedule. No mg, mg/m2, AUC, Gy, %, or numbered regimen anywhere.

2. UNGROUNDED CLAIMS: none that need flagging beyond what the sidecar already discloses. Verified
   against devita.txt:
   - "trichoepithelioma" appears exactly once in DeVita (line 226348), only as a histologic
     differential for microcystic adnexal carcinoma (MAC) — no management content. Confirmed.
   - CYLD, Brooke-Spiegler, cylindroma, spiradenoma: zero hits anywhere in devita.txt. Confirmed absent.
   - All specific claims in the sidecar (excision for solitary lesions, CO2 laser/electrosurgery/
     dermabrasion for multiple familial disease, no role for RT/systemic therapy, CYLD genetic
     counselling, dermatology/dermatopathology follow-up) are uncontroversial dermatology-oncology
     standard of care for a benign adnexal tumor, not specific regimens/trials/statistics — and the
     sidecar explicitly labels every one of them "(general oncology standard, not from DeVita's
     section on this disease)" rather than attributing them to DeVita. No fabricated DeVita citation,
     no fabricated statistic (e.g., no invented recurrence-rate or malignant-transformation-rate
     number — the one mention of malignant transformation is qualitatively hedged as "rare" with no
     numeric figure attached).
   - No drug names, no trial names, no regimen acronyms appear anywhere in the file.

3. CITATION: present (line 79) — "DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
   Oncology, 12th ed." with no page numbers, plus an explicit disclosure that DeVita has no dedicated
   management content for this disease.

4. VERDICT: CLEAN (ready for R1). Transparent, non-fabricating writeup for a disease DeVita doesn't
   actually cover; every claim is honestly labeled as general standard rather than falsely attributed
   to DeVita, and there is no dose/regimen leak.
