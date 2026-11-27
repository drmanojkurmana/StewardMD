"""Jobs: HMAC vector, idempotent skip, cancel, ceilings, callback, drain."""
from __future__ import annotations

import hashlib
import json

import httpx
import pytest

from research_worker.jobs import (
    drain_once,
    run_job,
    send_callback,
    sign_callback,
    validate_message,
)
from research_worker.queue import Message
from conftest import FakeQueue, FakeStorage, callback_client, make_msg, text_pdf

SECRET = "test-secret"
URL = "https://stewardmd.in"

# Frozen test vector from docs/research/contracts/phase-3/callback.md.
VECTOR_BODY = (
    b'{"jobId":"job_1","idempotencyKey":"k1","status":"done",'
    b'"resultKey":"projects/p1/jobs/job_1/result.json","usage":{"pages":2,"seconds":1.5}}'
)
VECTOR_SIG = "d9526eaa7328d6c49e32502c09811b05d46cdea2f82ec680ab29afe838c487e5"


def run(msg, storage, statuses=None, **kw):
    client, calls = callback_client(statuses)
    outcome = run_job(
        msg, storage=storage, callback_client=client, callback_url=URL,
        secret=SECRET, sleep=lambda *_: None, **kw,
    )
    return outcome, calls


def test_hmac_signature_vector():
    assert sign_callback(SECRET, "1763900000", VECTOR_BODY) == VECTOR_SIG


def test_callback_headers_and_raw_body():
    client, calls = callback_client()
    payload = json.loads(VECTOR_BODY)
    assert send_callback(client, URL, "job_1", payload, SECRET,
                         sleep=lambda *_: None, now=lambda: 1763900000) is True
    request = calls[0]
    assert str(request.url) == f"{URL}/api/research/jobs/job_1/callback"
    assert request.headers["X-Research-Timestamp"] == "1763900000"
    assert request.headers["X-Research-Signature"] == VECTOR_SIG
    assert request.content == VECTOR_BODY  # exact bytes, compact JSON


def test_callback_retries_then_succeeds():
    client, calls = callback_client([500, 502, 200])
    assert send_callback(client, URL, "job_1", {"status": "done"}, SECRET,
                         sleep=lambda *_: None) is True
    assert len(calls) == 3


def test_callback_gives_up_after_three():
    client, calls = callback_client([500, 500, 500])
    assert send_callback(client, URL, "job_1", {"status": "done"}, SECRET,
                         sleep=lambda *_: None) is False
    assert len(calls) == 3


def test_happy_path_writes_result_and_calls_back():
    data = text_pdf(pages=2)
    msg = make_msg(data)
    storage = FakeStorage({msg["input"]["r2Key"]: data})
    outcome, calls = run(msg, storage)
    assert outcome == {"status": "done", "settled": True, "skipped": False, "error": None}
    result_key = "projects/p1/jobs/job_1/result.json"
    assert result_key in storage.writes
    stored = json.loads(storage.objects[result_key])
    assert stored["jobId"] == "job_1"
    assert stored["idempotencyKey"] == "k1"
    assert stored["status"] == "done"
    assert stored["sha256"] == hashlib.sha256(data).hexdigest()
    assert len(stored["pages"]) == 2
    assert stored["usage"]["pages"] == 2
    body = json.loads(calls[0].content)
    assert body["status"] == "done"
    assert body["resultKey"] == result_key
    assert "error" not in body


def test_idempotent_skip_does_no_work():
    data = text_pdf()
    msg = make_msg(data)
    result_key = "projects/p1/jobs/job_1/result.json"
    stored = {"jobId": "job_1", "idempotencyKey": "k1", "status": "done",
              "usage": {"pages": 1, "seconds": 0.4}, "pages": [], "ocr": False, "sha256": "x"}
    storage = FakeStorage({result_key: json.dumps(stored).encode()})
    outcome, calls = run(msg, storage)
    assert outcome["skipped"] is True and outcome["settled"] is True
    assert msg["input"]["r2Key"] not in storage.reads  # never read the PDF
    assert storage.writes == []  # never re-wrote the result
    body = json.loads(calls[0].content)
    assert body["usage"] == {"pages": 1, "seconds": 0.4}
    assert body["resultKey"] == result_key


def test_cancel_before_start():
    data = text_pdf()
    msg = make_msg(data)
    storage = FakeStorage({
        msg["input"]["r2Key"]: data,
        "projects/p1/jobs/job_1/cancel": b"",
    })
    outcome, calls = run(msg, storage)
    assert outcome["status"] == "cancelled" and outcome["settled"] is True
    assert storage.writes == []
    assert json.loads(calls[0].content)["status"] == "cancelled"


def test_cancel_mid_document():
    data = text_pdf(pages=3)
    msg = make_msg(data)
    # exists() calls on the cancel key: 1 run_job pre-check, 2 before the
    # extraction loop, 3 before page 1, 4 before page 2 -> cancel after page 1.
    storage = FakeStorage({msg["input"]["r2Key"]: data}, cancel_after=4)
    outcome, calls = run(msg, storage)
    assert outcome["status"] == "cancelled" and outcome["settled"] is True
    assert storage.writes == []  # no partial result saved
    body = json.loads(calls[0].content)
    assert body["status"] == "cancelled"
    assert body["usage"]["pages"] == 1


def test_page_ceiling_fails_with_code():
    data = text_pdf(pages=2)
    msg = make_msg(data, max_pages=1)
    storage = FakeStorage({msg["input"]["r2Key"]: data})
    outcome, calls = run(msg, storage)
    assert outcome["status"] == "failed" and outcome["error"] == "ceiling_pages"
    assert storage.writes == []
    body = json.loads(calls[0].content)
    assert body["error"] == "ceiling_pages"
    assert "resultKey" not in body


def test_missing_input_fails():
    msg = make_msg(text_pdf())
    outcome, calls = run(msg, FakeStorage())
    assert outcome["error"] == "input_missing"
    assert json.loads(calls[0].content)["error"] == "input_missing"


def test_callback_failure_leaves_job_unsettled():
    data = text_pdf()
    msg = make_msg(data)
    storage = FakeStorage({msg["input"]["r2Key"]: data})
    outcome, _ = run(msg, storage, statuses=[500, 500, 500])
    assert outcome["status"] == "done"
    assert outcome["settled"] is False  # drain must not ack
    assert "projects/p1/jobs/job_1/result.json" in storage.writes  # result durable


def test_validate_message_rejects_bad_shapes():
    good = make_msg(text_pdf())
    validate_message(good)  # no raise
    bad_versions = [
        {**good, "v": 2},
        {**good, "kind": "other"},
        {**good, "ceilings": {"maxPages": 61, "maxSeconds": 240}},
        {**good, "ceilings": {"maxPages": 1, "maxSeconds": 241}},
        {**good, "input": {"r2Key": "projects/OTHER/pdf/" + "a" * 64 + ".pdf"}},
        {**good, "input": {"r2Key": "elsewhere.pdf"}},
        {**good, "idempotencyKey": ""},
    ]
    for bad in bad_versions:
        with pytest.raises(ValueError):
            validate_message(bad)


def test_drain_acks_settled_and_retries_unsettled():
    data = text_pdf()
    settled_msg = make_msg(data, job="job_ok")
    unsettled_msg = make_msg(data, job="job_retry")
    storage = FakeStorage({
        settled_msg["input"]["r2Key"]: data,
        unsettled_msg["input"]["r2Key"]: data,
    })
    queue = FakeQueue([
        Message(id="m1", lease_id="l1", attempts=1, body=settled_msg, raw_body=""),
        Message(id="m2", lease_id="l2", attempts=1, body=unsettled_msg, raw_body=""),
    ])
    statuses = [200, 500, 500, 500]  # first job settles, second never does
    client, _ = callback_client(statuses)
    counts = drain_once(queue, storage, callback_client=client, callback_url=URL,
                        secret=SECRET, sleep=lambda *_: None)
    assert counts.pop("lastError").startswith("not settled")
    assert counts == {"pulled": 2, "done": 1, "failed": 0, "cancelled": 0, "retried": 1}
    assert queue.acked == ["l1"]
    assert queue.retried == [("l2", 60)]
    assert queue.pull_args == {"batch_size": 5, "visibility_timeout_ms": 7_200_000}


def test_drain_retries_malformed_and_invalid_messages():
    queue = FakeQueue([
        Message(id="m1", lease_id="l1", attempts=1, body=None, raw_body="garbage"),
        Message(id="m2", lease_id="l2", attempts=1, body={"v": 99}, raw_body=""),
    ])
    client, calls = callback_client()
    counts = drain_once(queue, FakeStorage(), callback_client=client, callback_url=URL,
                        secret=SECRET, sleep=lambda *_: None)
    assert counts["retried"] == 2 and counts["pulled"] == 2
    assert queue.acked == []
    assert calls == []  # nothing to call back about

def test_storage_failure_is_retried_quickly_not_hidden_for_the_lease():
    # 2026-11-27: missing R2 keys left jobs un-acked, hidden for the whole 2 h lease.
    from research_worker.storage import StorageError

    class BrokenStorage(FakeStorage):
        def exists(self, key):
            raise StorageError("r2 head failed")

        def get_bytes(self, key):
            raise StorageError("r2 get failed")

    msg = make_msg(text_pdf())
    queue = FakeQueue([Message(id="m1", lease_id="l1", attempts=1, body=msg, raw_body="")])
    client, calls = callback_client()
    counts = drain_once(queue, BrokenStorage(), callback_client=client, callback_url=URL,
                        secret=SECRET, sleep=lambda *_: None)
    assert counts["retried"] == 1
    assert queue.retried == [("l1", 60)]
    assert queue.acked == []
