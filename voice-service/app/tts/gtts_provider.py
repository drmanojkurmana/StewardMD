"""Fast TTS via gTTS (no model download) — for fast testing/iteration. Multilingual (en/hi/te/...).
Decodes the returned MP3 to 8 kHz PCM with PyAV (bundles ffmpeg — no system dep). Swap to Parler
(TTS_PROVIDER=parler) for best Indic voice quality in production."""
from .base import TTSProvider
from ..audio.resample import resample_linear, float_to_pcm16, pcm16_to_float

_LANG = {"en": "en", "hi": "hi", "te": "te", "ta": "ta", "kn": "kn", "ml": "ml", "mr": "mr",
         "gu": "gu", "bn": "bn", "pa": "pa"}


class GttsTTS(TTSProvider):
    def __init__(self, config):
        self.cfg = config

    def load(self):
        return self  # nothing to load — gTTS is a network call

    def synth(self, text, lang="en"):
        if not text:
            return b""
        try:
            import io
            from gtts import gTTS
            import av
            buf = io.BytesIO()
            gTTS(text, lang=_LANG.get(lang, "en")).write_to_fp(buf)
            buf.seek(0)
            # Decode MP3 -> mono float samples + source sample rate, via PyAV.
            container = av.open(buf)
            stream = container.streams.audio[0]
            src_sr = stream.rate
            samples = []
            resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=src_sr)
            for frame in container.decode(stream):
                for f in resampler.resample(frame):
                    pcm = bytes(f.planes[0])
                    samples.extend(pcm16_to_float(pcm))
            container.close()
            floats8k = resample_linear(samples, src_sr, self.cfg.sample_rate)
            return float_to_pcm16(floats8k)
        except Exception:
            return b""
