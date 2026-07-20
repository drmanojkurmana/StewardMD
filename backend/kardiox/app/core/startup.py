"""Startup validation (Phase 6E) — fail fast on a misconfigured production deployment.

Returns a list of problems. Items prefixed "FATAL:" abort startup in prod (environment=prod); everything
else is a warning. In dev/staging nothing is fatal (so local + CI run freely).
"""
from __future__ import annotations


def validate_startup(settings) -> list[str]:
    problems: list[str] = []
    prod = settings.environment == "prod"

    if prod and not settings.pipeline_token:
        problems.append("FATAL: KARDIOX_PIPELINE_TOKEN must be set in prod (edge → pipeline auth).")
    if prod and settings.cors_origins.strip() == "*":
        problems.append("CORS is '*' in prod — tighten KARDIOX_CORS_ORIGINS to the app origin.")

    if settings.mode == "live":
        if not (settings.r2_endpoint and settings.r2_access_key_id and settings.r2_secret_access_key):
            msg = "R2 is not configured (KARDIOX_R2_*) — live pipeline cannot read uploads."
            problems.append(("FATAL: " if prod else "") + msg)
        core_none = [s for s in ("provider_digitization", "provider_wfdb", "provider_measurement",
                                 "provider_rhythm") if getattr(settings, s) == "none"]
        if core_none:
            problems.append(f"live mode but core providers are 'none' {core_none} — pipeline will 501.")

    return problems
