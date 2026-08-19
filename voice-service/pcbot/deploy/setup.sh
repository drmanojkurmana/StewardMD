#!/usr/bin/env bash
# Set up the FollowCare Pipecat voice bot on a fresh Oracle Cloud Always-Free VM (Ubuntu 22.04/24.04, ARM64).
# Run it FROM the voice-service/ directory on the VM:   bash pcbot/deploy/setup.sh
# Idempotent: safe to re-run. Does NOT touch secrets - you fill pcbot/deploy/voice.env yourself.
set -euo pipefail

VS="$(cd "$(dirname "$0")/../.." && pwd)"          # voice-service/
PCBOT="$VS/pcbot"
PYBIN=""
SVC=/etc/systemd/system/stewardmd-voice.service
USER_NAME="$(id -un)"

echo "==> voice-service dir: $VS"

# On a tiny box (E2.1.Micro = 1 GB) add swap so the pip install + runtime never OOM. Skip if RAM >= 2 GB.
MEM_MB="$(free -m | awk '/^Mem:/{print $2}')"
if [ "${MEM_MB:-9999}" -lt 2000 ] && ! sudo swapon --show | grep -q .; then
  echo "==> Low RAM (${MEM_MB} MB): creating a 3 GB swap file…"
  sudo fallocate -l 3G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=3072
  sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "    swap: $(free -m | awk '/^Swap:/{print $2" MB"}')"
fi

echo "==> Installing system packages (python3.12, venv, build tools, curl)…"
sudo apt-get update -y
sudo apt-get install -y software-properties-common curl ca-certificates >/dev/null
if ! command -v python3.12 >/dev/null 2>&1; then
  sudo add-apt-repository -y ppa:deadsnakes/ppa || true
  sudo apt-get update -y
  sudo apt-get install -y python3.12 python3.12-venv python3.12-dev
fi
sudo apt-get install -y build-essential >/dev/null
PYBIN="$(command -v python3.12)"
echo "    python: $($PYBIN --version)"

echo "==> Creating venv + installing requirements (pipecat + sarvam + fastapi)…"
"$PYBIN" -m venv "$PCBOT/.venv"
"$PCBOT/.venv/bin/pip" install --quiet --upgrade pip
"$PCBOT/.venv/bin/pip" install -r "$PCBOT/requirements.txt"
echo "    installed pipecat-ai: $("$PCBOT/.venv/bin/pip" show pipecat-ai | sed -n 's/^Version: //p')"

echo "==> Installing cloudflared (for the stable HTTPS/WSS tunnel)…"
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH=arm64; [ "$(uname -m)" = "x86_64" ] && ARCH=amd64
  curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb"
  sudo dpkg -i /tmp/cloudflared.deb
fi
echo "    cloudflared: $(cloudflared --version 2>/dev/null | head -1)"

if [ ! -f "$PCBOT/deploy/voice.env" ]; then
  cp "$PCBOT/deploy/voice.env.example" "$PCBOT/deploy/voice.env"
  echo "==> Created $PCBOT/deploy/voice.env - FILL IN THE SECRETS before the service will work."
fi

echo "==> Writing systemd service $SVC …"
sudo tee "$SVC" >/dev/null <<UNIT
[Unit]
Description=StewardMD FollowCare voice bot (Pipecat + Sarvam)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$VS
EnvironmentFile=$PCBOT/deploy/voice.env
ExecStart=$PCBOT/.venv/bin/uvicorn server:app --app-dir pcbot --host 127.0.0.1 --port 7860 --log-level info
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable stewardmd-voice
sudo systemctl restart stewardmd-voice
sleep 3
curl -sS -m 5 http://127.0.0.1:7860/health && echo "  <- voice service healthy" || echo "  !! service not healthy yet (check: sudo journalctl -u stewardmd-voice -n 50)"

cat <<NEXT

======================================================================
 Voice service is running on 127.0.0.1:7860 (systemd: stewardmd-voice).
 REMAINING OWNER STEPS (one-time):

 1) Fill secrets:   nano $PCBOT/deploy/voice.env
    then:           sudo systemctl restart stewardmd-voice

 2) Expose it on a stable HTTPS URL via Cloudflare (uses your stewardmd.in):
      cloudflared tunnel login                       # browser: pick stewardmd.in
      cloudflared tunnel create stewardmd-voice
      cloudflared tunnel route dns stewardmd-voice voice.stewardmd.in
      # write the tunnel config:
      sudo mkdir -p /etc/cloudflared
      # /etc/cloudflared/config.yml:
      #   tunnel: stewardmd-voice
      #   credentials-file: /home/$USER_NAME/.cloudflared/<TUNNEL-UUID>.json
      #   ingress:
      #     - hostname: voice.stewardmd.in
      #       service: http://localhost:7860
      #     - service: http_status:404
      sudo cloudflared service install
      sudo systemctl restart cloudflared

 3) Point the app at it: set VOICE_PUBLIC_BASE=https://voice.stewardmd.in in voice.env,
    then: sudo systemctl restart stewardmd-voice

 4) Test:   curl https://voice.stewardmd.in/health
    Call:    bash pcbot/call.sh 91XXXXXXXXXX te "heart failure" 3
             (run from voice-service/, needs FOLLOWCARE_VOICE_SERVICE_TOKEN in ../deploy/.env or export it)
======================================================================
NEXT
