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
`out/<name>.pdf` plus a `out/<name>.png` preview (PNGs are gitignored). Type follows the app:
Bricolage Grotesque for display (`--smd-dsp`) and Inter for text (see Fonts below).

Screens in `img/` were captured from the real app bundle in headless Chromium on 2026-10-27:
phone 390 x 844 @3x, iPad 1180 x 820 @2x. `make-screens.py <capture_dir>` adds the iOS status bar
(so the notch sits over it, never over the app header) and builds the watch images.

Devices:
- iPhone, Android phone, foldable and Apple Watch frames in `img/frames/` are the owner's supplied images
  (transparent outside and in the screen; the two watch images had their backgrounds removed with
  `cut-frames.py`). Their source and licence are the owner's call; swap in the makers' official marketing
  frames before a large print run. `make-screens.py` fits each capture to its frame's own screen opening.
- iPad: CSS frame (`.ipad` in `pamphlet.css`).
- Big screens carry the high-reach modules: Kardia Echo Lab and AngioLAB, Antibiogram.

Fonts: static TrueType files in `fonts/` (Inter, Bricolage Grotesque, Noto Sans Telugu, Noto Sans Devanagari;
all OFL, `fonts/OFL.txt`), instanced from Google Fonts' variable sources. Chrome writes variable web fonts
into a PDF as Type 3 glyphs, which the iPhone PDF viewer draws soft and unhinted; check with
`pdffonts out/<name>.pdf` that every font is CID TrueType.

No blurred `box-shadow` anywhere: Chromium writes it into the PDF as a translucent image that the
iPhone PDF viewer draws as a grey box. The footer credits MaiKnowledge (logo from the company letterhead).
`img/qr.svg` points to https://stewardmd.in.

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
- 1,041 ECG lessons, 3,035 ophthalmology questions, 46 NMC anaesthesia competencies (Anesthetica), 35 atlases,
  26 kits, 26 FollowCare pathways: the module notes in `vault/modules/`.
- 3,400+ 3D structures: the 3D Anatomy search box reads "Search 3,432 structures".

KardiQ X, ThoreX, FundX and SknX carry an "Early access" chip: they sit behind the access code.
Re-check every figure before a reprint; they move.
