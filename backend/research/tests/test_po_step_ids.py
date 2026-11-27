"""Verify adapter stepIds match the JS runner so container fallbacks hit the gateway cache."""
from __future__ import annotations

import json
import httpx

from paperorchestra.adapter.po_adapter import pipeline
from paperorchestra.adapter.po_adapter.loader import build_token_table
from paperorchestra.adapter.po_adapter.llm import GatewayLLMClient, sanitize_step_id
from test_po_common import (
    DRAFT_V0,
    OUTLINE_JSON,
    fenced_json,
    make_manifest,
    refined_tex,
    review_json,
)


def _responder_multi(sent_bodies):
    review_n = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal review_n
        body = json.loads(request.content.decode("utf-8"))
        sent_bodies.append(body)
        purpose = body.get("purpose")
        sid = body.get("stepId", "")
        if sid == "outline":
            multi_outline = {
                "plotting_plan": [],
                "intro_related_work_plan": OUTLINE_JSON["intro_related_work_plan"],
                "section_plan": [
                    {"section_name": "Abstract", "key_points": ["Summary"]},
                    {"section_name": "Introduction", "key_points": ["Background"]},
                    {"section_name": "Methods", "key_points": ["Design"]},
                ],
            }
            text = json.dumps(multi_outline)
        elif sid.startswith("section:"):
            sec_title = sid.split(":", 1)[1].capitalize()
            text = (
                f"\\section{{{sec_title}}}\n"
                + f"Drafted {sec_title} with " + "{{run:r1.estimate}} and \\cite{smith2020}."
            )
        elif purpose == "review":
            review_n += 1
            text = fenced_json(review_json(8 if review_n > 4 else 5))
        elif purpose == "refinement":
            text = "```latex\n" + refined_tex(1) + "\n```"
        else:
            text = json.dumps({"response": refined_tex(1)})
        return httpx.Response(200, json={
            "text": text,
            "model": "gemini-2.5-flash",
            "usage": {"inputTokens": 40, "outputTokens": 20},
        })

    return handler


def test_sanitize_step_id_and_section_order():
    assert sanitize_step_id("Section:Statistical Methods!") == "section:statistical-methods"
    order = pipeline.build_section_order(None)
    assert [s["stepId"] for s in order] == [
        "section:abstract",
        "section:introduction",
        "section:methods",
        "section:results",
        "section:discussion",
    ]


def test_python_pipeline_emits_js_matching_step_ids(tmp_path):
    sent = []
    http = httpx.Client(transport=httpx.MockTransport(_responder_multi(sent)))
    client = GatewayLLMClient(
        gateway_url="https://gw.test/v1/internal/llm",
        job_token="tok",
        job_id="job_step_test",
        project_id="proj_step_test",
        user_id="uid_step_test",
        tier="T2",
        http_client=http,
        sleep=lambda _s: None,
    )
    manifest = make_manifest()
    table = build_token_table(manifest["runs"])
    cite_map = {manifest["references"][0]["key"]: manifest["references"][0]}
    outline = pipeline.run_outline(manifest, tmp_path, client)
    draft, cite_map, _ = pipeline.run_section_draft(manifest, tmp_path, client, outline, citation_map=cite_map, with_literature=False)
    # Use DRAFT_V0 so all 4 canonical sections + citation/number tokens satisfy refinement gate
    assert "\\section{Abstract}" in draft and "\\section{Methods}" in draft
    pipeline.run_refinement(manifest, tmp_path, client, DRAFT_V0, cite_map, table, max_reflections=1)

    step_ids = [b.get("stepId") for b in sent]
    assert step_ids[0] == "outline"
    assert "section:abstract" in step_ids
    assert "section:introduction" in step_ids
    assert "section:methods" in step_ids
    # Baseline review: refine:0:rev1..rev3 and refine:0:meta
    assert "refine:0:rev1" in step_ids
    assert "refine:0:rev2" in step_ids
    assert "refine:0:rev3" in step_ids
    assert "refine:0:meta" in step_ids
    # Round 1 refinement and round 1 review
    assert "refine:1" in step_ids
    assert "refine:1:rev1" in step_ids
    assert "refine:1:meta" in step_ids


def test_outline_and_section_retry_suffixes(tmp_path):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        calls.append(body.get("stepId"))
        if body.get("stepId") == "outline":
            return httpx.Response(200, json={"text": "not-json", "model": "gemini-2.5-flash", "usage": {"inputTokens": 10, "outputTokens": 5}})
        if body.get("stepId") == "outline:r1":
            return httpx.Response(200, json={"text": json.dumps({
                "plotting_plan": [],
                "intro_related_work_plan": OUTLINE_JSON["intro_related_work_plan"],
                "section_plan": [
                    {"section_name": "Introduction", "key_points": ["Intro"]},
                    {"section_name": "Methods", "key_points": ["Methods"]},
                ],
            }), "model": "gemini-2.5-flash", "usage": {"inputTokens": 10, "outputTokens": 5}})
        if body.get("stepId") == "section:introduction":
            return httpx.Response(200, json={"text": "   ", "model": "gemini-2.5-flash", "usage": {"inputTokens": 5, "outputTokens": 1}})
        return httpx.Response(200, json={"text": "\\section{Body}\nDraft {{run:r1.estimate}} \\cite{smith2020}", "model": "gemini-2.5-flash", "usage": {"inputTokens": 10, "outputTokens": 5}})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GatewayLLMClient(
        gateway_url="https://gw.test/v1/internal/llm",
        job_token="tok",
        http_client=http,
        sleep=lambda _s: None,
    )
    outline = pipeline.run_outline(make_manifest(), tmp_path, client)
    pipeline.run_section_draft(make_manifest(), tmp_path, client, outline, with_literature=False)
    assert calls[:2] == ["outline", "outline:r1"]
    assert "section:introduction" in calls
    assert "section:introduction:r1" in calls


def test_unusable_reply_is_asked_again_under_a_new_step_id():
    """The gateway caches replies by stepId, so a retry after an unusable reply must not reuse the id."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        calls.append(body.get("stepId"))
        text = "bad" if len(calls) == 1 else "good"
        return httpx.Response(200, json={"text": text, "model": "gemini-2.5-flash", "usage": {"inputTokens": 5, "outputTokens": 2}})

    client = GatewayLLMClient(
        gateway_url="https://gw.test/v1/internal/llm",
        job_token="tok",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _s: None,
    )
    resp = client.call_text(
        "prompt", "researchmd-writer",
        result_parsing_func=lambda raw: None if raw == "bad" else raw,
        check_parsed_response_not_none=True,
        purpose="write",
        step_id="refine:0:rev1",
    )
    assert resp["raw_response"] == "good"
    assert calls == ["refine:0:rev1", "refine:0:rev1:r1"]


def test_build_section_order_matches_js_section_title_and_dedup(tmp_path):
    outline = {
        "plotting_plan": [],
        "intro_related_work_plan": OUTLINE_JSON["intro_related_work_plan"],
        "section_plan": [
            {"section_title": "Abstract", "key_points": ["Summary"]},
            {"section_title": "3. Methodology", "key_points": ["Design"]},
            {"section_title": "Methods", "key_points": ["Stats"]},
            {"section_title": "Methods", "key_points": ["Subgroup"]},
            {"section_title": "§§§", "key_points": ["Non-ASCII"]},
        ],
    }
    order = pipeline.build_section_order(outline)
    assert [s["stepId"] for s in order] == [
        "section:abstract",
        "section:3-methodology",
        "section:methods",
        "section:methods-2",
        "section:section-5",
    ]
    assert [s["id"] for s in order] == [
        "abstract",
        "3-methodology",
        "methods",
        "methods-2",
        "section-5",
    ]

    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        sent.append(body.get("stepId"))
        return httpx.Response(200, json={
            "text": "\\section{Sec}\nDraft {{run:r1.estimate}} \\cite{smith2020}",
            "model": "gemini-2.5-flash",
            "usage": {"inputTokens": 10, "outputTokens": 5},
        })

    client = GatewayLLMClient(
        gateway_url="https://gw.test/v1/internal/llm",
        job_token="tok",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _s: None,
    )
    manifest = make_manifest()
    pipeline.run_section_draft(manifest, tmp_path, client, outline, with_literature=False)
    assert sent == [
        "section:abstract",
        "section:3-methodology",
        "section:methods",
        "section:methods-2",
        "section:section-5",
    ]
