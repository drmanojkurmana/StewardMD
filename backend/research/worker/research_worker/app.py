"""Container HTTP surface: GET /health and POST /drain.

/drain is called once a minute by the stewardmd-research-worker cron through
the Durable Object container port. It is protected by X-Drain-Token; the
public Worker fetch() handler returns 404, so this surface is never exposed.
"""
from __future__ import annotations

import hmac
import os

import httpx
from fastapi import FastAPI, Header, HTTPException

from . import __version__
from .jobs import drain_once
from .queue import QueueClient
from .storage import R2Storage


def _clients_from_env():
    queue = QueueClient()
    storage = R2Storage()
    client = httpx.Client(timeout=30.0)
    return queue, storage, client


def create_app() -> FastAPI:
    production = os.getenv("RESEARCH_ENV") == "production"
    app = FastAPI(
        title="StewardMD Research Worker",
        version=__version__,
        description="Phase 3 PDF extraction worker. Contracts: docs/research/contracts/phase-3/.",
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
    )

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "stewardmd-research", "version": __version__}

    @app.post("/drain")
    def drain(x_drain_token: str | None = Header(default=None)):
        expected = os.getenv("DRAIN_TOKEN")
        if not expected:
            raise HTTPException(status_code=503, detail="drain_unavailable")
        if not x_drain_token or not hmac.compare_digest(x_drain_token, expected):
            raise HTTPException(status_code=401, detail="unauthorized")
        secret = os.getenv("RESEARCH_CALLBACK_SECRET")
        if not secret:
            raise HTTPException(status_code=503, detail="callback_unavailable")
        try:
            queue, storage, client = _clients_from_env()
        except KeyError as exc:
            raise HTTPException(status_code=503, detail=f"missing config {exc}") from exc
        callback_url = os.getenv("RESEARCH_CALLBACK_URL", "https://stewardmd.in")
        try:
            return drain_once(
                queue,
                storage,
                callback_client=client,
                callback_url=callback_url,
                secret=secret,
            )
        finally:
            client.close()
            queue.close()

    return app


app = create_app()