#!/bin/bash
# Renders every cases/*.html to a matching .png via headless Chrome.
# Run `node gen.mjs` first to (re)generate the HTML from case data.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

shopt -s nullglob
count=0
for html in "$DIR"/cases/*.html; do
  png="${html%.html}.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1800,1200 \
    --screenshot="$png" "file://$html" >/dev/null 2>&1
  count=$((count + 1))
done
echo "rendered $count PNGs into $DIR/cases"
