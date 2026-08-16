"""TTSProvider seam (spec §10) so Indic Parler-TTS can be swapped later. Same GPU as STT (spec §10)."""
from abc import ABC, abstractmethod


class TTSProvider(ABC):
    @abstractmethod
    def load(self):
        """Load the model onto the GPU (called once at service start)."""

    @abstractmethod
    def synth(self, text, lang="en"):
        """text -> PCM16 @ 8 kHz bytes, ready to stream to the caller."""
