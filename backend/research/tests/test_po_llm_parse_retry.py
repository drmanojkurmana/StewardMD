"""Unparseable gateway replies are retried inside the same attempts loop.

A live draft failed 48 s in with GatewayError("unparseable_response"): the
gateway answered 200 with text the upstream parser could not decode, and the
client raised at once. An undecodable reply is now retried like 429/5xx, after
the same backoff, until the attempts run out. Every retry is a real call: it is
recorded in calls/usage and checked against max_calls and the output-token cap.
"""
from __future__ import annotations

import httpx
import pytest

from paperorchestra.adapter.po_adapter.llm import (
    CeilingError, GatewayError, GatewayLLMClient)
from test_po_common import GATEWAY_URL, JOB_TOKEN

UNPARSEABLE = "The draft is ready, but it is prose rather than JSON."
GOOD = '```json\n{"ok": true}\n```'


def make_client(handler, **kwargs):
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return GatewayLLMClient(gateway_url=GATEWAY_URL, job_token=JOB_TOKEN,
                            http_client=http, sleep=lambda s: None,
                            now=lambda: 1763900000, **kwargs)


def reply(text, out_tokens=50):
    return httpx.Response(200, json={"text": text, "model": "mock",
                                     "usage": {"inputTokens": 100,
                                               "outputTokens": out_tokens}})


def test_unparseable_then_good_succeeds_and_counts_both_calls():
    replies = iter([UNPARSEABLE, GOOD])
    requests = []

    def handler(request):
        requests.append(request)
        return reply(next(replies))

    client = make_client(handler)
    result = client.call_text("write", "m")
    assert result["parsed_response"] == {"ok": True}
    assert len(requests) == 2
    assert client.calls == 2
    assert len(client.usage) == 2


def test_always_unparseable_raises_after_all_attempts():
    requests = []

    def handler(request):
        requests.append(request)
        return reply(UNPARSEABLE)

    client = make_client(handler, tier="T2")
    with pytest.raises(GatewayError) as exc:
        client.call_text("write", "m")
    assert exc.value.code == "unparseable_response"
    assert len(requests) == 3  # 1 attempt + 2 retries (T2 ceiling)
    assert client.calls == 3  # each retried call counted


def test_bad_envelope_is_retried():
    replies = iter([httpx.Response(200, content=b"not json"), reply(GOOD)])
    requests = []

    def handler(request):
        requests.append(request)
        return next(replies)

    client = make_client(handler)
    result = client.call_text("write", "m")
    assert result["parsed_response"] == {"ok": True}
    assert len(requests) == 2


def test_max_calls_hit_during_parse_retries_raises_ceiling():
    requests = []

    def handler(request):
        requests.append(request)
        return reply(UNPARSEABLE)

    client = make_client(handler, tier="T2", max_calls=2)
    with pytest.raises(CeilingError) as exc:
        client.call_text("write", "m")
    assert exc.value.code == "ceiling_calls"
    assert len(requests) == 2  # third attempt refused before any network call
    assert client.calls == 2


def test_output_token_ceiling_is_not_retried():
    requests = []

    def handler(request):
        requests.append(request)
        return reply(UNPARSEABLE, out_tokens=4001)

    client = make_client(handler, tier="T2")
    with pytest.raises(CeilingError) as exc:
        client.call_text("write", "m")
    assert exc.value.code == "ceiling_output_tokens"
    assert len(requests) == 1