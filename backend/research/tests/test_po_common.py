"""Shared helpers for the test_po_* suite (no tests of its own).

Everything is mocked with httpx.MockTransport: no network, no provider keys,
no real gateway. The mock routes on the adapter's "purpose" field, exactly
like the real gateway adapter will route on tier/purpose.
"""
from __future__ import annotations

import json

import httpx

from paperorchestra.adapter.po_adapter.llm import GatewayLLMClient
from paperorchestra.adapter.po_adapter.search import ConnectorSearch

GATEWAY_URL = "https://gateway.test/v1/generate"
API_URL = "https://api.test"
JOB_TOKEN = "test-job-token"
SECRET = "test-secret"


def make_manifest(**overrides) -> dict:
    manifest = {
        "v": 1,
        "projectId": "p1",
        "jobId": "job_1",
        "protocol": {
            "title": "Intervention X for outcome Y: a systematic review",
            "question": "Does X reduce Y in adults?",
            "pico": {"population": "adults", "intervention": "X",
                     "comparator": "usual care", "outcome": "Y"},
            "design": "systematic review and meta-analysis",
            "eligibility": "randomised trials in adults",
            "outcomes": ["Y"],
            "lockHash": "a" * 64,
            "lockedAt": "2026-11-01T00:00:00Z",
        },
        "evidence": [{
            "studyId": "s1", "label": "Trial One",
            "source": {"title": "Trial One report", "doi": "10.1000/trial1",
                       "pmid": "11111111", "authors": ["Smith J"], "year": 2019},
            "values": [{"field": "events_intervention", "value": 12,
                        "verified": True, "locator": {"page": 4, "table": "Table 2"},
                        "quote": "12 events in the intervention arm"}],
        }],
        "runs": [{
            "runId": "r1", "engine": "research-engine.js",
            "engineVersion": "gold001", "measure": "OR", "method": "DL",
            "result": {"estimate": 0.62, "ciLower": 0.41, "ciUpper": 0.93,
                       "p": 0.02, "k": 12, "i2": 35.2},
        }],
        "references": [{
            "key": "ref1", "title": "Trial One report", "authors": ["Smith J", "Doe A"],
            "year": 2019, "venue": "Journal of Examples", "doi": "10.1000/trial1",
            "pmid": "11111111", "volume": "10", "pages": "1-9",
        }],
    }
    manifest.update(overrides)
    return manifest


OUTLINE_JSON = {
    "plotting_plan": [],
    "intro_related_work_plan": {
        "introduction_strategy": {
            "hook_hypothesis": "Y is common.",
            "problem_gap_hypothesis": "X is understudied.",
            "search_directions": ["systematic reviews of X for Y"],
        },
        "related_work_strategy": {"overview": "prior trials", "subsections": []},
    },
    "section_plan": [
        {"section_title": "Methods", "subsections": [
            {"subsection_title": "Search strategy", "content_bullets": ["databases"]}]},
    ],
}

DRAFT_V0 = (
    "\\section{Introduction} Outcome Y is common \\cite{ref1}.\n"
    "\\section{Methods} We searched three databases. Two reviewers screened records.\n"
    "\\section{Results} The intervention reduced mortality "
    "(OR {{run:r1:estimate}}, 95% CI {{run:r1:ciLower}} to {{run:r1:ciUpper}}; "
    "p {{run:r1:p}}).\n"
    "\\section{Discussion} The pooled effect supports X \\cite{ref1}.\n"
)


def refined_tex(version: int) -> str:
    return DRAFT_V0.replace(
        "\\section{Discussion}",
        f"\\section{{Discussion}} REFINED_V{version}.",
    )


def review_json(overall: int) -> dict:
    return {
        "Summary": "A systematic review of X for Y.",
        "Strengths": ["Clear methods."], "Weaknesses": ["None major."],
        "Originality": 3, "Quality": 3, "Clarity": 3, "Significance": 3,
        "Questions": [], "Limitations": [], "Ethical Concerns": False,
        "Soundness": 3, "Presentation": 3, "Contribution": 3,
        "Overall": overall, "Confidence": 4, "Decision": "Accept",
    }


def fenced_json(obj) -> str:
    return "```json\n" + json.dumps(obj) + "\n```"


def make_gateway(handler=None, *, tier="T2", max_calls=64, review_scores=None,
                 write_routes=None):
    """GatewayLLMClient over MockTransport. Returns (client, requests).

    Default routing by purpose:
      write       -> write_routes needles first, then outline JSON (outline
                     prompt) or DRAFT_V0 (section prompt)
      refinement  -> json worklog + refined latex (version increments)
      review      -> reviewer JSON (scores from review_scores, default 5,7,8...)
      format      -> empty formatting review
    write_routes: list of (substring, response_text) matched on system+prompt.
    """
    requests = []
    state = {"refinement": 0, "reviewer_calls": 0}
    scores = list(review_scores or [5, 7, 8, 9, 9, 9])

    def default_handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        body = json.loads(request.content)
        purpose = body.get("purpose", "write")
        if purpose == "refinement":
            state["refinement"] += 1
            text = fenced_json({"round_plan": "address weaknesses"}) + "\n"
            text += "```latex\n" + refined_tex(state["refinement"]) + "\n```"
        elif purpose == "review":
            if "meta-reviewing" in (body.get("system") or ""):
                text = fenced_json(review_json(scores[min(
                    state["reviewer_calls"] // 3, len(scores) - 1)]))
            else:
                idx = min(state["reviewer_calls"] // 3, len(scores) - 1)
                state["reviewer_calls"] += 1
                text = fenced_json(review_json(scores[idx]))
        elif purpose == "format":
            text = fenced_json({"figure_and_tables": {}, "other_issues": []})
        else:
            # OutlineAgent sends its system prompt as the first content part,
            # so route on the assembled prompt text, not only "system".
            blob = (body.get("system") or "") + (body.get("prompt") or "")
            text = None
            for needle, routed in (write_routes or []):
                if needle in blob:
                    text = routed
                    break
            if text is None:
                if "paper outline" in blob:
                    text = fenced_json(OUTLINE_JSON)
                else:
                    text = "```latex\n" + DRAFT_V0 + "\n```"
        return httpx.Response(200, json={
            "text": text, "model": "mock-model",
            "usage": {"inputTokens": 100, "outputTokens": 50}})

    http = httpx.Client(transport=httpx.MockTransport(handler or default_handler))
    client = GatewayLLMClient(
        gateway_url=GATEWAY_URL, job_token=JOB_TOKEN, job_id="job_1",
        project_id="p1", user_id="u1", tier=tier, max_calls=max_calls,
        http_client=http, sleep=lambda s: None, now=lambda: 1763900000)
    return client, requests


def make_search(records=None, *, secret=SECRET, now=lambda: 1763900000):
    """ConnectorSearch over MockTransport. Returns (search, requests)."""
    requests = []
    payload_records = list(records or [])

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"records": payload_records})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    search = ConnectorSearch(
        api_url=API_URL, secret=secret, project_id="p1", job_id="job_1",
        http_client=http, sleep=lambda s: None, now=now)
    return search, requests


def pubmed_record(**overrides) -> dict:
    rec = {
        "source": "pubmed", "externalId": "12345678",
        "title": "Effect of intervention X on outcome Y",
        "authors": ["Smith J", "Doe A"], "year": 2019,
        "doi": "10.1000/example", "abstract": "Background: Y is common.",
        "publicationDate": "2019-06-01", "venue": "Journal of Examples",
        "extra": {},
    }
    rec.update(overrides)
    return rec
