"""Plivo telephony: outbound origination (REST) + bidirectional Audio Streaming over a WebSocket.

We do NOT use Plivo's AI Agent — only raw audio streaming, so IndicConformer/Parler run on our GPU.

Two objects:
  * PlivoController.originate(to, call_id): places the call; Plivo fetches /plivo/answer which returns XML that
    opens a <Stream> back to wss <public_base>/plivo/stream/<call_id> (bidirectional).
  * PlivoStreamTelephony(ws): the per-call TelephonyProvider bound to that WebSocket. It endpoints inbound
    audio by energy/silence to yield one patient turn at a time, and streams TTS out (with barge-in).

Endpointing/barge-in thresholds are real-world tuning knobs (mic levels, codec, network jitter) — exposed as
constructor args so they can be calibrated on the actual telephony path, not guessed once in code.
"""
import asyncio
import base64
import json
import urllib.request

from .base import TelephonyProvider
from ..audio import codec


class PlivoController:
    def __init__(self, config):
        self.cfg = config

    def answer_xml(self, call_id):
        """Plivo Answer XML: open a bidirectional audio stream to this service for `call_id`."""
        ws = self.cfg.public_base.replace("https://", "wss://").rstrip("/") + "/plivo/stream/" + call_id
        fmt = "mulaw" if self.cfg.audio_format == "mulaw" else "L16"
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            f'<Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-{fmt};rate={self.cfg.sample_rate}" '
            'audioTrack="inbound" streamTimeout="86400">'
            f"{ws}</Stream>"
            "</Response>"
        )

    def originate(self, to_number, call_id):
        """Place the outbound call via Plivo REST. answer_url carries the call_id so the WS can correlate."""
        url = f"https://api.plivo.com/v1/Account/{self.cfg.plivo_auth_id}/Call/"
        answer_url = self.cfg.public_base.rstrip("/") + "/plivo/answer?callId=" + call_id
        payload = {
            "from": self.cfg.plivo_from, "to": to_number, "answer_url": answer_url,
            "answer_method": "POST", "hangup_url": self.cfg.public_base.rstrip("/") + "/plivo/hangup?callId=" + call_id,
        }
        # FREE Automatic Machine Detection: hang up if a voicemail/machine answers (never talk to a machine).
        if self.cfg.amd:
            payload["machine_detection"] = self.cfg.amd
        body = json.dumps(payload).encode()
        auth = base64.b64encode(f"{self.cfg.plivo_auth_id}:{self.cfg.plivo_auth_token}".encode()).decode()
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": "Basic " + auth})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status in (200, 201, 202)
        except Exception:
            return False


class PlivoStreamTelephony(TelephonyProvider):
    def __init__(self, ws, config, silence_ms=800, energy_threshold=500, max_utterance_ms=15000):
        self.ws = ws                       # a starlette/FastAPI WebSocket
        self.cfg = config
        self.stream_id = None
        self._answered = True              # the WS only opens once the call is answered
        self._silence_ms = silence_ms
        self._energy = energy_threshold
        self._max_ms = max_utterance_ms
        self._playing = False
        self._barge = False

    async def dial(self, call):
        return self._answered              # origination happened before the WS; connection == answered

    async def _recv_media(self):
        """Yield inbound PCM16 chunks from Plivo media frames; track the stream id."""
        raw = await self.ws.receive_text()
        msg = json.loads(raw)
        ev = msg.get("event")
        if ev == "start":
            self.stream_id = (msg.get("start") or {}).get("streamId") or msg.get("streamId")
            return b""
        if ev == "media":
            payload = (msg.get("media") or {}).get("payload") or ""
            return codec.decode_frame(payload, self.cfg.audio_format)
        if ev in ("stop", "closed"):
            return None
        return b""

    async def listen(self, timeout_s):
        """Accumulate inbound audio until `silence_ms` of quiet after speech, a max length, or hangup."""
        frame_ms = 20
        buf = bytearray()
        silence = 0
        spoke = False
        elapsed = 0
        deadline_ms = int(timeout_s * 1000)
        while True:
            try:
                chunk = await asyncio.wait_for(self._recv_media(), timeout=timeout_s)
            except asyncio.TimeoutError:
                return bytes(buf) if spoke else None
            if chunk is None:
                return bytes(buf) if spoke else None
            if not chunk:
                continue
            elapsed += frame_ms
            if _rms(chunk) >= self._energy:
                spoke = True
                silence = 0
                buf += chunk
            elif spoke:
                silence += frame_ms
                buf += chunk
                if silence >= self._silence_ms:
                    return bytes(buf)
            if len(buf) and (elapsed >= self._max_ms):
                return bytes(buf)
            if not spoke and elapsed >= deadline_ms:
                return None

    async def play(self, pcm):
        """Stream PCM16 out in ~20 ms frames. Barge-in: abort if the patient starts speaking."""
        if not pcm:
            return
        self._playing = True
        self._barge = False
        bytes_per_frame = int(self.cfg.sample_rate * 0.02) * 2  # 20 ms of 16-bit mono
        for i in range(0, len(pcm), bytes_per_frame):
            if self._barge:
                await self._clear()
                break
            frame = pcm[i:i + bytes_per_frame]
            await self.ws.send_text(json.dumps({
                "event": "playAudio",
                "media": {"contentType": "audio/x-mulaw" if self.cfg.audio_format == "mulaw" else "audio/x-l16",
                          # Plivo REQUIRES sampleRate as a STRING here; a numeric value makes Plivo drop the frame
                          # silently (agent audio never reaches the caller = dead air).
                          "sampleRate": str(self.cfg.sample_rate), "payload": codec.encode_frame(frame, self.cfg.audio_format)},
            }))
            await asyncio.sleep(0.02)
        self._playing = False

    async def _clear(self):
        try:
            await self.ws.send_text(json.dumps({"event": "clearAudio", "streamId": self.stream_id}))
        except Exception:
            pass

    async def hangup(self):
        try:
            await self.ws.close()
        except Exception:
            pass


def _rms(pcm16):
    """Cheap frame energy (mean |amplitude|) for silence detection — no numpy."""
    n = len(pcm16) // 2
    if not n:
        return 0
    total = 0
    for i in range(0, n * 2, 2):
        total += abs(int.from_bytes(pcm16[i:i + 2], "little", signed=True))
    return total // n
