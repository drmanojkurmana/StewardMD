"""Bounded gate repair (2026-11-27 live failure: one stray sentence in the
abstract threw away the whole draft). The gates stay strict: repair gets at
most two gateway calls, then the last violations raise GateError as before."""
from __future__ import annotations

import json

import httpx
import pytest

from paperorchestra.adapter.po_adapter import gates, pipeline, repair
from paperorchestra.adapter.po_adapter.llm import CeilingError
from paperorchestra.adapter.po_adapter.loader import build_token_table
from test_po_common import (fenced_json, make_gateway, make_manifest,
                            review_json)


ABSTRACT_HEADING = "\\section*{Abstract}"
RESULTS_BLOCK = (
    "\\section{Results}\n"
    "The pooled OR was {{run:r1.estimate}} "
    "(95\\% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}).\n"
)
BAD_ABSTRACT_BODY = (
    "\\noindent\\textbf{Background.} This review estimated the effect. "
    "A risk ratio below 1.0 favours the intervention.\n"
)
REPAIRED_ABSTRACT_BODY = BAD_ABSTRACT_BODY.replace("1.0", "the null")
BAD_DRAFT = ABSTRACT_HEADING + "\n" + BAD_ABSTRACT_BODY + RESULTS_BLOCK


@pytest.fixture()
def manifest():
    return make_manifest()


@pytest.fixture()
def token_table(manifest):
    return build_token_table(manifest["runs"])


@pytest.fixture()
def citation_map(manifest):
    return {"ref1": manifest["references"][0]}


def latex_response(body):
    return "```latex\n" + body + "\n```"


def abstract_reply(body):
    return latex_response(ABSTRACT_HEADING + "\n" + body)


def scripted(reply, requests):
    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={
            "text": reply, "model": "mock",
            "usage": {"inputTokens": 100, "outputTokens": 50}})
    return handler


def repair_client(reply):
    requests = []
    client, _ = make_gateway(scripted(reply, requests))
    return client, requests


def test_repair_replaces_only_the_affected_section(manifest, token_table,
                                                   citation_map):
    client, requests = repair_client(abstract_reply(REPAIRED_ABSTRACT_BODY))
    violations = gates.check_paper(BAD_DRAFT, token_table, citation_map, manifest)
    assert [v["gate"] for v in violations] == ["untokenised_number"]

    repaired = repair.repair_violations(
        client, BAD_DRAFT, violations, token_table, citation_map)

    assert "below the null" in repaired
    assert "1.0 favours" not in repaired
    # Unaffected sections stay byte-identical.
    assert RESULTS_BLOCK in repaired

    assert len(requests) == 1
    body = requests[0]
    assert body["purpose"] == "repair"
    prompt = body["prompt"]
    assert "{{run:r1.estimate}}" in prompt  # allowed token list
    assert "\\cite{ref1}" in prompt        # allowed citation list
    assert "\\section*{Abstract}" in prompt
    assert "Results" not in prompt          # only the affected section


def test_successful_repair_produces_manuscript_and_records_hit(
        manifest, token_table, citation_map):
    client, requests = repair_client(abstract_reply(REPAIRED_ABSTRACT_BODY))
    context = {"gate_hits": [], "repairs": []}

    manuscript = pipeline.assemble_manuscript(
        manifest, BAD_DRAFT, token_table, citation_map,
        client=client, gate_context=context)

    abstract = next(s for s in manuscript["sections"] if s["id"] == "abstract")
    assert "below the null" in abstract["text"]
    assert "1.0" not in abstract["text"]
    assert len(requests) == 1

    assert any(v["gate"] == "untokenised_number" and v["number"] == "1.0"
               for v in context["gate_hits"])
    assert len(context["repairs"]) == 1
    assert context["repairs"][0]["violations"][0]["number"] == "1.0"
    assert manuscript["provenance"]["gateHits"] == context["gate_hits"]
    assert manuscript["provenance"]["repairs"] == context["repairs"]


def test_still_violating_after_two_rounds_raises_last_violations(
        manifest, token_table, citation_map):
    still_bad = BAD_ABSTRACT_BODY.replace("1.0", "2.0")
    client, requests = repair_client(abstract_reply(still_bad))
    context = {"gate_hits": [], "repairs": []}

    with pytest.raises(gates.GateError) as exc:
        pipeline.assemble_manuscript(
            manifest, BAD_DRAFT, token_table, citation_map,
            client=client, gate_context=context)

    assert len(requests) == 2
    assert [r["repaired"] for r in context["repairs"]] == [1, 2]
    assert any(v["gate"] == "untokenised_number" and v["number"] == "2.0"
               for v in exc.value.violations)


def test_invented_token_still_fails_the_gates(manifest, token_table,
                                              citation_map):
    invented = BAD_ABSTRACT_BODY.replace("1.0", "{{run:r9.estimate}}")
    client, requests = repair_client(abstract_reply(invented))

    with pytest.raises(gates.GateError) as exc:
        pipeline.assemble_manuscript(
            manifest, BAD_DRAFT, token_table, citation_map, client=client)

    assert len(requests) == 2
    assert any(v["gate"] == "unknown_token" and "r9.estimate" in v["token"]
               for v in exc.value.violations)


def test_changed_heading_keeps_original_and_fails(manifest, token_table,
                                                  citation_map):
    client, requests = repair_client(
        latex_response("\\section*{Summary}\n" + REPAIRED_ABSTRACT_BODY))

    with pytest.raises(gates.GateError) as exc:
        pipeline.assemble_manuscript(
            manifest, BAD_DRAFT, token_table, citation_map, client=client)

    assert len(requests) == 2
    assert any(v["gate"] == "untokenised_number" and v["number"] == "1.0"
               for v in exc.value.violations)


def test_repair_calls_count_toward_max_calls(manifest, token_table,
                                             citation_map):
    requests = []
    client, _ = make_gateway(scripted(abstract_reply(REPAIRED_ABSTRACT_BODY),
                                      requests), max_calls=0)

    with pytest.raises(CeilingError) as exc:
        pipeline.assemble_manuscript(
            manifest, BAD_DRAFT, token_table, citation_map, client=client)

    assert exc.value.code == "ceiling_calls"
    assert requests == []  # the ceiling fired before any network call


def test_refinement_keeps_the_repaired_candidate(tmp_path, manifest,
                                                 token_table, citation_map):
    requests = []
    state = {"reviewer_calls": 0}
    scores = [5, 7, 8]

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        purpose = body.get("purpose", "write")
        if purpose == "repair":
            text = abstract_reply(REPAIRED_ABSTRACT_BODY)
        elif purpose == "refinement":
            text = (fenced_json({"round_plan": "address weaknesses"}) + "\n"
                    + latex_response(BAD_DRAFT))
        elif purpose == "review":
            idx = min(state["reviewer_calls"] // 3, len(scores) - 1)
            if "meta-reviewing" not in (body.get("system") or ""):
                state["reviewer_calls"] += 1
            text = fenced_json(review_json(scores[idx]))
        elif purpose == "format":
            text = fenced_json({"figure_and_tables": {}, "other_issues": []})
        else:
            text = latex_response(BAD_DRAFT)
        return httpx.Response(200, json={
            "text": text, "model": "mock",
            "usage": {"inputTokens": 100, "outputTokens": 50}})

    client, _ = make_gateway(handler)

    final_tex, context = pipeline.run_refinement(
        manifest, tmp_path, client, BAD_DRAFT, citation_map, token_table,
        max_reflections=2)

    # Every refinement round reintroduced the stray number; the parser seam
    # repaired it before the agent stored the candidate, so refinement keeps
    # the repaired text (not the rejected original).
    assert "below the null" in final_tex
    assert "below 1.0" not in final_tex
    assert context["repairs"], context
    assert any(v["gate"] == "untokenised_number" for v in context["gate_hits"])
