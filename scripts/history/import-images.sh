#!/usr/bin/env bash
# Today in Medical History: convert generated images (PNG/JPG/WEBP named MM-DD-YYYY.*) into the app's
# banner pictures: 480x360 WebP on pure black, about 15-25 KB each, in data/history/img/. Then rebuilds the
# month files so each event knows its picture.  Usage: scripts/history/import-images.sh <folder>
set -euo pipefail
SRC="${1:?folder of images}"; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; OUT="$ROOT/data/history/img"
mkdir -p "$OUT"; n=0; bad=0
for f in "$SRC"/*.{png,PNG,jpg,JPG,jpeg,webp}; do
  [ -f "$f" ] || continue
  b="$(basename "${f%.*}")"
  if ! [[ "$b" =~ ^[01][0-9]-[0-3][0-9]-[0-9]{3,4}$ ]]; then echo "skip (name is not MM-DD-YYYY): $f"; bad=$((bad+1)); continue; fi
  # fit inside 480x360, pad with black (the app screen-blends it, so black disappears on every theme)
  ffmpeg -y -loglevel error -i "$f" -vf "scale=480:360:force_original_aspect_ratio=decrease,pad=480:360:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p" \
    -c:v libwebp -quality 72 -compression_level 6 "$OUT/$b.webp"
  n=$((n+1))
done
node "$ROOT/scripts/history/build-history.mjs"
echo "imported $n, skipped $bad, total size: $(du -sh "$OUT" | cut -f1)"
