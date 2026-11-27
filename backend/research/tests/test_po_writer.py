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
    assert "{{run:r1.estimate}}" in results["text"]
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
    assert "{{run:r1.estimate}}" in model["sections"][2]["text"]


def test_render_tokens_deterministic():
    manifest = make_manifest()
    table = build_token_table(manifest["runs"])
    text = "OR {{run:r1.estimate}} ({{run:r1.ciLower}} to {{run:r1.ciUpper}})"
    assert writer.render_tokens(text, table) == "OR 0.62 (0.41 to 0.93)"
    # Unknown tokens are left for the gates to flag.
    assert writer.render_tokens("{{run:r9.x}}", table) == "{{run:r9.x}}"


def test_unresolved_reference_marked():
    sections = [{"id": "introduction", "heading": "Introduction",
                 "text": "Background \\cite{ghost}."}]
    model = writer.build_manuscript(title="T", sections=sections, token_table={})
    assert model["references"][0]["resolved"] is False


def test_live_like_layout_and_latex_conversion():
    manifest = make_manifest()
    table = build_token_table(manifest["runs"])
    tex = (
        "\\section*{Abstract}\n"
        "\\noindent\\textbf{Background and objective.} To assess intervention X "
        "on outcome Y (OR {{run:r1.estimate}}, 95\\% CI {{run:r1.ciLower}} to "
        "{{run:r1.ciUpper}}; p {{run:r1.p}}).\n\n"
        "\\section{Introduction}\n"
        "This \\emph{systematic review} and \\textit{meta-analysis} evaluates X "
        "\\cite{ref1}. Study details appear in Table~\\ref{tab:study-data}.\n\n"
        "\\section{Methods}\n"
        "\\subsection{Protocol and eligibility}\n"
        "\\label{sec:protocol}\n"
        "\\begin{itemize}\n"
        "  \\item Adults aged 18 or older\n"
        "  \\item Randomised trials only\n"
        "\\end{itemize}\n"
        "Steps followed:\n"
        "\\begin{enumerate}\n"
        "  \\item Screen titles and abstracts\n"
        "  \\item Extract verified outcomes\n"
        "\\end{enumerate}\n"
        "\\subsection{Data and outcome definition}\n"
        "Extracted from \\texttt{run\\_7f09c578d6214e4ba6928f9b40e8ffdd} "
        "(95\\% CI, Smith \\& Doe, item \\#1, cost \\$50).\n"
        "\\subsection{Statistical analysis}\n"
        "Thresholds were $p \\le 0.05$, $p \\leq 0.01$, $n \\ge 10$, $k \\geq 2$, "
        "difference $1.2 \\pm 0.3$, scale $2 \\times 3$, and $p \\approx 0.02$.\n\n"
        "\\section{Results}\n"
        "\\subsection{Included evidence}\n"
        "Characteristics are in Table~\\ref{tab:study-data}, outcomes in "
        "Table~\\ref{tab:outcomes}, and plots in Figure~\\ref{fig:forest}.\n"
        "\\begin{table}[t]\n"
        "\\centering\n"
        "\\caption{Summary of included studies.}\n"
        "\\label{tab:study-data}\n"
        "\\begin{tabular}{@{}lcc@{}}\n"
        "\\toprule\n"
        "Study & Year & Events \\\\\n"
        "\\midrule\n"
        "Trial One & 2019 & 12 \\\\\n"
        "\\hline\n"
        "\\bottomrule\n"
        "\\end{tabular}\n"
        "\\end{table}\n"
        "\\subsection{Pooled analysis and heterogeneity}\n"
        "\\textbf{Pooled effect:} OR {{run:r1.estimate}} "
        "({{run:r1.ciLower}} to {{run:r1.ciUpper}}).\n"
        "\\subsection{Reporting}\n"
        "Checklist at \\url{https://example.com/~user/a_b} per \\mbox{PRISMA 2020}.\n\n"
        "\\section{Discussion}\n"
        "Findings in Table~\\ref{tab:study-data} support intervention X \\cite{ref1}.\n\n"
        "\\section*{Acknowledgements}\n"
        "We thank the reviewers.\n\n"
        "\\section*{References}\n"
        "See reference list.\n"
    )

    sections = writer.parse_latex_sections(tex)
    model = writer.build_manuscript(
        title="Test review", sections=sections, token_table=table,
        references=manifest["references"], manifest=manifest,
    )

    assert [s["id"] for s in model["sections"]] == [
        "abstract",
        "introduction",
        "methods",
        "protocol-and-eligibility",
        "data-and-outcome-definition",
        "statistical-analysis",
        "results",
        "included-evidence",
        "pooled-analysis-and-heterogeneity",
        "reporting",
        "discussion",
        "acknowledgements",
        "references",
    ]

    by_id = {s["id"]: s for s in model["sections"]}
    assert by_id["methods"]["text"] == ""
    assert by_id["results"]["text"] == ""
    assert by_id["abstract"]["text"].startswith("**Background and objective.** To assess")
    assert "{{run:r1.estimate}}" in by_id["abstract"]["text"]
    assert "{{run:r1.ciLower}}" in by_id["pooled-analysis-and-heterogeneity"]["text"]
    assert "*systematic review*" in by_id["introduction"]["text"]
    assert "*meta-analysis*" in by_id["introduction"]["text"]
    assert "Table 1" in by_id["introduction"]["text"]
    assert "Table 1" in by_id["included-evidence"]["text"]
    assert "Table 2" in by_id["included-evidence"]["text"]
    assert "Figure 1" in by_id["included-evidence"]["text"]
    assert "Table 1" in by_id["discussion"]["text"]
    assert "run_7f09c578d6214e4ba6928f9b40e8ffdd" in by_id["data-and-outcome-definition"]["text"]
    assert "95% CI, Smith & Doe, item #1, cost $50" in by_id["data-and-outcome-definition"]["text"]
    assert "- Adults aged 18 or older" in by_id["protocol-and-eligibility"]["text"]
    assert "- Randomised trials only" in by_id["protocol-and-eligibility"]["text"]
    assert "1. Screen titles and abstracts" in by_id["protocol-and-eligibility"]["text"]
    assert "2. Extract verified outcomes" in by_id["protocol-and-eligibility"]["text"]

    stat = by_id["statistical-analysis"]["text"]
    for sym in ("≤", "≥", "±", "×", "≈"):
        assert sym in stat
    for num in ("0.05", "0.01", "10", "2", "1.2", "0.3", "3", "0.02"):
        assert num in stat

    inc = by_id["included-evidence"]["text"]
    assert "Summary of included studies." in inc
    assert "Study | Year | Events" in inc
    assert "Trial One | 2019 | 12" in inc
    assert "https://example.com/~user/a_b" in by_id["reporting"]["text"]
    assert "PRISMA 2020" in by_id["reporting"]["text"]
    assert "\\cite{ref1}" in by_id["introduction"]["text"]
    assert model["references"][0]["key"] == "ref1"

    # No LaTeX backslash commands remain outside preserved \cite{...} markers.
    import re
    for sec in model["sections"]:
        stripped_cites = re.sub(r"\\cite\{[^}]+\}", "", sec["text"])
        assert "\\" not in stripped_cites, f"Leftover backslash in {sec['id']}: {stripped_cites}"


def test_latex_to_text_edge_cases():
    raw = (
        "\\maketitle\\centering\\smallskip\\medskip\\bigskip\n"
        "First\\par Second \\customcmd{kept} \\barecmd \\{braced\\} "
        "na\\\"ive \\textbf{{{run:r1.estimate}}} \\textbf{\\noindent}."
    )
    out = writer.latex_to_text(raw)
    assert "\\" not in out
    assert "First" in out and "Second" in out
    assert "kept" in out
    assert "{braced}" in out
    assert "naive" in out
    assert "**{{run:r1.estimate}}**" in out
    assert "****" not in out


def test_build_manuscript_orders_imrad_and_keeps_subsections_attached():
    sections = [
        {"id": "acknowledgements", "heading": "Acknowledgements", "level": 1, "text": "Thanks."},
        {"id": "results", "heading": "Results", "level": 1, "text": ""},
        {"id": "included-evidence", "heading": "Included evidence", "level": 2, "text": "Evidence."},
        {"id": "references", "heading": "References", "level": 1, "text": "Refs."},
        {"id": "methods", "heading": "Methods", "level": 1, "text": ""},
        {"id": "statistical-analysis", "heading": "Statistical analysis", "level": 2, "text": "Stats."},
        {"id": "discussion", "heading": "Discussion", "level": 1, "text": "Disc."},
        {"id": "abstract", "heading": "Abstract", "level": 1, "text": "Abs."},
        {"id": "introduction", "heading": "Introduction", "level": 1, "text": "Intro."},
    ]
    model = writer.build_manuscript(title="T", sections=sections, token_table={})
    assert [s["id"] for s in model["sections"]] == [
        "abstract",
        "introduction",
        "methods",
        "statistical-analysis",
        "results",
        "included-evidence",
        "discussion",
        "acknowledgements",
        "references",
    ]


def test_latex_symbols_dashes_and_token_punctuation_cleanup():
    raw = (
        "Heterogeneity $\\tau^2$ was {{run:r1.i2}}%; significance p={{run:r1.p}}; "
        "effect -- see https://example.com/a--b --- overall.\n"
        "| col1 | col2 |\n| --- | --- |"
    )
    text = writer.latex_to_text(raw)
    assert "τ^2" in text or "τ" in text
    assert "{{run:r1.i2}}%" not in text
    assert "https://example.com/a--b" in text
    assert "| --- | --- |" in text
    assert "effect -- see" not in text
    assert "b - overall" in text
    rendered = writer.render_tokens(
        "I2 {{run:r1.i2}}%; p={{run:r1.p}}; upper {{run:r1.ciUpper}}",
        {
            "r1.i2": {"value": 92.2, "formatted": "92.2%"},
            "r1.p": {"value": 0.0001, "formatted": "< .001"},
            "r1.ciUpper": {"value": 0.70, "formatted": "0.70"},
        },
    )
    assert "92.2%%" not in rendered
    assert "p < .001" in rendered
    assert "p=<" not in rendered
