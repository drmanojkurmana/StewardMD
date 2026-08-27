# NMC source extracts — the evidence behind every claim the NMC Logbook makes

Plain-text extractions (`pdftotext -layout`) of the official NMC PDFs the module's curriculum packs
are built from. Fetched **2026-08-27** from `nmc.org.in`.

## Why these are in the repo

`test/pglog-curriculum.test.mjs` checks **every numeric target in every pack against the text in this
directory**. Before these files existed the test compared a target against a quotation the generator
had synthesised *from that same target* — which could not fail, and which is how 17 of the Emergency
Medicine procedure minima went missing without any test noticing. R1 caught it; this directory is the
fix.

So: a number in a pack is only allowed to exist if it appears here. Nothing else is evidence.

## Not a runtime asset

These are **test fixtures and an audit trail**. They live at the repo root, deliberately *outside*
`pglog/`, so `scripts/build-www.sh` (which copies `pglog/`) never puts 868 KB of regulation text into
the native bundle.

## The files

| File | Source | Fetched |
|---|---|---|
| `PGMER-2023.txt` | **THE PUBLISHED GAZETTE** — PGMER-2023 · CG-DL-E-03012024-251108 · *PUBLISHED BY AUTHORITY* · 29 Dec 2023. **The only PGMER text this module may cite.** | 2026-08-27 |
| `PGMER-2023-DRAFT-prepublication.txt` | **NOT AUTHORITATIVE.** The `LatestNews/MER.pdf` rendition, headed *"[To be published in the Gazette of India…]"*. The module was built against it until 2026-08-27; its clause numbering and some wording differ. Retained so the correction is auditable. | 2026-08-27 |
| `PGMEB-FAQ-2024-04-10.txt` | PGMEB clarification on PGMER-2023 (FAQs), 10 Apr 2024. Scan → OCR; caveats in its own header. **Defines the attendance denominator.** | 2026-08-27 |
| `PGMSR-2023.txt` | Minimum Standard of Requirements for PG Courses, 2023, 15 Jan 2024. Institutional capacity, **not** logbook content. | 2026-08-27 |
| `Faculty-Qualifications-Regulations-2025.txt` | Medical Institutions (Qualifications of Faculty) Regulations, 2025 · gazette 30 Jun 2025. **s.16/s.17 define who may be a PG Guide.** | 2026-08-27 |
| `Faculty-Qualifications-FAQ-2025-10-28.txt` | FAQs on the above, 28 Oct 2025. Nothing in this module derives from it. | 2026-08-27 |
| `MCI-Logbook-Guidelines-2020-UG.txt` | *Guidelines for preparing Logbook*, 17 Jan 2020 — **for the UNDERGRADUATE programme**, despite the PG curricula cross-referencing it. Retained for the UG phase. | 2026-08-27 |
| `gen_med.txt` | MD General Medicine (revised), NMC 2022 | 2026-08-27 |
| `gen_surg.txt` | MS General Surgery, NMC 2019 | 2026-08-27 |
| `obg.txt` | MS Obstetrics & Gynaecology, NMC 2019 | 2026-08-27 |
| `paeds.txt` | MD Paediatrics (revised), NMC 2022 | 2026-08-27 |
| `anaes.txt` | MD Anaesthesiology, NMC 2019 | 2026-08-27 |
| `ortho.txt` | MS Orthopaedics (revised), NMC 2022 | 2026-08-27 |
| `radio.txt` | MD Radiodiagnosis, NMC 2019 | 2026-08-27 |
| `patho.txt` | MD Pathology (revised), NMC 2022 | 2026-08-27 |
| `psych.txt` | MD Psychiatry (revised), NMC 2022 | 2026-08-27 |
| `derm.txt` | MD Dermatology, Venereology & Leprosy, NMC 2019 | 2026-08-27 |
| `ophth.txt` | MS Ophthalmology, NMC 2019 | 2026-08-27 |
| `ent.txt` | MS Otorhinolaryngology, NMC 2019 | 2026-08-27 |
| `commed.txt` | MD Community Medicine, NMC 2019 | 2026-08-27 |
| `emerg.txt` | MD Emergency Medicine Curriculum V6, NMC 2024 | 2026-08-27 |
| `resp.txt` | MD Pulmonary (Respiratory) Medicine, NMC 2019 | 2026-08-27 |

Full URLs are in `NMC_PG_LOGBOOK_REQUIREMENTS.md` §10.

## Caveats

- **These are extractions, not the PDFs.** Layout extraction of a two-column table can reorder text
  and split a label from its number across lines. The test therefore matches on the number *and* a
  distinctive token of the label, and any pack requirement whose label was reworded for the UI
  carries the original PDF spelling in its `sourceText` field.
- ~~PG-MSR absent~~ — **obtained 2026-08-27** (`PGMSR-2023.txt`, text-extractable). It contains no
  logbook specification; exactly one per-resident figure is used, and it is reconstructed from a
  table (see `sourceFragments` in the pack).
- ~~PGMEB FAQ absent~~ — **obtained 2026-08-27**. Now graded `nmc_faq`, not `nmc_faq_secondary`.
- **The `PGMER-2023.txt` here is the GAZETTE.** If you are diffing against something that numbers the
  e-logbook clause 5.2(v), you are looking at the draft. The gazette numbers it **5.2(vi)**.

## When an NMC document is amended

Re-extract, replace the file here, run `node --test test/pglog-curriculum.test.mjs`. It will name
every pack claim that no longer matches its source.
