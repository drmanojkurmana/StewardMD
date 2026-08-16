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
            wav = audio.to("cpu", dtype=self._torch.float32).squeeze()
            # Downsampling 44.1kHz -> 8kHz (5.5x) MUST be anti-aliased; naive linear interpolation aliases into
            # "underwater/robotic" garble. torchaudio.resample applies the low-pass filter. Fall back to linear
            # only if torchaudio is unavailable (upsampling paths don't alias, so the fallback is fine there).
            try:
                import torchaudio
                wav8k = torchaudio.functional.resample(wav, int(self._sr), int(self.cfg.sample_rate))
                pcm = (wav8k.clamp(-1.0, 1.0) * 32767.0).to(self._torch.int16).cpu().numpy().tobytes()
                return pcm
            except Exception:
                return float_to_pcm16(resample_linear(wav.numpy().tolist(), self._sr, self.cfg.sample_rate))
        except Exception:
            return b""
