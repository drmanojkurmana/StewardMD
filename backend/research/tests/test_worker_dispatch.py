"""Worker registration: drain_once routes each kind to its own handler.

Proves stats_model -> stats.job, manuscript_draft -> manuscript.job,
pdf_extract -> research_worker.jobs, and an unknown kind retries to the DLQ.
Handlers are spied so the test isolates dispatch from the work itself.
"""
from __future__ import annotations

import pytest

import research_worker.jobs as worker_jobs
from research_worker.queue import Message
from conftest import FakeQueue, FakeStorage, callback_client, make_msg, text_pdf
from stats import job as stats_job
from manuscript import job as manuscript_job

SECRET = "test-secret"
URL = "https://stewardmd.in"


def stats_msg():
    return {
        "v": 1, "kind": "stats_model", "jobId": "job_s", "projectId": "p1",
        "idempotencyKey": "ks", "createdAt": 1763900000,
        "input": {"r2Key": "projects/p1/data/snapshots/imp1.csv",
                  "model": {"family": "linear", "formula": "y ~ x"},
                  "compliance": {"ipdApproved": True, "evidenceId": "irb-1"}},
        "ceilings": {"maxSeconds": 240, "maxRows": 100000},
    }


def draft_msg():
    return {
        "v": 1, "kind": "manuscript_draft", "jobId": "job_m", "projectId": "p1",
        "idempotencyKey": "km", "createdAt": 1763900000,
        "input": {"r2Key": "projects/p1/manuscript/snapshots/snap1.json"},
        "ceilings": {"maxSeconds": 600, "maxCalls": 64},
    }


def test_handler_for_resolves_each_kind():
    assert worker_jobs.handler_for("pdf_extract") == (worker_jobs.validate_message, worker_jobs.run_job)
    assert worker_jobs.handler_for("stats_model") == (stats_job.validate_message, stats_job.run_job)
    assert worker_jobs.handler_for("manuscript_draft") == (manuscript_job.validate_message, manuscript_job.run_job)
    assert worker_jobs.handler_for("nope") is None


def test_drain_dispatches_each_kind_to_its_handler(monkeypatch):
    seen = {}

    def spy(name):
        def runner(msg, **kw):
            seen[name] = msg
            return {"status": "done", "settled": True, "skipped": False, "error": None}
        return runner

    monkeypatch.setattr(worker_jobs, "run_job", spy("pdf_extract"))
    monkeypatch.setattr(stats_job, "run_job", spy("stats_model"))
    monkeypatch.setattr(manuscript_job, "run_job", spy("manuscript_draft"))

    pdf = make_msg(text_pdf(), job="job_p")
    messages = [
        Message(id="mp", lease_id="lp", attempts=1, body=pdf, raw_body=""),
        Message(id="ms", lease_id="ls", attempts=1, body=stats_msg(), raw_body=""),
        Message(id="mm", lease_id="lm", attempts=1, body=draft_msg(), raw_body=""),
        Message(id="mx", lease_id="lx", attempts=1, body={**pdf, "kind": "unknown_kind"}, raw_body=""),
    ]
    queue = FakeQueue(messages)
    client, _ = callback_client()
    counts = worker_jobs.drain_once(queue, FakeStorage(), callback_client=client,
                                    callback_url=URL, secret=SECRET, sleep=lambda *_: None)
    assert seen["pdf_extract"]["jobId"] == "job_p"
    assert seen["stats_model"]["jobId"] == "job_s"
    assert seen["manuscript_draft"]["jobId"] == "job_m"
    assert counts["done"] == 3 and counts["retried"] == 1
    assert queue.acked == ["lp", "ls", "lm"]
    assert queue.retried == [("lx", 60)]  # unknown kind never worked


def test_drain_retries_invalid_stats_message(monkeypatch):
    called = []
    monkeypatch.setattr(stats_job, "run_job", lambda msg, **kw: called.append(msg))
    bad = stats_msg()
    bad["ceilings"]["maxRows"] = 0  # fails stats validator
    queue = FakeQueue([Message(id="m1", lease_id="l1", attempts=1, body=bad, raw_body="")])
    client, _ = callback_client()
    counts = worker_jobs.drain_once(queue, FakeStorage(), callback_client=client,
                                    callback_url=URL, secret=SECRET, sleep=lambda *_: None)
    assert counts["retried"] == 1 and called == []
    assert queue.acked == []
