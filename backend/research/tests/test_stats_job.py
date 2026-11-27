"""Unit tests for the stats_model job handler (stats.job).

The worker package is not edited: run_job mirrors research_worker.jobs.run_job
and reuses its HMAC callback (monkeypatched here). Covers validation, the IPD
gate, idempotent skip, cancel, ceilings, and that result.json carries
aggregates and a manifest but never patient rows.
"""
from __future__ import annotations

import json

import pytest

import research_worker.jobs as worker_jobs
from stats import job as stats_job

SECRET = "test-secret"


class FakeStorage:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.puts = 0

    def get_bytes(self, key):
        return self.objects.get(key)

    def exists(self, key):
        return key in self.objects

    def put_bytes(self, key, data, content_type="application/json"):
        self.objects[key] = data
        self.puts += 1


def make_msg(**over):
    msg = {
        "v": 1,
        "kind": "stats_model",
        "jobId": "job_1",
        "projectId": "p1",
        "idempotencyKey": "k1",
        "createdAt": 1763900000,
        "input": {
            "r2Key": "projects/p1/data/snapshots/imp1.csv",
            "model": {"family": "linear", "formula": "y ~ x"},
            "compliance": {"ipdApproved": True, "evidenceId": "irb-2026-001"},
        },
        "ceilings": {"maxSeconds": 240, "maxRows": 100000},
    }
    msg.update(over)
    return msg


CSV = b"y,x\n2,1\n4,2\n5,3\n4,4\n"
RESULT_KEY = "projects/p1/jobs/job_1/result.json"
CANCEL_KEY = "projects/p1/jobs/job_1/cancel"


@pytest.fixture
def callbacks(monkeypatch):
    sent = []

    def fake_send(client, base_url, job_id, payload, secret, *, sleep=None, now=None):
        sent.append(payload)
        return True

    monkeypatch.setattr(worker_jobs, "send_callback", fake_send)
    return sent


def run(msg, storage, callbacks, **kw):
    return stats_job.run_job(
        msg, storage=storage, callback_client=None,
        callback_url="https://stewardmd.in", secret=SECRET, **kw,
    )


def test_validate_message_accepts_and_rejects():
    stats_job.validate_message(make_msg())
    for bad in (
        make_msg(kind="pdf_extract"),
        make_msg(v=2),
        make_msg(jobId=""),
        make_msg(createdAt=-1),
        make_msg(ceilings={"maxSeconds": 241, "maxRows": 10}),
        make_msg(ceilings={"maxSeconds": 10, "maxRows": 0}),
        make_msg(input={"r2Key": "projects/p2/data/snapshots/imp1.csv",
                        "model": {"family": "linear", "formula": "y ~ x"},
                        "compliance": {"ipdApproved": True, "evidenceId": "e"}}),
        make_msg(input={"r2Key": "projects/p1/pdf/" + "a" * 64 + ".pdf",
                        "model": {"family": "linear", "formula": "y ~ x"},
                        "compliance": {"ipdApproved": True, "evidenceId": "e"}}),
    ):
        with pytest.raises(ValueError):
            stats_job.validate_message(bad)
    bad_model = make_msg()
    bad_model["input"]["model"] = {"family": "neural-net"}
    with pytest.raises(ValueError):
        stats_job.validate_message(bad_model)


def test_done_writes_result_without_rows(callbacks):
    storage = FakeStorage({make_msg()["input"]["r2Key"]: CSV})
    out = run(make_msg(), storage, callbacks)
    assert out == {"status": "done", "settled": True, "skipped": False, "error": None}
    stored = json.loads(storage.objects[RESULT_KEY])
    assert stored["status"] == "done"
    assert stored["jobId"] == "job_1"
    assert stored["idempotencyKey"] == "k1"
    assert stored["usage"]["pages"] == 0
    assert stored["family"] == "linear"
    assert stored["manifest"]["dataHash"]
    assert stored["manifest"]["model"]["formula"] == "y ~ x"
    # aggregates only: no raw rows anywhere in the result
    assert "columns" not in stored
    assert "rows" not in stored
    assert "x" not in stored and "y" not in stored
    assert callbacks[0]["status"] == "done"
    assert callbacks[0]["resultKey"] == RESULT_KEY
    assert callbacks[0]["usage"]["pages"] == 0


def test_idempotent_skip_resends_callback(callbacks):
    storage = FakeStorage({make_msg()["input"]["r2Key"]: CSV})
    run(make_msg(), storage, callbacks)
    puts = storage.puts
    out = run(make_msg(), storage, callbacks)
    assert out["skipped"] is True and out["status"] == "done"
    assert storage.puts == puts
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


def test_ipd_gate_blocks_and_writes_nothing(callbacks):
    msg = make_msg()
    msg["input"]["compliance"] = {"ipdApproved": False, "evidenceId": "irb-1"}
    storage = FakeStorage({msg["input"]["r2Key"]: CSV})
    out = run(msg, storage, callbacks)
    assert out["status"] == "failed" and out["error"] == "ipd_gate"
    assert RESULT_KEY not in storage.objects


def test_invalid_spec(callbacks):
    msg = make_msg()
    msg["input"]["model"] = {"family": "linear"}  # no formula
    storage = FakeStorage({msg["input"]["r2Key"]: CSV})
    out = run(msg, storage, callbacks)
    assert out["status"] == "failed" and out["error"] == "invalid_spec"


def test_model_error_code_propagates(callbacks):
    msg = make_msg()
    msg["input"]["model"] = {"family": "linear", "formula": "y ~ x + x"}
    storage = FakeStorage({msg["input"]["r2Key"]: CSV})
    out = run(msg, storage, callbacks)
    assert out["status"] == "failed" and out["error"] == "invalid_formula"


def test_ceiling_rows(callbacks):
    msg = make_msg(ceilings={"maxSeconds": 240, "maxRows": 2})
    storage = FakeStorage({msg["input"]["r2Key"]: CSV})
    out = run(msg, storage, callbacks)
    assert out["status"] == "failed" and out["error"] == "ceiling_rows"


def test_dataset_invalid(callbacks):
    msg = make_msg()
    storage = FakeStorage({msg["input"]["r2Key"]: b"\xff\xfe\x00broken"})
    out = run(msg, storage, callbacks)
    assert out["status"] == "failed" and out["error"] == "dataset_invalid"


def test_cox_job_end_to_end(callbacks):
    csv = b"time,event,x\n1,1,0\n2,1,1\n3,1,0\n4,0,1\n5,1,0\n6,1,1\n"
    msg = make_msg()
    msg["input"]["model"] = {"family": "cox", "time": "time", "event": "event", "covariates": ["x"]}
    storage = FakeStorage({msg["input"]["r2Key"]: csv})
    out = run(msg, storage, callbacks)
    assert out["status"] == "done"
    stored = json.loads(storage.objects[RESULT_KEY])
    assert stored["ties"] == "efron"
    assert stored["coefficients"][0]["term"] == "x"
    assert stored["phTest"]["transform"] == "km"


def test_diagnostic_job_end_to_end(callbacks):
    csv = b"study_id,TP,FN,FP,TN\na,47,9,101,738\nb,126,51,272,1543\nc,19,10,12,192\n"
    msg = make_msg()
    msg["input"]["model"] = {
        "family": "diagnostic",
        "columns": {"TP": "TP", "FN": "FN", "FP": "FP", "TN": "TN"},
        "id": "study_id",
    }
    storage = FakeStorage({msg["input"]["r2Key"]: csv})
    out = run(msg, storage, callbacks)
    assert out["status"] == "done"
    stored = json.loads(storage.objects[RESULT_KEY])
    assert stored["model"] == "reitsma"
    assert 0 < stored["pooledSens"] < 1
    assert stored["correctionApplied"] is False  # no zero cells in this fixture


def test_json_snapshot_columns(callbacks):
    payload = json.dumps({"columns": {"y": [2, 4, 5, 4], "x": [1, 2, 3, 4]}}).encode()
    msg = make_msg()
    msg["input"]["r2Key"] = "projects/p1/data/snapshots/imp2.json"
    storage = FakeStorage({msg["input"]["r2Key"]: payload})
    out = run(msg, storage, callbacks)
    assert out["status"] == "done"


def test_unsettled_callback_keeps_result_for_replay(monkeypatch):
    monkeypatch.setattr(worker_jobs, "send_callback", lambda *a, **k: False)
    storage = FakeStorage({make_msg()["input"]["r2Key"]: CSV})
    out = run(make_msg(), storage, [])
    assert out["status"] == "done" and out["settled"] is False
    assert RESULT_KEY in storage.objects  # redelivery skips straight to callback


def test_csv_parse_and_validation_value_errors_classify_as_dataset_invalid(callbacks):
    # Non-numeric string in regression column -> ValueError with space-separated message -> dataset_invalid (not stats_failed)
    bad_csv = b"y,x\n2,1\nNA,2\n5,3\n4,4\n"
    msg = make_msg()
    out = run(msg, FakeStorage({msg["input"]["r2Key"]: bad_csv}), callbacks)
    assert out["status"] == "failed" and out["error"] == "dataset_invalid"

    # Survival validation ValueError (negative time) -> dataset_invalid (not stats_failed)
    neg_time_csv = b"time,event\n-1,1\n2,1\n3,0\n"
    km_msg = make_msg()
    km_msg["input"]["model"] = {"family": "km", "time": "time", "event": "event"}
    out_km = run(km_msg, FakeStorage({km_msg["input"]["r2Key"]: neg_time_csv}), callbacks)
    assert out_km["status"] == "failed" and out_km["error"] == "dataset_invalid"

    # Empty JSON columns -> dataset_invalid (not stats_failed)
    empty_json = json.dumps({"columns": {}}).encode()
    j_msg = make_msg()
    j_msg["input"]["r2Key"] = "projects/p1/data/snapshots/empty.json"
    out_json = run(j_msg, FakeStorage({j_msg["input"]["r2Key"]: empty_json}), callbacks)
    assert out_json["status"] == "failed" and out_json["error"] == "dataset_invalid"