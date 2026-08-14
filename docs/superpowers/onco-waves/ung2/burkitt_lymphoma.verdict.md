# Adversarial verification verdict: burkitt_lymphoma.md

Checked against DeVita 12th ed, Ch. 67 (Non-Hodgkin Lymphoma), BL-specific
"Clinical Features" / "Pathology" / "Immunophenotype and Genetics" / dedicated
"Treatment" subsection (devita.txt lines ~268851-269010; the earlier line
range the draft agent cited, 265886-265920, is actually general NHL
intro/incidence text, not BL-specific — cite correction noted below, does not
change the verdict since the real BL section was located and checked).

## 1. DOSE LEAK
None. Grepped all digits in the sidecar:
- "100 percent" (Ki-67 proliferation fraction) — biology, not a dose.
- "phase III" (trial design descriptor) — not a dose.
- "age over 40", "performance status greater than 2" (BL-IPI risk factors) — prognostic thresholds, not a dose/mg/AUC/cycle count.
- "12th ed" — edition number in the citation line.
No mg, mg/m², AUC, cycle-count, or numbered-schedule figures appear anywhere. The draft agent's claimed omissions (CODOX-M/IVAC OS%, DA-EPOCH-R cycle count "six to eight (two past CR)", EFS/OS percentages, BL-IPI's three OS bands 96%-59%) are indeed all absent from the sidecar as claimed.

## 2. UNGROUNDED CLAIMS
Mostly well-grounded; four items go beyond what's stated in the DeVita BL section:
- **Magrath-regimen component breakdown** ("combining an alkylating agent, an anthracycline, a vinca alkaloid, high-dose methotrexate, and ifosfamide/etoposide/cytarabine components") — DeVita's text names only "CODOX-M/IVAC" and "the original Magrath regimen," it does not spell out the drug-class composition in the reviewed section. This is standard, correct oncology knowledge (that's literally what CODOX-M/IVAC is), but it is not textually grounded in the passage reviewed — it was supplied from general knowledge, not from the source text.
- **"BL in adults behaves biologically the same as childhood BL"** — DeVita states adults are "similarly treated with regimens designed for pediatric populations" (a treatment-pattern statement); it does not make a biological-equivalence claim. This is an inferential overreach dressed as a DeVita-grounded fact.
- **"All three forms spread preferentially to bone marrow and CNS"** — true for endemic and sporadic BL per the text, but the immunodeficiency-associated (HIV) subtype is described in DeVita only as involving "lymph nodes ... and peripheral blood," with no explicit marrow/CNS statement for that subtype in the reviewed passage. Generalizing to "all three" mildly overextends the source.
- **Response-adapted duration claim applied to "first line" broadly** ("therapy is continued for a defined number of cycles past confirmed complete response rather than a fixed total cycle count decided up front") — DeVita ties the "two cycles past CR" response-adapted design specifically to the DA-EPOCH-R study; the sidecar states it as if describing both regimen families (Magrath-type and DA-EPOCH-R) generically, when the CODOX-M/IVAC data in the text is presented as a fixed-protocol OS outcome, not explicitly response-adapted.

None of the four above are fabricated drugs/numbers — they're standard-of-care inferences stretched slightly past the literal reviewed text. All other claims (Ki-67 near 100%, CHOP+IT-MTX insufficiency, rituximab phase III EFS benefit, dismal relapse outcome/ASCT rarely curative, endemic/sporadic clinical presentations, BL-IPI's four factors, the explicitly-flagged non-DeVita items: surgery's diagnostic/complication-only role, HIV testing/ART, fertility preservation) are directly supported by the reviewed passage or honestly labeled as general-oncology-standard rather than DeVita-sourced.

## 3. CITATION
Present: "Sources: DeVita, Hellman, and Rosenberg's Cancer: Principles & Practice of Oncology, 12th ed." — name only, no page numbers. Correct format.

## 4. VERDICT: ISSUES (minor, non-blocking)
- No dose leak — passes the hard gate cleanly.
- Four claims listed above are inferential extensions beyond the literal DeVita BL passage rather than fabrications; all are uncontroversial standard-of-care content. Recommend R1 either (a) accept as-is given they're guideline-standard, or (b) soften wording (e.g., "similarly treated" instead of "biologically the same"; scope the bone-marrow/CNS-spread sentence to endemic+sporadic only; scope response-adapted duration to the DA-EPOCH-R-type regimen rather than both families) before promoting past R1.
- Draft agent's cited line range for the BL clinical section (265886-265920) is wrong — that range is general NHL intro/incidence, not BL-specific; the real BL Clinical Features/Pathology/Treatment content is at ~268851-269010. Content checks out against the correct location; only the internal line-number bookkeeping was off.
