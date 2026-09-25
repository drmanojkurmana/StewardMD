# RadioAnatome orientation: what each module shows, and the evidence

Last verified 2026-09-25. This file is the evidence behind `flipX` and `orient` in
`atlas/modules.json`. `test/atlas-data.test.mjs` parses the table below: the letters and flipX
there must match modules.json exactly, and every pin check is re-evaluated against the
module's own shipped pins, so the doc cannot drift from the data.

## Rules applied

- **Letters describe the view AFTER flipX.** Edges are `left`, `right`, `top`, `bottom`, from
  R L A P S I. An edge with no verified letter stays blank.
- **Data is never flipped.** Images, pins and the slice frame `q` all describe the STORED
  image. With flipX the viewer mirrors at display time, so a displayed fraction a maps to
  stored fraction 1 - a before it goes through `q` (the 3D cut planes texture the stored image).
- **flipX only where the module shows the patient's right on the image right in an axial or
  coronal plane, and that was verified from anatomy.** It is set on 2 modules.
- **No R/L on any cadaver (Visible Human) module.** On that body left and right cannot be
  verified: two landmarks disagree (vault, RadioAnatome).
- **Never the header alone.** The pipeline writes its own NIfTI headers (diagonal affines, no
  flips), so a pipeline header tells you nothing about orientation.
- **Pin checks** compare the centroids of a structure's shipped pins, as percentages of the
  image box and before flipX. `a.x > b.x` means a sits further right on the stored image.
  Living-module evidence also quotes MASK centroids (fractions of the image, before flipX),
  printed by `atlas-pipeline/living.py`, which also proves each module is an exact
  re-indexing of its source volume and that its images reproduce byte-for-byte.

## Findings worth knowing

1. **Living torso axial and coronal show the patient's right on the image right.** Liver and
   spleen masks say so (liver x 0.70, spleen x 0.23, every slice pooled). The right middle
   lobe agrees (x 0.71; left upper lobe 0.26), and so do the heart (0.45, left of midline)
   and IVC vs aorta pins (56.1 vs 49.0). `flipX` puts them in radiological convention.
2. **Knee, foot and hand stacks are rotated 180 degrees compared with every other Visible
   Human module.** `segment_knee_ct.py`, `segment_foot_ct.py` and `segment_hand_ct.py` stack the
   raw slices as `flip(transpose(raw), axis 0)`, which flips the COLUMN axis. `vhp_volume.stack`
   instead does `flipud(raw).T`, which flips the ROW axis. The comment in segment_knee_ct.py
   says "match vhp_volume.stack", but the code does not. Result: in the axial view the posterior
   is at the TOP (fibula above tibia, the tibial crest points down, the CT table runs along the
   top edge). In the sagittal view the posterior is on the LEFT (calcaneus left, toes right). The
   letters below say exactly that. The contract has no vertical flip, and flipX is reserved for
   R/L, so these modules stay non-conventional until the viewer gets a `flipY` (axial) and a
   horizontal mirror for sagittal. Rebuilding them would change every image and pin path.
3. **Brain left/right is NOT verified.** SynthSeg hemisphere labels (left-labelled hemisphere
   at x 0.31, right-labelled at 0.68, in the axial and coronal views) come from the input
   header, not from anatomy. `SynthSeg/predict.py` line 396 aligns the volume to RAS through
   its affine before predicting, and the network is trained with left/right flips that swap
   the labels. So the labels restate the t1.nii.gz header (dcm2niix, RAS). No reliable
   single-subject anatomical L/R marker exists in a head-only T1. Taken at face value, the
   header puts the patient's right on the image right. The brain modules therefore get A/P
   and S/I letters but no R/L and no flipX, matching their notice ("left and right are
   deliberately not asserted"). If the header is accepted as sufficient, `flipX: true` plus
   R/L letters on `mri-brain-axial` and `mri-brain-coronal` is a two-line change.
4. **The 3D cut planes for the living torso axial stack were misregistered and are fixed.**
   `live3d.py` framed the axial quad on the full 288x288 grid, but the axial module is the
   277x240 crop (`live_c`, offset x 6, y 22). The texture sat up to 39.2 mm off at the image
   corners. Slice levels also came from an image-correlation fit, off by one voxel on 12
   axial and 2 sagittal slices. Planes now come from the exact chain in `living.py`.
   Worst corner error before the fix: axial 39.2 mm, coronal 1.1 mm (half-voxel convention),
   sagittal 1.8 mm. After: 0, with manifest planes equal to atlas.json `q` to 1e-6 m (tested).

## Per-module table

| module | flipX | left | right | top | bottom | pin check | evidence |
|---|---|---|---|---|---|---|---|
| `ct-live-torso-axial` | yes | R | L | A | P | liver.x > spleen.x; middle-lobe-right.x > upper-lobe-left.x; heart.y < spinal-cord.y | Masks: liver x 0.70 vs spleen 0.23; heart y 0.27 vs spinal cord 0.69. Spine and CT table at the bottom |
| `ct-live-torso-coronal` | yes | R | L | S | I | liver.x > spleen.x; heart.y < urinary-bladder.y | Masks: liver x 0.70 vs spleen 0.23; heart y 0.02 vs bladder 0.80 |
| `ct-live-torso-sagittal` | no | A | P | S | I | heart.x < spinal-cord.x; heart.y < urinary-bladder.y | Masks: heart x 0.24 vs spinal cord 0.71; heart y 0.02 vs bladder 0.80 |
| `mri-brain-axial` | no |  |  | A | P | caudate-nucleus.y < cerebellar-cortex.y | Masks: caudate y 0.40 vs cerebellar cortex 0.70; orbits at the top edge |
| `mri-brain-coronal` | no |  |  | S | I | cerebral-white-matter.y < brainstem.y | Masks: cerebral cortex y 0.42 vs brainstem 0.69, cerebellar cortex 0.72 |
| `mri-brain-sagittal` | no | A | P | S | I | caudate-nucleus.x < cerebellar-cortex.x; cerebral-white-matter.y < brainstem.y | Masks: caudate x 0.40 vs cerebellar cortex 0.70; face on the left |
| `brain-mri-axial-t1` | no |  |  |  |  | - | Hidden (cadaver, 0 pins); nothing asserted |
| `ct-abdomen-axial` | no |  |  | A | P | colon.y < lumbar-vertebra.y | Bowel anterior, vertebra and back muscle (y 80.7) posterior |
| `ct-abdomen-coronal` | no |  |  | S | I | lumbar-vertebra.y < iliopsoas.y | Iliac wings along the bottom of slice 17; psoas descends below the lumbar spine |
| `ct-abdomen-sagittal` | no | A | P | S | I | colon.x < lumbar-vertebra.x; lumbar-vertebra.y < iliopsoas.y | Abdominal wall left, lordotic spine right, sacrum at the bottom |
| `ct-head-axial` | no |  |  | A | P | paranasal-sinus.y < skull.y | Nose and orbits at the top (slice 12), occiput at the bottom |
| `ct-head-coronal` | no |  |  | S | I | - | Visual: vertex at the top, orbits then maxilla and mandible below (slice 6) |
| `ct-head-sagittal` | no | A | P | S | I | paranasal-sinus.x < skull.x | Face on the left, occiput right, vertex at the top, cervical spine at the bottom |
| `ct-thorax-axial` | no |  |  | A | P | sternum.y < thoracic-vertebra.y | Sternum top, spine bottom |
| `ct-thorax-coronal` | no |  |  | S | I | - | Visual: clavicles and shoulders at the top, diaphragm and upper abdomen at the bottom |
| `ct-thorax-sagittal` | no | A | P | S | I | sternum.x < thoracic-vertebra.x | Sternum left, spine right; neck at the top, diaphragm at the bottom |
| `ct-pelvis-axial` | no |  |  | A | P | hip-bone.y < sacrum.y | Pubic symphysis at the top and ischial tuberosities at the bottom (slice 18); iliac wings open toward the top |
| `ct-pelvis-coronal` | no |  |  | S | I | sacrum.y < hip-bone.y; hip-bone.y < femur.y | Sacrum, then hip bone, then femur, top to bottom |
| `ct-pelvis-sagittal` | no | A | P | S | I | hip-bone.y < femur.y | Pubic ramus lower left, sacrum upper right (slice 12); acetabulum above the femoral head |
| `ct-wholebody-axial` | no |  |  | A | P | sternum.y < thoracic-vertebra.y | Sternum top, spine bottom (slice 6); tibia anterior to fibula in the legs (slice 18) |
| `ct-wholebody-coronal` | no |  |  | S | I | skull.y < cervical-vertebra.y; thoracic-vertebra.y < lumbar-vertebra.y; lumbar-vertebra.y < sacrum.y | Full cranio-caudal order, vertex at the top |
| `ct-knee-axial` | no |  |  | P | A | fibula.y < tibia.y | Rotated 180 degrees (finding 2): fibula (posterolateral) above tibia, tibial crest points down, CT table along the top edge |
| `ct-knee-coronal` | no |  |  | S | I | femur.y < tibia.y | Femoral condyles above the tibial plateau |
| `ct-knee-sagittal` | no | P | A | S | I | femur.y < tibia.y; fibula.x < tibia.x | Posterior on the LEFT (finding 2): fibula left of the tibia |
| `ct-foot-axial` | no |  |  | P | A | tarsal.y < phalanx-foot.y | Rotated 180 degrees (finding 2): toes toward the bottom, CT table along the top edge |
| `ct-foot-coronal` | no |  |  | S | I | tibia.y < tarsal.y; tarsal.y < metatarsal.y | Tibia, then tarsus, then metatarsals, top to bottom |
| `ct-foot-sagittal` | no | P | A | S | I | tibia.y < tarsal.y; tarsal.x < phalanx-foot.x | Posterior on the LEFT (finding 2): heel left, toes right |
| `ct-hand-axial` | no |  |  | P | A | - | Rotated 180 degrees (finding 2): the iliac wings in view converge toward the top (posterior) and flare toward the bottom (anterior) |
| `ct-hand-coronal` | no |  |  | S | I | - | Chain, not in-image anatomy (one structure only): cadaver_mm.py rebuilds this module byte-for-byte from the raw slices via segment_hand_ct.py + vhp_volume.reformat, the same code whose S-up coronal output is anatomically verified on knee, foot and every other coronal here; fingertips curl at the bottom (slice 12) |
| `ct-hand-sagittal` | no | P | A | S | I | - | Chain, as above: same stacking as knee and foot (whose sagittals are anatomically posterior-left), rebuilt byte-for-byte; no in-image landmark was checked |

## Re-checking

    atlas-pipeline/.venv/bin/python atlas-pipeline/living.py --work /abs/path/to/atlas-pipeline/work
    node test/atlas-data.test.mjs

`living.py` without `--write` re-proves the maps, the byte-identical reproduction, q and the
plane crossings, and prints the mask centroids quoted above. It needs the gitignored volumes
in the main checkout's `atlas-pipeline/work`.
