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
        # Per the model card: the DESCRIPTION tokenizer is the text-encoder's tokenizer, NOT a subfolder. Using
        # the wrong one breaks the voice conditioning (clean start then groaning/time-stretch garble).
        self._desc_tok = AutoTokenizer.from_pretrained(self._model.config.text_encoder._name_or_path)
        self._sr = self._model.config.sampling_rate
        return self

    def synth(self, text, lang="en"):
        if not text:
            return b""
        if self._model is None:
            self.load()
        try:
            dev = self.cfg.device
            # attention_mask + prompt_attention_mask are REQUIRED — without them the model attends to padding
            # and generation degrades into stutter/groan after the first words.
            desc = self._desc_tok(_DESCRIPTION, return_tensors="pt").to(dev)
            prompt = self._tok(text, return_tensors="pt").to(dev)
            with self._torch.no_grad():
                audio = self._model.generate(
                    input_ids=desc.input_ids, attention_mask=desc.attention_mask,
                    prompt_input_ids=prompt.input_ids, prompt_attention_mask=prompt.attention_mask)
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
