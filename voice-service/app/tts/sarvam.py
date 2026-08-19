"""Sarvam Bulbul TTS via API (no GPU). Requests mu-law/PCM at 8 kHz directly (telephony rate) so there's no
resampling and no aliasing. Returns PCM16 8 kHz to match the TTSProvider contract (telephony encodes to mu-law)."""
import base64
import io
import wave

from .base import TTSProvider
from ..audio.resample import resample_linear, float_to_pcm16, pcm16_to_float

_LANG = {"te": "te-IN", "en": "en-IN", "hi": "hi-IN", "ta": "ta-IN", "kn": "kn-IN", "ml": "ml-IN",
         "mr": "mr-IN", "gu": "gu-IN", "bn": "bn-IN", "pa": "pa-IN", "od": "od-IN"}


class SarvamTTS(TTSProvider):
    def __init__(self, config):
        self.cfg = config

    def load(self):
        return self  # nothing to load — it's an API

    def synth(self, text, lang="en"):
        if not text:
            return b""
        try:
            import requests
            payload = {"text": text, "language_code": _LANG.get(lang, "te-IN"),
                       "speech_sample_rate": str(self.cfg.sample_rate), "output_audio_codec": "wav"}
            if self.cfg.sarvam_tts_model:
                payload["model"] = self.cfg.sarvam_tts_model
            if self.cfg.sarvam_speaker:
                payload["speaker"] = self.cfg.sarvam_speaker
            try:                                  # slower + louder for elderly ears (ignore if not accepted)
                payload["pace"] = float(self.cfg.sarvam_pace)
                payload["loudness"] = float(self.cfg.sarvam_loudness)
            except Exception:
                pass
            r = requests.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": self.cfg.sarvam_api_key, "Content-Type": "application/json"},
                json=payload, timeout=30,
            )
            audios = (r.json() or {}).get("audios") or []
            if not audios:
                return b""
            with wave.open(io.BytesIO(base64.b64decode(audios[0])), "rb") as w:
                sr = w.getframerate()
                pcm = w.readframes(w.getnframes())
            if sr != self.cfg.sample_rate:   # normally already 8k, but be safe
                pcm = float_to_pcm16(resample_linear(pcm16_to_float(pcm), sr, self.cfg.sample_rate))
            return pcm
        except Exception:
            return b""
