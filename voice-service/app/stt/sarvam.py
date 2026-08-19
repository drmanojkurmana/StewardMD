"""Sarvam Saarika STT via API (no GPU). Telephony gives us 8 kHz PCM; Sarvam prefers 16 kHz, so we upsample
(linear is fine for upsampling — no aliasing) and upload as a WAV. Returns the transcript text."""
import io
import wave

from .base import STTProvider
from ..audio.resample import resample_linear, float_to_pcm16, pcm16_to_float

_LANG = {"te": "te-IN", "en": "en-IN", "hi": "hi-IN", "ta": "ta-IN", "kn": "kn-IN", "ml": "ml-IN",
         "mr": "mr-IN", "gu": "gu-IN", "bn": "bn-IN", "pa": "pa-IN", "od": "od-IN"}


class SarvamSTT(STTProvider):
    def __init__(self, config):
        self.cfg = config

    def load(self):
        return self  # nothing to load — it's an API

    def transcribe(self, pcm16_8k, lang="en"):
        if not pcm16_8k:
            return ""
        try:
            import requests
            pcm16k = float_to_pcm16(resample_linear(pcm16_to_float(pcm16_8k), 8000, 16000))
            buf = io.BytesIO()
            with wave.open(buf, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(16000)
                w.writeframes(pcm16k)
            buf.seek(0)
            data = {"language_code": _LANG.get(lang, "te-IN")}
            if self.cfg.sarvam_stt_model:
                data["model"] = self.cfg.sarvam_stt_model
            r = requests.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": self.cfg.sarvam_api_key},
                files={"file": ("audio.wav", buf, "audio/wav")},
                data=data, timeout=30,
            )
            return ((r.json() or {}).get("transcript") or "").strip()
        except Exception:
            return ""
