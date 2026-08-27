#!/bin/bash
# Copy the built page to the site path. Root index.html and _site/ are NOT
# touched: root is the clinician app and build-www.sh copies it into the
# native bundles.
set -e
W=/Users/diwakarkumar/Developer/StewardMD/.claude/worktrees/audit-sweep
SRC=$W/scrollcraft/builds/stewardmd
DST=$W/product

mkdir -p "$DST/assets"
cp "$SRC/index.html"      "$DST/index.html"
cp "$SRC/scrollcraft.css" "$DST/scrollcraft.css"
cp "$SRC/scrollcraft.js"  "$DST/scrollcraft.js"
cp "$SRC"/assets/*.webp   "$DST/assets/"
cp "$SRC"/assets/*.woff2  "$DST/assets/"

echo "deployed to $DST"
du -sh "$DST"
ls -1 "$DST" "$DST/assets"
