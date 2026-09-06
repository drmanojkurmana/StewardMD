#!/usr/bin/env python3
"""Full-resolution TotalSegmentator `total` run over the Visible Human whole-body CT.

The first whole body was segmented with --fast (3 mm): upsampled to the 1 mm grid the
masks are a voxel staircase and thin bones (ribs, C1-C2, T1-T3) went missing. The 1.5 mm
model fixes both, but the full 512 x 512 x 1877 stack does not fit an 8 GB machine in one
pass. So: cut the stack into overlapping z-chunks, segment each, then stitch. In the overlap a voxel takes its label from the chunk whose centre is
nearer, so every structure is labelled by the chunk that saw it with the most context.

Resumable: a finished chunk (wb_seg_full_<k>.nii.gz) is not re-run.
"""
import argparse
import os
import subprocess
import sys
import time

import numpy as np
import nibabel as nib

_HERE = os.path.dirname(os.path.abspath(__file__))
TS = os.path.join(os.path.dirname(sys.executable), "TotalSegmentator")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(_HERE, "work"))
    ap.add_argument("--chunks", type=int, default=4)
    ap.add_argument("--overlap", type=int, default=60, help="slices of overlap between chunks")
    ap.add_argument("--device", default="mps")
    a = ap.parse_args()

    src = nib.load(os.path.join(a.work, "wb_vol.nii.gz"))
    NZ = src.shape[2]
    aff = src.affine
    edges = np.linspace(0, NZ, a.chunks + 1).astype(int)
    spans = []
    for k in range(a.chunks):
        z0 = max(0, edges[k] - (a.overlap // 2 if k else 0))
        z1 = min(NZ, edges[k + 1] + (a.overlap // 2 if k < a.chunks - 1 else 0))
        spans.append((z0, z1))
    print("chunks", spans, flush=True)

    vol = None
    for k, (z0, z1) in enumerate(spans):
        out = os.path.join(a.work, "wb_seg_full_%d.nii.gz" % k)
        if os.path.exists(out):
            print("chunk %d done already" % k, flush=True)
            continue
        if vol is None:
            vol = np.asanyarray(src.dataobj)
        cin = os.path.join(a.work, "wb_chunk_%d.nii.gz" % k)
        nib.save(nib.Nifti1Image(np.ascontiguousarray(vol[:, :, z0:z1]).astype(np.int16), aff), cin)
        t0 = time.time()
        print("chunk %d z %d..%d -> TotalSegmentator" % (k, z0, z1), flush=True)
        cmd = [TS, "-i", cin, "-o", out, "--ml", "--device", a.device, "-nr", "2", "-ns", "2"]
        r = subprocess.run(cmd)
        if r.returncode != 0:
            raise SystemExit("chunk %d failed (%d)" % (k, r.returncode))
        print("chunk %d done in %.0f s" % (k, time.time() - t0), flush=True)
        os.remove(cin)

    # ---- stitch ----
    del vol
    seg = np.zeros(src.shape, dtype=np.uint8)
    # nearest-centre ownership: precompute for every z which chunk owns it
    centres = [(z0 + z1) / 2.0 for z0, z1 in spans]
    owner = np.array([int(np.argmin([abs(z - c) for c in centres])) for z in range(NZ)])
    for k, (z0, z1) in enumerate(spans):
        part = np.asanyarray(nib.load(os.path.join(a.work, "wb_seg_full_%d.nii.gz" % k)).dataobj).astype(np.uint8)
        zs = np.flatnonzero(owner == k)
        lo, hi = int(zs[0]), int(zs[-1]) + 1
        seg[:, :, lo:hi] = part[:, :, lo - z0:hi - z0]
        print("stitched chunk %d -> z %d..%d (%d labels)" % (k, lo, hi, len(np.unique(part)) - 1), flush=True)
    nib.save(nib.Nifti1Image(seg, aff), os.path.join(a.work, "wb_seg_full.nii.gz"))
    print("wrote wb_seg_full.nii.gz labels", int(seg.max()), flush=True)


if __name__ == "__main__":
    main()
