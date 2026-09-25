#!/usr/bin/env bash
# Fetches the MIMIC-IV Clinical Database Demo (100 ICU patients, ODbL v1.0, no credentialing).
# https://physionet.org/content/mimic-iv-demo/2.2/
#
# The data is NOT committed: it is licensed, and redistributing it through a git history is not
# ours to do. backend/medcore/data-mimic/ is gitignored.
set -euo pipefail
BASE="https://physionet.org/files/mimic-iv-demo/2.2"
DIR="$(cd "$(dirname "$0")/../data-mimic" 2>/dev/null && pwd || echo "backend/medcore/data-mimic")"
mkdir -p "$DIR/hosp" "$DIR/icu"
for f in hosp/patients.csv.gz hosp/admissions.csv.gz hosp/labevents.csv.gz hosp/d_labitems.csv.gz \
         icu/icustays.csv.gz icu/chartevents.csv.gz icu/d_items.csv.gz icu/inputevents.csv.gz; do
  echo "  $f"
  curl -sS -L -o "$DIR/$f" "$BASE/$f"
done
echo "done -> $DIR"
