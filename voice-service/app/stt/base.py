"""STTProvider seam (spec §9) so IndicConformer can later be swapped for Sarvam/another provider."""
from abc import ABC, abstractmethod


class STTProvider(ABC):
    @abstractmethod
    def load(self):
        """Load the model onto the GPU (called once at service start)."""

    @abstractmethod
    def transcribe(self, pcm16_8k, lang="en"):
        """PCM16 @ 8 kHz -> transcript text."""
