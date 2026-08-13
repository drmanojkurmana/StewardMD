# Verdict: familial_adenomatous_polyposis.md

## 1. DOSE LEAK
None. No mg / mg-m2 / AUC / numbered drug-cycle schedule anywhere in the sidecar.
The only numbers present are ages/screening intervals ("ages 10 to 12 years", "every 1 to 3
years", "fifties or sixties"), which match DeVita Table 40.6 verbatim ("Flexible sigmoidoscopy
to start at ages 10 to 12 y"; "upper endoscopy with side-viewing scope ... every 1 to 3 y") and
are surveillance intervals, not dosing/regimen numbers — acceptable.

## 2. UNGROUNDED CLAIMS
Spot-checked against DeVita 12th ed, Ch. 40 "Cancer of the Colon" (Table 40.3, Table 40.5,
Table 40.6, FAP narrative ~line 120056-120220) and the Soft Tissue Sarcoma chapter (desmoid
section, ~line 211100-218025).

- **Sulindac named specifically as FAP adenoma chemoprevention** — `grep -i sulindac` on the
  full DeVita text returns exactly ONE hit, and it is in the Soft Tissue Sarcoma chapter as a
  systemic therapy for established **desmoid tumors**, not colonic-adenoma chemoprevention in
  FAP. DeVita's FAP/colon-chapter narrative does not mention sulindac at all. The claim is
  clinically true and guideline-standard (Giardiello et al., long-standing FAP chemoprevention
  literature) but is not supported by the DeVita passage the draft agent says it grounded from.
- **COX-2 inhibitor for FAP adenoma burden** — DeVita's NSAID/COX-2 chemoprevention discussion
  (CAPP2 aspirin trial, rofecoxib) is about Lynch syndrome and sporadic CRC, not FAP specifically.
  Real-world uncontroversial (celecoxib had an historical FDA FAP indication) but not tied to
  the FAP passage in this text.
- **"Papillary thyroid carcinoma" as the specific subtype + "ultrasound surveillance"** — DeVita's
  FAP extracolonic-manifestations list says only "thyroid tumors"; it does not specify the
  papillary histology or prescribe ultrasound as the surveillance modality. Medically correct and
  uncontroversial, but an added specificity beyond the source text.
- **Desmoids as "a major driver of morbidity and mortality after colectomy"** — not stated in the
  excerpted DeVita text. DeVita does say desmoids can cause obstruction/complications and that
  abdominal desmoids may be located "in the bed of a prior surgery" (Ch. 60), which supports the
  surgery-provokes-desmoid link, but the mortality-driver framing is an addition not found in the
  grounding text (it is a well-known real-world fact from the polyposis literature, just not from
  this source).
- **"Restorative proctocolectomy" / "ileal pouch"** — reasonably close paraphrase of DeVita's own
  wording ("total proctocolectomy," "continent pull-through procedures," ileorectal anastomosis
  with rectal surveillance via proctoscopy for the FAP/UC surgical section). Not flagging as
  fabricated, just noting it's a terminology substitution rather than a verbatim match.

None of the above are statistics, trial names, or drug doses invented out of nothing — they are
real, standard, uncontroversial FAP-management facts — but they are not actually traceable to the
~90 DeVita lines the draft agent cited as the grounding source, and one of them (sulindac) is
lifted from a different chapter's different context (desmoid treatment, not adenoma
chemoprevention). Worth a light-touch fix before R1 rather than a rewrite.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology,
12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES (minor, non-blocking)
No dose leak, no invented trials/statistics, no fabricated regimens. The flagged items above are
real/uncontroversial clinical facts that are either (a) sourced from a different DeVita chapter
than claimed (sulindac — desmoid chapter, not adenoma chemoprevention) or (b) more specific than
what DeVita's FAP passage actually says (papillary subtype, ultrasound modality, mortality-driver
framing for desmoids). Recommend R1 either soften these four claims to match DeVita's actual
wording or accept them as well-established outside-DeVita general knowledge explicitly (rather
than implying colon-chapter grounding). Nothing here rises to the level of blocking fabrication.
