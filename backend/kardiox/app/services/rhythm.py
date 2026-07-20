"""Stages 6-7-9 — Rhythm, beat classification, morphology. Library: TorchECG (PyTorch). README 6/7/9."""
from __future__ import annotations

from app.services.base import RhythmProvider


class NoneRhythm(RhythmProvider):
    name = "none"

    async def rhythm(self, signal: dict) -> dict:
        self._ni()

    async def beats(self, signal: dict) -> dict:
        self._ni()

    async def morphology(self, signal: dict) -> dict:
        self._ni()


class TorchECGRhythm(RhythmProvider):
    """PyTorch models (TorchECG) for rhythm + rate + regularity, per-beat classification, and morphology
    (P/f-waves, hypertrophy, BBB, T-waves)."""

    name = "torchecg"
    implemented = False

    async def rhythm(self, signal: dict) -> dict:
        # TODO(models): TorchECG rhythm classifier → {"label": "atrial fibrillation", "rateBpm": 128,
        #   "regularity": "irregular", "confidence": 0.9}. Run in a thread/GPU worker; don't block the loop.
        self._ni()

    async def beats(self, signal: dict) -> dict:
        # TODO(models): per-beat labels → {"beats": [{"t": 0.42, "label": "normal"}, ...]}.
        self._ni()

    async def morphology(self, signal: dict) -> dict:
        # TODO(models): → {"pWaves": "absent", "fWaves": True, "bbb": None, "hypertrophy": None, "tWaves": "nonspecific"}.
        self._ni()
