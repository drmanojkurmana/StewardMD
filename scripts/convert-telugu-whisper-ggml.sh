#!/usr/bin/env bash
# StewardMD — build the on-device Telugu specialist for MaiK Scribe (Steward Voice PRO/ULTIMATE).
# ---------------------------------------------------------------------------------------------
# Converts the BENCHMARK-verified Telugu model (vasista22/whisper-telugu-small, te WER 14.7%) from
# HuggingFace transformers format -> whisper.cpp ggml -> INT8 (q8_0), pins its SHA-256, and (if
# Cloudflare creds are present) uploads it to the same R2 origin as the other Whisper models.
#
# It is NOT an off-the-shelf ggml file, which is why host-whisper-models.sh cannot fetch it.
#
# PREREQUISITES: python3 (torch+transformers), git, cmake/make. For upload: wrangler login OR
#   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (R2 Storage: Edit). Heavy-ish (~1 GB downloads).
#
# Usage:  bash scripts/convert-telugu-whisper-ggml.sh            # convert + print sha/bytes
#         UPLOAD=1 bash scripts/convert-telugu-whisper-ggml.sh   # convert + upload to R2
set -euo pipefail

HF_MODEL="vasista22/whisper-telugu-small"
OUT_NAME="ggml-telugu-small-q8_0.bin"
BUCKET="${WHISPER_R2_BUCKET:-stewardmd-models}"; PREFIX="whisper"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WCPP="$ROOT/local-plugins/capacitor-whisper/android/src/main/cpp/whisper-cpp"   # bundled whisper.cpp (has models/ + src)
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "▸ work dir: $WORK"

# 1) deps: HF model + the openai/whisper package (supplies mel filters + tokenizer assets the converter needs)
python3 -m pip install -q -U "transformers" torch huggingface_hub openai-whisper
python3 - "$HF_MODEL" "$WORK/hf" <<'PY'
import sys; from huggingface_hub import snapshot_download
snapshot_download(sys.argv[1], local_dir=sys.argv[2], local_dir_use_symlinks=False)
print("downloaded", sys.argv[1])
PY
ASSETS="$(python3 -c 'import os,whisper;print(os.path.dirname(whisper.__file__))')"

# 2) convert HF -> ggml f16  (whisper.cpp models/convert-h5-to-ggml.py: <hf_model_dir> <whisper_assets_dir> <out_dir>)
python3 "$WCPP/models/convert-h5-to-ggml.py" "$WORK/hf" "$ASSETS" "$WORK/out"
F16="$WORK/out/ggml-model.bin"; [ -f "$F16" ] || { echo "✗ conversion produced no ggml-model.bin"; exit 1; }

# 3) build the quantize tool from the bundled whisper.cpp, then quantize f16 -> q8_0 (INT8)
cmake -S "$WCPP" -B "$WORK/build" -DGGML_METAL=OFF -DWHISPER_BUILD_EXAMPLES=ON >/dev/null
cmake --build "$WORK/build" --target quantize -j >/dev/null 2>&1 || cmake --build "$WORK/build" -j >/dev/null
QZ="$(find "$WORK/build" -name quantize -type f | head -1)"; [ -n "$QZ" ] || { echo "✗ quantize tool not built"; exit 1; }
"$QZ" "$F16" "$WORK/$OUT_NAME" q8_0

# 4) pin values
SHA="$(shasum -a 256 "$WORK/$OUT_NAME" | awk '{print $1}')"; BYTES="$(wc -c < "$WORK/$OUT_NAME" | tr -d ' ')"
echo "──────────────────────────────────────────────────────────────────────"
echo "  PIN THESE in native-bridge.js WHISPER_MODELS['telugu-small-q8_0']:"
echo "    sha256: \"$SHA\""
echo "    bytes:  $BYTES"
echo "──────────────────────────────────────────────────────────────────────"

# 5) optional upload
if [ "${UPLOAD:-0}" = "1" ]; then
  echo "▸ uploading r2://$BUCKET/$PREFIX/$OUT_NAME …"
  npx wrangler r2 object put "$BUCKET/$PREFIX/$OUT_NAME" --file="$WORK/$OUT_NAME" \
      --content-type="application/octet-stream" --remote
  echo "  ✓ uploaded — now paste the sha256/bytes above into native-bridge.js and rebuild native."
else
  echo "▸ (set UPLOAD=1 to push to R2). File left at: $WORK/$OUT_NAME (temp — copy it out if not uploading)"
fi
