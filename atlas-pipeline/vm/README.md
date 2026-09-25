# VM re-segmentation of the six older Visible Human CT regions

This job rebuilds the 17 cadaver CT modules on one unattended Google Cloud VM and then powers the VM off. The modules are ct-head, ct-thorax, ct-knee, ct-abdomen and ct-pelvis (axial, coronal and sagittal each), plus ct-wholebody (axial and coronal).

For each module the job does four things:
- Segments the region with the segmenter the original used:
  - segment_head_ct.py, segment_thorax_ct.py and segment_knee_ct.py for the classical regions;
  - TotalSegmentator 2.18.0 for abdomen, pelvis and whole body.
- Re-renders the original 24 picks and compares every image and pin with the pre-audit `5d651f5a5` atlas.json.
- Writes a 48-slice `v2` stack.
- Runs `pin_scan.py` over that stack for the audit.

Nothing here changes the repo. The results land in the bucket for review.

| file | role |
|---|---|
| `run_reseg.sh` | the VM startup script |
| `reseg.py` | the job |
| `recipe.py` | exact image recipes, plus `discover`, which recovers a recipe from the shipped pixels |
| `recipes.json` | the 9 classical recipes, proven byte-identical on the Mac |
| `bundle.sh` | builds the small input bundle; uploads nothing |

## 1. Build the bundle (on the Mac, about 29 MB)

```sh
cd /Users/diwakarkumar/Developer/StewardMD/.claude/worktrees/radioanatome-premium
atlas-pipeline/vm/bundle.sh /tmp/reseg-bundle.tar.gz
```

## 2. Bucket and inputs

```sh
P=project-6074a703-e86c-40a5-848
gcloud storage buckets create gs://smd-radioanatome-reseg --project=$P --location=asia-south1 --uniform-bucket-level-access
gcloud storage cp /tmp/reseg-bundle.tar.gz gs://smd-radioanatome-reseg/in/bundle.tar.gz

# raw slice folders, streamed straight from work/ (no local copy); about 1.5 GB in total, wb alone is 946 MB
W=/Users/diwakarkumar/Developer/StewardMD/atlas-pipeline/work
gcloud storage cp -r $W/head    gs://smd-radioanatome-reseg/in/raw/
gcloud storage cp -r $W/chest   gs://smd-radioanatome-reseg/in/raw/
gcloud storage cp -r $W/knee2   gs://smd-radioanatome-reseg/in/raw/
gcloud storage cp -r $W/abdomen gs://smd-radioanatome-reseg/in/raw/
gcloud storage cp -r $W/pelvis  gs://smd-radioanatome-reseg/in/raw/
gcloud storage cp -r $W/wb      gs://smd-radioanatome-reseg/in/raw/
gcloud storage ls gs://smd-radioanatome-reseg/in/raw/     # expect head/ chest/ knee2/ abdomen/ pelvis/ wb/

# the VM runs as the default compute service account: let it read in/ and write out/
NUM=$(gcloud projects describe $P --format='value(projectNumber)')
gcloud storage buckets add-iam-policy-binding gs://smd-radioanatome-reseg \
  --member=serviceAccount:$NUM-compute@developer.gserviceaccount.com --role=roles/storage.objectAdmin
```

## 3. Create the VM (the startup script runs the whole job)

Before creating it, check two things. Both commands are read-only:

```sh
gcloud compute images describe-from-family pytorch-2-9-cu129-ubuntu-2204-nvidia-580 \
  --project=deeplearning-platform-release --format='value(name,status)'
gcloud compute regions describe asia-south1 --project=$P --format=json | grep -B1 -A1 -i '"NVIDIA_L4_GPUS"'
```

Then create the VM:

```sh
gcloud compute instances create reseg-vhp \
  --project=$P --zone=asia-south1-a \
  --machine-type=g2-standard-16 \
  --image-family=pytorch-2-9-cu129-ubuntu-2204-nvidia-580 --image-project=deeplearning-platform-release \
  --boot-disk-size=200GB --boot-disk-type=pd-balanced \
  --maintenance-policy=TERMINATE --restart-on-failure \
  --scopes=cloud-platform \
  --metadata=reseg-bucket=gs://smd-radioanatome-reseg,install-nvidia-driver=True \
  --metadata-from-file=startup-script=atlas-pipeline/vm/run_reseg.sh
```

- **No capacity in zone a** (`ZONE_RESOURCE_POOL_EXHAUSTED`): run the same command with `--zone=asia-south1-b`, then `-c`.
- **The L4:** it comes with the g2-standard-16 machine type, so there is no `--accelerator` flag. If the create is refused for lack of a GPU, that is the L4 quota shown by the check above.
- **Retry the same name after a zone failure:** delete any half-created instance first.

## 4. Watch it

```sh
gcloud storage cat gs://smd-radioanatome-reseg/out/run.log | tail -40        # uploaded every 5 min
gcloud compute instances get-serial-port-output reseg-vhp --zone=asia-south1-a --project=$P | tail -40
gcloud compute instances describe reseg-vhp --zone=asia-south1-a --project=$P --format='value(status)'
```

`TERMINATED` means the job finished, or failed, and uploaded everything.

- **Failure:** the EXIT trap still uploads the log and every output that exists, then powers off.
- **Restart:** a restarted VM does not re-run the job. It uploads again and powers off, because `/var/reseg/.ran` records the first attempt.
- **Time limit:** the job is capped at 11 h.

## 5. Pull the results, then delete the VM

```sh
mkdir -p /tmp/reseg-out
gcloud storage rsync --recursive --exclude='^seg/' gs://smd-radioanatome-reseg/out /tmp/reseg-out   # leave out the masks
gcloud storage cp -r gs://smd-radioanatome-reseg/out/seg /tmp/reseg-out/                           # optional: masks, to rebuild without re-segmenting
gcloud compute instances delete reseg-vhp --zone=asia-south1-a --project=$P                        # a stopped VM still bills its 200 GB disk
```

What `out/` holds:

| path | contents |
|---|---|
| `report.json` | per region: command, seconds and voxels per label |
| `report.json` | per module: the recipe; `images_at_original_picks` (levels: bytes, pixels, near); `pins_vs_5d651f5a5` (identical, within 1 px, changed, missing, extra); every differing pin in `pin_differences`; `v2` (picks, pins, frames without pins); the viewer schema check |
| `versions.json` | Python stack, libwebp, TotalSegmentator, nnunetv2, torch, CUDA and GPU |
| `pip-freeze-*.txt` | full package lists |
| `recipes_vm.json` | the crop and picks recovered on the VM for the 8 TotalSegmentator modules |
| `atlas/<id>/atlas.json`, `atlas/<id>/v2/` | the 48-slice stacks. Images live at `/atlas/<id>/v2/NNN.webp`, the same layout as the living modules. Only images, thumbs and pins; q frames, extra windows and planes are not generated here. |
| `pinscan/` | `flags.json` and one PNG per flagged pin |
| `seg/<folder>_seg.nii.gz` | the new masks |

## Mac dry run (no TotalSegmentator, no gcloud, no shutdown)

```sh
atlas-pipeline/vm/bundle.sh /tmp/reseg-bundle.tar.gz
DRY_RUN=1 PIPE_PY=$PWD/atlas-pipeline/.venv/bin/python BUNDLE_TGZ=/tmp/reseg-bundle.tar.gz \
  RAW_DIR=/Users/diwakarkumar/Developer/StewardMD/atlas-pipeline/work ROOT=/tmp/reseg-dry MODULES=ct-head-axial \
  atlas-pipeline/vm/run_reseg.sh
rm -rf /tmp/reseg-dry
```

Result on 2026-09-25 for ct-head-axial:
- **Images:** 24 of 24 byte-identical to 5d651f5a5.
- **Pins:** 105 of 105 identical.
- **v2:** 48 slices, 205 pins, viewer schema clean, 9 pin_scan flags.

## Provenance: how each original was segmented

- **TotalSegmentator version 2.18.0.** The installed version was not recorded in the repo, and the Mac venv that ran it no longer exists. The version comes from two session transcripts:
  - `~/.claude/projects/-Users-diwakarkumar-Downloads-Stewardmd/0eeb624a-cd48-415d-94f6-e21dfb5ad0b2.jsonl`. On 2026-08-18 the install step queried PyPI ("TotalSegmentator latest: 2.18.0") and reported "TotalSegmentator OK, torch 2.13.0".
  - `-Users-diwakarkumar-Developer-StewardMD--claude-worktrees-atlas3d-bodyparts/25a8b400-….jsonl`, which shows "TS 2.18.0" and "torch 2.13.0 cuda False mps True".
  - `run_reseg.sh` pins `TotalSegmentator==2.18.0`. It uses the image's CUDA torch rather than 2.13.0.
- **Abdomen.** Recovered verbatim from the same transcript 0eeb624a, 2026-08-18T14:49:48Z:
  - The volume was stacked with `vhp_volume.py stack --raw-dir work/abdomen` (NIfTI affine diag(0.9375, 0.9375, 1)).
  - The run was `TotalSegmentator -i abd_vol.nii.gz -o abd_seg.nii.gz --ml --fast --roi_subset` over 25 classes: liver, spleen, kidney_left, kidney_right, pancreas, gallbladder, stomach, duodenum, small_bowel, colon, urinary_bladder, aorta, inferior_vena_cava, adrenal_gland_left, adrenal_gland_right, vertebrae_L1 to vertebrae_L5, sacrum, iliopsoas_left, iliopsoas_right, autochthon_left and autochthon_right. `reseg.py` `TS_ARGS` repeats it exactly.
  - It ran on the CPU.
  - Caveat: the final run's log `work/ts-abd3.log` shows a 3 mm input. It reports "cropping from (160, 160, 93)", and its resample and save steps took milliseconds. The memory note `-Users-diwakarkumar-Downloads-Stewardmd/memory/radioanatome-atlas.md` explains why: the 8 GB laptop ran out of memory in TotalSegmentator's final resample, so the volume was pre-resampled to 3 mm by hand and the mask was nearest-neighbour upsampled back. That hand-resample code is not recorded anywhere.
  - On the 64 GB VM, `--fast` makes TotalSegmentator do the same 3 mm round trip itself. The two paths can differ by a voxel at mask edges; `pins_vs_5d651f5a5` measures the difference.
  - `work/abd_lut.json` equals the label file's `model_values`, the 11 classes that run found.
- **Pelvis and whole body: NOT recovered.** No transcript or script of those runs exists locally.
  - Their label files (`_geometry`) say TotalSegmentator `total` ran at native 0.9375 mm on a 62 GB VM.
  - `work/pel_ts.log` holds only progress bars.
  - The VM therefore runs `--ml` with no `--fast` and no `--roi_subset`. That is an assumption.
- **Head, thorax, knee: classical, no model.** The label files' `_geometry` say so. `recipes.json` crops are relative to each script's own output, and on the VM `crop0_is_crop_pair` confirms each crop is still the script's `crop_pair` box.
- **Label ids.** For the TotalSegmentator regions, `model_values` is re-derived by name from 2.18.0's `class_map["total"]`, using only the names the original mapping listed. Any id that moved is recorded as `model_value_changes`. Other classes the new run finds appear in `voxels_per_value` but get no pins.

## Known uncertainties

- **Pelvis and whole-body invocation.** The flags are an assumption; see above.
- **Abdomen resampling.** The original resampled by hand; TotalSegmentator's own `--fast` path stands in for it.
- **Weights need GitHub.** TotalSegmentator downloads its weights from github.com release assets, so the VM needs outbound internet. Only GitHub *repo* access is absent.
  - To avoid the download, pre-stage the weights into `gs://smd-radioanatome-reseg/in/totalseg/`, laid out as `TOTALSEG_HOME_DIR`. The script syncs them if present.
- **GPU vs CPU.** The originals ran on the CPU, at least the abdomen. The VM uses the L4 (fp16), so masks can differ slightly at edges.
- **webp bytes across platforms.** Pillow 12.3.0 bundles libwebp 1.6.0 on both platforms, but lossy encoding on x86 vs arm64 may not be byte-identical. That is why image checks report a level:
  - `bytes`;
  - `pixels`, meaning identical decoded pixels;
  - `near`, meaning a decoded MAD of 0.5 or less.
  - Discovery accepts `near`.
- **Python version.** If the image's newest Python is 3.10, numpy and scipy cannot be pinned to the Mac versions (2.5.3 and 1.18.1 need Python 3.11 or later). The run then uses the newest compatible versions and records them.
- **Crops of the TotalSegmentator modules.** Their crops came from masks that no longer exist. `discover` first tries `crop_pair` on the new mask, then a pixel-space search against the shipped images. A module whose images cannot be matched is reported with `error` and gets no v2 stack.
- **Whole-body memory.** Native-resolution `total` on 1877 slices. nnU-Net falls back to the CPU if the 24 GB L4 is short; 64 GB of RAM covers that.
- **Disk type.** `--boot-disk-type=pd-balanced` is set because G2 does not take pd-standard. If the create rejects it, drop the flag.
