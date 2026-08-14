# Adversarial verification verdict — radiation_enteritis.md (wave8)

## 1. DOSE LEAK
None. Grepped for mg / mg-m2 / AUC / mg-kg / mcg / units / q-w schedules / cycle-day patterns: zero hits.
All-numbers scan of the file surfaces only:
- "Grade 2" rectal bleeding (a toxicity grade, matches DeVita's own wording verbatim, not a dose)
- "40 to 60 days" (a survival-duration threshold from guidelines DeVita cites for offering home PN — not a drug dose/AUC/mg/schedule)
- "12th ed" (citation edition number)
Sidecar explicitly and correctly declines to reproduce DeVita's own numeric treatment-schedule detail for hyperbaric oxygen ("2.4 atmospheres... median of 36 sessions (90 minutes)") and the meta-analysis sample size ("12 studies totalling 437 patients") even though both appear in the source — good discipline, not a leak.

## 2. UNGROUNDED CLAIMS
None found that are both (a) unsupported by the DeVita text and (b) not disclosed as general-oncology-standard / not marked as such.
Spot-checks against DeVita 12th ed (grep hits at devita.txt lines ~327179-327185, ~159886-159929, ~341484-341527, ~338420-338448):
- Acute enteritis/proctitis timing (within 6 weeks; resolves in 2-6 months), late enteritis/proctitis timing (8-12 months, can be delayed years), mechanism (prostaglandin release + bile salt malabsorption → increased peristalsis), bacterial overgrowth flagged with strictures/enterocolic fistulas, pancolitis resembling IBD — all verbatim-consistent with the diarrhea chapter (devita.txt:327172-327185).
- Late rectal toxicity passage: rectal bleeding/mucous discharge/mild incontinence, Grade 2 bleeding treated with steroid suppositories/sitz baths/fiber, caution against deep rectal biopsies/cauterization, argon-beam plasma coagulation for refractory bleeding, hyperbaric oxygen rationale (ischemic mucosa, angiogenesis, healing) — all verbatim-consistent (devita.txt:159916-159930).
- MBO section: radiation enteritis as a named MBO cause alongside tumor/adhesions; antisecretory agents (somatostatin analog, steroids, scopolamine), pain meds, antiemetics; NG decompression/IV hydration — verbatim-consistent (devita.txt:341484-341504).
- Home PN section: radiation enteritis listed among reasons for home PN; meta-analysis conclusion (limited benefit, high cost, suggestion of survival benefit); 40-60 day survival guideline threshold; good performance status + caretaker support prerequisites — verbatim-consistent (devita.txt:338420-338445).
- Items explicitly hedged as "(general oncology standard, not from DeVita's section on this disease)" — antidiarrheal/antispasmodic/low-residue diet, bile acid sequestrants for bile-salt-malabsorption diarrhea, case-by-case treatment breaks, obliterative endarteritis/fibrosis as the mechanism for surgical risk in irradiated bowel, longitudinal nutrition monitoring — none of these are DeVita citations, all are uncontroversial standard-of-care statements, and the file is honest that they're outside the grepped DeVita passages (obliterative endarteritis specifically was not found via grep in the supplied DeVita text, but the file already discloses it as general-standard, not a DeVita claim, so no fabrication risk).
- The closing "What DeVita does not specify" section correctly lists the gaps (no specific antidiarrheal/antibiotic drug choice, no dedicated small-bowel endoscopic/surgical algorithm) rather than inventing them.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: CLEAN — ready for R1.
No dose/schedule leak, no unsupported specific regimen/drug/trial/statistic, DeVita-vs-general-standard attribution is consistently and correctly disclosed throughout, citation line present and properly formatted.
