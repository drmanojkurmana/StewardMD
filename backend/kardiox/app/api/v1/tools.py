"""Additive v1 tools — serial comparison + clinical report / FHIR export.

These operate on analysis payloads the caller already holds (the app stores prior analyses locally), so
they add capability WITHOUT changing the /analyze contract or the iOS frontend. Deterministic; auth +
rate-limit like the rest of the API.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.ratelimit import rate_limit
from app.core.security import require_pipeline_auth

router = APIRouter(prefix="/ecg", tags=["tools"])


class CompareRequest(BaseModel):
    current: dict[str, Any]
    prior: dict[str, Any]


class ReportRequest(BaseModel):
    analysis: dict[str, Any]


@router.post("/compare", summary="Serial ECG comparison (current vs prior analysis)",
             dependencies=[Depends(require_pipeline_auth), Depends(rate_limit)])
async def compare(req: CompareRequest) -> dict:
    from app.services.serial import compare as _compare
    return _compare(req.current, req.prior)


@router.post("/report", summary="Clinical report + FHIR R4 + printable HTML from an analysis",
             dependencies=[Depends(require_pipeline_auth), Depends(rate_limit)])
async def report(req: ReportRequest) -> dict:
    from app.services.report import build_report, render_html, to_fhir
    rep = build_report(req.analysis)
    return {"report": rep, "fhir": to_fhir(req.analysis), "html": render_html(rep)}
