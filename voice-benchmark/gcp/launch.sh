#!/bin/bash
# launch.sh — upload the benchmark + fire a CPU spot VM that self-deletes.
# Cost cap is structural: spot pricing + --max-run-duration + termination-action=DELETE.
# Usage: ./launch.sh            (upload scripts+corpus, then launch)
#        ./launch.sh nolaunch   (just upload)
set -euo pipefail
PROJECT="${PROJECT:-stewardmd-498ec}"
ZONE="${ZONE:-us-central1-a}"
VM="${VM:-vb-run}"
BUCKET="${BUCKET:-gs://stewardmd-498ec-sknx-model/voice-benchmark}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # voice-benchmark/

echo ">> uploading scripts + corpus to $BUCKET"
gsutil -m cp "$HERE"/scripts/*.py "$BUCKET/scripts/"
gsutil cp "$HERE"/results/medical_corpus.jsonl "$BUCKET/results/"
gsutil rm "$BUCKET/out/DONE" 2>/dev/null || true   # clear any stale sentinel

[ "${1:-}" = "nolaunch" ] && { echo "uploaded only"; exit 0; }

gsutil rm "$BUCKET/out/DONE" 2>/dev/null || true   # clear stale sentinel before a fresh run

# On-demand (STANDARD) — spot kept getting preempted/stocked out here, and the ~2h run isn't worth
# restarting. max-run-duration + DELETE still hard-cap cost. Walk machine types x zones until one takes.
# 16 vCPU: faster-whisper is pinned to all cores, so this is ~8x the throughput of a 4-vCPU box.
# ~1-1.5h whole matrix. On-demand n2/e2-standard-16 ~ \$0.78/hr => ~\$1-1.5 total.
launched=""
for MT in n2-standard-16 e2-standard-16 c2-standard-16 n2-standard-8 e2-standard-8; do
 for Z in us-central1-c us-central1-a us-east1-b us-west1-b us-east4-a europe-west1-b asia-south1-a; do
  echo ">> trying $MT @ $Z"
  if gcloud compute instances create "$VM" --project="$PROJECT" --zone="$Z" \
      --machine-type="$MT" \
      --provisioning-model=STANDARD --instance-termination-action=DELETE --max-run-duration=4h \
      --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
      --boot-disk-size=60GB --boot-disk-type=pd-balanced \
      --scopes=cloud-platform \
      --metadata=VB_BUCKET="$BUCKET" \
      --metadata-from-file=startup-script="$HERE/gcp/startup.sh" >/tmp/vb_launch.txt 2>&1; then
    launched="$MT@$Z"; echo "ZONE=$Z" > /tmp/vb_zone.txt; break 2
  fi
 done
done
[ -z "$launched" ] && { echo "ALL zones/types stocked out"; tail -6 /tmp/vb_launch.txt; exit 1; }

echo ">> launched $launched. poll:  gsutil cat $BUCKET/out/DONE"
echo ">> results land at:  $BUCKET/out/BENCHMARK.md"
