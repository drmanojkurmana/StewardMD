"""HTTP surface: /health kept, /drain token-protected."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import research_worker.app as worker_app
from conftest import FakeQueue, FakeStorage, callback_client, make_msg, text_pdf
from research_worker.queue import Message


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RESEARCH_ENV", "test")
    return TestClient(worker_app.app)


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "stewardmd-research"


def test_drain_without_server_token_is_503(client, monkeypatch):
    monkeypatch.delenv("DRAIN_TOKEN", raising=False)
    assert client.post("/drain").status_code == 503


def test_drain_wrong_token_is_401(client, monkeypatch):
    monkeypatch.setenv("DRAIN_TOKEN", "right")
    monkeypatch.setenv("RESEARCH_CALLBACK_SECRET", "s")
    assert client.post("/drain", headers={"X-Drain-Token": "wrong"}).status_code == 401
    assert client.post("/drain").status_code == 401


def test_drain_missing_callback_secret_is_503(client, monkeypatch):
    monkeypatch.setenv("DRAIN_TOKEN", "right")
    monkeypatch.delenv("RESEARCH_CALLBACK_SECRET", raising=False)
    assert client.post("/drain", headers={"X-Drain-Token": "right"}).status_code == 503


def test_drain_runs_and_returns_counts(client, monkeypatch):
    monkeypatch.setenv("DRAIN_TOKEN", "right")
    monkeypatch.setenv("RESEARCH_CALLBACK_SECRET", "s")
    data = text_pdf()
    msg = make_msg(data)
    storage = FakeStorage({msg["input"]["r2Key"]: data})
    queue = FakeQueue([Message(id="m1", lease_id="l1", attempts=1, body=msg, raw_body="")])
    cb, _ = callback_client()

    def fake_clients():
        return queue, storage, cb

    monkeypatch.setattr(worker_app, "_clients_from_env", fake_clients)
    resp = client.post("/drain", headers={"X-Drain-Token": "right"})
    assert resp.status_code == 200
    assert resp.json() == {"pulled": 1, "done": 1, "failed": 0, "cancelled": 0, "retried": 0}
    assert queue.acked == ["l1"]


def test_drain_missing_config_is_503(client, monkeypatch):
    monkeypatch.setenv("DRAIN_TOKEN", "right")
    monkeypatch.setenv("RESEARCH_CALLBACK_SECRET", "s")

    def fake_clients():
        raise KeyError("CF_ACCOUNT_ID")

    monkeypatch.setattr(worker_app, "_clients_from_env", fake_clients)
    assert client.post("/drain", headers={"X-Drain-Token": "right"}).status_code == 503