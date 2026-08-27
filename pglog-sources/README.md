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
| `PGMER-2023.txt` | Post-Graduate Medical Education Regulations, 2023 · NMC/PGMEB · File No. N-P016(11)/2/2023-PGMEB-NMC · Gazette of India Extraordinary Part-III §4 | 2026-08-27 |
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
- **PG-MSR 2023/2024 is absent** — the NMC PDF is a scanned image with no extractable text. No
  MSR-derived requirement is claimed anywhere in the module.
- **The PGMEB FAQ (10.04.2024) is absent** — the primary PDF was not reachable. Anything sourced from
  it is graded `nmc_faq_secondary` and is editable by the institution.

## When an NMC document is amended

Re-extract, replace the file here, run `node --test test/pglog-curriculum.test.mjs`. It will name
every pack claim that no longer matches its source.
