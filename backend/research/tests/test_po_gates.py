"""Hard gate tests (plan section 12: numbers, citations, claim links,
direction/significance agreement). Gates run before any autorater score."""
from __future__ import annotations

import pytest

from paperorchestra.adapter.po_adapter import gates
from test_po_common import make_manifest


@pytest.fixture()
def manifest():
    return make_manifest()


@pytest.fixture()
def token_table(manifest):
    from paperorchestra.adapter.po_adapter.loader import build_token_table
    return build_token_table(manifest["runs"])


@pytest.fixture()
def citation_map():
    return {"ref1": {"title": "Trial One report", "doi": "10.1000/trial1",
                     "pmid": "11111111"}}


def section(sid, text):
    return {"id": sid, "heading": sid.title(), "text": text}


def test_untokenised_number_rejected(token_table):
    sections = [section("results", "The intervention reduced mortality (OR 0.62).")]
    violations = gates.check_numbers(sections, token_table)
    assert any(v["gate"] == "untokenised_number" and v["number"] == "0.62"
               for v in violations)


def test_tokenised_numbers_pass(token_table):
    sections = [section("results",
                        "The intervention reduced mortality (OR {{run:r1.estimate}}, "
                        "95% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}; p {{run:r1.p}}).")]
    assert gates.check_numbers(sections, token_table) == []


def test_years_reviewer_counts_thresholds_allowed(token_table):
    sections = [section("results",
                        "Since 2018, two reviewers screened records; 3 reviewers assessed risk of bias. "
                        "The significance level was 0.05 and the heterogeneity cutoff was 50%.")]
    assert gates.check_numbers(sections, token_table) == []


def test_unknown_token_rejected(token_table):
    sections = [section("results", "Effect {{run:r9.estimate}} was reported.")]
    violations = gates.check_numbers(sections, token_table)
    assert any(v["gate"] == "unknown_token" for v in violations)


def test_numbers_outside_results_not_gated(token_table):
    sections = [section("methods", "We searched 3 databases and included 12 trials.")]
    assert gates.check_numbers(sections, token_table) == []


def test_unresolved_citation_unknown_key(token_table, citation_map, manifest):
    sections = [section("introduction", "Background \\cite{ghost}.")]
    violations = gates.check_citations(sections, citation_map, manifest)
    assert any(v["gate"] == "unresolved_citation" and v["key"] == "ghost"
               for v in violations)


def test_unresolved_citation_no_identifier(token_table, manifest):
    sections = [section("introduction", "Background \\cite{ref2}.")]
    citation_map = {"ref2": {"title": "Mystery paper"}}
    violations = gates.check_citations(sections, citation_map, manifest)
    assert any(v["reason"] == "no_doi_or_pmid" for v in violations)


def test_citation_identifier_must_be_in_manifest(token_table, manifest):
    sections = [section("introduction", "Background \\cite{ref2}.")]
    citation_map = {"ref2": {"title": "Outside paper", "doi": "10.9999/outside"}}
    violations = gates.check_citations(sections, citation_map, manifest)
    assert any(v["reason"] == "not_in_manifest" for v in violations)


def test_resolved_citation_passes(token_table, citation_map, manifest):
    sections = [section("introduction", "Background \\cite{ref1}.")]
    assert gates.check_citations(sections, citation_map, manifest) == []


def test_claim_without_source_rejected():
    sections = [section("discussion", "The intervention significantly improved outcomes.")]
    violations = gates.check_claim_links(sections)
    assert any(v["gate"] == "claim_without_source" for v in violations)


def test_claim_with_token_or_citation_passes():
    sections = [section("discussion",
                        "The intervention reduced mortality ({{run:r1.estimate}}). "
                        "Prior work agrees \\cite{ref1}.")]
    assert gates.check_claim_links(sections) == []


def test_significantly_reduced_with_ci_crossing_null_rejected(token_table):
    # r1 CI 0.41-0.93 excludes 1; build a crossing CI for the same estimate.
    table = dict(token_table)
    table["r1.ciLower"] = {**table["r1.ciLower"], "value": 0.8}
    table["r1.ciUpper"] = {**table["r1.ciUpper"], "value": 1.3}
    sections = [section("results",
                        "The intervention significantly reduced mortality "
                        "({{run:r1.estimate}}, {{run:r1.ciLower}} to {{run:r1.ciUpper}}).")]
    violations = gates.check_direction(sections, table)
    assert any(v["gate"] == "significance_mismatch" and v["claim"] == "significant"
               for v in violations)


def test_direction_and_significance_agree_passes(token_table):
    sections = [section("results",
                        "The intervention significantly reduced mortality "
                        "({{run:r1.estimate}}, {{run:r1.ciLower}} to {{run:r1.ciUpper}}).")]
    assert gates.check_direction(sections, token_table) == []


def test_reduced_with_estimate_above_null_rejected(token_table):
    table = dict(token_table)
    table["r1.estimate"] = {**table["r1.estimate"], "value": 1.4}
    sections = [section("results", "The intervention reduced mortality ({{run:r1.estimate}}).")]
    violations = gates.check_direction(sections, table)
    assert any(v["gate"] == "direction_mismatch" for v in violations)


def test_not_significant_with_excluding_ci_rejected(token_table):
    sections = [section("results",
                        "The effect was not significant ({{run:r1.ciLower}} to {{run:r1.ciUpper}}).")]
    violations = gates.check_direction(sections, token_table)
    assert any(v["gate"] == "significance_mismatch" and v["claim"] == "not significant"
               for v in violations)


def test_enforce_raises_gate_error(token_table):
    sections = [section("results", "OR 0.62 was observed.")]
    with pytest.raises(gates.GateError) as exc:
        gates.enforce(sections, token_table)
    assert exc.value.code == "gate_failed"
    assert exc.value.violations


def test_check_paper_splits_sections(token_table, citation_map, manifest):
    text = ("\\section{Results} OR 0.62 was observed.\n"
            "\\section{Methods} We searched 3 databases.\n")
    violations = gates.check_paper(text, token_table, citation_map, manifest)
    assert any(v["gate"] == "untokenised_number" and v["section"] == "results"
               for v in violations)
    assert not any(v["section"] == "methods" for v in violations)


def test_retired_colon_token_flagged_malformed(token_table):
    sections = [section("results", "Effect {{run:r1:estimate}} was reported.")]
    violations = gates.check_numbers(sections, token_table)
    assert any(v["gate"] == "malformed_token" for v in violations)


def test_composite_ci_token_resolves(token_table):
    sections = [section("results", "OR {{run:r1.estimate}} {{run:r1.ci}}.")]
    assert gates.check_numbers(sections, token_table) == []


def test_composite_ci_without_bounds_is_unknown(token_table):
    table = {k: v for k, v in token_table.items() if k not in ("r1.ciLower", "r1.ciUpper")}
    sections = [section("results", "OR {{run:r1.ci}}.")]
    violations = gates.check_numbers(sections, table)
    assert any(v["gate"] == "unknown_token" for v in violations)


def test_latex_escaped_percent_ci_allowed(token_table):
    # The draft writes "95\% CI" before writer.latex_to_text runs.
    sections = [section("abstract",
                        "The pooled estimate was {{run:r1.estimate}} "
                        "(95\\% CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}).")]
    violations = gates.check_numbers(sections, token_table)
    assert not any(v.get("number") == "95" for v in violations)


def test_latex_escaped_percent_tilde_ci_allowed(token_table):
    sections = [section("abstract",
                        "The pooled estimate was {{run:r1.estimate}} "
                        "(95\\%~CI {{run:r1.ciLower}} to {{run:r1.ciUpper}}).")]
    violations = gates.check_numbers(sections, token_table)
    assert not any(v.get("number") == "95" for v in violations)


def test_latex_escaped_percent_confidence_allowed(token_table):
    sections = [section("abstract",
                        "The pooled estimate was {{run:r1.estimate}} "
                        "(95 \\% confidence interval {{run:r1.ciLower}} to "
                        "{{run:r1.ciUpper}}).")]
    violations = gates.check_numbers(sections, token_table)
    assert not any(v.get("number") == "95" for v in violations)


def test_bare_number_still_flagged_with_escaped_percent_rule(token_table):
    sections = [section("abstract", "There was a reduction of 95 cases.")]
    violations = gates.check_numbers(sections, token_table)
    assert any(v["gate"] == "untokenised_number" and v["number"] == "95"
               for v in violations)


def test_research_question_sentence_is_not_a_claim():
    # Exact live sentence (2026-11-27), with the verb restored after the comma.
    sentence = (r"\noindent\textbf{Background and objective.} This systematic review "
                r"and meta-analysis addresses whether BCG vaccination reduces "
                r"tuberculosis in infants.")
    sections = [section("abstract", sentence)]
    assert gates.check_claim_links(sections) == []


def test_objective_phrasing_is_not_a_claim():
    sections = [section("abstract",
                        "Our objective was to quantify how BCG reduces tuberculosis.")]
    assert gates.check_claim_links(sections) == []


def test_plain_claim_without_source_still_flagged():
    sections = [section("abstract", "BCG vaccination reduces tuberculosis in infants.")]
    violations = gates.check_claim_links(sections)
    assert any(v["gate"] == "claim_without_source" for v in violations)


def test_exponent_digits_are_notation_not_numbers():
    """A live draft failed on I$^2$ (heterogeneity): an exponent is not a result number."""
    sections = [{"id": "abstract", "heading": "Abstract",
                 "text": "Heterogeneity was summarised with I$^2$ and \\chi^{2}; a \\textsuperscript{2} mark. "
                         "A reduction of 42 cases was seen."}]
    numbers = [v["number"] for v in gates.check_numbers(sections, {})]
    assert "2" not in numbers
    assert "42" in numbers  # a real untokenised result number is still caught
