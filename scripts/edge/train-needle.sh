#!/usr/bin/env bash
# scripts/edge/train-needle.sh: fine-tune the Needle 3 router (local LoRA, Cactus's official `needle finetune`
# from cactus-needle 3.0.6) on a rented GCP L4, build the .cact on this Mac, and score it on the frozen test set
# with the pinned macOS engine. Recipe, cost and results: vault/plans/Edge-Runbook.md section 5a.
#
#   scripts/edge/train-needle.sh setup                 venv + pinned checkpoint/engine (WORK below)
#   scripts/edge/train-needle.sh up                    create the VM (auto-deletes after MAX_RUN, default 4h)
#   scripts/edge/train-needle.sh train NAME [ARGS..]   upload train.jsonl, run `needle finetune ARGS` on the VM,
#                                                      fetch WORK/NAME.safetensors
#   scripts/edge/train-needle.sh build NAME [--keep-head] [--layers N]   -> WORK/NAME.cact
#   scripts/edge/train-needle.sh predict NAME validation|test               -> WORK/NAME.<split>.pred.jsonl
#   scripts/edge/train-needle.sh down                  delete the VM (always run this)
# The 2026-10-04 run (r4, FAILED the test marks): train r4 --epochs 8 --lr 5e-4 --lora-rank 32 --lora-alpha 64 --val-split 0
#
# Only the generated dataset (vault/plans/edge-data/dataset/export/needle-local/train.jsonl, built from the app's
# own data, no PHI) leaves the Mac. Weights never leave it. Telemetry of the needle CLI is off (NEEDLE_TELEMETRY=0).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-$HOME/.claude/jobs/fd3555fb/tmp/needle-tune}"
ZONE="${ZONE:-us-central1-a}"; VM="${VM:-needle-tune}"; MAX_RUN="${MAX_RUN:-4h}"
PIN="https://huggingface.co/Cactus-Compute/needle3/resolve/27c0a9a5b3ca835e0b7dbeaccf555df03dac493d"
export NEEDLE_TELEMETRY=0 DO_NOT_TRACK=1
EXP="$ROOT/vault/plans/edge-data/dataset/export/needle-local"
mkdir -p "$WORK"; cd "$WORK"

fetch() {  # url dest sha256
  [ -f "$2" ] && echo "$3  $2" | shasum -a 256 -c - >/dev/null 2>&1 && return 0
  mkdir -p "$(dirname "$2")"; curl -fsL -o "$2.part" "$1"
  echo "$3  $2.part" | shasum -a 256 -c - >/dev/null || { echo "SHA-256 MISMATCH: $1"; exit 1; }; mv "$2.part" "$2"
}
ssh_vm() { gcloud compute ssh "$VM" --zone "$ZONE" --command "$1"; }

case "${1:-}" in
setup)
  [ -x .venv/bin/needle ] || { uv venv -q -p 3.12 .venv; uv pip install -q -p .venv/bin/python "cactus-needle[train]==3.0.6"; }
  fetch "$PIN/checkpoints/needle3.safetensors" checkpoints/needle3.safetensors c234c70dccc7a9115e7c41ac2e41d3655fea3b85c245dd898b46179fb90c6c0c
  fetch "$PIN/needle3.cact" engine/needle3.cact c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38
  fetch "$PIN/macos-arm64/libneedle.a" engine/libneedle.a 9e9e0d01dc1ac0438f2890e5f51fec48fd6eadce1cd2c4455ccc13eb735838bb
  fetch "$PIN/macos-arm64/needle.h" engine/needle.h 3aa713942528d944598458cecb4a262f2cc49349bec63355f91df0b159964e55
  clang++ -std=c++17 -O2 -Iengine "$ROOT/scripts/edge/needle-host.cpp" engine/libneedle.a -framework Accelerate -o needle-host
  echo "setup ok: $WORK" ;;
up)
  # On-demand L4 (g2-standard-4): ~0.71 USD/h list price in us-central1 (2026-10-04 billing catalog). The VM
  # deletes itself after MAX_RUN even if `down` is never run.
  gcloud compute instances create "$VM" --zone "$ZONE" --machine-type g2-standard-4 \
    --image-family common-cu129-ubuntu-2204-nvidia-580 --image-project deeplearning-platform-release \
    --boot-disk-size 100GB --maintenance-policy TERMINATE --metadata install-nvidia-driver=True \
    --max-run-duration "$MAX_RUN" --instance-termination-action DELETE
  for i in $(seq 1 40); do ssh_vm "nvidia-smi -L" 2>/dev/null && break; sleep 15; done
  ssh_vm "curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null && ~/.local/bin/uv venv -q --clear -p 3.12 ~/v && \
    ~/.local/bin/uv pip install -q -p ~/v/bin/python 'cactus-needle[train]==3.0.6' 'jax[cuda12]' && mkdir -p ~/w/checkpoints && \
    curl -fsL -o ~/w/checkpoints/needle3.safetensors $PIN/checkpoints/needle3.safetensors && \
    echo 'c234c70dccc7a9115e7c41ac2e41d3655fea3b85c245dd898b46179fb90c6c0c  w/checkpoints/needle3.safetensors' | sha256sum -c - && \
    ~/v/bin/python -c 'import jax; print(jax.devices())'" ;;
train)
  NAME="$2"; shift 2
  (cd "$ROOT" && node scripts/edge/needle-pred.mjs think train) > train.think.jsonl
  gcloud compute scp --zone "$ZONE" train.think.jsonl "$VM":w/train.jsonl
  ssh_vm "cd ~/w && NEEDLE_TELEMETRY=0 DO_NOT_TRACK=1 ~/v/bin/needle finetune train.jsonl --checkpoint checkpoints/needle3.safetensors --out $NAME.safetensors --checkpoint-dir ckpt $* 2>&1 | grep --line-buffered -v 'step ' | tee $NAME.log"
  gcloud compute scp --zone "$ZONE" "$VM":w/"$NAME".safetensors "$VM":w/"$NAME".log "$WORK"/ ;;
build)
  NAME="$2"; shift 2; KEEP=0; ARGS=()
  for a in "$@"; do [ "$a" = "--keep-head" ] && KEEP=1 || ARGS+=("$a"); done
  # --keep-head: the base model's confidence head stays in the archive (cactus drops it after a local LoRA,
  # as it was not trained with the new weights). Its threshold is then chosen on the validation split only.
  # Same steps as needle.model.finetune.build_main (3.0.6), with the head drop made optional and the base
  # archive (tokenizer blob) read from the pinned engine/needle3.cact instead of a fresh download of `main`.
  .venv/bin/python - "$NAME" "$KEEP" "${ARGS[@]+"${ARGS[@]}"}" <<'PY'
import sys, jax.numpy as jnp
from needle.model.checkpoints import read_adapter
from needle.model.run import load_checkpoint
from needle.model.finetune import merge_lora, rung
from needle.model.architecture import ConfidenceHead, effective_kv_window
from needle.model.export import read_tokenizer_blob, write_export
from needle.model.quantize import WEIGHT_BITS
name, keep, rest = sys.argv[1], sys.argv[2] == "1", sys.argv[3:]
layers = int(rest[rest.index("--layers") + 1]) if "--layers" in rest else None
ad = read_adapter(name + ".safetensors")
params, config, _ = load_checkpoint("checkpoints/needle3.safetensors", return_run=True)
lora = {tuple(k.split("/")): {"A": jnp.asarray(v["A"]), "B": jnp.asarray(v["B"])} for k, v in ad["lora"].items()}
params = merge_lora(params, lora, ad["scale"])
if not keep:
    params = {k: v for k, v in params.items() if k != ConfidenceHead.key}
params, config = rung(params, config, layers)
info = write_export(params, config, name + ".cact", bits=WEIGHT_BITS, tokenizer=read_tokenizer_blob("engine/needle3.cact"),
                    kv_window=effective_kv_window(config))
print(f"wrote {info['path']} {info['bytes'] / 1e6:.2f} MB, {config.num_layers} layers, W{WEIGHT_BITS}, confidence head {'kept (base)' if keep else 'dropped'}")
PY
  shasum -a 256 "$NAME.cact" ;;
predict)
  NAME="$2"; SPLIT="$3"
  (cd "$ROOT" && node scripts/edge/needle-pred.mjs rows "$SPLIT") > "$SPLIT.tsv"
  ./needle-host "$NAME.cact" "$SPLIT.tsv" > "$NAME.$SPLIT.raw.jsonl"
  (cd "$ROOT" && node scripts/edge/needle-pred.mjs pred "$WORK/$NAME.$SPLIT.raw.jsonl") > "$NAME.$SPLIT.pred.jsonl"
  echo "score: node scripts/edge/score.mjs --split ${SPLIT/validation/val} --pred $WORK/$NAME.$SPLIT.pred.jsonl" ;;
down)
  gcloud compute instances delete "$VM" --zone "$ZONE" --quiet ;;
*) sed -n 2,16p "$0"; exit 2 ;;
esac
