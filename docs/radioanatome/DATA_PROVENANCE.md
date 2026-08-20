# Data provenance

GENERATED on 2026-08-19.

| dataset | licence | licence URL | redistribute? | derivatives? | used for |
|---|---|---|---|---|---|
| `autopet-fdg-petct` | CC BY-NC 4.0 (NIfTI via FDAT) or TCIA Restricted (DICOM via TCIA) | https://autopet.grand-challenge.org/Dataset/ ; https://www.cancerimagingarchive.net/collection/healthy-total-body-cts/ | NO | NO | NOT USED - deferred |
| `jhu-icbm-dti-81` | FSL (as distributed) | http://neuro.debian.net/debian/extracts/fsldata/copyright | NO | NO | - |
| `mindboggle-101` | CC BY-NC-SA 3.0 (paper) vs CC BY 4.0 (site) - conflicting | https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2012.00171/full | NO | NO | - |
| `openneuro-cc0` | CC0 1.0 Public Domain Dedication (verified in the dataset's own dataset_description.json) | https://openneuro.org/datasets/ds003563/versions/1.1.0 ; https://openneuro.org/faq | yes | yes | living brain MRI (planned) |
| `spl-nac-brain-atlas` | 3D Slicer License Part B | https://github.com/Slicer/Slicer/blob/main/License.txt | yes | yes | not currently used |
| `tcia` | Per-collection CC BY 3.0/4.0, some NC | https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/ | NO | NO | not used |
| `totalsegmentator-dataset` | CC BY 4.0 | https://zenodo.org/records/10047292 | yes | yes | living-patient CT soft tissue, organs, vessels |
| `visible-human` | US Government work, no copyright; NLM download Terms and Conditions apply | https://www.nlm.nih.gov/databases/download/terms_and_conditions.html | yes | yes | whole-body + regional CT skeleton, all planes |
| `wikimedia-cc0` | CC0 / Public Domain (hard-filtered) | https://commons.wikimedia.org/wiki/Commons:Licensing | yes | yes | not currently used |

## Notes per dataset

### `autopet-fdg-petct`
- licence: CC BY-NC 4.0 (NIfTI via FDAT) or TCIA Restricted (DICOM via TCIA)
- verdict: **BLOCKED**
- attribution: required: Gatidis S, Kuestner T, University Hospital Tuebingen, plus DOI citation
- Only whole-body PET/CT found that is redistributable at all. HEALTHY-TOTAL-BODY-CTS was checked and rejected: its segmentations are CC BY 4.0 but the CT IMAGES sit under the NIH Controlled Data Access Policy (facial-reconstruction risk), so they cannot ship. No PD or CC0 whole-body PET/CT exists as of 2026-08-19.

### `jhu-icbm-dti-81`
- licence: FSL (as distributed)
- verdict: **BLOCKED**
- attribution: n/a
- Distributed under the FSL licence; independent non-FSL terms UNVERIFIED. This is why named white matter is hand-authored.

### `mindboggle-101`
- licence: CC BY-NC-SA 3.0 (paper) vs CC BY 4.0 (site) - conflicting
- verdict: **BLOCKED**
- attribution: required
- Unresolved conflicting licence claims; under the paper's version it is non-commercial AND share-alike. Encumbers the DKT40 classifier.

### `openneuro-cc0`
- licence: CC0 1.0 Public Domain Dedication (verified in the dataset's own dataset_description.json)
- verdict: **CLEAR**
- attribution: none required
- THE BRAIN ANSWER, and it costs nothing. OpenNeuro releases data under CC0 by default, which places no restrictions on who may use it or for what, commercial included. ds003563 publishes several resolutions; the volume ACTUALLY ingested is the 0.6 mm isotropic 7T MPRAGE (sub-yv98 ses-0481), confirmed from its own NIfTI header, and it was segmented with SynthSeg v1.0, not FastSurfer from a LIVING subject - far better than the 1 mm the brain pipeline needs, and the exact opposite of the 33-slice 4 mm cadaver T1 that defeated SynthSeg. Paired with fastsurfer-segonly (already CLEAR) this is expected to yield real brain labels with NO purchase. Verify the specific dataset's own licence field before ingesting: CC0 is the default, not a guarantee, and a few datasets opt out.

### `spl-nac-brain-atlas`
- licence: 3D Slicer License Part B
- verdict: **CLEAR**
- attribution: notice retention only
- 300+ hand-labelled structures; highest-quality single source. Part B 1(b) notice goes in Settings > Legal.

### `tcia`
- licence: Per-collection CC BY 3.0/4.0, some NC
- verdict: **BLOCKED**
- attribution: required plus DOI citation
- No CC0 collection found. CC BY 4.0 s3(a) attribution plus a mandatory DOI citation.

### `totalsegmentator-dataset`
- licence: CC BY 4.0
- verdict: **CLEAR**
- attribution: required: one credit line plus the Zenodo DOI
- THE SINGLE BIGGEST UNLOCK FOUND. 1228 CT volumes of real LIVING clinical patients across many scanners, institutions and pathologies, WITH 117 anatomical structures already expertly labelled. CC BY 4.0 permits commercial use AND redistribution of the images and of derivatives, with attribution. This needs NO segmentation model and NO model licence: the masks are supplied, so liver, spleen, kidney, lung, muscle, vessels and cardiac structures become available WITHOUT buying anything. It also fixes the real problem, which is that Visible Human is a frozen cadaver: living tissue has normal HU, so lung reads -700 to -850 instead of -540, organs separate on contrast, and muscle reads +20 to +70 instead of the -13 to -21 measured in our pelvis. CAVEAT: these are clinical studies chosen for pathological variety, so near-normal volumes must be CURATED by a clinician before use as an anatomy reference. Distinct from the existing rule against RUNNING the model on this dataset: shipping the CC BY 4.0 images and labels directly is a different and legitimate route that costs only an attribution line.

### `visible-human`
- licence: US Government work, no copyright; NLM download Terms and Conditions apply
- verdict: **CLEAR**
- attribution: one credit line required
- Licence agreement requirement was dropped in 2019. The credit obligation is contractual (from the download T&C), not copyright.

### `wikimedia-cc0`
- licence: CC0 / Public Domain (hard-filtered)
- verdict: **CLEAR**
- attribution: none
- Only files whose extmetadata License is pd or cc0. Keep the extmetadata blob per file as an audit record; Commons tags are user-asserted and sometimes wrong.

