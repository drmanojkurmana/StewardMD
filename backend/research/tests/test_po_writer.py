"""Writer seam tests: LaTeX draft -> IMRAD JSON manuscript, Vancouver refs."""
from __future__ import annotations

from paperorchestra.adapter.po_adapter import writer
from paperorchestra.adapter.po_adapter.loader import build_token_table
from test_po_common import DRAFT_V0, make_manifest


def test_parse_latex_sections():
    sections = writer.parse_latex_sections(DRAFT_V0)
    ids = [s["id"] for s in sections]
    assert ids == ["introduction", "methods", "results", "discussion"]
    results = sections[2]
    assert "{{run:r1:estimate}}" in results["text"]
    assert "\\section" not in results["text"]


def test_parse_subsections_and_starred():
    tex = "\\section*{Abstract} Structured text.\n\\section{Methods}\n\\subsection{Search} Details."
    sections = writer.parse_latex_sections(tex)
    assert [s["id"] for s in sections] == ["abstract", "methods", "search"]
    assert sections[2]["level"] == 2


def test_vancouver_format():
    entry = {"authors": ["Smith J", "Doe A"], "title": "Trial One report",
             "venue": "Journal of Examples", "year": 2019, "volume": "10",
             "pages": "1-9", "doi": "10.1000/trial1", "pmid": "11111111"}
    citation = writer.vancouver(entry, 1)
    assert citation.startswith("1. Smith J, Doe A. Trial One report.")
    assert "Journal of Examples. 2019;10:1-9." in citation
    assert "doi:10.1000/trial1" in citation
    assert "PMID:11111111" in citation


def test_vancouver_six_authors_then_et_al():
    entry = {"authors": [f"Author {i}" for i in range(8)], "title": "T", "year": 2020}
    citation = writer.vancouver(entry, 2)
    assert "et al" in citation
    assert "Author 7" not in citation


def test_build_manuscript_imrad_order_and_citation_numbering():
    manifest = make_manifest()
    table = build_token_table(manifest["runs"])
    sections = writer.parse_latex_sections(DRAFT_V0)
    model = writer.build_manuscript(
        title="Test review", sections=sections, token_table=table,
        references=manifest["references"], manifest=manifest)
    assert model["v"] == 1
    assert [s["id"] for s in model["sections"]] == [
        "introduction", "methods", "results", "discussion"]
    assert len(model["references"]) == 1
    ref = model["references"][0]
    assert ref["number"] == 1 and ref["key"] == "ref1"
    assert ref["resolved"] and ref["doi"] == "10.1000/trial1"
    assert ref["citation"].startswith("1. Smith J, Doe A.")
    assert model["provenance"]["protocolHash"] == "a" * 64
    assert model["provenance"]["runIds"] == ["r1"]
    # Canonical text keeps tokens.
    assert "{{run:r1:estimate}}" in model["sections"][2]["text"]


def test_render_tokens_deterministic():
    manifest = make_manifest()
    table = build_token_table(manifest["runs"])
    text = "OR {{run:r1:estimate}} ({{run:r1:ciLower}} to {{run:r1:ciUpper}})"
    assert writer.render_tokens(text, table) == "OR 0.62 (0.41 to 0.93)"
    # Unknown tokens are left for the gates to flag.
    assert writer.render_tokens("{{run:r9:x}}", table) == "{{run:r9:x}}"


def test_unresolved_reference_marked():
    sections = [{"id": "introduction", "heading": "Introduction",
                 "text": "Background \\cite{ghost}."}]
    model = writer.build_manuscript(title="T", sections=sections, token_table={})
    assert model["references"][0]["resolved"] is False
