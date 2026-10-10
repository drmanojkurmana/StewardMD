#!/bin/bash
# finish-g1.sh: unattended resumable FINISH pipeline for the PrepNucleus drawing redraw (G1 batch).
# When ~/prep-data/rad/redraw/full/G1-DONE exists, runs: fetch batch output, unpad, QA (OCR + geometry
# + Claude vision judge via Messages Batch API), labels (-ai1 / -ai1-h webps), verdict table + contact
# sheets for the leader, publish in waves of ~100, share-ID refresh and de-ID audit.
# DRY RUN: finish-g1.sh --dry runs steps 2-5 on the pilot figures WITHOUT publishing.
# Usage: bash tools/finish-g1.sh [--dry] [--only f,f] [--stage DIR] [--out DIR] [--waves N]
#        [--model auto|sonnet|haiku] [--fresh] [--skip-judge] [--no-publish]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${REDRAW_DATA:-$HOME/prep-data/rad/redraw}"
FULL="${REDRAW_FULL:-$DATA/full}"
REVIEW="${REDRAW_REVIEW:-$DATA/review}"
DRY=0; ONLY=""; STAGE="$FULL/stage-g1"; OUT="$FULL"; WAVES=100; MODEL="auto"; FRESH=""; SKIPJ=""; NOPUB=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry) DRY=1; OUT="$FULL/dry-g1"; STAGE="$FULL/dry-g1/stage"; shift;;
    --only) ONLY="$2"; shift 2;;
    --stage) STAGE="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --waves) WAVES="$2"; shift 2;;
    --model) MODEL="$2"; shift 2;;
    --fresh) FRESH="--fresh"; shift;;
    --skip-judge) SKIPJ="--skip-judge"; shift;;
    --no-publish) NOPUB=1; shift;;
    -h|--help) sed -n '2,9p' "$0"; exit 0;;
    *) echo "unknown flag $1"; exit 2;;
  esac
done
LOG="$OUT/finish-g1.log"
mkdir -p "$OUT" "$REVIEW"
exec > >(tee -a "$LOG") 2>&1
echo "=== finish-g1 $(date -u +%FT%TZ) dry=$DRY out=$OUT stage=$STAGE ==="
# key: load silently, never print
if [ -f "$HOME/.config/stewardmd/anthropic.env" ]; then set -a; . "$HOME/.config/stewardmd/anthropic.env"; set +a; fi
if [ "$DRY" = 0 ] && [ ! -f "$FULL/G1-DONE" ]; then echo "G1 not done yet (no $FULL/G1-DONE). Waiting for the watcher."; exit 1; fi
ARGS_ONLY=""; [ -n "$ONLY" ] && ARGS_ONLY="--only $ONLY"
if [ "$DRY" = 0 ]; then
  echo "--- step 1: fetch batch output ---"
  # shellcheck disable=SC2086
  python3 "$REPO/tools/finish-g1-fetch.py" --full "$FULL" --job g1 $FRESH
  echo "--- step 3: QA (bakeoff if needed, then full) ---"
  if [ ! -f "$FULL/bakeoff-pick.txt" ] && [ "$MODEL" = "auto" ] && [ -z "$SKIPJ" ]; then
    # shellcheck disable=SC2086
    python3 "$REPO/tools/finish-g1-qa.py" --out "$FULL" --mode bakeoff $FRESH $SKIPJ
    cp "$FULL/bakeoff-pick.txt" "$FULL/bakeoff-pick.txt" 2>/dev/null || true
  fi
  PICK="$MODEL"
  [ "$MODEL" = "auto" ] && [ -f "$FULL/bakeoff-pick.txt" ] && PICK="$(cat "$FULL/bakeoff-pick.txt")"
  # shellcheck disable=SC2086
  python3 "$REPO/tools/finish-g1-qa.py" --out "$FULL" --mode full --model "${PICK:-haiku}" $ARGS_ONLY $FRESH $SKIPJ --data "$DATA" --full "$FULL"
  echo "--- step 2: labels ---"
  # shellcheck disable=SC2086
  python3 "$REPO/tools/finish-g1-label.py" --stage "$STAGE" --decisions "$FULL/decisions.tsv" $ARGS_ONLY $FRESH --data "$DATA" --full "$FULL" --mode full
  echo "--- step 4: sheets ---"
  python3 "$REPO/tools/finish-g1-sheet.py" --stage "$STAGE" --review "$REVIEW" --out "$FULL" --mode full --data "$DATA" --full "$FULL"
  if [ "$NOPUB" = 1 ]; then echo "publish skipped (--no-publish)"; exit 0; fi
  echo "--- step 5: publish in waves of $WAVES ---"
  python3 "$REPO/tools/finish-g1-publish.py" --stage "$STAGE" --waves "$WAVES" --repo "$REPO" $FRESH
else
  echo "--- DRY RUN on pilot figures (no fetch, no publish) ---"
  # shellcheck disable=SC2086
  python3 "$REPO/tools/finish-g1-qa.py" --out "$OUT" --mode dry --model "$MODEL" $ARGS_ONLY $FRESH $SKIPJ --data "$DATA" --full "$FULL"
  echo "--- dry labels ---"
  # shellcheck disable=SC2086
  python3 "$REPO/tools/finish-g1-label.py" --stage "$STAGE" --decisions "$OUT/decisions.tsv" $ARGS_ONLY $FRESH --mode dry
  echo "--- dry sheets ---"
  python3 "$REPO/tools/finish-g1-sheet.py" --stage "$STAGE" --review "$OUT/review" --out "$OUT" --mode dry
  echo "--- dry publish (no uploads) ---"
  python3 "$REPO/tools/finish-g1-publish.py" --stage "$STAGE" --waves "$WAVES" --repo "$REPO" --dry $FRESH
fi
echo "=== finish-g1 done $(date -u +%FT%TZ) ==="
