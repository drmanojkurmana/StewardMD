---
tags: [plan, edge, vision, evaluated]
---
# Cactus Mirage evaluation (2026-11-13)

**Verdict: not adopted. No native plugin, no Scan-Meds change.** See [[Decisions]] 2026-11-13. Re-evaluate on a
new Mirage release that publishes OCR/document benchmarks or handwriting support.

## What it is
- `Cactus-Compute/mirage` on Hugging Face, Apache-2.0, published 2026-11-06 (blog "Mirage: VLM + OCR + Detection +
  Segment + Decide in 22 MB"). 51.3 M params, custom conv + attention encoder at 512 px, 2-bit `.cact` (21.6 MB).
- One call (`cactus_describe`) returns JSON: scene, objects (0-1000 boxes), text lines, masks, relations, and a
  `form` filled from a caller schema (choice, bounded integer, text, box).
- Description languages: English, German, French, Spanish, Italian, Dutch, Polish. No Indian language.
- Published numbers: 74 ms on a Galaxy S26 NPU, 107 ms on its CPU. **No OCR, DocVQA or handwriting benchmark.**
- Runs on the unified Cactus engine (`libcactus.a` + `cactus.h`, 4.1.0), which now also runs Needle 3 and
  Whistle. Prebuilt iOS arm64 (1.97 MB), iOS simulator and Android arm64 static libs. No Swift/Kotlin bindings,
  16 KB page support not stated. Our `capacitor-needle` pins the older standalone `libneedle` (2026-09-28), so
  Mirage would need the new engine, a new or rebuilt plugin, and its own audit.

## Bench (container, not a phone; scripts in `edge-data/mirage-bench/`)
Seven synthetic printed images (clean typed text, the easiest case Scan-Meds will see).

| Image | Result |
|---|---|
| Printed Rx, 4 lines | All lines read; duplicate overlapping spans ("Cap.", "Cap. Omeprazole 20 m", full line) |
| Italic, skewed, noisy | Lines read, plus a garbled duplicate ("Toh Pgracetamol") |
| Strip label | "40 me" for 40 mg, "cn cablet Contains Pantoprazole sadl", lines truncated |
| "Tab. Metformin 500 mg BD" | "Vetformin" |
| Lab report, 3 rows | **Potassium 5.8 (flagged H) dropped entirely** (only "Potassium", "mmo", "H"); creatinine 1.2 and Hb 9.1 read, with stray fragments ("2", "erum Creatinin") |
| `extract` frequency + route enums | `null` on all three orders; "-" (absent) at 0.95+ even when "BD"/"OD"/"TDS"/"IV" was on the image |
| `extract` drug text + dose_mg int | drug = "drug", dose = **1000** for a 500 mg order |

Wall time 0.7 to 1.9 s per image on the container CPU.

## Why not adopted
1. Silent value loss on clean print (an abnormal potassium) and an invented dose are disqualifying for anything
   that touches medication or lab values. Scan-Meds already has Apple Vision OCR on device plus a strong server
   model, with clinician review.
2. Structured `form` output, the feature that made it interesting, did not work on text at all.
3. No handwriting, no Indian languages, no published document benchmarks.
4. Cost: a second engine generation to pin and audit, ABI churn already seen with needle3.

## Other uses checked (2026-11-13): none fit
| Idea | Where | Result |
|---|---|---|
| Image-type gate ("is this a CXR / skin / fundus / ECG / document?") before KardiQ X, ThoreX, SknX, FundX run or upload | 28 images: 5 CXR, 5 skin, 5 fundus, 6 ECG (3 real, 3 drawn), 2 documents, 5 everyday photos | `extract` value **1/28** (returns "-" for nearly everything). Argmax over the real choices **7/28**, about chance; every ECG and fundus wrong. Scene/objects: CXR = "dress", "shoe", "tank"; fundus = "moon", "light bulb", "citrus slice"; ECG on brown paper = "handwritten note" |
| Text boxes for PHI redaction before upload | ThoreX `phiRedactToImage` | Already covered on both platforms by `SMD_NATIVE.ocr` (Apple Vision on iOS, ML Kit on Android), and Mirage missed a whole text value in the lab bench, which would leak PHI |
| Face detection before the SknX cloud upload | `sknx-cloudvision.js` | Not tested further: MediaPipe vision is already bundled (FundX face landmarker), a better-proven option if this is ever wanted |
| Captions / alt text for the Image Library | `image-library.js` | Images are already captioned, and Mirage mislabels medical images (above) |

It is a general-scene model (street signs, objects, cats, coffee); medical images are outside what it knows.
