"""Typed pipeline errors + FastAPI handlers that render the v1 error envelope.

Wire format (matches kardiox-net.js ERROR_MAP + README API Specification):
    { "error": { "code": <str>, "message": <str>, "stage": <str> } }
The edge Worker forwards these through; the iOS RemoteAnalyzer maps `code`/`stage` to the right UI.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class KardioXError(Exception):
    """Base pipeline error. `http` is the status the client should see; `code`/`stage` are contract fields."""

    http = 500
    code = "internal_error"
    stage = "report"

    def __init__(self, message: str | None = None, *, stage: str | None = None, code: str | None = None, http: int | None = None):
        super().__init__(message or self.code)
        self.message = message or self.__class__.__doc__ or self.code
        if stage:
            self.stage = stage
        if code:
            self.code = code
        if http:
            self.http = http


class StageNotImplemented(KardioXError):
    """A pipeline stage has no real implementation yet (models not wired). 501."""

    http = 501
    code = "not_implemented"


class BadImage(KardioXError):
    """Image is blurry, cropped or too small to read. 400 → screen-19 retake."""

    http = 400
    code = "bad_image"
    stage = "quality"


class LayoutUndetected(KardioXError):
    """The 12-lead layout could not be detected. 422."""

    http = 422
    code = "layout_undetected"
    stage = "digitization"


class UpstreamUnavailable(KardioXError):
    """A required upstream (R2, Gemini, a model server) is unavailable. 503."""

    http = 503
    code = "pipeline_unavailable"


class PipelineTimeout(KardioXError):
    """The pipeline exceeded its time budget. 504."""

    http = 504
    code = "timeout"


def _envelope(err: KardioXError) -> JSONResponse:
    return JSONResponse(status_code=err.http, content={"error": {"code": err.code, "message": err.message, "stage": err.stage}})


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(KardioXError)
    async def _kx(_: Request, exc: KardioXError):  # noqa: ANN001
        return _envelope(exc)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):  # noqa: ANN001
        # Never leak internals or PII; return a generic contract error.
        return _envelope(UpstreamUnavailable("Unexpected pipeline error"))
