#!/usr/bin/env python3
"""Pull individual members out of the 22 GB TotalSegmentator dataset zip on Zenodo,
without downloading the archive.

Why this exists: the dataset is published as ONE 22 GB zip, but a module needs only a
handful of subjects (~11 MB of CT each, plus a few tiny masks). Zenodo honours HTTP
range requests, so the zip's central directory can be read remotely and single members
fetched by byte offset. Streaming a member through remotezip in one shot proved
unreliable — Zenodo drops long connections mid-read (`IncompleteRead`) — so each member
is fetched in bounded chunks with retries and inflated locally.

LICENCE: the dataset is CC BY 4.0 (verified from the Zenodo record's own metadata:
license.id == "cc-by-4.0"). Commercial use, redistribution and derivatives are all
permitted with attribution. See atlas-pipeline/sources.json -> totalsegmentator-dataset
and DATA_PROVENANCE.md. Nothing here bypasses access control; it is a range read of a
public file.
"""
import argparse
import os
import sys
import time
import zlib

URL = ("https://zenodo.org/records/10047292/files/"
       "Totalsegmentator_dataset_v201.zip")
CHUNK = 4 * 1024 * 1024
RETRIES = 6


def _members(url):
    from remotezip import RemoteZip
    with RemoteZip(url) as z:
        return {i.filename: (i.header_offset, i.compress_size, i.file_size,
                             i.compress_type) for i in z.infolist()}


def _range(url, start, end):
    """Bytes [start, end] inclusive, retried. Returns b'' only if the range is empty."""
    import requests
    last = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(url, headers={"Range": f"bytes={start}-{end}"},
                             timeout=180, stream=True)
            if r.status_code not in (200, 206):
                raise IOError(f"HTTP {r.status_code}")
            buf = bytearray()
            for part in r.iter_content(1 << 20):
                buf += part
            want = end - start + 1
            if len(buf) != want:
                raise IOError(f"short read {len(buf)} of {want}")
            return bytes(buf)
        except Exception as exc:                      # network flakiness is expected here
            last = exc
            time.sleep(min(2 ** attempt, 20))
    raise IOError(f"range {start}-{end} failed after {RETRIES} tries: {last}")


def fetch(url, name, offset, csize, fsize, ctype, out_path):
    """Fetch one zip member and write it inflated to out_path."""
    # local file header: 30 bytes fixed + name + extra; read it to find the data start
    head = _range(url, offset, offset + 29)
    if head[:4] != b"PK\x03\x04":
        raise IOError(f"{name}: not a local file header at {offset}")
    n_len = int.from_bytes(head[26:28], "little")
    x_len = int.from_bytes(head[28:30], "little")
    data0 = offset + 30 + n_len + x_len

    raw = bytearray()
    pos = data0
    remaining = csize
    while remaining > 0:
        take = min(CHUNK, remaining)
        raw += _range(url, pos, pos + take - 1)
        pos += take
        remaining -= take

    if ctype == 0:                                    # stored
        data = bytes(raw)
    else:                                             # deflate
        data = zlib.decompress(bytes(raw), -zlib.MAX_WBITS)
    if len(data) != fsize:
        raise IOError(f"{name}: inflated {len(data)} != expected {fsize}")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as fh:
        fh.write(data)
    return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="destination directory")
    ap.add_argument("--subject", action="append", default=[],
                    help="subject id, e.g. s0108 (repeatable)")
    ap.add_argument("--mask", action="append", default=[],
                    help="mask stem to fetch per subject, e.g. liver (repeatable). "
                         "Omit for the CT only; pass 'ALL' for every mask.")
    ap.add_argument("--url", default=URL)
    a = ap.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from check_sources import require_clear
    require_clear("totalsegmentator-dataset")         # the gate, before any network use

    idx = _members(a.url)
    for sub in a.subject:
        wanted = [f"{sub}/ct.nii.gz"]
        if a.mask == ["ALL"]:
            wanted += [k for k in idx if k.startswith(f"{sub}/segmentations/")
                       and k.endswith(".nii.gz")]
        else:
            wanted += [f"{sub}/segmentations/{m}.nii.gz" for m in a.mask]
        for name in wanted:
            if name not in idx:
                print(f"  MISSING in archive: {name}")
                continue
            out = os.path.join(a.out, name)
            if os.path.exists(out) and os.path.getsize(out) > 0:
                continue
            off, csize, fsize, ctype = idx[name]
            t = time.time()
            got = fetch(a.url, name, off, csize, fsize, ctype, out)
            print(f"  {name:52} {got/1048576:7.2f} MB  {time.time()-t:5.1f}s")


if __name__ == "__main__":
    main()
