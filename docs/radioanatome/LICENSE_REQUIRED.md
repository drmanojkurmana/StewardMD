# Licence-gated components (DEFERRED, not used)

GENERATED on 2026-08-19. Nothing in this file is used by the pipeline;
`check_sources.require_clear()` refuses every one of them.

Each entry states what anatomy it would unlock, whether buying it actually
solves the problem, and the free alternative. Several are NOT worth buying
because the limitation is our source data, not the model.

## `autopet-fdg-petct`

- **licence** — CC BY-NC 4.0 (NIfTI via FDAT) or TCIA Restricted (DICOM via TCIA)
- **commercial use** — NOT permitted
- **status** — BLOCKED
- **why blocked** — BANNED BY OWNER 2026-08-19: RadioAnatome is to be COMMERCIALLY deployable, and CC BY-NC 4.0 forbids that for as long as the data ships. Owner instruction: no CC BY-NC, research-only or restricted datasets, and PET/CT is to be kept architecturally separate for a later, separately licensed phase. Supersedes the earlier non-commercial position recorded on the same day.
- **verified from** — https://autopet.grand-challenge.org/Dataset/ ; https://www.cancerimagingarchive.net/collection/healthy-total-body-cts/
- **note** — Only whole-body PET/CT found that is redistributable at all. HEALTHY-TOTAL-BODY-CTS was checked and rejected: its segmentations are CC BY 4.0 but the CT IMAGES sit under the NIH Controlled Data Access Policy (facial-reconstruction risk), so they cannot ship. No PD or CC0 whole-body PET/CT exists as of 2026-08-19.

## `fma`

- **licence** — CC BY 3.0 Unported
- **commercial use** — permitted
- **status** — BLOCKED
- **why blocked** — CC BY attribution. Licensor's own page is offline; version taken from OBO Foundry, so PARTIALLY UNVERIFIED.
- **verified from** — https://obofoundry.org/ontology/fma.html

## `freesurfer`

- **licence** — FreeSurfer Software License v1.0
- **commercial use** — permitted
- **status** — BLOCKED
- **why blocked** — Part B 1(b) forces MGH-prefaced licence text into user documentation. Also states clinical applications are neither recommended nor advised. Use fastsurfer-segonly instead.
- **verified from** — https://surfer.nmr.mgh.harvard.edu/fswiki/FreeSurferSoftwareLicense

## `fsl`

- **licence** — FSL Licence
- **commercial use** — NOT permitted
- **status** — BLOCKED
- **why blocked** — Non-commercial. Clauses (2)/(3) reach the DEVELOPMENT PROCESS: using FSL to generate coordinates for a commercial product is caught even if no FSL code ships.
- **verified from** — https://fsl.fmrib.ox.ac.uk/fsl/docs/license.html

## `jhu-icbm-dti-81`

- **licence** — FSL (as distributed)
- **commercial use** — NOT permitted
- **status** — BLOCKED
- **why blocked** — Distributed under the FSL licence; independent non-FSL terms UNVERIFIED. This is why named white matter is hand-authored.
- **verified from** — http://neuro.debian.net/debian/extracts/fsldata/copyright

## `mindboggle-101`

- **licence** — CC BY-NC-SA 3.0 (paper) vs CC BY 4.0 (site) - conflicting
- **commercial use** — NOT permitted
- **status** — BLOCKED
- **why blocked** — Unresolved conflicting licence claims; under the paper's version it is non-commercial AND share-alike. Encumbers the DKT40 classifier.
- **verified from** — https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2012.00171/full

## `nv-segment-ctmr`

- **licence** — Non-commercial
- **commercial use** — NOT permitted
- **status** — BLOCKED
- **why blocked** — Non-commercial weights, so barred by the commercial goal set 2026-08-19. Would otherwise have been the most tempting option on the table: 345+ classes including 50 MRI body classes and 133 brain substructures. Not usable.
- **verified from** — https://github.com/Project-MONAI/VISTA

## `radiopaedia`

- **licence** — Non-commercial educational use
- **commercial use** — NOT permitted
- **status** — BLOCKED
- **why blocked** — Non-commercial only. Free-to-students distribution inside a commercial app does not qualify.
- **verified from** — https://radiopaedia.org/licence

## `tcia`

- **licence** — Per-collection CC BY 3.0/4.0, some NC
- **commercial use** — permitted
- **status** — BLOCKED
- **why blocked** — No CC0 collection found. CC BY 4.0 s3(a) attribution plus a mandatory DOI citation.
- **verified from** — https://www.cancerimagingarchive.net/data-usage-policies-and-restrictions/

## `totalsegmentator-appendicular-bones`

- **licence** — Proprietary subtask weights; free licence for non-commercial use, commercial requires contacting the author
- **commercial use** — NOT permitted
- **status** — PENDING_LICENCE
- **why blocked** — SCOPE CORRECTED 2026-08-19 (PR #712): this is NO LONGER the only route to tibia and fibula. A classical cortical-bone segmenter at 600 HU now yields tibia and fibula free, with no model and no licence (at 300 HU the foot skeleton fuses into one component per foot; at 600 HU it separates into 29). What remains gated is narrow: the PATELLA, and individually-named carpals/metacarpals/phalanges of the hand (the hands lie flat against the thighs over only ~8 cm of axial slices, so no z-banding exists and the free pipeline can honestly say no more than 'bone of the hand'). The free `total` task has femur only; VISTA3D/NV-Segment-CT was checked against its own label_dict.json and has no patella either. Which key is needed depends entirely on the unresolved commercial determination below.
- **verified from** — https://backend.totalsegmentator.com/license-academic/ ; totalsegmentator/map_to_binary.py commercial_models
- **note** — COMMERCIAL STATUS UNRESOLVED - this gate cannot be closed until the owner decides, because the two routes differ in price, not just paperwork. NON-COMMERCIAL: the free academic key at backend.totalsegmentator.com/license-academic/ is self-serve and sufficient. COMMERCIAL: a paid licence must be bought from jakob.wasserthal@usb.ch (no public price). Both positions were recorded on 2026-08-19 and contradicted each other: one entry asserted a reversal to a commercial goal, making the academic key insufficient, while the note asserted StewardMD is non-commercial. Neither is treated as settled here. Current app state as of 2026-08-19 is billing dormant and all features free for everyone (PR #557), which points at non-commercial, but that is an observation and not the owner's determination. Recorded because the register is the audit trail, not the conversation.

## `totalsegmentator-brain-structures`

- **licence** — Proprietary; free for non-commercial, paid commercial licence required
- **commercial use** — NOT permitted
- **status** — BLOCKED
- **why blocked** — Paid commercial licence required (free academic key is not usable under the commercial goal set 2026-08-19). 16 brain substructures. BUT buying it probably does NOT solve the brain: the blocker measured on our data is the SOURCE, not the model — a 33-slice 4 mm cadaver T1 defeated SynthSeg, which ran clean and still returned ~2x L/R asymmetry with most of the brain unlabelled. Fix the data first (see openneuro-cc0), then FastSurfer --seg_only, already CLEAR, is expected to suffice without any purchase.
- **verified from** — https://github.com/wasserth/TotalSegmentator

## `uberon`

- **licence** — CC BY 3.0 Unported
- **commercial use** — permitted
- **status** — BLOCKED
- **why blocked** — CC BY attribution. The LICENSE file is unambiguous even though GitHub's detector reports NOASSERTION.
- **verified from** — https://github.com/obophenotype/uberon/blob/master/LICENSE

## `wikipedia`

- **licence** — CC BY-SA 4.0
- **commercial use** — permitted
- **status** — BLOCKED
- **why blocked** — Attribution plus share-alike, which would force our derived text under BY-SA.
- **verified from** — https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use

## Can these be added later without redesign?

Yes. Every module is produced by `build.py` from (volume, mask, label-map),
and the label map is a plain JSON file mapping model class names to canonical
structure ids. Adding a licensed model later means running it, writing one
label file and re-running build.py — the viewer, catalog, ontology and tests
do not change. PET/CT is the same: a new modality value plus a label file.

