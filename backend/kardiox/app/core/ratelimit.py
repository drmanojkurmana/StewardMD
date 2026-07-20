"""Rate-limit hook (Phase 6D). In-memory token bucket; a distributed limiter (Redis / Cloudflare rate
limiting at the edge) is the scale path and drops in behind the same `rate_limit` dependency.

Disabled by default (rate_limit_per_min=0) — the edge Worker + StewardMD middleware are the primary
gate; this is defense-in-depth for the pipeline. Keyed by X-Session-ID, else X-Forwarded-For, else peer.
"""
from __future__ import annotations

import threading
import time

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import KardioXError


class RateLimited(KardioXError):
    http = 429
    code = "rate_limited"
    stage = "upload"


class TokenBucket:
    def __init__(self) -> None:
        self._buckets: dict[str, list[float]] = {}   # key -> [tokens, last_ts]
        self._lock = threading.Lock()

    def allow(self, key: str, rate_per_min: float, burst: int) -> bool:
        if rate_per_min <= 0:
            return True
        now = time.monotonic()
        refill = rate_per_min / 60.0
        with self._lock:
            b = self._buckets.get(key)
            if b is None:
                self._buckets[key] = [burst - 1.0, now]
                return True
            b[0] = min(float(burst), b[0] + (now - b[1]) * refill)
            b[1] = now
            if b[0] >= 1.0:
                b[0] -= 1.0
                return True
            return False


LIMITER = TokenBucket()


async def rate_limit(request: Request) -> None:
    s = get_settings()
    rpm = s.rate_limit_per_min
    if rpm <= 0:
        return
    key = (request.headers.get("x-session-id")
           or request.headers.get("x-forwarded-for")
           or (request.client.host if request.client else "anon"))
    if not LIMITER.allow(key, rpm, max(1, s.rate_limit_burst)):
        raise RateLimited("Too many requests - slow down")
