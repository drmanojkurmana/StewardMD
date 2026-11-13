#!/usr/bin/env bash
# Today in Medical History: turn generated pictures into the app's banner images (480x360 WebP, about 15-25 KB,
# pure black kept: the app screen-blends it away) in data/history/img/, then rebuild the month files.
#   scripts/history/import-images.sh <folder>              files already named MM-DD-YYYY(.png/.jpg/.webp)
#   scripts/history/import-images.sh --part N <folder>     Gemini downloads with random names: matched to the
#                                                          list in gemini-prompt-N-of-M.txt by the order they
#                                                          were saved (oldest first)
# Afterwards it rewrites the Gemini prompts so they ask only for the pictures still missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; OUT="$ROOT/data/history/img"; BATCH=""
if [ "${1:-}" = "--part" ]; then BATCH="$2"; shift 2; fi
SRC="${1:?folder of images}"; mkdir -p "$OUT"; n=0; bad=0
conv() { ffmpeg -y -loglevel error -i "$1" -vf "scale=480:360:force_original_aspect_ratio=decrease,pad=480:360:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p" -c:v libwebp -quality 72 -compression_level 6 "$OUT/$2.webp"; }
if [ -n "$BATCH" ]; then
  PROMPT="$(ls "$ROOT"/data/history/gemini/gemini-prompt-"$BATCH"-of-*.txt 2>/dev/null | head -1)"
  [ -n "$PROMPT" ] || { echo "no gemini-prompt-$BATCH-of-*.txt"; exit 1; }
  mapfile -t NAMES < <(grep -oE '^[0-9]+\. [01][0-9]-[0-3][0-9]-([0-9]{3,4}b?|day)\.png' "$PROMPT" | sed -E 's/^[0-9]+\. //; s/\.png$//')
  mapfile -t FILES < <(ls -tr "$SRC" | grep -iE '\.(png|jpe?g|webp)$')
  if [ "${#FILES[@]}" -ne "${#NAMES[@]}" ]; then echo "part $BATCH has ${#NAMES[@]} days but the folder has ${#FILES[@]} images"; exit 1; fi
  for i in "${!FILES[@]}"; do conv "$SRC/${FILES[$i]}" "${NAMES[$i]}"; echo "${FILES[$i]} -> ${NAMES[$i]}.webp"; n=$((n+1)); done
else
  for f in "$SRC"/*.{png,PNG,jpg,JPG,jpeg,webp}; do
    [ -f "$f" ] || continue
    b="$(basename "${f%.*}")"
    if ! [[ "$b" =~ ^[01][0-9]-[0-3][0-9]-([0-9]{3,4}b?|day)$ ]]; then echo "skip (name is not MM-DD-YYYY): $f"; bad=$((bad+1)); continue; fi
    conv "$f" "$b"; n=$((n+1))
  done
fi
node "$ROOT/scripts/history/build-history.mjs"
node "$ROOT/scripts/history/image-prompts.mjs"
echo "imported $n, skipped $bad, total: $(du -sh "$OUT" | cut -f1)"
