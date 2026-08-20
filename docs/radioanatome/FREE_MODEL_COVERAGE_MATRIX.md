# Free model coverage matrix

GENERATED on 2026-08-19.

Read the **blocker** column before proposing a purchase. Where the blocker is
VHP DATA, no model licence fixes it — the contrast is absent from the voxels,
and the fix is living-patient source data, which is free under CC BY 4.0.

| structure family | best model | works on VHP cadaver? | free? | blocker | expected quality |
|---|---|---|---|---|---|
| Skeleton (skull, spine, ribs, sternum, clavicle, pelvis, femur) | TotalSegmentator total | YES | FREE (Apache-2.0) | - | SHIPPED, HU-verified |
| Knee / tibia / fibula / patella | TotalSegmentator appendicular_bones | YES (bone survives freezing) | GATED | model licence | deferred; classical fallback planned |
| Hands / feet / small bones | TotalSegmentator appendicular_bones | YES | GATED | model licence | deferred; classical fallback planned |
| Liver, spleen, kidneys, pancreas, gallbladder, stomach, bowel | expert masks shipped WITH the CC BY 4.0 dataset | NO | FREE (CC BY 4.0) | VHP DATA: one 25-90 HU band, no contrast | good on living CT |
| Lungs and lung LOBES | expert masks in the CC BY 4.0 dataset | NO | FREE (CC BY 4.0) | VHP DATA: -540 HU vs -700/-850 living; no fissures | good on living CT |
| Heart, chambers, myocardium | expert masks in the CC BY 4.0 dataset | NO | FREE (CC BY 4.0) | VHP DATA: needs contrast | good on living CT |
| Aorta and major vessels | expert masks in the CC BY 4.0 dataset | NO | FREE (CC BY 4.0) | VHP DATA: no contrast in a cadaver | good on living angiographic CT |
| Skeletal muscle and fat | expert masks in the CC BY 4.0 dataset | NO | FREE (CC BY 4.0) | VHP DATA: pelvic muscle measured -13..-21 HU, 32-40% below -30 HU (fat) | good on living CT |
| Airway / trachea / larynx | TotalSegmentator total | NO | FREE | VHP DATA: air-in-body measured at 0 voxels; the airway is not air-filled | good on living CT |
| Brain: cerebrum, cerebellum, brainstem, ventricles, thalamus, basal ganglia | FastSurfer --seg_only | NO | FREE (Apache-2.0 code) | VHP DATA: 33-slice 4 mm cadaver T1 defeated SynthSeg | good on a living 1 mm T1 (OpenNeuro CC0) |
| Coronary arteries | none free and verified | NO | NONE FOUND | needs cardiac CTA plus a dedicated model | NOT AVAILABLE |
| PET / metabolic | n/a - PET has no anatomy to segment | n/a | NO CLEAN DATA | no commercially clean whole-body PET/CT exists | NOT AVAILABLE, deferred by design |

## The one purchase that is actually justified

`appendicular_bones` — tibia, fibula, patella, and the hand and foot bones.
It is the ONLY row where the limitation is the model rather than our data:
bone contrast survives freezing, so the cadaver can support these labels.
VISTA3D was checked against its own `label_dict.json` and has no tibia, fibula
or patella either, so it is not a free substitute. A classical
threshold-plus-position segmenter is the free fallback.

## Purchases that would NOT help

- `brain_structures` — SynthSeg ran clean on our cadaver T1 and still returned
  ~2x L/R asymmetry with most of the brain unlabelled. Fix the data first.
- `tissue_types`, `heartchambers_highres` — cannot recover contrast that was
  never in the image.

