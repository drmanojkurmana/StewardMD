# StewardMD pamphlets

Print pieces for the app (benchmark: ClinicalKey's two A4 notice-board sheets).

| File | Size | Audience |
| --- | --- | --- |
| `colleges.html` | A4 | Medical colleges, PG residents, faculty |
| `clinicians.html` | A4 | Practising doctors |
| `numbers.html` | A4 | Everyone: "Only on StewardMD" numbers sheet |
| `poster.html` | A3 | Corridor poster combining all three |

Print-ready PDFs are in `out/`. Rebuild after any edit:

```
node render.cjs            # all four
node render.cjs poster     # one
```

`render.cjs` serves this folder, renders with the pre-installed Playwright Chromium and writes
`out/<name>.pdf` plus a `out/<name>.png` preview (PNGs are gitignored). Fonts (Fraunces, Inter)
load from Google Fonts at render time and are embedded in the PDF.

Screens in `img/` were captured from the real app bundle in headless Chromium (390 x 844, 3x) on
2026-10-27. `img/qr.svg` points to https://stewardmd.in.

## Where each number comes from (checked 2026-10-27)
- 4,700+ diseases: live `KB_ENRICHMENT.byId` = 4,770 (Knowledge Library shows "4,770 disease entries").
- 450+ calculators: live `MEDCALC._calcs` = 456.
- 253 protocols in 19 subjects: `vault/modules/Clinical Protocols.md`.
- 1,532 monographs with dose rules: `data/dose-rules.json.gz` (`vault/Roadmap.md`).
- 108 antibiogram sources: `vault/modules/Antibiogram.md`.
- 330 interaction rules: `STEWARDMD_OVERVIEW.md`.
- 260+ chemo regimens: overview counts 267.
- 106,367 ICD codes: `vault/modules/ICD Search.md`.
- 176,430 questions: PrepNucleus bank v4 (`vault/handoff/2026-10-06-prepnucleus.md`). Flag `smd_prep` is default OFF.
- 1,041 ECG lessons, 3,035 ophthalmology questions, 46 NMC anaesthesia competencies, 35 atlases,
  26 kits, 26 FollowCare pathways: the module notes in `vault/modules/`.
- 3,400+ 3D structures: the 3D Anatomy search box reads "Search 3,432 structures".

KardiQ X, ThoreX, FundX and SknX carry an "Early access" chip: they sit behind the access code.
Re-check every figure before a reprint; they move.
