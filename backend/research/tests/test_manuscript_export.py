"""Tests for DOCX export, citation ordering, Vancouver format, and refusal gates (Package 5A.3).

Verifies:
- export(manuscript_json, runs, references, out_path)
- unresolved token refusal (strict gate; nothing is written)
- unresolved citation refusal (missing key or no DOI/PMID; nothing is written)
- citation order and Vancouver format
- DOCX opens with python-docx and contains rendered numbers
- SVG and PNG figure embedding and tables
"""
from __future__ import annotations

from pathlib import Path
import pytest

import docx
from manuscript.docx_export import UnresolvedCitationError, export, format_vancouver
from manuscript.render_tokens import UnresolvedTokenError


@pytest.fixture()
def valid_runs():
    return [
        {
            "runId": "r1",
            "measure": "OR",
            "method": "DL",
            "result": {
                "estimate": 0.62,
                "ciLower": 0.41,
                "ciUpper": 0.93,
                "p": 0.02,
                "k": 12,
                "i2": 35.2,
            },
        },
        {
            "runId": "r2",
            "measure": "MD",
            "method": "REML",
            "result": {
                "estimate": -1.50,
                "ciLower": -2.80,
                "ciUpper": -0.20,
                "p": 0.0003,
                "k": 6,
                "i2": 15.0,
            },
        },
    ]


@pytest.fixture()
def valid_references():
    return [
        {
            "key": "ref_second",
            "title": "Earlier Study on Outcome",
            "authors": ["Brown K", "Davis M"],
            "venue": "Lancet",
            "year": 2018,
            "volume": "391",
            "pages": "100-105",
            "doi": "10.1016/s0140-6736(18)0001",
            "pmid": "29100001",
        },
        {
            "key": "ref_first",
            "title": "Primary Multicenter Trial",
            "authors": ["Smith J", "Doe A", "Adams B", "Clark C", "Evans E", "Fox F", "Green G"],
            "venue": "New England Journal of Medicine",
            "year": 2020,
            "volume": "382",
            "pages": "500-510",
            "doi": "10.1056/nejmoa200001",
            "pmid": "32000001",
        },
    ]


@pytest.fixture()
def valid_manuscript():
    return {
        "title": "Intervention X for Clinical Outcomes: A Systematic Review and Meta-Analysis",
        "authors": ["Dr. Jane Doe, MD", "Dr. John Smith, PhD"],
        "institution": "Department of Medicine, ResearchMD Institute",
        "sections": [
            {
                "id": "abstract",
                "heading": "Abstract",
                "level": 1,
                "text": "Background: Condition Y is common.\n\nMethods: We searched MEDLINE and Embase.\n\nResults: Pooled analysis showed significant reduction (OR {{run:r1.estimate}}, {{run:r1.ci}}; p {{run:r1.p}}).\n\nConclusions: Intervention X is effective.",
            },
            {
                "id": "introduction",
                "heading": "Introduction",
                "level": 1,
                "text": "Condition Y has high global burden \\cite{ref_first}. Previous observational studies were inconsistent \\cite{ref_second}.",
            },
            {
                "id": "methods",
                "heading": "Methods",
                "level": 1,
                "text": "We conducted a systematic review following PRISMA 2020 guidelines. Two independent reviewers extracted data.",
            },
            {
                "id": "results",
                "heading": "Results",
                "level": 1,
                "text": "A total of {{run:r1.k}} trials were included. The pooled effect demonstrated an odds ratio of {{run:r1.estimate}} {{run:r1.ci}} (p {{run:r1.p}}). Heterogeneity was I2 = {{run:r1.i2}}.\n\nSecondary outcome difference was {{run:r2.estimate}} {{run:r2.ci}} with p {{run:r2.p}} across {{run:r2.k}} trials.",
            },
            {
                "id": "discussion",
                "heading": "Discussion",
                "level": 1,
                "text": "Our findings align with earlier investigations \\cite{ref_first, ref_second}. Strengths include rigorous methodology.",
            },
        ],
    }


def test_vancouver_reference_format(valid_references):
    ref_first = valid_references[1]
    # More than 6 authors -> et al
    v_first = format_vancouver(ref_first, 1)
    assert v_first.startswith("1. Smith J, Doe A, Adams B, Clark C, Evans E, Fox F, et al. Primary Multicenter Trial.")
    assert "New England Journal of Medicine. 2020;382:500-510." in v_first
    assert "doi:10.1056/nejmoa200001." in v_first
    assert "PMID:32000001." in v_first

    ref_second = valid_references[0]
    v_second = format_vancouver(ref_second, 2)
    assert v_second.startswith("2. Brown K, Davis M. Earlier Study on Outcome.")
    assert "Lancet. 2018;391:100-105." in v_second


def test_unresolved_token_refusal_writes_nothing(tmp_path, valid_manuscript, valid_runs, valid_references):
    out_file = tmp_path / "failed_token_export.docx"
    assert not out_file.exists()

    # Tamper section with non-existent token
    bad_manuscript = dict(valid_manuscript)
    bad_manuscript["sections"] = [
        {"id": "results", "heading": "Results", "level": 1, "text": "Ghost token {{run:r99.estimate}}."}
    ]

    with pytest.raises(UnresolvedTokenError) as exc_info:
        export(bad_manuscript, valid_runs, valid_references, out_file)

    assert "r99" in str(exc_info.value)
    # Critical guarantee: nothing written to destination
    assert not out_file.exists()


def test_unresolved_citation_missing_key_refusal(tmp_path, valid_manuscript, valid_runs, valid_references):
    out_file = tmp_path / "failed_citation_key.docx"
    assert not out_file.exists()

    bad_manuscript = dict(valid_manuscript)
    bad_manuscript["sections"] = [
        {"id": "intro", "heading": "Introduction", "level": 1, "text": "Unknown cite \\cite{ghost_ref}."}
    ]

    with pytest.raises(UnresolvedCitationError) as exc_info:
        export(bad_manuscript, valid_runs, valid_references, out_file)

    assert "ghost_ref" in str(exc_info.value)
    assert not out_file.exists()


def test_unresolved_citation_missing_doi_and_pmid_refusal(tmp_path, valid_manuscript, valid_runs):
    out_file = tmp_path / "failed_citation_ids.docx"
    assert not out_file.exists()

    refs_without_ids = [
        {"key": "ref_bare", "title": "Draft with no IDs", "authors": ["Noone A"]}
    ]
    bad_manuscript = dict(valid_manuscript)
    bad_manuscript["sections"] = [
        {"id": "intro", "heading": "Introduction", "level": 1, "text": "Bare cite \\cite{ref_bare}."}
    ]

    with pytest.raises(UnresolvedCitationError) as exc_info:
        export(bad_manuscript, valid_runs, refs_without_ids, out_file)

    assert "ref_bare" in str(exc_info.value)
    assert "neither DOI nor PMID" in str(exc_info.value)
    assert not out_file.exists()


def test_docx_export_full_imrad_opens_and_contains_rendered_numbers(
    tmp_path, valid_manuscript, valid_runs, valid_references
):
    out_file = tmp_path / "valid_export.docx"

    # Create dummy PNG and SVG files for figure placeholders
    svg_file = tmp_path / "forest_plot.svg"
    svg_file.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">'
        '<rect width="200" height="80" fill="#336699"/>'
        '<text x="20" y="45" font-size="16" fill="white">Forest Plot SVG</text>'
        '</svg>',
        encoding="utf-8",
    )

    png_file = tmp_path / "prisma.png"
    # Create minimal 1x1 valid PNG
    from PIL import Image
    img = Image.new("RGB", (20, 20), color="blue")
    img.save(str(png_file), format="PNG")

    figures = [
        {"id": "fig1", "path": str(svg_file), "caption": "Figure 1: Forest plot of primary outcome."},
        {"id": "fig2", "path": str(png_file), "caption": "Figure 2: PRISMA study flow diagram."},
        {"id": "fig3", "path": None, "caption": "Figure 3: Funnel plot."},
    ]

    tables = [
        {
            "id": "table1",
            "title": "Table 1: Study Characteristics and Summary Estimates",
            "headers": ["Outcome", "Estimate", "95% CI", "p-value", "Studies (k)"],
            "rows": [
                ["Primary Mortality", "{{run:r1.estimate}}", "{{run:r1.ci}}", "{{run:r1.p}}", "{{run:r1.k}}"],
                ["Secondary Score", "{{run:r2.estimate}}", "{{run:r2.ci}}", "{{run:r2.p}}", "{{run:r2.k}}"],
            ],
        }
    ]

    result_path = export(
        valid_manuscript,
        valid_runs,
        valid_references,
        out_file,
        figures=figures,
        tables=tables,
    )
    assert result_path == out_file
    assert out_file.exists()

    # Re-open with python-docx and inspect document contents
    doc = docx.Document(str(out_file))

    # Collect all text in document paragraphs and tables
    all_paragraphs = [p.text for p in doc.paragraphs]
    doc_text = "\n".join(all_paragraphs)

    table_cells = []
    for tbl in doc.tables:
        for row in tbl.rows:
            table_cells.extend(c.text for c in row.cells)
    all_text = doc_text + "\n" + "\n".join(table_cells)

    # 1. No raw {{run:...}} or \cite{...} tokens remain anywhere
    assert "{{run:" not in all_text
    assert "\\cite{" not in all_text
    assert "[@" not in all_text

    # 2. Rendered numbers are present
    assert "OR 0.62" in all_text
    assert "(95% CI 0.41 to 0.93)" in all_text
    assert ".020" in all_text
    assert "12 trials" in all_text
    assert "-1.50" in all_text
    assert "< .001" in all_text
    assert "35.2%" in all_text

    # 3. Citation order verified:
    # In valid_manuscript: Introduction cites ref_first then ref_second.
    # Therefore ref_first is [1] and ref_second is [2].
    assert "[1]" in all_text
    assert "[2]" in all_text
    assert "[1, 2]" in all_text

    # 4. Vancouver references section present
    assert "References" in all_paragraphs
    ref_first_line = next(p for p in all_paragraphs if p.startswith("1. Smith J, Doe A"))
    ref_second_line = next(p for p in all_paragraphs if p.startswith("2. Brown K, Davis M"))
    assert "doi:10.1056/nejmoa200001" in ref_first_line
    assert "PMID:32000001" in ref_first_line
    assert "doi:10.1016/s0140-6736(18)0001" in ref_second_line
    assert "PMID:29100001" in ref_second_line

    # 5. Tables rendered with populated cells
    assert len(doc.tables) >= 1
    assert "Primary Mortality" in table_cells
    assert "0.62" in table_cells

    # 6. Figures and placeholder
    assert any("Figure 1: Forest plot of primary outcome" in p for p in all_paragraphs)
    assert any("Figure 2: PRISMA study flow diagram" in p for p in all_paragraphs)
    assert any("[Figure 3: Funnel plot - Image Placeholder]" in p for p in all_paragraphs)


def test_citation_order_determines_vancouver_numbering(tmp_path, valid_runs, valid_references):
    out_file = tmp_path / "order_test.docx"

    # Invert citation order: cite ref_second first, then ref_first
    manuscript = {
        "title": "Order Inversion Test",
        "sections": [
            {
                "id": "introduction",
                "heading": "Introduction",
                "level": 1,
                "text": "First cited is ref_second \\cite{ref_second}.",
            },
            {
                "id": "methods",
                "heading": "Methods",
                "level": 1,
                "text": "Next cited is ref_first \\cite{ref_first}.",
            },
        ],
    }

    export(manuscript, valid_runs, valid_references, out_file)
    doc = docx.Document(str(out_file))
    paragraphs = [p.text for p in doc.paragraphs]

    # ref_second should now be numbered 1, ref_first numbered 2
    assert any(p.startswith("1. Brown K, Davis M. Earlier Study on Outcome.") for p in paragraphs)
    assert any(p.startswith("2. Smith J, Doe A, Adams B") for p in paragraphs)


def test_hard_gate_blocks_export_with_violation_list(tmp_path, valid_runs, valid_references):
    from paperorchestra.adapter.po_adapter.gates import GateError

    manuscript = {
        "title": "Blocked Review",
        "sections": [
            {"id": "results", "heading": "Results", "level": 1,
             "text": "The intervention reduced mortality (OR 0.62)."},
        ],
    }
    out_file = tmp_path / "blocked.docx"
    with pytest.raises(GateError) as exc:
        export(manuscript, valid_runs, valid_references, out_file)
    assert any(v["gate"] == "untokenised_number" for v in exc.value.violations)
    assert not out_file.exists()  # nothing written on a gate failure


def test_subsections_stay_under_their_parent_in_docx(tmp_path, valid_manuscript, valid_runs, valid_references):
    # Live paper draft 2026-11-27: subsections were exported last, alphabetically, after Discussion.
    ms = dict(valid_manuscript)
    secs = list(ms["sections"])
    methods_at = next(i for i, s in enumerate(secs) if s["id"] == "methods")
    secs.insert(methods_at + 1, {"id": "statistical-analysis", "heading": "Statistical analysis", "level": 2,
                                 "text": "Random-effects pooling was used."})
    ms["sections"] = secs
    out = export(ms, valid_runs, valid_references, tmp_path / "order.docx")
    paras = [p.text for p in docx.Document(str(out)).paragraphs]
    i_methods = next(i for i, t in enumerate(paras) if t.strip() == "Methods")
    i_stats = next(i for i, t in enumerate(paras) if t.strip() == "Statistical analysis")
    i_results = next(i for i, t in enumerate(paras) if t.strip() == "Results")
    assert i_methods < i_stats < i_results
