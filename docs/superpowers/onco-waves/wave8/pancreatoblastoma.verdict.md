# Adversarial verification verdict — pancreatoblastoma.md

## 1. DOSE LEAK
None. Grepped the sidecar for digits: only hit is "12th ed." in the source
line and the SMAD4/CTNNB1/KRAS gene-name line (no numbers there either —
false match on nothing). No mg, mg/m2, AUC, cycle count, or numbered schedule
anywhere in the file.

## 2. UNGROUNDED CLAIMS
The sidecar is generally disciplined about tagging non-DeVita content with
"(general oncology standard, not from DeVita's section on this disease)" —
that labeling is honest and each such claim (platinum+anthracycline
neoadjuvant backbone, metastasectomy consideration, adult PDAC-line
extrapolation, AFP/imaging surveillance, genetics referral) is uncontroversial
pediatric-oncology practice, not fabricated specifics (no drug names beyond
class, no doses, no trial names). Those are fine.

Two claims slip through **without** that disclosure tag, i.e., presented as
if part of the grounded DeVita summary:

- **"characterised by acinar differentiation with squamoid nests"** (line 5) —
  checked the exact DeVita paragraph (lines 104644-104660 of devita.txt): it
  says "these tumors contain acinar cells, but other cell types
  (neuroendocrine, ductal) are often present." DeVita's pancreatoblastoma
  section does **not** mention squamoid nests/corpuscles anywhere. "Squamoid
  corpuscles" is a real, well-known WHO-classification histologic feature of
  pancreatoblastoma, so it's not wrong — but it is not DeVita-sourced and,
  unlike every other non-DeVita claim in this same document, it isn't flagged
  as such. Inconsistent labeling discipline.
- **"DeVita notes that survival is poorer once disease is metastatic"**
  (Metastatic disease section) — DeVita's text only juxtaposes two facts
  ("Cures are often achievable with resection in children, although one-third
  of patients present with metastatic disease") without ever stating that
  survival is worse when metastatic. Attributing that inference to DeVita by
  name ("DeVita notes that...") overstates what the source actually says.

Minor paraphrase drift (not fabrication, but worth flagging):
- "typically presenting in the first decade of life" vs. DeVita's "usually
  occurs in the first 8 years of life" — decade (10y) is a looser/larger
  window than DeVita's stated 8 years.
- "frequently produces alpha-fetoprotein" — DeVita says AFP/hormone elevation
  "has been described," without a frequency qualifier; "frequently" is an
  added strength claim not in the source.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles &
Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES (minor, not dose/regimen fabrication)

- No dose leak — clean on the hard safety criterion.
- No invented drug names, trial names, or statistics — the disclosed
  "general oncology standard" claims are appropriately hedged and clinically
  uncontroversial.
- But two claims in the "grounded" portion are not actually grounded in the
  DeVita excerpt and lack the disclosure tag the rest of the document uses
  consistently: "squamoid nests" (add the "(general oncology standard...)"
  tag or cut it) and the "DeVita notes... survival is poorer" attribution
  (soften to not name DeVita, since DeVita only states the metastatic-rate
  fact, not a survival comparison).
- Minor paraphrase inflation ("first decade of life" vs "first 8 years";
  "frequently produces AFP" vs "has been described") — low stakes, but worth
  tightening for exact fidelity to source before R1.

Recommendation: fix the two unflagged claims (squamoid nests, the
survival-attributed-to-DeVita sentence) before treating this as fully
DeVita-faithful; everything else — including the explicit chemo/regimen gap
and its honest disclosure — is sound and ready.
