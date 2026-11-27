"""Queue client against mocked HTTP (no network)."""
from __future__ import annotations

import base64
import json

import httpx
import pytest

from research_worker.queue import QueueClient, QueueError


def make_client(handler):
    return QueueClient(
        "acct", "queue123", "tok",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_pull_request_shape_and_base64_body():
    seen = {}
    payload = {"v": 1, "jobId": "job_1"}
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "success": True,
            "result": {
                "message_backlog_count": 1,
                "messages": [{
                    "id": "m1", "lease_id": "lease1", "attempts": 2,
                    "timestamp_ms": 1763900000000,
                    "body": encoded,
                    "metadata": {"CF-Content-Type": "json"},
                }],
            },
        })

    messages = make_client(handler).pull(batch_size=5, visibility_timeout_ms=900_000)
    assert seen["url"] == (
        "https://api.cloudflare.com/client/v4/accounts/acct/queues/queue123/messages/pull"
    )
    assert seen["auth"] == "Bearer tok"
    assert seen["body"] == {"visibility_timeout_ms": 900_000, "batch_size": 5}
    assert len(messages) == 1
    assert messages[0].body == payload
    assert messages[0].lease_id == "lease1"
    assert messages[0].attempts == 2


def test_pull_text_body_plain():
    def handler(request):
        return httpx.Response(200, json={
            "success": True,
            "result": {"messages": [{
                "id": "m1", "lease_id": "l", "attempts": 1,
                "body": '{"v": 1}', "metadata": {"CF-Content-Type": "text"},
            }]},
        })

    assert make_client(handler).pull()[0].body == {"v": 1}


def test_pull_malformed_body_is_none():
    def handler(request):
        return httpx.Response(200, json={
            "success": True,
            "result": {"messages": [{"id": "m1", "lease_id": "l", "attempts": 1,
                                     "body": "not-json", "metadata": {}}]},
        })

    assert make_client(handler).pull()[0].body is None


def test_pull_empty():
    def handler(request):
        return httpx.Response(200, json={"success": True, "result": {"messages": []}})

    assert make_client(handler).pull() == []


def test_ack_payload():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"success": True, "result": {}})

    make_client(handler).ack(["l1", "l2"])
    assert seen["url"].endswith("/messages/ack")
    assert seen["body"] == {"acks": [{"lease_id": "l1"}, {"lease_id": "l2"}], "retries": []}


def test_retry_with_delay():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"success": True, "result": {}})

    make_client(handler).retry("l1", delay_seconds=60)
    assert seen["body"] == {"acks": [], "retries": [{"lease_id": "l1", "delay_seconds": 60}]}


def test_api_failure_raises():
    def handler(request):
        return httpx.Response(200, json={"success": False, "errors": [{"message": "nope"}]})

    with pytest.raises(QueueError):
        make_client(handler).pull()


def test_http_error_raises():
    def handler(request):
        return httpx.Response(500, text="boom")

    with pytest.raises(QueueError):
        make_client(handler).ack(["l1"])

def test_json_body_delivered_as_plain_text_is_decoded():
    # Production delivered json-typed messages that were not base64; the old decoder dropped them.
    from research_worker.queue import _decode_body
    assert _decode_body('{"v": 1, "kind": "manuscript_draft"}', "json") == {"v": 1, "kind": "manuscript_draft"}
    import base64
    raw = base64.b64encode(b'{"v": 1}').decode()
    assert _decode_body(raw, "json") == {"v": 1}
