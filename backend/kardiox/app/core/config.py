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
    provider_quality: str = "none"    # → opencv (real image-quality gate)
    provider_digitization: str = "none"
    provider_rhythm: str = "none"
    provider_measurement: str = "none"
    provider_wfdb: str = "none"
    provider_rules: str = "builtin"   # the deterministic rule engine is real; safe to keep on
    provider_gemini: str = "none"

    # ── Quality gate thresholds (stage 5) ──────────────────────────────────────────────────────────
    quality_min_resolution: int = 400        # px on the short edge
    quality_min_focus: float = 60.0          # variance of Laplacian (below = blurry)
    quality_min_contrast: float = 25.0       # grayscale std-dev
    quality_max_glare_frac: float = 0.10     # fraction of near-white pixels
    quality_min_brightness: float = 40.0
    quality_max_brightness: float = 225.0

    # ── Upload validation (edge + pipeline) ────────────────────────────────────────────────────────
    max_upload_bytes: int = 12 * 1024 * 1024  # 12 MiB hard cap on an ECG image

    # ── Rate limiting (pipeline defense-in-depth; 0 = disabled, the edge is the primary gate) ────────
    rate_limit_per_min: int = 0
    rate_limit_burst: int = 20

    # ── Phase 7 advanced subsystems (feature-flagged; all additive, none enabled for end users) ──────
    calibration_temperature: float = 1.0     # 1.0 = identity (uncalibrated); fit + set after validation
    enable_consensus_fusion: bool = True     # run the evidence-fusion/consensus engine in the pipeline
    enable_explainability: bool = True       # attach per-finding explanations to the report

    # Specialist model classifiers (MI / rare-disease / conduction / morphology / beat). ONE JSON
    # registry maps task -> {path, kind, labels, inputSpec, labelMap}. Empty {} = every specialist is
    # NOT READY (KardioX ships no weights). Adding a specialist needs no code — just a registry entry.
    specialists_json: str = "{}"
    # EcgLib (ispras, Apache-2.0) pretrained binary classifiers. Comma-separated pathology codes to enable
    # (AFIB,1AVB,STACH,SBRAD,IRBBB,CRBBB,PVC); empty = disabled/Not-Ready. ecglib fetches the weights.
    ecglib_pathologies: str = ""
    # Multi-digitizer consensus members (comma-separated: classical, external). Extra members flagged
    # Not Ready are skipped; a single available member still yields a (single-source) result.
    digitizer_consensus_members: str = "classical"

    # ── Rhythm model (stages 6/7/9, TorchECG) — ship NO weights. Empty path → provider raises
    #    UpstreamUnavailable (never fakes a label). A validated checkpoint is required to enable.
    rhythm_model_path: str = ""
    rhythm_model_kind: str = "torchscript"   # torchscript | onnx | torch_statedict | tensorflow
    rhythm_model_fs: int = 500
    rhythm_model_labels: str = ""            # comma-separated label map bundled with the checkpoint
    rhythm_model_input_spec: str = ""        # named preset in models.INPUT_SPECS (e.g. ptbxl_500hz_10s)
    rhythm_label_map: str = ""               # named preset in models.LABEL_MAPS (e.g. ptbxl_superclass)

    # ── External digitizer (image → signal) plug-in, e.g. an ECG-Digitiser wrapper ─────────────────
    digitizer_entrypoint: str = ""           # "module:function" resolved at runtime; empty = not ready
    # ECG-Digitiser (felixkrones, BSD-2) — operator-installed. Command with {input}/{output} placeholders;
    # empty = Not Ready. See app/integrations/ecg_digitiser.py + docs/DIGITISER.md.
    ecg_digitiser_cmd: str = ""
    ecg_digitiser_fs: int = 500
    ecg_digitiser_timeout_s: float = 120.0

    # ── Gemini (stage-12 explanation) — future ─────────────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-1.5-pro"

    @property
    def rhythm_labels_list(self) -> list[str]:
        return [s.strip() for s in self.rhythm_model_labels.split(",") if s.strip()]

    @property
    def specialists_config(self) -> dict:
        import json
        try:
            v = json.loads(self.specialists_json or "{}")
            return v if isinstance(v, dict) else {}
        except (ValueError, TypeError):
            return {}

    @property
    def consensus_members_list(self) -> list[str]:
        return [s.strip() for s in self.digitizer_consensus_members.split(",") if s.strip()] or ["classical"]

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
