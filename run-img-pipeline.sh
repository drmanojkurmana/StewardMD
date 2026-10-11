#!/usr/bin/env bash
# run-img-pipeline.sh - Autonomous background runner for image MCQ pipeline
# Resumable, idempotent, logs to ~/prep-data/assessment/images/pipeline.log
set -u

DIR="/Volumes/WD BLACK SN7100 1TB Media/stewardmd/prep-work/img-questions"
DATA_DIR="$HOME/prep-data/assessment/images"
LOG="$DATA_DIR/pipeline.log"

echo "=== [$(date)] Image Pipeline Started ===" >> "$LOG"
cd "$DIR"

echo "--- [$(date)] Step 1: Classify remaining pool candidates ---" >> "$LOG"
node tools/prep-imgclassify.mjs --concurrency 16 >> "$LOG" 2>&1
echo "Classify finished with code $?" >> "$LOG"

echo "--- [$(date)] Step 2: Clean and stage newly kept images ---" >> "$LOG"
node tools/prep-imgclean.mjs >> "$LOG" 2>&1
echo "Clean finished with code $?" >> "$LOG"

echo "--- [$(date)] Step 3: Question generation & blind verification (limit 150, <$5) ---" >> "$LOG"
node tools/prep-imgqgen.mjs --limit 150 --concurrency 3 >> "$LOG" 2>&1
echo "QGen finished with code $?" >> "$LOG"

echo "=== [$(date)] Step 4: Pipeline run finished ===" >> "$LOG"
touch "$DATA_DIR/pipeline-done.flag"
