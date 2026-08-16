"""AI4Bharat IndicConformer 600M STT (spec §9). Heavy deps (torch, transformers/nemo) are imported lazily in
load(), so importing this module needs nothing — the core loop tests never touch it.

Telephony audio is 8 kHz; the model expects 16 kHz mono float. resample_linear (pure, in app.audio.resample)
is the dependency-free default; on the GPU torchaudio.resample is used when available (higher quality).

MODEL API is a tuning knob: IndicConformer ships a custom forward (model(wav, lang, decoder)). Confirm the
exact call against the current model card on the box and adjust `_run` if needed — that is the one place the
real model wiring lives.
"""
from .base import STTProvider
from ..audio.resample import resample_linear, pcm16_to_float


# AI4Bharat language codes differ from our 2-letter app codes in a couple of places.
_LANG = {"en": "en", "hi": "hi", "te": "te", "ta": "ta", "kn": "kn", "ml": "ml", "mr": "mr",
         "gu": "gu", "bn": "bn", "pa": "pa", "or": "or", "as": "as"}


class IndicConformerSTT(STTProvider):
    def __init__(self, config):
        self.cfg = config
        self._model = None
        self._torch = None
        self._ta = None

    def load(self):
        import torch  # lazy
        from transformers import AutoModel
        self._torch = torch
        try:
            import torchaudio
            self._ta = torchaudio
        except Exception:
            self._ta = None
        self._model = AutoModel.from_pretrained(self.cfg.stt_model, trust_remote_code=True)
        self._model.to(self.cfg.device).eval()
        return self

    def _to_16k_float(self, pcm16_8k):
        if self._ta is not None:
            wav = self._torch.frombuffer(bytearray(pcm16_8k), dtype=self._torch.int16).float() / 32768.0
            wav = self._ta.functional.resample(wav.unsqueeze(0), 8000, 16000)
            return wav
        floats = resample_linear(pcm16_to_float(pcm16_8k), 8000, 16000)
        return self._torch.tensor(floats, dtype=self._torch.float32).unsqueeze(0)

    def _run(self, wav, lang):
        # IndicConformer custom forward: model(wav, lang_code, "ctc"|"rnnt"). Wrapped defensively.
        code = _LANG.get(lang, "hi")
        wav = wav.to(self.cfg.device)
        with self._torch.no_grad():
            try:
                out = self._model(wav, code, "rnnt")
            except Exception:
                out = self._model(wav, code, "ctc")
        if isinstance(out, (list, tuple)):
            out = out[0]
        return str(out).strip()

    def transcribe(self, pcm16_8k, lang="en"):
        if not pcm16_8k:
            return ""
        if self._model is None:
            self.load()
        try:
            return self._run(self._to_16k_float(pcm16_8k), lang)
        except Exception:
            return ""
