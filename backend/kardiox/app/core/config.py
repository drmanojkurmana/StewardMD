"""Configuration management (12-factor, env-driven) via pydantic-settings.

Every deployment knob is an environment variable; nothing secret is hard-coded. Import `get_settings()`
(cached) anywhere you need config. See `.env.example` for the full list.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KARDIOX_", env_file=".env", extra="ignore")

    # ── App ──────────────────────────────────────────────────────────────────────────────────────
    app_name: str = "KardioX AI Pipeline"
    environment: Literal["dev", "staging", "prod"] = "dev"
    # mode=mock → return the canonical AF sample so the iOS app connects end-to-end BEFORE models exist.
    # mode=live → run the real pipeline (providers raise NotImplemented until ECG models are wired in).
    mode: Literal["mock", "live"] = "mock"
    log_level: str = "INFO"
    request_timeout_s: float = 90.0

    # ── API ──────────────────────────────────────────────────────────────────────────────────────
    api_v1_prefix: str = "/v1"
    cors_origins: str = "*"  # comma-separated; tighten in prod (e.g. https://stewardmd.in)

    # ── Auth (the Cloudflare edge → this pipeline) ────────────────────────────────────────────────
    # Shared secret the edge Worker sends as X-Pipeline-Token. Empty in dev disables the check.
    pipeline_token: str = Field(default="", description="Shared secret from the Cloudflare edge Worker")

    # ── R2 (S3-compatible) — the pipeline READS the ephemeral upload the edge put there, by sessionId ─
    r2_endpoint: str = Field(default="", description="https://<account>.r2.cloudflarestorage.com")
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "kardiox-ephemeral"
    r2_upload_prefix: str = "uploads/"
    # If the pipeline should delete the object after reading (belt-and-suspenders; the edge also deletes).
    r2_delete_after_read: bool = True

    # ── Provider selection (per stage). Default "none" → NotImplemented. Swap to real impl names as
    #    the ML models land (e.g. preprocessing="opencv", rhythm="torchecg"). See services/registry.py.
    provider_preprocessing: str = "none"
    provider_digitization: str = "none"
    provider_rhythm: str = "none"
    provider_measurement: str = "none"
    provider_wfdb: str = "none"
    provider_rules: str = "builtin"   # the deterministic rule engine is real; safe to keep on
    provider_gemini: str = "none"

    # ── Rhythm model (stages 6/7/9, TorchECG) — ship NO weights. Empty path → provider raises
    #    UpstreamUnavailable (never fakes a label). A validated checkpoint is required to enable.
    rhythm_model_path: str = ""
    rhythm_model_fs: int = 500
    rhythm_model_labels: str = ""   # comma-separated label map bundled with the checkpoint

    # ── Gemini (stage-12 explanation) — future ─────────────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-1.5-pro"

    @property
    def rhythm_labels_list(self) -> list[str]:
        return [s.strip() for s in self.rhythm_model_labels.split(",") if s.strip()]

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
