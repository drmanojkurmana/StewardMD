"""Gateway HTTP client timeout: must outlast the gateway's own call budget.

The gateway (functions/api/research/_gateway.js) now gives a research call
LLM_CALL_DEADLINE_MS = 120 s instead of MaiK's 28 s chat deadline. The worker
must wait longer than that or it aborts a call the gateway is still serving
(the live gateway_http_502 draft failures, 2026-11-27).
"""
from __future__ import annotations

import httpx
import pytest

from paperorchestra.adapter.po_adapter.llm import (
    CeilingError,
    GATEWAY_HTTP_TIMEOUT_SECONDS,
    GatewayLLMClient,
    PO_MAX_SECONDS,
)

GATEWAY_CALL_DEADLINE_SECONDS = 120


def test_gateway_http_timeout_outlasts_the_gateway_deadline():
    assert PO_MAX_SECONDS == 600
    assert GATEWAY_HTTP_TIMEOUT_SECONDS >= 150
    assert GATEWAY_HTTP_TIMEOUT_SECONDS > GATEWAY_CALL_DEADLINE_SECONDS


def test_per_call_600s_ceiling_stops_before_next_call():
    clock = [1000.0]
    called = 0

    def handler(request):
        nonlocal called
        called += 1
        return httpx.Response(200, json={
            "text": "ok", "model": "gemini-2.5-flash",
            "usage": {"inputTokens": 10, "outputTokens": 5},
        })

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GatewayLLMClient(
        gateway_url="https://gw.test/v1/internal/llm",
        job_token="tok",
        http_client=http,
        monotonic=lambda: clock[0],
        sleep=lambda _s: None,
    )
    res = client.call_text("First call", "researchmd-writer",
                           result_parsing_func=lambda x: x, step_id="outline")
    assert res["raw_response"] == "ok"
    assert called == 1

    # Exactly 600s still allowed; passing 600s stops BEFORE making the HTTP call.
    clock[0] = 1600.0
    client.call_text("At boundary", "researchmd-writer",
                     result_parsing_func=lambda x: x, step_id="section:methods")
    assert called == 2

    clock[0] = 1600.1
    with pytest.raises(CeilingError) as exc:
        client.call_text("Over 600s", "researchmd-writer",
                         result_parsing_func=lambda x: x, step_id="section:results")
    assert exc.value.code == "ceiling_seconds"
    assert called == 2  # aborted before hitting HTTP


def test_per_call_600s_ceiling_also_checks_before_retries():
    clock = [0.0]
    called = 0

    def handler(request):
        nonlocal called
        called += 1
        clock[0] += 350.0  # two attempts push total past 600s
        return httpx.Response(503, text="busy")

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GatewayLLMClient(
        gateway_url="https://gw.test/v1/internal/llm",
        job_token="tok",
        http_client=http,
        monotonic=lambda: clock[0],
        sleep=lambda _s: None,
    )
    with pytest.raises(CeilingError) as exc:
        client.call_text("Retry call", "researchmd-writer",
                         result_parsing_func=lambda x: x, step_id="outline")
    assert exc.value.code == "ceiling_seconds"
    assert called == 2
