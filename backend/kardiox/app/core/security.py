"""Authentication hooks.

The pipeline trusts ONLY the Cloudflare edge Worker (which does the real user auth + rate limiting).
The edge sends a shared secret in `X-Pipeline-Token`; we verify it here. This is a FastAPI dependency
so every protected route just declares `deps=[Depends(require_pipeline_auth)]`.

🔧 To add direct client auth later (e.g. verifying a StewardMD session JWT), add a second dependency
here and compose it — the route contract does not change.
"""
from __future__ import annotations

import hmac

from fastapi import Header

from app.core.config import get_settings
from app.core.errors import KardioXError


class Unauthorized(KardioXError):
    http = 401
    code = "unauthorized"
    stage = "upload"


async def require_pipeline_auth(x_pipeline_token: str | None = Header(default=None)) -> None:
    settings = get_settings()
    expected = settings.pipeline_token
    if not expected:
        return  # dev/local: auth disabled when no token configured
    if not x_pipeline_token or not hmac.compare_digest(x_pipeline_token, expected):
        raise Unauthorized("Invalid or missing X-Pipeline-Token")
