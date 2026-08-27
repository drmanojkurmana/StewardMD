#!/bin/bash
set -e
W=/Users/diwakarkumar/Developer/StewardMD/.claude/worktrees/audit-sweep
SRC=$W/store-assets/raw-app-screens
OUT=$W/scrollcraft/builds/stewardmd/assets

conv () { cwebp -quiet -q 82 -resize 560 0 "$SRC/$1.png" -o "$OUT/m-$2.webp"; }

conv 03-reasoning        maik
conv 05-interactions     drugs
conv 13-infusion-pump    icu
conv 12-antibiogram-dark abx
conv 02-library          kb
conv 09-pyelo-safety     renal
conv 08-tb-safety        tb

ls -la "$OUT"
