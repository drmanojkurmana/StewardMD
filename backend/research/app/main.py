"""StewardMD Research API. Deterministic analysis only; no LLM calculates statistics."""
from __future__ import annotations

import hmac
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.services.meta_analysis import MetaAnalysisError, calculate_meta_analysis

app = FastAPI(
    title="StewardMD Research Service",
    version="0.1.0",
    description="Medical-first research orchestration and reproducible statistical analysis.",
    docs_url=None if os.getenv("RESEARCH_ENV") == "production" else "/docs",
    redoc_url=None if os.getenv("RESEARCH_ENV") == "production" else "/redoc",
)


def require_worker_token(x_research_worker_token: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("RESEARCH_WORKER_TOKEN", "")
    if not expected:
        if os.getenv("RESEARCH_ENV") == "production":
            raise HTTPException(status_code=503, detail="Research worker authentication is not configured")
        return
    if not x_research_worker_token or not hmac.compare_digest(x_research_worker_token, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


class StudyInput(BaseModel):
    study_id: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=240)
    effect: float = Field(allow_inf_nan=False)
    ci_lower: float = Field(allow_inf_nan=False)
    ci_upper: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def ordered_ci(self):
        if not self.ci_lower < self.effect < self.ci_upper:
            raise ValueError("Study confidence interval must contain the effect estimate")
        return self


class MetaAnalysisRequest(BaseModel):
    effect_measure: str = Field(pattern="^(OR|RR|HR|MD|SMD)$")
    model: str = Field(default="random_dl", pattern="^(fixed|random_dl)$")
    confidence_level: float = Field(default=0.95, gt=0.5, lt=0.999)
    studies: list[StudyInput] = Field(min_length=2, max_length=500)

    @model_validator(mode="after")
    def unique_studies(self):
        ids = [s.study_id for s in self.studies]
        if len(ids) != len(set(ids)):
            raise ValueError("study_id values must be unique")
        if self.effect_measure in {"OR", "RR", "HR"} and any(
            s.effect <= 0 or s.ci_lower <= 0 or s.ci_upper <= 0 for s in self.studies
        ):
            raise ValueError("Ratio measures require positive estimates and confidence limits")
        return self


@app.get("/health")
def health():
    return {"status": "ok", "service": "stewardmd-research", "version": "0.1.0"}


@app.post("/v1/meta-analysis/compute", dependencies=[Depends(require_worker_token)])
def meta_analysis(body: MetaAnalysisRequest):
    try:
        return calculate_meta_analysis(
            [s.model_dump() for s in body.studies],
            effect_measure=body.effect_measure,
            model=body.model,
            confidence_level=body.confidence_level,
        )
    except MetaAnalysisError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
