"""End-to-end seam proof (the D-5 spike): upstream OutlineAgent runs
UNCHANGED on ResearchMD inputs with a mocked gateway. No network, no
provider keys. Also proves the PHI gate blocks at the gateway boundary and
that nothing in upstream/ is modified."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from paperorchestra.adapter import po_adapter
from paperorchestra.adapter.po_adapter import pipeline, seams
from paperorchestra.adapter.po_adapter.phi import PhiBlockedError
from test_po_common import (GATEWAY_URL, OUTLINE_JSON, make_gateway,
                            make_manifest, make_search, pubmed_record)


def upstream_hashes() -> dict:
    root = po_adapter.UPSTREAM_DIR
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*.py"))}


def test_outline_step_end_to_end_with_mocked_llm(tmp_path):
    before = upstream_hashes()
    client, requests = make_gateway()
    manifest = make_manifest()

    outline = pipeline.run_outline(manifest, tmp_path, client, cutoff_date="2024-11")

    # Upstream parsed and wrote its own outline.json.
    assert outline == OUTLINE_JSON
    written = json.loads((tmp_path / "outline.json").read_text())
    assert written == OUTLINE_JSON
    assert set(outline) == {"plotting_plan", "intro_related_work_plan", "section_plan"}

    # Exactly one gateway call, authenticated with the per-job token.
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == GATEWAY_URL
    assert request.headers["Authorization"] == "Bearer test-job-token"
    body = json.loads(request.content)
    assert body["jobId"] == "job_1" and body["projectId"] == "p1"
    assert body["tier"] == "T2"
    # The assembled prompt carried the ResearchMD inputs, not CVPR materials.
    assert "Protocol lock hash" in body["prompt"]
    assert "{{run:r1.estimate}}" in body["prompt"]
    assert "IMRAD" in body["prompt"]

    # Token usage recorded; no provider client was ever created.
    assert client.total_usage()["calls"] == 1
    assert upstream_hashes() == before


def test_phi_blocks_before_any_gateway_call(tmp_path):
    client, requests = make_gateway()
    manifest = make_manifest()
    manifest["evidence"][0]["values"][0]["quote"] = (
        "Patient Ramesh Kumar, MRN 483920, admitted on 12/03/2024")
    with pytest.raises(PhiBlockedError) as exc:
        pipeline.run_outline(manifest, tmp_path, client)
    assert "mrn" in exc.value.categories
    assert requests == []  # nothing left the worker


def test_provider_clients_are_disabled_under_seams():
    client, _ = make_gateway()
    uninstall = seams.install(client)
    try:
        import utils.gemini_utils as gem
        import utils.openai_utils as oai
        with pytest.raises(RuntimeError):
            gem.get_genai_client()
        with pytest.raises(RuntimeError):
            oai.get_openai_client()
    finally:
        uninstall()
    # Uninstall restores the originals (the function objects, not clients).
    import utils.gemini_utils as gem
    assert callable(gem.get_genai_client)
    assert gem.get_genai_client.__name__ == "get_genai_client"


def test_full_manuscript_chain_with_mocked_llm(tmp_path):
    client, requests = make_gateway(review_scores=[5, 7, 8])
    manifest = make_manifest()
    manuscript = pipeline.run_manuscript(manifest, tmp_path, client,
                                         cutoff_date="2024-11")
    assert manuscript["v"] == 1
    assert [s["id"] for s in manuscript["sections"]] == [
        "introduction", "methods", "results", "discussion"]
    assert manuscript["references"][0]["resolved"] is True
    assert manuscript["provenance"]["runIds"] == ["r1"]
    assert manuscript["provenance"]["gateHits"] == []
    assert manuscript["provenance"]["usage"]["calls"] == len(client.usage)
    assert len(requests) == len(client.usage)
    assert all(str(r.url) == GATEWAY_URL for r in requests)
    results = next(s for s in manuscript["sections"] if s["id"] == "results")
    assert "{{run:r1.estimate}}" in results["text"]


def test_literature_suggester_uses_our_connectors(tmp_path, monkeypatch):
    import time
    monkeypatch.setattr(time, "sleep", lambda s: None)  # upstream 1s polite wait

    discovery = json.dumps({
        "section_name": "Introduction",
        "candidates": [{"title": "Effect of intervention X on outcome Y",
                        "year": 2019, "reason": "matches the question"}],
    })
    client, requests = make_gateway(write_routes=[
        ("highly relevant", "```json\n" + discovery + "\n```"),
        ("SPECIFIC academic paper", "```json\n" + discovery + "\n```"),
        ("Introduction and Related Work",
         "```latex\n\\section{Introduction} Background from the literature.\n```"),
    ])
    search, search_requests = make_search([pubmed_record()])
    manifest = make_manifest()

    manuscript = pipeline.run_manuscript(
        manifest, tmp_path, client, search=search, cutoff_date="2024-11",
        with_literature=True)

    # The connector API was called (signed), not Semantic Scholar.
    assert len(search_requests) >= 1
    assert all("semanticscholar" not in str(r.url) for r in requests)
    assert all(str(r.url) == GATEWAY_URL for r in requests)
    # The enriched citation map carries DOI/PMID from our connectors.
    lit_map = json.loads((tmp_path / "citation_map.json").read_text())
    enriched = [v for v in lit_map.values() if v.get("pmid") == "12345678"]
    assert enriched, lit_map
    assert enriched[0]["doi"] == "10.1000/example"
    assert manuscript["provenance"]["gateHits"] == []


def test_gate_violation_blocks_autorater_score(tmp_path):
    from paperorchestra.adapter.po_adapter.loader import build_token_table
    from test_po_common import DRAFT_V0

    client, requests = make_gateway(review_scores=[5, 7, 8])
    manifest = make_manifest()
    table = build_token_table(manifest["runs"])
    bad_draft = DRAFT_V0.replace("{{run:r1.estimate}}", "0.62")
    final_tex, ctx = pipeline.run_refinement(
        manifest, tmp_path, client, bad_draft,
        {"ref1": manifest["references"][0]}, table)
    # The untokenised draft was blocked BEFORE any reviewer call; the loop
    # then refined to a clean draft which scored and was accepted.
    assert any(v["gate"] == "untokenised_number" for v in ctx["gate_hits"])
    assert "{{run:r1.estimate}}" in final_tex
    assert "OR 0.62" not in final_tex
