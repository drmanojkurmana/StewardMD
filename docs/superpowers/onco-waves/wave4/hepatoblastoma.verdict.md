# Adversarial verification — hepatoblastoma.md

## 1. DOSE LEAK
None. Only digit occurrence in the whole file is "12th ed." in the citation line. No mg, mg/m2, AUC, or numbered schedule anywhere.

## 2. UNGROUNDED CLAIMS
The draft agent's own grounding claim covers only DeVita lines 111783-111796 (the ~14-line Hepatoblastoma section, which is chemo/surgery/transplant only — no PRETEXT, no metastasis-site detail, no AFP-subtype nuance, no syndrome list, no ototoxicity). Several sidecar statements go beyond that passage and are not supported anywhere else in devita.txt either:

- **PRETEXT staging ("mapped by the PRETEXT system, grouping the liver into four sections")** — zero hits for "PRETEXT" anywhere in devita.txt. Real/standard staging system in hepatoblastoma but wholly unsupported by the cited source.
- **"Pulmonary metastasis is the dominant site of spread"** (stated twice, in Treatment and Monitoring) — no hepatoblastoma-specific pulmonary-metastasis text found anywhere in devita.txt. True clinically, but not from DeVita.
- **"Low or normal AFP ... small cell undifferentiated subtype, which behaves more aggressively"** — not in the hepatoblastoma section; the only "small-cell undifferentiated carcinoma" hit in devita.txt (line 78431) is an unrelated tumor list, not hepatoblastoma-specific.
- **Beckwith-Wiedemann syndrome as a hepatoblastoma risk factor** — DeVita's only Beckwith-Wiedemann mention in this text is tied to **Pancreatoblastoma** (Ch. 35, p.513: "These tumors have been associated with the Beckwith-Wiedmann and familial adenomatous polyposis (FAP) syndromes"), not hepatoblastoma. The sidecar transplants that pancreatoblastoma-specific association onto hepatoblastoma. (FAP-hepatoblastoma itself IS separately supported elsewhere in DeVita via a syndrome table — line ~203303, "Colorectal cancer, ampullary cancer, hepatoblastoma, medulloblastoma" under FAP — but Beckwith-Wiedemann-hepatoblastoma specifically is not.)
- **Ototoxicity/renal-function monitoring + otoprotective strategies for cisplatin** — generic cisplatin ototoxicity is discussed elsewhere in DeVita (e.g. line ~16019, ~168095 "Ototoxicity" section) but not inside the hepatoblastoma section itself; the sidecar applies it here by extrapolation.

None of the above are fabricated drugs/trials/statistics, and all are uncontroversial, guideline-standard pediatric-oncology facts (PRETEXT staging, lung as dominant met site, AFP-negative small-cell-undifferentiated prognosis, FAP/hepatoblastoma link, cisplatin ototoxicity) — but they exceed the source range the draft agent itself claimed ("~14 DeVita lines"), and one (Beckwith-Wiedemann) is a misattributed source association (borrowed from the pancreatoblastoma passage).

## 3. CITATION
Present, correct format, no page numbers: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed."

## 4. VERDICT: ISSUES (minor, non-fabrication)
- No dose leak — clean.
- No fabricated regimen, drug, trial ID, or statistic — clean.
- But: PRETEXT detail, "pulmonary metastasis = dominant site" claims, AFP/small-cell-undifferentiated nuance, and Beckwith-Wiedemann-hepatoblastoma pairing all sit outside the cited DeVita passage (and Beckwith-Wiedemann is specifically borrowed from the pancreatoblastoma section, not hepatoblastoma). Recommend either finding a real DeVita anchor for these elsewhere in the full text before R1, or flagging them as supplementary standard-of-care knowledge not sourced to DeVita (rather than presenting them as flowing from the same citation line).
