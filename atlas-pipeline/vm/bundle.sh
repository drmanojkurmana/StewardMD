#!/usr/bin/env bash
# Build the small input bundle for the VM re-segmentation (code, labels, atlas.json files and the
# 5d651f5a5 reference images). Prints its size. Uploads NOTHING; the raw slice folders are NOT in
# it (README: they go to the bucket straight from atlas-pipeline/work with `gcloud storage cp -r`).
# Usage: atlas-pipeline/vm/bundle.sh [out.tar.gz]      (default /tmp/reseg-bundle.tar.gz)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/reseg-bundle.tar.gz}"
REF=5d651f5a5
STAGE="$(mktemp -d /tmp/reseg-bundle.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
REGIONS="head thorax knee abdomen pelvis wholebody"

P="$STAGE/atlas-pipeline"
mkdir -p "$P/labels" "$P/vm"
for f in orient.py slices.py build.py pins.py labels.py vhp_volume.py check_sources.py pin_scan.py sources.json \
         segment_head_ct.py segment_thorax_ct.py segment_knee_ct.py; do
  cp "$REPO/atlas-pipeline/$f" "$P/$f"
done
for r in $REGIONS; do cp "$REPO/atlas-pipeline/labels/ct-$r-axial.json" "$P/labels/"; done
cp "$REPO/atlas-pipeline/vm/recipe.py" "$REPO/atlas-pipeline/vm/reseg.py" "$REPO/atlas-pipeline/vm/recipes.json" \
   "$REPO/atlas-pipeline/vm/run_reseg.sh" "$P/vm/"
cp "$REPO/atlas.js" "$STAGE/atlas.js"              # read-only copy: the viewer's schema check

n_ref=0
for r in $REGIONS; do
  for plane in axial coronal sagittal; do
    mid="ct-$r-$plane"
    [ -f "$REPO/atlas/$mid/atlas.json" ] || continue
    mkdir -p "$STAGE/current/atlas/$mid" "$STAGE/ref5d/atlas/$mid"
    cp "$REPO/atlas/$mid/atlas.json" "$STAGE/current/atlas/$mid/"
    # the pre-audit module: atlas.json + every top-level NNN.webp, read-only from git
    git -C "$REPO" ls-tree --name-only "$REF" "atlas/$mid/" | grep -E '/(atlas\.json|[0-9]{3}\.webp)$' > "$STAGE/.list"
    while IFS= read -r path; do
      git -C "$REPO" show "$REF:$path" > "$STAGE/ref5d/$path"
      n_ref=$((n_ref + 1))
    done < "$STAGE/.list"
  done
done
rm -f "$STAGE/.list"

tar -czf "$OUT" -C "$STAGE" .
echo "bundle: $OUT"
echo "  modules: $(ls "$STAGE/current/atlas" | wc -l | tr -d ' ')   5d651f5a5 files: $n_ref"
echo "  size: $(du -h "$OUT" | cut -f1) ($(wc -c < "$OUT" | tr -d ' ') bytes)"
