"""Phase 5A.4 autorater tests: deterministic gates first, mocked LLM rater on
the rubric, and the cost-per-review report. No network, no provider keys."""
from __future__ import annotations

import json

import httpx
import pytest

from manuscript import autorater
from paperorchestra.adapter.po_adapter import writer
from paperorchestra.adapter.po_adapter.llm import GatewayLLMClient
from test_po_common import (GATEWAY_URL, JOB_TOKEN, DRAFT_V0, fenced_json,
                            make_manifest)


def clean_manuscript():
    return {"title": "Test review", "sections": writer.parse_latex_sections(DRAFT_V0)}


def token_table():
    return autorater.build_token_table(make_manifest()["runs"])


def citation_map():
    return {"ref1": {"title": "Trial One report", "doi": "10.1000/trial1", "pmid": "11111111"}}


def rubric_json(score=4):
    return {"scores": {d: {"score": score, "comment": "ok"} for d in autorater.DIMENSIONS},
            "summary": "A sound review."}


def make_rater_gateway(payload=None, *, raw=None):
    requests = []

    def handler(request):
        requests.append(request)
        body = json.loads(request.content)
        assert body["purpose"] == "review"
        text = raw if raw is not None else fenced_json(payload or rubric_json())
        return httpx.Response(200, json={"text": text, "model": "mock-model",
                                         "usage": {"inputTokens": 100, "outputTokens": 50}})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GatewayLLMClient(gateway_url=GATEWAY_URL, job_token=JOB_TOKEN,
                              job_id="job_1", project_id="p1", user_id="u1", tier="T3",
                              http_client=http, sleep=lambda s: None, now=lambda: 1763900000)
    return client, requests


def test_deterministic_report_passes_clean_draft():
    report = autorater.deterministic_report(clean_manuscript(), token_table(),
                                            citation_map(), make_manifest())
    assert report["passed"] is True and report["violations"] == []


def test_deterministic_report_flags_free_number():
    ms = clean_manuscript()
    ms["sections"][2]["text"] = "The intervention reduced mortality (OR 0.62)."
    report = autorater.deterministic_report(ms, token_table(), citation_map(), make_manifest())
    assert report["passed"] is False
    assert any(v["gate"] == "untokenised_number" for v in report["violations"])


def test_llm_rater_scores_on_rubric():
    client, requests = make_rater_gateway(rubric_json(4))
    rater = autorater.LLMRater(client)
    result = rater.rate(clean_manuscript())
    assert set(result["scores"]) == set(autorater.DIMENSIONS)
    assert result["overall"] == 4.0
    assert len(requests) == 1
    assert json.loads(requests[0].content)["tier"] == "T3"


def test_llm_rater_rejects_unparseable_and_missing_dimension():
    client, _ = make_rater_gateway(raw="not json at all")
    with pytest.raises(ValueError):
        autorater.LLMRater(client).rate(clean_manuscript())
    partial = {"scores": {"integrity": {"score": 4, "comment": "x"}}}
    client2, _ = make_rater_gateway(partial)
    with pytest.raises(ValueError):
        autorater.LLMRater(client2).rate(clean_manuscript())


def test_score_draft_blocks_before_rating_on_gate_violation():
    ms = clean_manuscript()
    ms["sections"][2]["text"] = "The intervention reduced mortality (OR 0.62)."
    client, requests = make_rater_gateway()
    result = autorater.score_draft(ms, make_manifest()["runs"], make_manifest()["references"],
                                   client=client, manifest=make_manifest())
    assert result["blocked"] is True
    assert result["rubric"] is None and result["overall"] is None
    assert result["deterministic"]["violations"]
    assert requests == []  # hard gates run BEFORE any reviewer call


def test_score_draft_rates_a_passing_draft():
    client, requests = make_rater_gateway(rubric_json(5))
    result = autorater.score_draft(clean_manuscript(), make_manifest()["runs"],
                                   make_manifest()["references"], client=client,
                                   manifest=make_manifest())
    assert result["blocked"] is False
    assert result["overall"] == 5.0
    assert len(requests) == 1


def test_cost_per_review_from_ai_usage_rows():
    records = [
        {"step": "write", "tier": "T2", "model": "m", "tokens_in": 1000, "tokens_out": 500,
         "cost_micro_usd": 20000, "job_id": "job_1", "project_id": "p1", "ts": 1},
        {"step": "review", "tier": "T3", "model": "m", "tokens_in": 2000, "tokens_out": 800,
         "cost_micro_usd": 60000, "job_id": "job_1", "project_id": "p1", "ts": 2},
        {"step": "write", "tier": "T2", "model": "m", "tokens_in": 1000, "tokens_out": 500,
         "cost_micro_usd": 20000, "job_id": "job_2", "project_id": "p1", "ts": 3},
    ]
    report = autorater.cost_per_review(records)
    assert report["calls"] == 3
    assert report["tokens_in"] == 4000 and report["tokens_out"] == 1800
    assert report["cost_micro_usd"] == 100000
    assert report["cost_usd"] == 0.1
    assert report["cost_complete"] is True
    assert report["by_step"]["write"]["calls"] == 2
    assert report["by_step"]["review"]["cost_micro_usd"] == 60000
    assert report["by_tier"]["T2"]["calls"] == 2
    assert report["by_job"]["job_1"]["calls"] == 2


def test_cost_per_review_adapter_usage_without_cost_is_incomplete():
    client, _ = make_rater_gateway()
    autorater.LLMRater(client).rate(clean_manuscript())
    report = autorater.cost_per_review(client.usage)  # camelCase, no cost_micro_usd
    assert report["calls"] == 1
    assert report["tokens_in"] == 100 and report["tokens_out"] == 50
    assert report["cost_complete"] is False
    assert report["cost_micro_usd"] == 0
    assert report["by_step"]["review"]["calls"] == 1
