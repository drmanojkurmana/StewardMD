# RadioAnatome orientation: what each module shows, and the evidence

Last verified 2026-09-25. This file is the evidence behind `flipX`, `flipY` and `orient` in
`atlas/modules.json`. `test/atlas-data.test.mjs` parses the table below: the flips and letters
there must match modules.json exactly, and every pin check is re-evaluated against the
module's own shipped pins, so the doc cannot drift from the data.

## Rules applied

- **Letters describe the view AFTER flipX/flipY.** Edges are `left`, `right`, `top`, `bottom`,
  from R L A P S I. An edge with no verified letter stays blank.
- **Data is never flipped.** Images, pins and the slice frame `q` all describe the STORED
  image. The viewer mirrors at display time, so with flipX a displayed fraction a maps to stored
  fraction 1 - a (flipY: b to 1 - b) before it goes through `q`. The 3D cut planes texture the
  stored image.
- **Flips are set per module.** A flipX that puts R on the viewer's left must rest on verified
  laterality: a left-right pin check (living torso), or for the brain the header check below.
  On a cadaver module flipX makes **no laterality claim**: there it only completes a 180-degree
  turn (with flipY) or mirrors a sagittal view so anterior is on the left.
- **No R/L on any cadaver (Visible Human) module.** On that body left and right cannot be
  verified: two landmarks disagree (vault, RadioAnatome).
- **Never a pipeline header.** The pipeline writes its own NIfTI headers (diagonal affines, no
  flips), so those say nothing about orientation. The one header used is the dataset's
  ORIGINAL `t1.nii.gz`, and only because it passes the anatomy check in finding 3.
- **Pin checks** compare the centroids of a structure's shipped pins, as percentages of the
  STORED image box (before any flip). `a.x > b.x` means a sits further right on the stored
  image. Living-module evidence also quotes MASK centroids (fractions of the stored image),
  printed by `atlas-pipeline/living.py`, which also proves each module is an exact re-indexing
  of its source volume and that its images reproduce byte-for-byte.

## Findings worth knowing

1. **Living torso axial and coronal store the patient's right on the image right.** Liver and
   spleen masks say so (liver x 0.70, spleen x 0.23, every slice pooled). The right middle
   lobe agrees (x 0.71; left upper lobe 0.26), and so do the heart (0.45, left of midline)
   and IVC vs aorta pins (56.1 vs 49.0). `flipX` puts them in radiological convention.
2. **Knee, foot and hand stacks were stored rotated compared with every other Visible Human
   module.** `segment_knee_ct.py`, `segment_foot_ct.py` and `segment_hand_ct.py` stack the raw
   slices as `flip(transpose(raw), axis 0)`, which flips the COLUMN axis. `vhp_volume.stack`
   instead does `flipud(raw).T`, which flips the ROW axis. The comment in segment_knee_ct.py
   says "match vhp_volume.stack", but the code does not. What each plane stores, and the fix:
   - axial: turned 180 degrees, posterior at the TOP (fibula above tibia, the tibial crest
     points down, the CT table runs along the top edge). `flipX` + `flipY` turns it back.
   - sagittal: posterior on the LEFT (calcaneus left, toes right; fibula left of tibia).
     `flipX` alone gives the usual anterior-left view. S/I is already right.
   - coronal: S/I is right. Only the horizontal (left/right) axis is mirrored against the other
     cadaver modules, and cadaver left/right is not asserted anyway, so no flip.
   Rebuilding them instead would change every image and pin path.
3. **Brain left/right comes from the original header, checked against the anatomy.**
   Provenance: header, consistent with anatomy on A/P and S/I. `living.py header_check()`
   accepts the ORIGINAL `t1.nii.gz` affine (OpenNeuro ds003563, dcm2niix) only if it is
   axis-aligned and non-degenerate and its A/P and S/I codes match the anatomy of the same
   volume. Result: codes RAS, zooms 0.6 / 0.599 / 0.599 mm, sane. A/P axis: caudate at
   index 221.2 vs cerebellar cortex 117.2, so +index is anterior, which agrees with "A". S/I
   axis: cortex 230.8 vs brainstem 155.2, so +index is superior, which agrees with "S". The
   displays also show it: orbits at the top of the axial, face on the left of the sagittal,
   brainstem at the bottom of the coronal. A head-only T1 has no reliable single-subject L/R
   landmark, so L/R rests on that header: +x index is the patient's RIGHT. The axial and
   coronal store +x to the right, so they show the patient's right on the image right and
   get `flipX`. The SynthSeg hemisphere labels agree (right-labelled at x 0.68 of the stored
   image), but they are not independent: `SynthSeg/predict.py` line 396 orients the volume
   through the same header. If the check ever fails, `living.py` stops and the brain R/L
   letters and flipX must be removed.
4. **The 3D cut planes for the living torso axial stack were misregistered and are fixed.**
   `live3d.py` framed the axial quad on the full 288x288 grid, but the axial module is the
   277x240 crop (`live_c`, offset x 6, y 22). The texture sat up to 39.2 mm off at the image
   corners. Slice levels also came from an image-correlation fit, off by one voxel on 12
   axial and 2 sagittal slices. Planes now come from the exact chain in `living.py`.
   Worst corner error before the fix: axial 39.2 mm, coronal 1.1 mm (half-voxel convention),
   sagittal 1.8 mm. After: 0, with manifest planes equal to atlas.json `q` to 1e-6 m (tested).
   Since the 48-slice stacks (`atlas/<id>/v2/`, 2026-09-25) there is one plane per slice, and
   each plane carries the slice's own `img`, so the 3D layer never guesses an image path.

5. **Living neck (s0021) and thorax-neck (s0897) are re-indexed from anatomy, then stored like the
   torso.** `atlas-pipeline/tsd_living.py` measures each subject's axes from its own masks before
   anything is cut, and every available landmark must agree or it stops. S/I: C2 above T4. A/P:
   trachea in front of the spinal cord. L/R, compared level by level because the neck moves the
   midline: descending aorta left of the cord, superior vena cava right of the cord, the
   brachiocephalic trunk climbing toward the right, heart left of the cord. s0021: descending aorta
   index 81.1 vs cord 103.9 (61 shared levels), SVC 114.4 vs 103.9, trunk origin 93.7 to bifurcation
   107.7, heart 82.6 vs 103.6, so +x index is the patient's RIGHT. s0897: aorta 102.4 vs cord 110.1
   (134 levels), SVC 123.2 vs 108.6, trunk 109.0 to 111.7, heart 99.4 vs 109.6; the liver and spleen
   masks agree independently (x 0.63 vs 0.19 of the stored axial). Both headers say RAS and agree
   with this on every axis, but they are not the evidence. The volume is then stored in the torso
   convention (patient right on the image right, anterior up, index 0 superior), so axial and
   coronal get `flipX` and R/L letters exactly like `ct-live-torso-*`, and the sagittal is
   anterior-left with no flip. `living.py --group live-neck --group live-thorax-neck` proves the
   re-indexing voxel for voxel and prints the mask centroids.

## Per-module table

| module | flipX | flipY | left | right | top | bottom | pin check | evidence |
|---|---|---|---|---|---|---|---|---|
| `ct-live-torso-axial` | yes | no | R | L | A | P | liver.x > spleen.x; middle-lobe-right.x > upper-lobe-left.x; heart.y < spinal-cord.y | Masks: liver x 0.70 vs spleen 0.23; heart y 0.27 vs spinal cord 0.69. Spine and CT table at the bottom |
| `ct-live-torso-coronal` | yes | no | R | L | S | I | liver.x > spleen.x; heart.y < urinary-bladder.y | Masks: liver x 0.70 vs spleen 0.23; heart y 0.02 vs bladder 0.80 |
| `ct-live-torso-sagittal` | no | no | A | P | S | I | heart.x < spinal-cord.x; heart.y < urinary-bladder.y | Masks: heart x 0.24 vs spinal cord 0.71; heart y 0.02 vs bladder 0.80 |
| `ct-live-neck-axial` | yes | no | R | L | A | P | superior-vena-cava.x > aorta.x; thyroid-gland.y < spinal-cord.y; trachea.y < spinal-cord.y | Finding 5. Masks: SVC x 0.62 vs aorta 0.48, heart 0.45; thyroid y 0.29 vs spinal cord 0.53. Spine and CT table at the bottom |
| `ct-live-neck-coronal` | yes | no | R | L | S | I | superior-vena-cava.x > aorta.x; thyroid-gland.y < heart.y | Finding 5. Masks: SVC x 0.62 vs aorta 0.48; cervical vertebrae y 0.33 vs heart 0.92 |
| `ct-live-neck-sagittal` | no | no | A | P | S | I | trachea.x < spinal-cord.x; thyroid-gland.y < heart.y | Finding 5. Masks: thyroid x 0.29 and trachea 0.41 vs spinal cord 0.53; cervical vertebrae y 0.33 vs heart 0.92 |
| `ct-live-thorax-neck-axial` | yes | no | R | L | A | P | liver.x > spleen.x; superior-vena-cava.x > aorta.x; trachea.y < spinal-cord.y | Finding 5. Masks: liver x 0.63 vs spleen 0.19; SVC 0.56 vs aorta 0.48; trachea y 0.49 vs spinal cord 0.60 |
| `ct-live-thorax-neck-coronal` | yes | no | R | L | S | I | liver.x > spleen.x; thyroid-gland.y < heart.y | Finding 5. Masks: liver x 0.63 vs spleen 0.19; thyroid y 0.26 vs heart 0.67 |
| `ct-live-thorax-neck-sagittal` | no | no | A | P | S | I | trachea.x < spinal-cord.x; thyroid-gland.y < heart.y | Finding 5. Masks: trachea x 0.49 vs spinal cord 0.61, heart 0.34; thyroid y 0.26 vs heart 0.67 |
| `mri-brain-axial` | yes | no | R | L | A | P | caudate-nucleus.y < cerebellar-cortex.y | Masks: caudate y 0.40 vs cerebellar cortex 0.70; orbits at the top edge. R/L: header, consistent with anatomy on A/P and S/I (finding 3) |
| `mri-brain-coronal` | yes | no | R | L | S | I | cerebral-white-matter.y < brainstem.y | Masks: cerebral cortex y 0.42 vs brainstem 0.69, cerebellar cortex 0.72. R/L: header, consistent with anatomy on A/P and S/I (finding 3) |
| `mri-brain-sagittal` | no | no | A | P | S | I | caudate-nucleus.x < cerebellar-cortex.x; cerebral-white-matter.y < brainstem.y | Masks: caudate x 0.40 vs cerebellar cortex 0.70; face on the left |
| `brain-mri-axial-t1` | no | no |  |  |  |  | - | Hidden (cadaver, 0 pins); nothing asserted |
| `ct-abdomen-axial` | no | no |  |  | A | P | colon.y < lumbar-vertebra.y | Bowel anterior, vertebra and back muscle (y 80.7) posterior |
| `ct-abdomen-coronal` | no | no |  |  | S | I | lumbar-vertebra.y < iliopsoas.y | Iliac wings along the bottom of slice 17; psoas descends below the lumbar spine |
| `ct-abdomen-sagittal` | no | no | A | P | S | I | colon.x < lumbar-vertebra.x; lumbar-vertebra.y < iliopsoas.y | Abdominal wall left, lordotic spine right, sacrum at the bottom |
| `ct-head-axial` | no | no |  |  | A | P | paranasal-sinus.y < skull.y | Nose and orbits at the top (slice 12), occiput at the bottom |
| `ct-head-coronal` | no | no |  |  | S | I | - | Visual: vertex at the top, orbits then maxilla and mandible below (slice 6) |
| `ct-head-sagittal` | no | no | A | P | S | I | paranasal-sinus.x < skull.x | Face on the left, occiput right, vertex at the top, cervical spine at the bottom |
| `ct-thorax-axial` | no | no |  |  | A | P | sternum.y < thoracic-vertebra.y | Sternum top, spine bottom |
| `ct-thorax-coronal` | no | no |  |  | S | I | - | Visual: clavicles and shoulders at the top, diaphragm and upper abdomen at the bottom |
| `ct-thorax-sagittal` | no | no | A | P | S | I | sternum.x < thoracic-vertebra.x | Sternum left, spine right; neck at the top, diaphragm at the bottom |
| `ct-pelvis-axial` | no | no |  |  | A | P | hip-bone.y < sacrum.y | Pubic symphysis at the top and ischial tuberosities at the bottom (slice 18); iliac wings open toward the top |
| `ct-pelvis-coronal` | no | no |  |  | S | I | sacrum.y < hip-bone.y; hip-bone.y < femur.y | Sacrum, then hip bone, then femur, top to bottom |
| `ct-pelvis-sagittal` | no | no | A | P | S | I | hip-bone.y < femur.y | Pubic ramus lower left, sacrum upper right (slice 12); acetabulum above the femoral head |
| `ct-wholebody-axial` | no | no |  |  | A | P | sternum.y < thoracic-vertebra.y | Sternum top, spine bottom (slice 6); tibia anterior to fibula in the legs (slice 18) |
| `ct-wholebody-coronal` | no | no |  |  | S | I | skull.y < cervical-vertebra.y; thoracic-vertebra.y < lumbar-vertebra.y; lumbar-vertebra.y < sacrum.y | Full cranio-caudal order, vertex at the top |
| `ct-knee-axial` | yes | yes |  |  | A | P | fibula.y < tibia.y | Stored turned 180 degrees (finding 2); flipX + flipY turn it back, no laterality claim. Stored: fibula (posterolateral) above tibia, tibial crest points down, CT table along the top edge |
| `ct-knee-coronal` | no | no |  |  | S | I | femur.y < tibia.y | Femoral condyles above the tibial plateau |
| `ct-knee-sagittal` | yes | no | A | P | S | I | femur.y < tibia.y; fibula.x < tibia.x | Stored posterior-left (finding 2): fibula left of the tibia. flipX mirrors it to anterior-left, no laterality claim |
| `ct-foot-axial` | yes | yes |  |  | A | P | tarsal.y < phalanx-foot.y | Stored turned 180 degrees (finding 2); flipX + flipY turn it back, no laterality claim. Stored: toes toward the bottom, CT table along the top edge |
| `ct-foot-coronal` | no | no |  |  | S | I | tibia.y < tarsal.y; tarsal.y < metatarsal.y | Tibia, then tarsus, then metatarsals, top to bottom |
| `ct-foot-sagittal` | yes | no | A | P | S | I | tibia.y < tarsal.y; tarsal.x < phalanx-foot.x | Stored posterior-left (finding 2): heel left, toes right. flipX mirrors it to anterior-left, no laterality claim |
| `ct-hand-axial` | yes | yes |  |  | A | P | - | Stored turned 180 degrees (finding 2); flipX + flipY turn it back, no laterality claim. Stored: the iliac wings in view converge toward the top (posterior) and flare toward the bottom (anterior) |
| `ct-hand-coronal` | no | no |  |  | S | I | - | Chain, not in-image anatomy (one structure only): cadaver_mm.py rebuilds this module byte-for-byte from the raw slices via segment_hand_ct.py + vhp_volume.reformat, the same code whose S-up coronal output is anatomically verified on knee, foot and every other coronal here; fingertips curl at the bottom (slice 12) |
| `ct-hand-sagittal` | yes | no | A | P | S | I | - | Chain, as above: same stacking as knee and foot (whose sagittals are anatomically posterior-left when stored), rebuilt byte-for-byte; no in-image landmark was checked. flipX mirrors it to anterior-left, no laterality claim |

## Re-checking

    atlas-pipeline/.venv/bin/python atlas-pipeline/living.py --work /abs/path/to/atlas-pipeline/work
    atlas-pipeline/.venv/bin/python atlas-pipeline/living.py --work /abs/path/to/atlas-pipeline/work --group live-neck --group live-thorax-neck
    node test/atlas-data.test.mjs

`living.py` without `--write` re-proves the maps, the byte-identical reproduction, q and the
plane crossings, and prints the mask centroids quoted above. It needs the gitignored volumes
in the main checkout's `atlas-pipeline/work`.
