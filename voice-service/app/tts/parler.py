"""AI4Bharat Indic Parler-TTS (spec §10). Runs on the SAME GPU as STT. Heavy deps lazy-imported in load().

Output is resampled to 8 kHz PCM16 for telephony. The `description` prompt is the voice-style knob (calm,
clear, warm) — tune per language on the box. Model output sampling rate is read from the model config.
"""
from .base import TTSProvider
from ..audio.resample import resample_linear, float_to_pcm16

_DESCRIPTION = (
    "A clear, calm and warm female voice speaks naturally and reassuringly at a measured pace, "
    "very close to the microphone with almost no background noise."
)


class ParlerTTS(TTSProvider):
    def __init__(self, config):
        self.cfg = config
        self._model = None
        self._tok = None
        self._desc_tok = None
        self._torch = None
        self._sr = 44100

    def load(self):
        import torch  # lazy
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer
        self._torch = torch
        self._model = ParlerTTSForConditionalGeneration.from_pretrained(self.cfg.tts_model).to(self.cfg.device).eval()
        self._tok = AutoTokenizer.from_pretrained(self.cfg.tts_model)
        # Indic Parler uses a separate tokenizer for the description in some revisions; fall back to the same one.
        try:
            self._desc_tok = AutoTokenizer.from_pretrained(self.cfg.tts_model, subfolder="description_tokenizer")
        except Exception:
            self._desc_tok = self._tok
        self._sr = getattr(self._model.config, "sampling_rate", 44100)
        return self

    def synth(self, text, lang="en"):
        if not text:
            return b""
        if self._model is None:
            self.load()
        try:
            dev = self.cfg.device
            desc_ids = self._desc_tok(_DESCRIPTION, return_tensors="pt").input_ids.to(dev)
            prompt_ids = self._tok(text, return_tensors="pt").input_ids.to(dev)
            with self._torch.no_grad():
                audio = self._model.generate(input_ids=desc_ids, prompt_input_ids=prompt_ids)
            wav = audio.cpu().numpy().squeeze().tolist()
            wav8k = resample_linear(wav, self._sr, self.cfg.sample_rate)
            return float_to_pcm16(wav8k)
        except Exception:
            return b""
