"""Gateway HTTP client timeout: must outlast the gateway's own call budget.

The gateway (functions/api/research/_gateway.js) now gives a research call
LLM_CALL_DEADLINE_MS = 120 s instead of MaiK's 28 s chat deadline. The worker
must wait longer than that or it aborts a call the gateway is still serving
(the live gateway_http_502 draft failures, 2026-11-27).
"""
from __future__ import annotations

from paperorchestra.adapter.po_adapter.llm import GATEWAY_HTTP_TIMEOUT_SECONDS

GATEWAY_CALL_DEADLINE_SECONDS = 120


def test_gateway_http_timeout_outlasts_the_gateway_deadline():
    assert GATEWAY_HTTP_TIMEOUT_SECONDS >= 150
    assert GATEWAY_HTTP_TIMEOUT_SECONDS > GATEWAY_CALL_DEADLINE_SECONDS