#!/bin/bash
# gpu_startup.sh — fast GPU benchmark on a Deep Learning VM (PyTorch+CUDA preinstalled).
# 2 passes: whisper/qwen first (light deps), then NeMo + indic-conformer. Uploads, DONE, self-delete.
set -x
exec > /var/log/vb.log 2>&1
BUCKET="gs://stewardmd-498ec-sknx-model/voice-benchmark"
PY=$( [ -x /opt/conda/bin/python ] && echo /opt/conda/bin/python || echo python3 )
PIP="$PY -m pip"
export HF_HUB_DISABLE_TELEMETRY=1
# optional HF token (for the gated indic-conformer repo), passed via instance metadata; not logged
HFT="$(curl -s -H 'Metadata-Flavor: Google' 'http://metadata.google.internal/computeMetadata/v1/instance/attributes/HF_TOKEN' 2>/dev/null)"
[ -n "$HFT" ] && export HF_TOKEN="$HFT" HUGGING_FACE_HUB_TOKEN="$HFT"

fin() {
  gsutil cp /var/log/vb.log "$BUCKET/gpu_out/vb.log" 2>/dev/null
  gsutil cp /root/vb/results/RESULTS.md /root/vb/results/fast_results.json "$BUCKET/gpu_out/" 2>/dev/null
  echo "$1" > /root/DONE; gsutil cp /root/DONE "$BUCKET/gpu_out/DONE" 2>/dev/null
  local h="Metadata-Flavor: Google" b="http://metadata.google.internal/computeMetadata/v1/instance"
  local z n; z="$(curl -s -H "$h" "$b/zone" | awk -F/ '{print $NF}')"; n="$(curl -s -H "$h" "$b/name")"
  gcloud compute instances delete "$n" --zone="$z" -q || poweroff
}

# wait for the NVIDIA driver the DL image installs on first boot
for i in $(seq 1 30); do nvidia-smi && break; sleep 10; done

apt-get update -y || true; apt-get install -y ffmpeg python3-pip || true
# common-cu image has CUDA+driver but not torch — install a CUDA 12.4 torch (works with driver 580)
$PIP install -q torch torchaudio --index-url https://download.pytorch.org/whl/cu124 || $PIP install -q torch torchaudio
# LATEST transformers so Qwen3-ASR's config class is recognized (>=4.44 was too old)
$PIP install -q -U transformers accelerate gTTS jiwer soundfile librosa "datasets<3" huggingface_hub

mkdir -p /root/vb/scripts /root/vb/results && cd /root/vb
gsutil cp "$BUCKET/scripts/fast_bench.py" scripts/

# single pass: turbo + vasista22 telugu-small + qwen (+ indic, which errors: gated HF repo)
$PY scripts/fast_bench.py || echo "run nonzero"

fin OK
