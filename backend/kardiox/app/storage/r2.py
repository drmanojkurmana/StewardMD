"""Cloudflare R2 (S3-compatible) access for the pipeline.

The edge Worker PUTs the ephemeral upload to R2 under `<prefix><sessionId>` and DELETEs it after the
JSON comes back. This module lets the pipeline READ that object by sessionId (and optionally delete it
too, belt-and-suspenders). boto3 is imported lazily so the API image can run in mock mode without it.
"""
from __future__ import annotations

import asyncio

from app.core.config import Settings
from app.core.errors import UpstreamUnavailable


class R2Client:
    def __init__(self, s: Settings):
        self.s = s

    def _client(self):
        if not (self.s.r2_endpoint and self.s.r2_access_key_id and self.s.r2_secret_access_key):
            raise UpstreamUnavailable("R2 is not configured (set KARDIOX_R2_* env)")
        try:
            import boto3  # lazy: only needed in live mode
        except ImportError as e:  # pragma: no cover
            raise UpstreamUnavailable("boto3 not installed (pip install boto3)") from e
        return boto3.client(
            "s3",
            endpoint_url=self.s.r2_endpoint,
            aws_access_key_id=self.s.r2_access_key_id,
            aws_secret_access_key=self.s.r2_secret_access_key,
            region_name="auto",
        )

    def _key(self, session_id: str) -> str:
        return f"{self.s.r2_upload_prefix}{session_id}"

    async def get_image(self, session_id: str) -> bytes:
        def _get() -> bytes:
            c = self._client()
            obj = c.get_object(Bucket=self.s.r2_bucket, Key=self._key(session_id))
            return obj["Body"].read()
        try:
            return await asyncio.to_thread(_get)
        except UpstreamUnavailable:
            raise
        except Exception as e:
            raise UpstreamUnavailable(f"Could not read upload for session {session_id}") from e

    async def delete_image(self, session_id: str) -> None:
        if not self.s.r2_delete_after_read:
            return
        def _del() -> None:
            c = self._client()
            c.delete_object(Bucket=self.s.r2_bucket, Key=self._key(session_id))
        try:
            await asyncio.to_thread(_del)
        except Exception:
            pass  # best-effort; the edge also deletes
