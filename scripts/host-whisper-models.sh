#!/usr/bin/env bash
# StewardMD — publish the on-device Whisper (Clinical Dictation) models to Cloudflare R2.
# ---------------------------------------------------------------------------------------
# The app downloads these ggml model files ONCE, at runtime, from a StewardMD-owned origin
# (never a third-party hotlink). This script fetches the official ggml weights from Hugging
# Face, VERIFIES the pinned SHA-256 (must match native-bridge.js WHISPER_MODELS), and uploads
# them to an R2 bucket. Bytes are byte-for-byte the HF files, so the SHA-256 the app enforces
# natively will match.
#
# PREREQUISITE: you must be authenticated to Cloudflare —
#     wrangler login              (interactive, opens a browser)
#   OR export CLOUDFLARE_API_TOKEN=<token with "R2 Storage: Edit" + your account id>
#          export CLOUDFLARE_ACCOUNT_ID=<account id>
#
# After running this, do the ONE manual step it prints (attach the custom domain
# models.stewardmd.in to the bucket) — then WHISPER_MODEL_HOST already resolves. No app change.
#
# Usage:  bash scripts/host-whisper-models.sh
set -euo pipefail

BUCKET="${WHISPER_R2_BUCKET:-stewardmd-models}"
PREFIX="whisper"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# model file : pinned sha256 (must equal native-bridge.js WHISPER_MODELS[*].sha256)
FILES=(
  "ggml-small.en-q5_1.bin:bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30"
  "ggml-base-q5_1.bin:422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
  "ggml-tiny-q5_1.bin:818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"
)
HF_BASE="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

echo "▸ Bucket: $BUCKET   prefix: /$PREFIX"
npx wrangler r2 bucket create "$BUCKET" 2>/dev/null && echo "  created bucket" || echo "  bucket exists (ok)"

for entry in "${FILES[@]}"; do
  file="${entry%%:*}"; want="${entry##*:}"
  echo "▸ $file"
  echo "  downloading from Hugging Face…"
  curl -fL --retry 3 -o "$TMP/$file" "$HF_BASE/$file"
  got="$(shasum -a 256 "$TMP/$file" | awk '{print $1}')"
  if [ "$got" != "$want" ]; then
    echo "  ✗ SHA-256 MISMATCH — refusing to upload"
    echo "    expected $want"
    echo "    got      $got"
    exit 1
  fi
  echo "  ✓ sha256 verified ($got)"
  echo "  uploading to r2://$BUCKET/$PREFIX/$file …"
  npx wrangler r2 object put "$BUCKET/$PREFIX/$file" --file="$TMP/$file" \
      --content-type="application/octet-stream" --remote
  echo "  ✓ uploaded"
done

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
ONE MANUAL STEP (Cloudflare dashboard — needs the DNS zone, not scriptable safely):
  R2 → $BUCKET → Settings → Custom Domains → "Connect Domain" → models.stewardmd.in
  (stewardmd.in is already in your account, so the DNS + cert are created automatically.)

Then verify from anywhere:
  curl -sIL https://models.stewardmd.in/$PREFIX/ggml-base-q5_1.bin | grep -i -E 'HTTP/|content-length'
  # expect HTTP 200 and content-length: 59707625

That URL is exactly what native-bridge.js WHISPER_MODEL_HOST already points to — no app change.
Prefer serving from stewardmd.in instead? See docs/WHISPER_MODEL_HOSTING.md (Pages-Function option).
──────────────────────────────────────────────────────────────────────────────
EOF
echo "Done."
