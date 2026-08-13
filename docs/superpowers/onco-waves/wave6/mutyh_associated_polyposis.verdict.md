# Adversarial verification verdict - MUTYH-associated polyposis (MAP)

Sidecar: `docs/superpowers/onco-waves/wave6/mutyh_associated_polyposis.md`
DeVita source checked: `/Users/diwakarkumar/.claude/jobs/142278a7/tmp/devita.txt` (12th ed digitized text)

## 1. DOSE LEAK
None. Grepped for mg, mg/m2, AUC, q1-4w, cycle/day-numbered schedules - zero hits. The only
numbers in the file are epidemiologic risk percentages (43-100% lifetime CRC risk, ~4% lifetime
duodenal cancer risk), which are risk figures, not dosing, and are correctly attributed to DeVita.

## 2. UNGROUNDED CLAIMS
None found. Every specific DeVita-attributed claim checks out against the source text, and every
general-standard claim is explicitly labeled as such rather than falsely attributed to DeVita:
- "43 to 100 percent" lifetime CRC risk + "~4 percent" lifetime duodenal cancer risk, autosomal
  recessive -> verbatim match, DeVita Small Bowel Cancer ch. (line ~115386-115392: "MUTYH-associated
  polyposis (MAP). MAP is an autosomal recessive disorder with 43% to 100% ... lifetime CRC risk and
  a 4% lifetime risk of duodenal cancer.12").
- MAP listed among familial syndromes with elevated gastric-cancer risk alongside FAP, Lynch,
  Cowden, juvenile polyposis, Li-Fraumeni, Peutz-Jeghers -> matches DeVita Gastric Cancer ch.
  (line ~101228-101234) exactly, same syndrome list and order.
- SCLC-chapter note: germline MUTYH as most common pathogenic germline variant in an SCLC cohort,
  associated with greater platinum sensitivity -> matches DeVita text (line ~74245-74254: "5% of
  patients ... base excision repair gene mutY DNA glycosylase (MUTYH)" / platinum-sensitive
  correlation). Sidecar correctly frames this as an incidental lung-cancer biomarker association,
  not a MAP treatment recommendation - no extrapolation error.
- Every colectomy/surveillance/referral claim is explicitly flagged "(general oncology standard,
  not from DeVita's section on this disease)" and is uncontroversial hereditary-polyposis-syndrome
  standard of care (endoscopic surveillance, escalation to colectomy on unmanageable polyp burden,
  standard-of-stage treatment for established cancer, genetic counseling/cascade testing) - no
  fabricated regimen, trial, or drug name anywhere in the document.

## 3. CITATION
Present. Closing line: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of
Oncology, 12th ed. NCCN Guidelines: Genetic/Familial High-Risk Assessment - Colorectal." Edition
name only, no page numbers, no fabricated section titles.

## 4. VERDICT: CLEAN (ready for R1)

Notes for R1: this is a "no dedicated DeVita chapter" disease - the draft agent's honesty about
sourcing scarcity (3 scattered passages, ~15 lines total) is itself the main thing to sanity-check,
and it holds up: I independently found and confirmed all three passages (Small Bowel Cancer ch.
risk-factor list, Gastric Cancer ch. familial-syndrome list, SCLC ch. MUTYH/platinum note) and no
others exist under "MUTYH" in the digitized text. The heavy reliance on labeled
general-oncology-standard statements (rather than silently presenting them as DeVita content) is
correct behavior for a disease DeVita does not cover in depth, and the file explicitly flags itself
for manual sourcing against NCCN/GeneReviews for surveillance intervals and surgical thresholds -
appropriate given DeVita provides no such specifics for MAP.
