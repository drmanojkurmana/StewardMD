#!/usr/bin/env bash
# StewardMD — publish the on-device KardioX AI model pack to Cloudflare R2.
# ---------------------------------------------------------------------------------------
# The app downloads these ONNX weights ONCE, at first use, from a StewardMD-owned origin
# (models.stewardmd.in/kardiox — the SAME bucket the Whisper models use), caches them via
# @capacitor/filesystem, and can delete them. This script uploads a local models dir and
# VERIFIES the pinned SHA-256 (must equal kardiox-model-manager.js PACKS.diagnosis[*].sha256),
# so the integrity the app enforces matches what is served.
#
# PREREQUISITE: authenticate to Cloudflare —
#     wrangler login          (interactive) OR
#     export CLOUDFLARE_API_TOKEN=<token: R2 Storage: Edit>  CLOUDFLARE_ACCOUNT_ID=<id>
#
# The custom domain models.stewardmd.in is already attached to this bucket (Whisper uses it),
# so no manual step is needed — the URL resolves as soon as the objects are uploaded.
#
# Usage:  bash scripts/host-kardiox-models.sh /path/to/onnx/models
#   models dir must contain: ecglib_{AFIB,1AVB,SBRAD,STACH,PVC,CRBBB,IRBBB}.onnx
set -euo pipefail

SRC="${1:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "usage: $0 /path/to/onnx/models"; exit 2; }
BUCKET="${KARDIOX_R2_BUCKET:-stewardmd-models}"
PREFIX="kardiox"

# file : pinned sha256 (must equal kardiox-model-manager.js PACKS.diagnosis)
FILES=(
  "ecglib_AFIB.onnx:9d8f446df4e5abdb198d3325dce7fd09adf6ebc58224b97b1f753ed01249d260"
  "ecglib_1AVB.onnx:060307a9bc2a86ffe570be3c7bf7b0b548060333da2ee0770c61681102fac370"
  "ecglib_SBRAD.onnx:f9dc675ae4a11b6ab4c5b6aa0c3b75e1b85f0ee3fa5818cc5a082902d1147cb2"
  "ecglib_STACH.onnx:3a65c8e8272961363d1a36992fdb9af17a726c05f0dd3bb63175e3c60e355b98"
  "ecglib_PVC.onnx:a2e2938c15f4b26b4c3aba3349b0468c317d6e42f3e0b757e6d28e6ee03ddee7"
  "ecglib_CRBBB.onnx:1f37e51563a6f5e7b7bc6fee3498aff771087e4b03a8bc54d9825c0cf03e1d94"
  "ecglib_IRBBB.onnx:69fc68ad49f17e3acdcd53a5c28758c8b69a9495899ac69c1da34b9172cef8e8"
)

echo "▸ Bucket: $BUCKET   prefix: /$PREFIX   source: $SRC"
npx wrangler r2 bucket create "$BUCKET" 2>/dev/null && echo "  created bucket" || echo "  bucket exists (ok)"

for entry in "${FILES[@]}"; do
  file="${entry%%:*}"; want="${entry##*:}"
  path="$SRC/$file"
  [ -f "$path" ] || { echo "  ✗ missing: $path"; exit 1; }
  got="$(shasum -a 256 "$path" | awk '{print $1}')"
  if [ "$got" != "$want" ]; then
    echo "  ✗ SHA-256 MISMATCH for $file — refusing to upload"
    echo "    expected $want"; echo "    got      $got"; exit 1
  fi
  echo "▸ $file  ✓ sha256 verified"
  npx wrangler r2 object put "$BUCKET/$PREFIX/$file" --file="$path" \
      --content-type="application/octet-stream" --remote
done

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
Verify from anywhere:
  curl -sIL https://models.stewardmd.in/$PREFIX/ecglib_AFIB.onnx | grep -i -E 'HTTP/|content-length'
  # expect HTTP 200 and content-length: 22506708

That URL is exactly what kardiox-model-manager.js HOST already points to — no app change.
──────────────────────────────────────────────────────────────────────────────
EOF
echo "Done."
