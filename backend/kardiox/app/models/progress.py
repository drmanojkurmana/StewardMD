"""Streaming progress event (SSE) — drives the iOS processing/analysis screens' stage bars."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

StageStatus = Literal["pending", "active", "done", "failed"]


class StageProgress(BaseModel):
    stage: str
    status: StageStatus
    pct: int = 0
    detail: str | None = None
