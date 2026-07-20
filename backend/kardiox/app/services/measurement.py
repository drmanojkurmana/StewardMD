"""Stages 8 + 10 — Measurement (PR/QRS/QT/QTc/axis + per-lead) and ST analysis. Library: NeuroKit2.
README 8/10."""
from __future__ import annotations

from app.services.base import MeasurementProvider


class NoneMeasurement(MeasurementProvider):
    name = "none"

    async def measure(self, signal: dict) -> dict:
        self._ni()

    async def st(self, signal: dict) -> dict:
        self._ni()


class NeuroKitMeasurement(MeasurementProvider):
    """Signal delineation + intervals via NeuroKit2; axis from net QRS in I/aVF; ST from J-point."""

    name = "neurokit2"
    implemented = False

    async def measure(self, signal: dict) -> dict:
        # TODO(models): nk.ecg_process / ecg_delineate per lead → PR/QRS/QT; compute QTc (Bazett/Fridericia)
        # and axis. Return {"prMs": .., "qrsMs": 92, "qtMs": .., "qtcMs": 468, "axisDeg": 42, "perLead": {..}}.
        self._ni()

    async def st(self, signal: dict) -> dict:
        # TODO(models): J-point ST deviation per lead + territory grouping → {"perLead": {"V2": +0.3}, "territory": None}.
        self._ni()
