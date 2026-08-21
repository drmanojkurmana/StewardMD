#!/bin/bash
# startup.sh — runs as root on the benchmark VM at boot.
# Installs the Whisper stack, ct2-converts the two vasista22 fine-tunes, synthesizes/downloads
# audio, runs the model matrix, uploads results to GCS, drops a DONE sentinel, then powers off
# (the VM was created with --instance-termination-action=DELETE + --max-run-duration as a hard cap).
set -x
exec > /var/log/vb.log 2>&1
MD="http://metadata.google.internal/computeMetadata/v1/instance/attributes"
BUCKET="$(curl -s -H 'Metadata-Flavor: Google' "$MD/VB_BUCKET" || true)"
BUCKET="${BUCKET:-gs://stewardmd-498ec-sknx-model/voice-benchmark}"
export DEBIAN_FRONTEND=noninteractive HF_HUB_ENABLE_HF_TRANSFER=1

# self-delete via API — guest poweroff only *stops* a spot VM (DELETE action fires on preemption /
# max-run-duration, not guest shutdown). max-run-duration=4h is the backstop if this fails.
fin() {
  gsutil cp /var/log/vb.log "$BUCKET/out/vb.log" 2>/dev/null
  echo "$1" > /root/DONE; gsutil cp /root/DONE "$BUCKET/out/DONE" 2>/dev/null
  local h="Metadata-Flavor: Google" b="http://metadata.google.internal/computeMetadata/v1/instance"
  local zone name; zone="$(curl -s -H "$h" "$b/zone" | awk -F/ '{print $NF}')"; name="$(curl -s -H "$h" "$b/name")"
  gcloud compute instances delete "$name" --zone="$zone" -q || poweroff
}
trap 'fin FAILED' ERR

apt-get update -y
apt-get install -y python3-pip python3-venv ffmpeg

# --- Whisper stack (reliable; gives 4 of 5 models + all the numbers that pick the recommendation)
# Ubuntu 22.04 pip has no PEP-668 marker, so a plain system install works (no --break-system-packages).
pip3 install -q \
  faster-whisper ctranslate2 transformers torch torchaudio soundfile librosa \
  gTTS jiwer whisper-normalizer "datasets<3" hf_transfer huggingface_hub

mkdir -p /root/vb/scripts /root/vb/results && cd /root/vb
gsutil -m cp "$BUCKET/scripts/*" scripts/
gsutil cp "$BUCKET/results/medical_corpus.jsonl" results/

# --- convert the two fine-tunes to CT2 int8 (faster-whisper needs a CT2 dir, not the HF repo).
# These older Whisper checkpoints ship vocab.json/merges.txt, NOT a serialized tokenizer.json, so
# --copy_files errors. Convert weights first, then materialize tokenizer.json + preprocessor via HF.
for pair in telugu:/root/ct2-telugu-small hindi:/root/ct2-hindi-small; do
  lang="${pair%%:*}"; out="${pair##*:}"; m="vasista22/whisper-$lang-small"
  ct2-transformers-converter --model "$m" --output_dir "$out" --quantization int8 --force \
    && python3 -c "from transformers import WhisperTokenizerFast, WhisperProcessor
WhisperTokenizerFast.from_pretrained('$m').save_pretrained('$out')
WhisperProcessor.from_pretrained('$m').save_pretrained('$out')" \
    || echo "$lang convert failed"
done

# --- IndicConformer in its own venv (NeMo deps must not corrupt the Whisper stack)
python3 -m venv /root/icenv
/root/icenv/bin/pip install -q -U pip
/root/icenv/bin/pip install -q "nemo_toolkit[asr]" transformers torch torchaudio soundfile librosa || echo "NeMo install failed — IndicConformer will record an error (honest)"
export IC_PYTHON=/root/icenv/bin/python

# --- data: synth medical audio (gTTS) + pull FLEURS test clips
python3 scripts/synth_audio.py
FLEURS_N="${FLEURS_N:-50}" python3 scripts/get_fleurs.py   # WER sanity check only; medical corpus (500) carries the ranking

# --- run everything -> results/BENCHMARK.json + BENCHMARK.md
python3 scripts/run_all.py

gsutil -m cp results/BENCHMARK.json results/BENCHMARK.md "$BUCKET/out/"
trap - ERR
fin OK
