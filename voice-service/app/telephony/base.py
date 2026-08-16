"""TelephonyProvider — the seam the CallSession drives (spec §16: don't couple to one telco).

The session only needs: dial (place/confirm the call), listen (one patient turn of PCM16, endpointed by
silence), play (speak PCM16), hangup. Plivo is the V1 implementation; Exotel/others slot in behind this ABC.
"""
from abc import ABC, abstractmethod


class TelephonyProvider(ABC):
    @abstractmethod
    async def dial(self, call):
        """Place/confirm the outbound call. Returns True once answered, False on no-answer/busy/failed."""

    @abstractmethod
    async def listen(self, timeout_s):
        """Return one endpointed patient turn as PCM16 (8 kHz) bytes, or None on silence/hangup."""

    @abstractmethod
    async def play(self, pcm):
        """Speak PCM16 (8 kHz) to the caller. Should support barge-in (stop if the patient talks)."""

    @abstractmethod
    async def hangup(self):
        """End the call."""
