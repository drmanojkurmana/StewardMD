"""Fast STT via faster-whisper (CTranslate2). Small, ungated, loads in seconds — for fast testing/iteration.
Swap back to IndicConformer (STT_PROVIDER=indicconformer) for best Indic accuracy in production."""
from .base import STTProvider
from ..audio.resample import resample_linear, pcm16_to_float


class WhisperSTT(STTProvider):
    def __init__(self, config):
        self.cfg = config
        self._model = None

    def load(self):
        from faster_whisper import WhisperModel  # lazy
        compute = "float16" if self.cfg.device == "cuda" else "int8"
        try:
            self._model = WhisperModel(self.cfg.whisper_size, device=self.cfg.device, compute_type=compute)
        except Exception:
            self._model = WhisperModel(self.cfg.whisper_size, device="cpu", compute_type="int8")
        return self

    def transcribe(self, pcm16_8k, lang="en"):
        if not pcm16_8k:
            return ""
        if self._model is None:
            self.load()
        import numpy as np
        floats = resample_linear(pcm16_to_float(pcm16_8k), 8000, 16000)  # whisper wants 16 kHz float32
        arr = np.asarray(floats, dtype="float32")
        try:
            segments, _ = self._model.transcribe(arr, language=(lang if lang in ("en", "hi") else None), beam_size=1)
            return " ".join(s.text for s in segments).strip()
        except Exception:
            return ""
