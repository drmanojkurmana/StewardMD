"""Phase 6E — startup validation. Pure Python (no ML deps)."""
from __future__ import annotations

from app.core.startup import validate_startup


class _S:
    def __init__(self, **kw):
        self.environment = "dev"
        self.mode = "mock"
        self.pipeline_token = ""
        self.cors_origins = "*"
        self.r2_endpoint = ""
        self.r2_access_key_id = ""
        self.r2_secret_access_key = ""
        self.provider_digitization = "none"
        self.provider_wfdb = "none"
        self.provider_measurement = "none"
        self.provider_rhythm = "none"
        self.__dict__.update(kw)


def test_dev_mock_has_no_fatal():
    problems = validate_startup(_S(environment="dev", mode="mock"))
    assert not [p for p in problems if p.startswith("FATAL")]


def test_prod_requires_pipeline_token():
    problems = validate_startup(_S(environment="prod", mode="mock", pipeline_token=""))
    assert any(p.startswith("FATAL") and "PIPELINE_TOKEN" in p for p in problems)


def test_prod_live_requires_r2():
    problems = validate_startup(_S(environment="prod", mode="live", pipeline_token="secret", cors_origins="https://x"))
    assert any(p.startswith("FATAL") and "R2" in p for p in problems)


def test_live_warns_on_none_providers():
    problems = validate_startup(_S(environment="staging", mode="live",
                                   r2_endpoint="https://r2", r2_access_key_id="k", r2_secret_access_key="s"))
    assert any("providers are 'none'" in p for p in problems)
    assert not [p for p in problems if p.startswith("FATAL")]   # staging is never fatal
