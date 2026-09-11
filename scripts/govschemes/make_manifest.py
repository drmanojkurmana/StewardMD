#!/usr/bin/env python3
"""Write data/govschemes/raw/MANIFEST.tsv - sha256 + size for every downloaded source file.

The raw government workbooks/PDFs (~45MB) are NOT committed; this manifest is, so a later run can
prove it is looking at the same bytes that produced a scheme_version's content_hash. Pair it with
the source URL recorded in the D1 `sources` table.

Usage: python3 scripts/govschemes/make_manifest.py data/govschemes/raw
"""
import sys, hashlib, pathlib

d = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "data/govschemes/raw")
rows = []
for f in sorted(d.iterdir()):
    if f.is_file() and f.name != "MANIFEST.tsv":
        h = hashlib.sha256(f.read_bytes()).hexdigest()
        rows.append(f"{f.name}\t{f.stat().st_size}\t{h}")
(d / "MANIFEST.tsv").write_text("file\tbytes\tsha256\n" + "\n".join(rows) + "\n")
print(f"{len(rows)} files -> {d/'MANIFEST.tsv'}")
