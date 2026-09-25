#!/usr/bin/env bash
# VM startup script: re-segment the six older Visible Human CT regions, unattended, then power off.
#   in:  $BUCKET/in/bundle.tar.gz  (atlas-pipeline/vm/bundle.sh)   $BUCKET/in/raw/<folder>/*.raw
#        $BUCKET/in/totalseg/      optional pre-staged TotalSegmentator weights (else downloaded)
#   out: $BUCKET/out/  run.log, report.json, versions.json, recipes_vm.json, atlas/<id>/{atlas.json,v2/},
#        seg/<folder>_seg.nii.gz, pinscan/
# Whatever happens, the EXIT trap uploads the log and every output that exists, then shuts down.
# The bucket comes from instance metadata `reseg-bucket` (default gs://smd-radioanatome-reseg).
# DRY_RUN=1 (a Mac test of this script): no gcloud, no pip, no TotalSegmentator, no shutdown; needs
#   PIPE_PY=<python with numpy scipy nibabel pillow>  BUNDLE_TGZ=<bundle.tar.gz>  RAW_DIR=<work dir>
#   ROOT=<scratch dir>  [MODULES="ct-head-axial"]
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DRY_RUN="${DRY_RUN:-0}"
ROOT="${ROOT:-/var/reseg}"
OUT="$ROOT/out"
LOG="$OUT/run.log"
MARK="$ROOT/.ran"
TS_PIN="TotalSegmentator==2.18.0"
PIPE_PINS_311="numpy==2.5.3 scipy==1.18.1 nibabel==5.4.2 pillow==12.3.0"   # = the Mac venv that proved the recipes
PIPE_PINS_310="numpy scipy nibabel==5.4.2 pillow==12.3.0"                  # numpy 2.5 / scipy 1.18 need python >= 3.11
meta() { curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null || true; }
BUCKET="${BUCKET:-$(meta reseg-bucket)}"
BUCKET="${BUCKET:-gs://smd-radioanatome-reseg}"

mkdir -p "$OUT"
# A restart must not re-run the job (or loop on a failure): after one attempt, only power off.
if [ -f "$MARK" ] && [ "$DRY_RUN" != 1 ]; then
  echo "reseg already ran on this disk ($(cat "$MARK")); uploading what exists, powering off" | tee -a "$LOG"
  gcloud storage rsync --recursive "$OUT" "$BUCKET/out" || true
  shutdown -h now
  exit 0
fi
date -u +%FT%TZ > "$MARK"
exec > >(tee -a "$LOG") 2>&1
echo "=== reseg start $(date -u +%FT%TZ) bucket=$BUCKET dry_run=$DRY_RUN host=$(hostname)"

up() {                                  # upload one file if it exists; never fails the caller
  [ "$DRY_RUN" = 1 ] && return 0
  [ -f "$1" ] && gcloud storage cp -q "$1" "$BUCKET/out/$(basename "$1")" >/dev/null 2>&1 || true
}
UPLOADER=""
finish() {
  rc=$?
  set +e
  trap - EXIT TERM INT HUP
  echo "=== reseg exit $rc at $(date -u +%FT%TZ)"
  [ -n "$UPLOADER" ] && kill "$UPLOADER" 2>/dev/null
  if [ "$DRY_RUN" != 1 ]; then
    for i in 1 2 3; do
      gcloud storage rsync --recursive "$OUT" "$BUCKET/out" && break
      sleep 20
    done
    up "$LOG"
    sync
    shutdown -h now
  fi
}
trap finish EXIT
trap 'exit 143' TERM INT HUP

if [ "$DRY_RUN" != 1 ]; then
  ( while sleep 300; do up "$LOG"; up "$OUT/report.json"; up "$OUT/versions.json"; done ) &
  UPLOADER=$!
fi

# ---- GPU (driver is preinstalled on the -nvidia-* Deep Learning VM images; allow it to settle)
DEVICE=cpu
if [ "$DRY_RUN" != 1 ]; then
  for i in $(seq 1 60); do
    if nvidia-smi >/dev/null 2>&1; then DEVICE=gpu; break; fi
    sleep 10
  done
  nvidia-smi || echo "WARNING: no GPU after 10 min; TotalSegmentator will run on CPU (slow)"
fi
echo "device: $DEVICE"

# ---- Python environments
if [ "$DRY_RUN" = 1 ]; then
  PIPE="$PIPE_PY"
else
  first_py() { for p in "$@"; do command -v "$p" >/dev/null 2>&1 && { command -v "$p"; return 0; }; done; return 1; }
  BASE_PY="$(first_py python3.12 python3.11 /opt/conda/bin/python3 python3)"
  TORCH_PY=""
  for p in /opt/conda/bin/python3 python3.12 python3.11 python3; do
    if command -v "$p" >/dev/null 2>&1 && "$p" -c "import torch" 2>/dev/null; then TORCH_PY="$(command -v "$p")"; break; fi
  done
  mkvenv() {  # mkvenv <python> <dir> [--system-site-packages]
    "$1" -m venv ${3:-} "$2" 2>/dev/null && return 0
    apt-get update -qq && apt-get install -y -qq python3-venv \
      "python3.$("$1" -c 'import sys; print(sys.version_info[1])')-venv" || true
    "$1" -m venv ${3:-} "$2"
  }
  echo "base python: $BASE_PY ($("$BASE_PY" -V 2>&1)); python with torch: ${TORCH_PY:-none}"
  # TotalSegmentator: reuse the image's CUDA torch when there is one, else pip brings its own
  mkvenv "${TORCH_PY:-$BASE_PY}" /opt/tsenv --system-site-packages
  /opt/tsenv/bin/pip install -q --upgrade pip
  /opt/tsenv/bin/pip install -q "$TS_PIN"
  mkvenv "$BASE_PY" /opt/pipeenv
  /opt/pipeenv/bin/pip install -q --upgrade pip
  if "$BASE_PY" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then PINS="$PIPE_PINS_311"; else PINS="$PIPE_PINS_310"; fi
  # shellcheck disable=SC2086
  /opt/pipeenv/bin/pip install -q $PINS
  PIPE=/opt/pipeenv/bin/python
  /opt/tsenv/bin/pip freeze > "$OUT/pip-freeze-ts.txt" || true
  /opt/pipeenv/bin/pip freeze > "$OUT/pip-freeze-pipeline.txt" || true
fi

# ---- Inputs
B="$ROOT/bundle"
RAW="$ROOT/raw"
rm -rf "$B"
mkdir -p "$B" "$RAW"
if [ "$DRY_RUN" = 1 ]; then
  tar -xzf "$BUNDLE_TGZ" -C "$B"
  RAW="$RAW_DIR"
else
  gcloud storage cp "$BUCKET/in/bundle.tar.gz" "$ROOT/bundle.tar.gz"
  tar -xzf "$ROOT/bundle.tar.gz" -C "$B"
  gcloud storage rsync --recursive "$BUCKET/in/raw" "$RAW"
  export TOTALSEG_HOME_DIR="$ROOT/totalseg"
  mkdir -p "$TOTALSEG_HOME_DIR"
  if gcloud storage ls "$BUCKET/in/totalseg/" >/dev/null 2>&1; then
    gcloud storage rsync --recursive "$BUCKET/in/totalseg" "$TOTALSEG_HOME_DIR"
  fi
  # fetch weights up front so a download failure shows in the log before any compute is spent
  for t in total total_fast; do
    /opt/tsenv/bin/totalseg_download_weights -t "$t" || echo "WARNING: weight download for $t failed"
  done
fi
du -sh "$RAW"/* || true

# ---- The job
ARGS=(--bundle "$B" --raw "$RAW" --out "$OUT" --scratch "$ROOT/scratch")
if [ "$DRY_RUN" = 1 ]; then
  # shellcheck disable=SC2206
  ARGS+=(--no-ts --module ${MODULES:-ct-head-axial})
else
  ARGS+=(--ts-bin /opt/tsenv/bin/TotalSegmentator --ts-python /opt/tsenv/bin/python --device "$DEVICE")
fi
RC=0
TO=()
command -v timeout >/dev/null 2>&1 && TO=(timeout 11h)
${TO[@]+"${TO[@]}"} "$PIPE" "$B/atlas-pipeline/vm/reseg.py" "${ARGS[@]}" || RC=$?
echo "reseg.py exit $RC"
exit "$RC"
