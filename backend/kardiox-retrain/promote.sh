#!/bin/bash
# One-tap promotion: if the auto-retrainer staged an improved model, deploy it to kardiox-image.
# Human-in-the-loop by design — run this only after reviewing the staged report.
set -e
FB=gs://stewardmd-ecg-feedback
if ! gsutil -q stat "$FB/models/PROMOTION_READY.json" 2>/dev/null; then echo "No candidate is staged for promotion."; exit 0; fi
echo "=== staged candidate report ==="; gsutil cat "$FB/models/PROMOTION_READY.json"
LATEST=$(gsutil ls "$FB/models/" | grep candidate- | sort | tail -1)
echo "=== promoting: $LATEST ==="
gsutil cp "${LATEST}image_model_mireal.pt" ~/Developer/StewardMD/backend/kardiox-image/image_model_mireal.pt
cd ~/Developer/StewardMD/backend/kardiox-image
gcloud run deploy kardiox-image --source . --region us-central1 --memory 2Gi --cpu 2 --allow-unauthenticated --quiet
NEW=$(gcloud run revisions list --service kardiox-image --region us-central1 --sort-by="~metadata.creationTimestamp" --limit 1 --format="value(metadata.name)")
gcloud run services update-traffic kardiox-image --region us-central1 --to-revisions "$NEW=100" --quiet
gsutil mv "$FB/models/PROMOTION_READY.json" "$FB/models/PROMOTED-$(date -u +%Y%m%dT%H%M%SZ).json"
echo "=== promoted $NEW. Verify: ==="; curl -s https://kardiox-image-yislqrddsq-uc.a.run.app/v1/health
