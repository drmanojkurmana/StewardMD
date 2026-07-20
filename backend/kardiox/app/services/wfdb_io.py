"""Stage 4 — Signal extraction / WFDB I/O (pixel traces → calibrated mV/ms). Library: WFDB + NumPy.
README stage 4."""
from __future__ import annotations

from app.services.base import WfdbProvider


class NoneWfdb(WfdbProvider):
    name = "none"

    async def to_signal(self, traces: dict) -> dict:
        self._ni()


class WfdbSignal(WfdbProvider):
    """Convert pixel traces to mV/ms using the grid calibration; optionally read/write WFDB records for
    dataset interop + validation against PhysioNet."""

    name = "wfdb"
    implemented = False

    async def to_signal(self, traces: dict) -> dict:
        # TODO(models): using calibration (px→mm, mm/s, mm/mV), resample each pixel trace to a uniform
        # sampling rate and scale to millivolts. Return:
        #   {"leads": {"II": {"mv": [...], "fs": 500}, ...}, "duration_s": 10.0}
        # Use wfdb.wrsamp/rdrecord for interop with annotated datasets.
        self._ni()
