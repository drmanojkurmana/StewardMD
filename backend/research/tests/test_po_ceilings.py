"""Ceiling tests (contracts/phase-3/ceilings.md): token caps, retry caps,
refinement-round caps and the adapter max-calls guard stop runaway loops.
All LLM traffic is mocked; no network."""
from __future__ import annotations

import json

import httpx
import pytest

from paperorchestra.adapter.po_adapter.llm import (
    CeilingError, GatewayError, GatewayLLMClient, TIER_CEILINGS)
from test_po_common import GATEWAY_URL, JOB_TOKEN, make_gateway


def ok_handler(request):
    return httpx.Response(200, json={"text": "```json\n{\"ok\": true}\n```",
                                     "model": "mock",
                                     "usage": {"inputTokens": 10, "outputTokens": 5}})


def client_with(handler, **kwargs):
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return GatewayLLMClient(gateway_url=GATEWAY_URL, job_token=JOB_TOKEN,
                            http_client=http, sleep=lambda s: None,
                            now=lambda: 1763900000, **kwargs)


def test_tier_defaults_match_contract():
    assert TIER_CEILINGS["T1"] == {"max_input_tokens": 8000, "max_output_tokens": 2000,
                                   "max_retries": 2, "max_refinement_rounds": 1}
    assert TIER_CEILINGS["T2"]["max_input_tokens"] == 16000
    assert TIER_CEILINGS["T2"]["max_output_tokens"] == 4000
    assert TIER_CEILINGS["T2"]["max_refinement_rounds"] == 2
    assert TIER_CEILINGS["T3"] == {"max_input_tokens": 24000, "max_output_tokens": 4000,
                                   "max_retries": 1, "max_refinement_rounds": 1}


def test_input_token_ceiling_blocks_before_any_call():
    calls = []

    def handler(request):
        calls.append(request)
        return ok_handler(request)

    client = client_with(handler, tier="T2")
    with pytest.raises(CeilingError) as exc:
        client.call_text("x" * 70000, "m")  # ~17500 tokens > 16000
    assert exc.value.code == "ceiling_input_tokens"
    assert calls == []


def test_output_token_ceiling_on_actual_usage():
    def handler(request):
        return httpx.Response(200, json={"text": "ok", "model": "mock",
                                         "usage": {"inputTokens": 10,
                                                   "outputTokens": 4001}})

    client = client_with(handler, tier="T2")
    with pytest.raises(CeilingError) as exc:
        client.call_text("short", "m", result_parsing_func=lambda raw: raw)
    assert exc.value.code == "ceiling_output_tokens"


def test_max_calls_guard():
    client = client_with(ok_handler, max_calls=1)
    client.call_text("one", "m")
    with pytest.raises(CeilingError) as exc:
        client.call_text("two", "m")
    assert exc.value.code == "ceiling_calls"


def test_refinement_round_ceiling_t2():
    client = client_with(ok_handler, tier="T2")
    client.call_contents(["round one"], "m", purpose="refinement")
    client.call_contents(["round two"], "m", purpose="refinement")
    with pytest.raises(CeilingError) as exc:
        client.call_contents(["round three"], "m", purpose="refinement")
    assert exc.value.code == "ceiling_refinement_rounds"
    assert client.refinement_rounds == 2


def test_refinement_round_ceiling_t1_is_one():
    client = client_with(ok_handler, tier="T1")
    client.call_contents(["round one"], "m", purpose="refinement")
    with pytest.raises(CeilingError):
        client.call_contents(["round two"], "m", purpose="refinement")


def test_retry_ceiling_t2_three_attempts_then_fail():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(500)

    client = client_with(handler, tier="T2")
    with pytest.raises(GatewayError):
        client.call_text("q", "m")
    assert len(calls) == 3  # 1 attempt + 2 retries (T2 ceiling)


def test_retry_ceiling_t3_two_attempts():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503)

    client = client_with(handler, tier="T3")
    with pytest.raises(GatewayError):
        client.call_text("q", "m")
    assert len(calls) == 2  # 1 + 1 retry (T3 ceiling)


def test_retry_then_success():
    statuses = iter([500, 200])

    def handler(request):
        status = next(statuses)
        if status == 200:
            return ok_handler(request)
        return httpx.Response(status)

    client = client_with(handler, tier="T2")
    result = client.call_text("q", "m")
    assert result["parsed_response"] == {"ok": True}


def test_non_retryable_4xx_fails_fast():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(401)

    client = client_with(handler)
    with pytest.raises(GatewayError) as exc:
        client.call_text("q", "m")
    assert exc.value.code == "gateway_http_401"
    assert len(calls) == 1


def test_usage_recorded_per_call():
    client = client_with(ok_handler, tier="T2")
    client.call_text("q", "m", purpose="write")
    client.call_text("q2", "m", purpose="review")
    assert len(client.usage) == 2
    assert client.usage[0]["jobId"] == "job_local"
    assert client.usage[0]["inputTokens"] == 10
    assert client.usage[0]["outputTokens"] == 5
    assert client.usage[1]["purpose"] == "review"
    assert client.total_usage() == {"calls": 2, "inputTokens": 20, "outputTokens": 10}


def test_unconfigured_client_never_falls_back_to_provider():
    client = GatewayLLMClient(gateway_url="", job_token="")
    with pytest.raises(GatewayError) as exc:
        client.call_text("q", "m")
    assert exc.value.code == "gateway_unconfigured"


def test_runaway_upstream_refinement_loop_is_clamped(tmp_path):
    # The upstream agent is constructed with max_reflections=99; the pipeline
    # clamps to the T2 ceiling (2) and the client counts rounds independently.
    from paperorchestra.adapter.po_adapter import pipeline
    from test_po_common import make_manifest

    client, requests = make_gateway(review_scores=[5, 7, 8, 9])
    manifest = make_manifest()
    from paperorchestra.adapter.po_adapter.loader import build_token_table
    table = build_token_table(manifest["runs"])
    citation_map = {"ref1": manifest["references"][0]}
    from test_po_common import DRAFT_V0
    final_tex, ctx = pipeline.run_refinement(
        manifest, tmp_path, client, DRAFT_V0, citation_map, table,
        max_reflections=99)
    refinement_calls = [u for u in client.usage if u["purpose"] == "refinement"]
    assert len(refinement_calls) == 2
    assert client.refinement_rounds == 2
    assert "REFINED_V2" in final_tex
    assert ctx["gate_hits"] == []
