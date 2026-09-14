#!/bin/bash
# scripts/abdm-facility-qr.sh — generate the facility QR for ABDM scan-and-share.
#
# The QR is OURS to publish; ABDM only specifies the URL. Getting the parameter names wrong is invisible:
# the ABHA app rejects the code with "Invalid QR code" before anything reaches the gateway, so there is no
# callback, no audit line and nothing to debug from the server side. They are HYPHENATED - `hip-id` and
# `counter-id` - per ABDM's Scan-and-Share document v1.0 (22 Aug 2024) §4.1. We had them unhyphenated in
# V3-SPEC-RECONCILIATION.md until a scan failed on a real device (D13).
#
# One QR per counter/desk: counter-id becomes `context` in the patient/share callback, which opd-bridge.js
# records as the ticket's department so the display board can group by counter.
#
# Usage: ./scripts/abdm-facility-qr.sh [counter-id] [out.png]
#
# GOTCHA (macOS/homebrew): `pip install segno` is refused - the interpreter is externally managed
# (PEP 668) - and the script just says "need a QR encoder" again. Use a venv once, then prefix PATH:
#   python3 -m venv ~/.cache/stewardmd-abdm-local/venv && ~/.cache/stewardmd-abdm-local/venv/bin/pip install segno
#   PATH="$HOME/.cache/stewardmd-abdm-local/venv/bin:$PATH" ./scripts/abdm-facility-qr.sh OPD1 out.png
set -euo pipefail
COUNTER="${1:-OPD1}"
OUT="${2:-$HOME/Downloads/stewardmd-facility-qr-$COUNTER.png}"
HIP="${ABDM_HIP_ID:-IN2810006668}"
HOST="${ABDM_PHR_HOST:-https://phrsbx.abdm.gov.in}"   # phr.abdm.gov.in in production
URL="$HOST/share-profile?hip-id=$HIP&counter-id=$COUNTER"

python3 - "$URL" "$OUT" <<'PY'
import sys
try:
    import segno
except ImportError:
    sys.exit("need a QR encoder: python3 -m pip install segno  (or use a venv)")
url, out = sys.argv[1], sys.argv[2]
segno.make(url, error="m").save(out, scale=12, border=4)
print("wrote", out)
print("encodes", url)
PY
