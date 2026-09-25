# RadioAnatome: TotalSegmentator re-run vs the original pins (7 cadaver CT modules)

Evidence only, 2026-09-25. Nothing in `atlas/` was changed. Inputs: `/tmp/reseg-out` from the GCP VM run
(`report.json`, `atlas/<id>/atlas.json` + `v2/`, `pinscan/flags.json`, `run.log`), the pre-audit pins at
`5d651f5a5`, the shipped pins at `HEAD` (identical to the working tree for these 7 modules when this was written), and
`atlas-pipeline/pin_fixes.tsv`. `ct-abdomen-axial` is out of scope (recipe recovery failed).

## Verdict

| module | new segmentation vs old | recommendation |
|---|---|---|
| ct-abdomen-coronal | equivalent; soft tissue not verifiable | do not replace shipped pins |
| ct-abdomen-sagittal | equivalent, noisier (4 to 13 jump flags) | do not replace shipped pins |
| ct-pelvis-axial | slightly better | v2 is a candidate after a normal pin audit |
| ct-pelvis-coronal | mixed: hip/femur better, sacrum worse | hold: v2 has 19 blank leading frames |
| ct-pelvis-sagittal | worse | do not ship |
| ct-wholebody-axial | same errors plus new ones | do not ship v2 as built |
| ct-wholebody-coronal | nearly the same mask | v2 is a candidate after removing 3 pins |

**Overall: the re-run is not a better segmentation.** It is a close but not exact reproduction. The pin count
drops by about 23% at the original picks (764 to 586), but most of that drop comes from build code, not the
mask. The current `build.py` caps pins per structure per slice. That cap was fixed in `f034597b8` (2026-08-19),
after these modules were pinned; `f034597b8` only dropped blank frames from them. Between 3 and 64 old pins
per module exceed today's cap (174 in total), and any rebuild would drop them even from an identical mask.
**Do not swap the shipped pins for the new ones.** That would undo the clinician's hand audit (the
new run brings back 6 of the 13 pins the clinician removed or relabelled in these modules) and add no measurable accuracy.
**Ship only parts**: the v2 48-slice stacks for `ct-pelvis-axial` and `ct-wholebody-coronal`, after the
fixes listed below and the usual `pin_scan` review. Hold the rest.

## How to read the numbers

- **Same picks.** The VM recovered each module's crop and slice picks from the shipped pixels. All 7 modules
  re-render **byte-identical** to the shipped images (`images_at_original_picks.level = bytes`), so old and new
  pins are compared on exactly the same picture.
- **Control.** The 9 classical modules (head, thorax, knee) went through the same render and pin code on the
  same VM. They reproduced 880 of 912 pins identically, with 32 moved, 0 missing and 0 extra. The pin code is
  therefore sound, and every difference below comes from the TotalSegmentator mask or from the cap.
- **Pixels vs millimetres.** One display pixel is 0.18 mm (pelvis coronal/sagittal), 0.31 mm (abdomen),
  0.37 mm (pelvis axial), 0.46 mm (whole-body axial) or 2.1 mm (whole-body coronal). The report's
  "changed" (moved more than 1 px) therefore means very different things per module; the medians below are
  converted to mm.
- **Pins move easily.** Each pin is one inside-point per connected component (`pins.py`). A mask that grows
  or splits by a voxel can move that point by centimetres, so distance alone does not say which pin is right.
  The PNGs do.
- **Automated checks**, run identically on old, shipped, new and v2 pins: the `pin_scan.py` tissue and jump
  tests (its own `patch`/`JUMP` code, imported), plus a whole-body **z-order** test that flags a pin outside
  its structure's head-to-feet range ±40 slices. The ranges come from the p1-p99 values in
  `labels/ct-wholebody-axial.json` `_verification`. My v2 tissue and jump counts match the VM's `pinscan` for every module.
- **PNGs** (`reseg/<id>-<slice>.png`): the same shipped image twice, old pins top or left, new pins bottom or
  right, with one colour per structure within a module. A red X marks a pin the hand audit removed.
  `reseg/v2-<id>.png` sheets show selected new v2 frames.

## ct-abdomen-coronal

Images: 23/23 bytes. Pins at the 23 picks: 0 identical, 1 within 1 px, 99 changed (median 5.9 mm, 41 over
10 mm), 38 missing, 8 extra; 28 old pins exceed today's cap. v2: 48 slices, 258 pins, no empty frames.

| structure | old 5d651f5a5 | shipped (hand audit) | new, same picks | new v2 (48) |
|---|---:|---:|---:|---:|
| aorta | 2 | 2 | 3 | 9 |
| autochthonous-back-muscle | 16 | 16 | 13 | 31 |
| colon | 28 | 28 | 29 | 68 |
| duodenum | 1 | 1 | 1 | 4 |
| iliopsoas | 21 | 21 | 13 | 32 |
| lumbar-vertebra | 44 | 44 | 25 | 56 |
| small-bowel | 26 | 26 | 24 | 58 |
| **total** | 138 | 138 | 108 | 258 |
| frames without pins | 3 of 23 | 3 of 23 | 3 of 23 | 0 of 48 |

- No structure appears or disappears at module level. Per slice, presence shifts on a few slices: duodenum
  and small bowel move between slices, aorta gains 1 slice and iliopsoas loses 1.
- Jump flags: old 5, new 9; v2 has 13 jumps plus 1 iliopsoas pin on black (v2 29).
- [slice 13](reseg/ct-abdomen-coronal-13.png): old puts an iliopsoas pin on the lumbar spine (49.8, 69.4)
  and 5 lumbar-vertebra pins on one column. New has 3 lumbar pins, all on vertebral bodies, and its 2 colon pins
  sit inside air-filled lumen. [slice 10](reseg/ct-abdomen-coronal-10.png): the colon pins agree (air-filled
  flexures); small bowel, duodenum and iliopsoas are placed differently, and neither version can be checked on
  unenhanced cadaver soft tissue. [slice 19](reseg/ct-abdomen-coronal-19.png): the two versions agree
  (lumbar pins on posterior elements, back-muscle pins either side).
- The new run also segmented L4 (155 k voxels), L5 (36 k) and sacrum (152 k), which the original never found
  (the label file's `_actually_found` lists L1-L3 only). They get no pins, because the like-for-like mapping
  keeps only the original ids. Unverified; it could add pins later, after the HU check.
- **Verdict: equivalent.** Bone pins are right in both; soft tissue cannot be judged visually. The new colon pins
  look slightly better and the jumps slightly worse.

## ct-abdomen-sagittal

Images: 24/24 bytes. Pins: 1 identical, 1 within 1 px, 113 changed (median 5.1 mm, 37 over 10 mm), 25 missing,
24 extra; 13 old pins exceed today's cap. v2: 48 slices, 317 pins, no empty frames.

| structure | old 5d651f5a5 | shipped (hand audit) | new, same picks | new v2 (48) |
|---|---:|---:|---:|---:|
| aorta | 2 | 2 | 4 | 9 |
| autochthonous-back-muscle | 13 | 13 | 13 | 30 |
| colon | 37 | 37 | 44 | 102 |
| duodenum | 0 | 0 | 2 | 5 |
| iliopsoas | 22 | 22 | 16 | 38 |
| lumbar-vertebra | 34 | 34 | 21 | 47 |
| small-bowel | 32 | 32 | 39 | 86 |
| **total** | 140 | 140 | 139 | 317 |
| frames without pins | 4 of 24 | 4 of 24 | 4 of 24 | 0 of 48 |

- **Duodenum newly appears**: 0 old pins, 2 new pins (slices 11-12), 5 in v2. There is no way to confirm it
  on this cadaver; the label file already says its viscera share one 25-90 HU band.
- Jump flags: old 4, new 13; v2 has 14 jumps plus 1 lumbar-vertebra pin on a dark pixel (v2 15).
- [slice 13](reseg/ct-abdomen-sagittal-13.png): old stacks 2 iliopsoas pins on the L5/S1 vertebral body
  (wrong) and 6 lumbar pins. New drops those, but its back-muscle pin (74.6, 72.4) appears to sit on the
  posterior elements, which are bone. [slice 10](reseg/ct-abdomen-sagittal-10.png): both place lumbar pins on bone and
  aorta/iliopsoas anterior to the spine; they only differ in which components they pin.
  [slice 21](reseg/ct-abdomen-sagittal-21.png): the same 3 colon pins in air-filled colon; new lacks old's
  back-muscle pin.
- **Verdict: equivalent, noisier.** One wrong-tissue pin fixed, one new; the jump flags tripled.

## ct-pelvis-axial

Images: 24/24 bytes. Pins: 1 identical, 4 within 1 px, 89 changed (median 2.0 mm, 25 over 10 mm), 38 missing,
0 extra; 29 old pins exceed today's cap. v2: 48 slices, 191 pins, no empty frames, **0 pin_scan flags**.

| structure | old 5d651f5a5 | shipped (hand audit) | new, same picks | new v2 (48) |
|---|---:|---:|---:|---:|
| femur | 45 | 45 | 34 | 67 |
| hip-bone | 82 | 79 | 56 | 115 |
| sacrum | 5 | 7 | 4 | 9 |
| **total** | 132 | 131 | 94 | 191 |
| frames without pins | 0 of 24 | 0 of 24 | 0 of 24 | 0 of 48 |

- New's nearest old pin of the same structure: 27 within 1 mm, 29 within 1-5 mm, 24 within 5-15 mm, 14 farther.
- Hand audit (3 rows): none is reproduced. The auditor removed a pin on the sacroiliac joint line (slice 1)
  and relabelled posterior midline "hip-bone" pins as sacrum (slices 5-6). New has neither the wrong
  hip-bone pins nor a sacrum pin there, so that is a gap, not an error.
- [slice 17](reseg/ct-pelvis-axial-17.png): old has a **hip-bone pin on the femur** (89.2, 51.1), which is
  still shipped. New labels that bone femur. [slice 10](reseg/ct-pelvis-axial-10.png) and
  [slice 13](reseg/ct-pelvis-axial-13.png): all pins right in both; new has fewer.
- **Verdict: slightly better.** Fewer pins, all on the right bone in the slices examined, one shipped error fixed,
  and a clean v2.

## ct-pelvis-coronal

Images: 21/21 bytes. Pins: 1 identical, 38 changed (median 5.9 mm, 10 over 10 mm), 23 missing, 4 extra;
21 old pins exceed today's cap. v2: 48 slices, 108 pins, **23 of 48 frames without pins** (1-19 and 45-48).

| structure | old 5d651f5a5 | shipped (hand audit) | new, same picks | new v2 (48) |
|---|---:|---:|---:|---:|
| femur | 17 | 17 | 11 | 26 |
| hip-bone | 42 | 42 | 27 | 71 |
| sacrum | 3 | 2 | 5 | 11 |
| **total** | 62 | 61 | 43 | 108 |
| frames without pins | 10 of 21 | 10 of 21 | 11 of 21 | 23 of 48 |

- [slice 12](reseg/ct-pelvis-coronal-12.png) and [slice 13](reseg/ct-pelvis-coronal-13.png): old has
  **hip-bone pins on the femur**, at the greater trochanter/neck (84.4, 61.8) and (88.7, 61.4). Both are still
  shipped. New labels those bones femur. [slice 11](reseg/ct-pelvis-coronal-11.png): all right in both. New
  has 3 hip-bone pins (the cap) and none on the ischiopubic rami.
- [slice 15](reseg/ct-pelvis-coronal-15.png): new **reproduces the audit-removed sacrum pin** on the
  sacroiliac joint line (62.0, 12.5). It adds a second one on the opposite joint line (42.3, 3.1) and leaves
  the sacral body unpinned. Sacrum 3 to 5 pins, all at the joint lines or the top edge.
- v2 empty frames ([sheet](reseg/v2-ct-pelvis-coronal.png)): frames 1-19 (picks 73-185) are anterior soft
  tissue with no bone, so they are correctly empty but teach nothing. v2 starts 29 slices more anterior than the
  original stack (pick 73 vs 102), against the earlier decision to stop shipping frames that teach nothing
  (`e728ea1f2`). Frames 45-48 show the sacrum and coccyx with **no pin**, the known sacrum under-segmentation.
- **Verdict: mixed.** Hip bone and femur are better; the sacrum is worse. The v2 stack needs its range trimmed
  before it is usable.

## ct-pelvis-sagittal

Images: 24/24 bytes. Pins: 1 identical, 39 changed (median 4.2 mm, 9 over 10 mm), 13 missing, 9 extra; 3 old
pins exceed today's cap. v2: 48 slices, 123 pins, frames 1 and 48 without pins (lateral soft tissue, correct).

| structure | old 5d651f5a5 | shipped (hand audit) | new, same picks | new v2 (48) |
|---|---:|---:|---:|---:|
| femur | 18 | 13 | 14 | 32 |
| hip-bone | 34 | 32 | 32 | 87 |
| sacrum | 1 | 0 | 3 | 4 |
| **total** | 53 | 45 | 49 | 123 |
| frames without pins | 5 of 24 | 6 of 24 | 5 of 24 | 2 of 48 |

- **The new run brings back 4 of the 8 pins the clinician removed**:
  - the femur on a small isolated fragment below the femoral head (slice 7, [png](reseg/ct-pelvis-sagittal-07.png));
  - the femur on the ischium (slice 16);
  - the hip-bone on a faint soft-tissue blob (slice 16, pixel-identical at 62.7, 48.9, [png](reseg/ct-pelvis-sagittal-16.png));
  - a sacrum pin at the top-edge cut (slice 10, 53.4, 3.7 vs the removed 52.8, 0.0).

  The other 4 (hip-joint-line femurs on slices 18-19, greater trochanter on 22) do not come back.
- **Sacrum newly pinned where the audit said "not certain"**: 3 new pins, all at y 1-4% (the top edge).
- [slice 13](reseg/ct-pelvis-sagittal-13.png): new adds a **hip-bone pin on the upper sacrum** near the
  midline (68.4, 7.3). [slice 20](reseg/ct-pelvis-sagittal-20.png): right in both.
  [v2 end frames](reseg/v2-ct-pelvis-sagittal.png): correct.
- **Verdict: worse.** It reintroduces judged errors and adds a mislabel.

## ct-wholebody-axial

Images: 24/24 bytes. Pins: 1 identical, 1 within 1 px, 43 changed (median 2.5 mm, 4 over 10 mm), 21 missing,
3 extra; 16 old pins exceed today's cap. v2: 48 slices, 89 pins, 23 frames without pins (25-46, 48).

| structure | old 5d651f5a5 | shipped (hand audit) | new, same picks | new v2 (48) |
|---|---:|---:|---:|---:|
| cervical-vertebra | 5 | 5 | 4 | 6 |
| clavicle | 1 | 1 | 1 | 1 |
| hip-bone | 10 | 10 | 7 | 12 |
| lumbar-vertebra | 14 | 14 | 10 | 17 |
| rib | 10 | 10 | 8 | 12 |
| sacrum | 0 | 0 | 0 | 3 |
| skull | 6 | 6 | 6 | 10 |
| sternum | 2 | 2 | 2 | 4 |
| thoracic-vertebra | 18 | 18 | 10 | 24 |
| **total** | 66 | 66 | 48 | 89 |
| frames without pins | 13 of 24 | 13 of 24 | 13 of 24 | 23 of 48 |

- Empty frames are the legs in both, by design: femur and the other limb bones are deliberately unmapped
  because the arms lie beside the trunk.
- **Z-order errors: old 4, new 5 at the same picks; v2 9 of 89 pins (10%).** Each flagged pin is at least
  40 slices outside its structure's range. I checked 5 of the v2 ones by eye, and all 5 are wrong.
  - Kept from old (also still shipped):
    - lumbar-vertebra and thoracic-vertebra pins on C1/C2 ([slice 3](reseg/ct-wholebody-axial-03.png));
    - 2 skull pins on the right iliac wing ([slice 11](reseg/ct-wholebody-axial-11.png)).
  - New at the same picks: a **hip-bone pin on a rib** at T-spine level ([slice 7](reseg/ct-wholebody-axial-07.png), 24.9, 55.4).
  - v2 only ([sheet](reseg/v2-ct-wholebody-axial.png)):
    - hip-bone at the skull base (v2 4);
    - lumbar, thoracic and sacrum on the cervical spine (v2 5-6);
    - hip-bone on a lower rib (v2 14);
    - thoracic-vertebra at the iliac crest (v2 20);
    - rib on the forearm at hip level (v2 23);
    - **skull on a foot bone** (v2 47).
- [slice 8](reseg/ct-wholebody-axial-08.png): lumbar and rib pins agree.
- **Verdict: worse.** The same mislabels as old, plus new ones; v2 has 9 anatomically impossible pins.

## ct-wholebody-coronal

Images: 24/24 bytes. Pins: **19 identical, 24 within 1 px**, 58 changed (median 5.1 mm = 2.5 display px), 72
missing, 4 extra. **64 of the 72 missing are old pins beyond today's cap**; old slice 14 carries 31 pins. v2:
48 slices, 250 pins, 1 frame without pins (v2 1, anterior skin).

| structure | old 5d651f5a5 | shipped (hand audit) | new, same picks | new v2 (48) |
|---|---:|---:|---:|---:|
| cervical-vertebra | 21 | 21 | 10 | 24 |
| clavicle | 0 | 0 | 2 | 6 |
| hip-bone | 25 | 25 | 15 | 37 |
| lumbar-vertebra | 31 | 31 | 16 | 35 |
| rib | 14 | 14 | 6 | 16 |
| sacrum | 4 | 4 | 3 | 8 |
| skull | 34 | 33 | 34 | 81 |
| sternum | 3 | 3 | 3 | 7 |
| thoracic-vertebra | 41 | 41 | 16 | 36 |
| **total** | 173 | 172 | 105 | 250 |
| frames without pins | 4 of 24 | 4 of 24 | 4 of 24 | 1 of 48 |

- This is the closest reproduction of the seven: 43 of 105 new pins sit within 1 mm of an old pin.
- **Clavicle newly appears.** At the same picks, 1 pin is on the lateral clavicle (slice 12, correct) and 1
  is on the skull (slice 11, 69.9, 7.7, [png](reseg/ct-wholebody-coronal-11.png)). In v2, 4 of 6 are at
  shoulder level and 2 are on the skull (v2 22-23).
- New **reproduces the audit-removed "skull" pin on the pelvis** (slice 12, 30.6, 43.2,
  [png](reseg/ct-wholebody-coronal-12.png)); v2 24 has it too.
- [slice 13](reseg/ct-wholebody-coronal-13.png): old stacks 7 cervical, 4 thoracic and 8 lumbar pins down one
  column; new keeps 2, 3 and 3, all in the right region. [slice 6](reseg/ct-wholebody-coronal-06.png): identical
  in substance.
- **Verdict: same mask, cleaner display.** Two known error types need removing: clavicle pins outside
  z 225-373 and skull pins inferior to z 260 (z counts from the vertex).

## Structures that appear or disappear

| module | appears (new or v2) | disappears |
|---|---|---|
| ct-abdomen-sagittal | duodenum (0 to 2; v2 5) | none |
| ct-wholebody-coronal | clavicle (0 to 2; v2 6, 2 of them on the skull) | none |
| ct-wholebody-axial | sacrum in v2 only (3; v2 6 is on the neck) | none |
| ct-pelvis-sagittal | sacrum 0 shipped to 3 (all at the rejected top edge) | none |
| others | none | none |

## Side findings in the currently shipped atlas (not in pin_fixes.tsv)

- `ct-wholebody-axial` slice 3: lumbar-vertebra (36.7, 51.2) and thoracic-vertebra (61.7, 50.9) on C1/C2.
- `ct-wholebody-axial` slice 11: skull (29.9, 46.6) and (32.1, 48.2) on the right iliac wing.
- `ct-pelvis-coronal` slice 12 hip-bone (84.4, 61.8) and slice 13 hip-bone (88.7, 61.4), both on the femur.
- `ct-pelvis-axial` slice 17: hip-bone (89.2, 51.1) on the femur.

These are candidates for `pin_fixes.tsv` whatever happens to the re-run.

## What to ship, if anything

1. **Keep the shipped pins (21-24 slices) for all 7 modules.** The re-run gives no net accuracy gain, and it would
   discard the hand audit.
2. **`ct-pelvis-axial` v2**: candidate. It has 0 flags and no empty frames, and fixes the femur-as-hip-bone
   pattern. It still needs the normal look-at-every-flag audit.
3. **`ct-wholebody-coronal` v2**: candidate after 3 removals: the skull on the pelvis (v2 24) and the clavicle
   on the skull (v2 22, 23).
4. **Hold**:
   - `ct-pelvis-coronal` v2: trim frames 1-19 first. The sacrum is still wrong.
   - `ct-pelvis-sagittal`: reintroduces 4 audited errors.
   - `ct-wholebody-axial` v2: 9 z-order errors, including skull on the foot.
   - both abdomen modules: soft tissue is unverifiable, and the jump flags are 2-3x the old count.
5. Before any v2 ships, re-apply `pin_fixes.tsv` by position, not by slice number. The slice numbers change
   with 48 frames.

## How strong the evidence is

- **Pelvis and whole-body flags are assumed.** The VM ran `--ml` at native resolution with no `--fast` and
  no `--roi_subset`, because the original command was never recorded (`atlas-pipeline/vm/README.md`).
  Agreement differs:
  - Whole-body coronal agrees closely (43 pins within 1 mm), which supports the assumption for the whole body.
  - Pelvis agrees less (5 of 132 axial pins identical or within 1 px), so the pelvis differences may partly
    come from a different invocation, not a better or worse model.
- **Device.** The originals ran on CPU (a Mac with TS 2.18.0 / torch 2.13.0 per the transcripts, and "a 62 GB
  VM" per the label files). The re-run used an L4 GPU with torch 2.14.0. The version matches; fp16 and the
  device can move mask edges.
- **Abdomen resampling.** The original volume was pre-resampled to 3 mm by hand code that no longer exists.
  The re-run lets `--fast` do the round trip, so the abdomen comparison is the least like-for-like.
- **Cap confound.** 174 of the 230 missing pins exceed today's per-structure cap, so they are a code effect.
  The cap keeps the largest components, so I cannot tell which of the remaining missing pins the mask would
  otherwise have produced.
- **Visual judgement**: 25 comparison PNGs and 3 v2 sheets were looked at. That covers bone on bone-window images
  well. Abdominal soft tissue (bowel, aorta, duodenum, muscles) on unenhanced cadaver CT cannot be confirmed
  by eye, and those verdicts rest on the automated flags. Slice choice: best agreement, largest mask
  disagreement (the cap discounted), mid-stack, plus any slice with a reproduced audit pin. It is a sample,
  not a full audit.
- **The model is confused on this cadaver in ways the pins hide.** Inside the pelvis crop, the pelvis run labels
  9,702 voxels as skull (id 91) and 6,819 as rib_right_9/10 (ids 112/113). These ids come from
  `labels/ct-wholebody-axial.json`, and no id moved in 2.18.0. The pelvis mapping does not use them, so they
  make no pins, but they fit the arms-and-limbs confusion already documented for the whole body.
- The z-order test uses the original run's structure ranges ±40 slices; a pin just outside that margin
  would not be flagged.
