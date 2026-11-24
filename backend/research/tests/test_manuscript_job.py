"""Unit tests for the manuscript_draft job handler (manuscript.job).

Covers validation, the minted per-job gateway token, the happy path through the
adapter with a mocked gateway (draft tokens stay unresolved), idempotent skip,
cancel, missing/invalid snapshot, PHI block, and hard-gate failure persisting the
violation list. No network, no provider keys.
"""
from __future__ import annotations

import hashlib
import hmac
import json

import pytest

import research_worker.jobs as worker_jobs
from manuscript import job as manuscript_job
from paperorchestra.adapter.po_adapter import gates, pipeline
from paperorchestra.adapter.po_adapter.phi import PhiBlockedError
from test_po_common import make_gateway, make_manifest

SECRET = "test-secret"
URL = "https://stewardmd.in"
SNAP_KEY = "projects/p1/manuscript/snapshots/snap1.json"
RESULT_KEY = "projects/p1/jobs/job_1/result.json"
CANCEL_KEY = "projects/p1/jobs/job_1/cancel"


class FakeStorage:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.reads = []
        self.writes = []

    def get_bytes(self, key):
        self.reads.append(key)
        return self.objects.get(key)

    def exists(self, key):
        return key in self.objects

    def put_bytes(self, key, data, content_type="application/json"):
        self.writes.append(key)
        self.objects[key] = data


def make_msg(**over):
    msg = {
        "v": 1, "kind": "manuscript_draft", "jobId": "job_1", "projectId": "p1",
        "idempotencyKey": "k1", "createdAt": 1763900000,
        "input": {"r2Key": SNAP_KEY},
        "ceilings": {"maxSeconds": 600, "maxCalls": 64},
    }
    msg.update(over)
    return msg


@pytest.fixture
def callbacks(monkeypatch):
    sent = []

    def fake_send(client, base_url, job_id, payload, secret, *, sleep=None, now=None):
        sent.append(payload)
        return True

    monkeypatch.setattr(worker_jobs, "send_callback", fake_send)
    return sent


def run(msg, storage, callbacks, **kw):
    return manuscript_job.run_job(
        msg, storage=storage, callback_client=None, callback_url=URL,
        secret=SECRET, sleep=lambda *_: None, now=lambda: 1763900000, **kw)


def test_mint_job_token_matches_gateway_contract():
    token = manuscript_job.mint_job_token(SECRET, "job_1", 1763900900)
    digest = hmac.new(SECRET.encode(), b"llm:job_1:1763900900", hashlib.sha256).hexdigest()
    assert token == f"job_1.1763900900.{digest}"


def test_validate_message_accepts_and_rejects():
    manuscript_job.validate_message(make_msg())
    for bad in (
        make_msg(kind="pdf_extract"),
        make_msg(v=2),
        make_msg(jobId=""),
        make_msg(createdAt=-1),
        make_msg(ceilings={"maxSeconds": 601, "maxCalls": 64}),
        make_msg(ceilings={"maxSeconds": 10, "maxCalls": 0}),
        make_msg(input={"r2Key": "projects/p2/manuscript/snapshots/snap1.json"}),
        make_msg(input={"r2Key": "projects/p1/pdf/" + "a" * 64 + ".pdf"}),
        make_msg(input={"r2Key": SNAP_KEY, "cutoffDate": "2024-13-01"}),
    ):
        with pytest.raises(ValueError):
            manuscript_job.validate_message(bad)


def test_done_writes_draft_with_unresolved_tokens(callbacks, tmp_path):
    client, requests = make_gateway(review_scores=[5, 7, 8])
    manifest = make_manifest()
    storage = FakeStorage({SNAP_KEY: json.dumps(manifest).encode()})
    out = run(make_msg(), storage, callbacks, llm_client=client, workdir=tmp_path)
    assert out == {"status": "done", "settled": True, "skipped": False, "error": None}
    stored = json.loads(storage.objects[RESULT_KEY])
    assert stored["status"] == "done" and stored["jobId"] == "job_1"
    draft = stored["draft"]
    results = next(s for s in draft["sections"] if s["id"] == "results")
    # Numbers stay canonical tokens, unresolved (plan rule 6).
    assert "{{run:r1.estimate}}" in results["text"]
    assert "0.62" not in results["text"]
    assert stored["aiUsage"]["calls"] == len(client.usage) > 0
    assert callbacks[0]["status"] == "done"
    assert callbacks[0]["resultKey"] == RESULT_KEY
    assert callbacks[0]["usage"]["pages"] == 0
    assert all(str(r.url) == "https://gateway.test/v1/generate" for r in requests)


def test_idempotent_skip_resends_callback(callbacks, tmp_path):
    client, _ = make_gateway()
    storage = FakeStorage({SNAP_KEY: json.dumps(make_manifest()).encode()})
    run(make_msg(), storage, callbacks, llm_client=client, workdir=tmp_path)
    writes = len(storage.writes)
    out = run(make_msg(), storage, callbacks, llm_client=client, workdir=tmp_path)
    assert out["skipped"] is True and out["status"] == "done"
    assert len(storage.writes) == writes  # no re-write
    assert storage.reads.count(SNAP_KEY) == 1  # snapshot read once, never on skip
    assert len(callbacks) == 2


def test_cancel_flag(callbacks):
    storage = FakeStorage({CANCEL_KEY: b""})
    out = run(make_msg(), storage, callbacks)
    assert out["status"] == "cancelled" and out["settled"] is True
    assert RESULT_KEY not in storage.objects


def test_missing_input(callbacks):
    out = run(make_msg(), FakeStorage(), callbacks)
    assert out["status"] == "failed" and out["error"] == "input_missing"
    assert callbacks[0]["error"] == "input_missing"


def test_invalid_snapshot(callbacks):
    storage = FakeStorage({SNAP_KEY: b"\xff\xfe not json"})
    out = run(make_msg(), storage, callbacks)
    assert out["error"] == "snapshot_invalid"


def test_unlocked_protocol_refused(callbacks, tmp_path):
    manifest = make_manifest()
    manifest["protocol"]["lockHash"] = ""
    storage = FakeStorage({SNAP_KEY: json.dumps(manifest).encode()})
    client, _ = make_gateway()
    out = run(make_msg(), storage, callbacks, llm_client=client, workdir=tmp_path)
    assert out["error"] == "protocol_unlocked"
    assert RESULT_KEY not in storage.objects


def test_phi_blocks_before_any_gateway_call(callbacks, tmp_path):
    manifest = make_manifest()
    manifest["evidence"][0]["values"][0]["quote"] = (
        "Patient Ramesh Kumar, MRN 483920, admitted on 12/03/2024")
    storage = FakeStorage({SNAP_KEY: json.dumps(manifest).encode()})
    client, requests = make_gateway()
    out = run(make_msg(), storage, callbacks, llm_client=client, workdir=tmp_path)
    assert out["error"] == "phi_blocked"
    assert requests == []
    assert RESULT_KEY not in storage.objects


def test_gate_failure_persists_violation_list(callbacks, tmp_path, monkeypatch):
    violations = [{"gate": "untokenised_number", "section": "results", "number": "0.62"}]

    def boom(*a, **k):
        raise gates.GateError(violations)

    monkeypatch.setattr(pipeline, "run_manuscript", boom)
    storage = FakeStorage({SNAP_KEY: json.dumps(make_manifest()).encode()})
    client, _ = make_gateway()
    out = run(make_msg(), storage, callbacks, llm_client=client, workdir=tmp_path)
    assert out["status"] == "failed" and out["error"] == "gate_failed"
    stored = json.loads(storage.objects[RESULT_KEY])
    assert stored["status"] == "failed" and stored["violations"] == violations
    assert "draft" not in stored  # no partial draft saved
    assert callbacks[0]["error"] == "gate_failed"


def test_gateway_unconfigured_without_client(callbacks, monkeypatch):
    monkeypatch.delenv("RESEARCH_GATEWAY_URL", raising=False)
    storage = FakeStorage({SNAP_KEY: json.dumps(make_manifest()).encode()})
    out = run(make_msg(), storage, callbacks)
    assert out["error"] == "gateway_unconfigured"
