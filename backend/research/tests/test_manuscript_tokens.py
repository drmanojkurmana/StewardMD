"""Tests for deterministic token rendering and rule table (Package 5A.3).

Verifies formatting rule table:
- effects: 2 decimals
- p values: APA 7th edition rules (< .001, > .999, exact as .020 without leading zero)
- CIs: (95% CI a to b)
- counts: integers
- heterogeneity: 1 decimal percentage
And verifies strict refusal vs preview tolerance.
"""
from __future__ import annotations

import pytest

from manuscript.render_tokens import (
    RULE_TABLE,
    UnresolvedTokenError,
    format_apa_p_value,
    format_ci,
    format_count,
    format_effect,
    format_heterogeneity,
    render_tokens,
)


@pytest.fixture()
def sample_runs():
    return [
        {
            "runId": "r1",
            "measure": "OR",
            "method": "DL",
            "result": {
                "estimate": 0.6234,
                "ciLower": 0.412,
                "ciUpper": 0.934,
                "p": 0.02,
                "k": 12,
                "n": 1500,
                "i2": 35.2,
                "subgroup": {
                    "active": {
                        "estimate": 0.551,
                    }
                },
            },
        },
        {
            "runId": "r2",
            "measure": "MD",
            "method": "REML",
            "result": {
                "estimate": -2.406,
                "ciLower": -4.10,
                "ciUpper": -0.712,
                "p": 0.0004,
                "k": 5,
                "i2": 0.0,
            },
        },
        {
            "runId": "r3",
            "measure": "RR",
            "method": "FE",
            "result": {
                "estimate": 1.002,
                "ciLower": 0.998,
                "ciUpper": 1.006,
                "p": 0.9995,
                "k": 20,
            },
        },
    ]


def test_format_effect_two_decimals():
    assert format_effect(0.6234) == "0.62"
    assert format_effect(-2.406) == "-2.41"
    assert format_effect(1.0) == "1.00"
    assert format_effect("0.5") == "0.50"


def test_format_apa_p_value_rules():
    # Less than .001
    assert format_apa_p_value(0.0004) == "< .001"
    assert format_apa_p_value(0.0) == "< .001"
    # Greater than .999
    assert format_apa_p_value(0.9995) == "> .999"
    assert format_apa_p_value(1.0) == "> .999"
    # Exact values without leading zero (APA 7th ed)
    assert format_apa_p_value(0.02) == ".020"
    assert format_apa_p_value(0.045) == ".045"
    assert format_apa_p_value(0.001) == ".001"
    assert format_apa_p_value(0.500) == ".500"


def test_format_ci_standard():
    assert format_ci(0.412, 0.934) == "(95% CI 0.41 to 0.93)"
    assert format_ci(-4.1, -0.712) == "(95% CI -4.10 to -0.71)"


def test_format_count_integer():
    assert format_count(12) == "12"
    assert format_count(1500.0) == "1500"
    assert format_count("42") == "42"


def test_format_heterogeneity_percentage():
    assert format_heterogeneity(35.2) == "35.2%"
    assert format_heterogeneity(0.0) == "0.0%"


def test_rule_table_coverage():
    assert "estimate" in RULE_TABLE
    assert "ciLower" in RULE_TABLE
    assert "ciUpper" in RULE_TABLE
    assert "p" in RULE_TABLE
    assert "k" in RULE_TABLE
    assert "i2" in RULE_TABLE


def test_render_tokens_deterministic(sample_runs):
    text = (
        "Primary outcome OR {{run:r1:estimate}} {{run:r1:ci}} (p {{run:r1:p}}). "
        "Heterogeneity I2 was {{run:r1:i2}} across {{run:r1:k}} trials."
    )
    rendered = render_tokens(text, sample_runs, strict=True)
    expected = (
        "Primary outcome OR 0.62 (95% CI 0.41 to 0.93) (p .020). "
        "Heterogeneity I2 was 35.2% across 12 trials."
    )
    assert rendered == expected


def test_render_tokens_apa_p_boundary(sample_runs):
    text_small_p = "Effect {{run:r2:estimate}} {{run:r2:ci}} with p {{run:r2:p}}."
    rendered_small = render_tokens(text_small_p, sample_runs, strict=True)
    assert "Effect -2.41 (95% CI -4.10 to -0.71) with p < .001." == rendered_small

    text_large_p = "Effect {{run:r3:estimate}} with p {{run:r3:p}}."
    rendered_large = render_tokens(text_large_p, sample_runs, strict=True)
    assert "Effect 1.00 with p > .999." == rendered_large


def test_render_tokens_nested_dot_path(sample_runs):
    text = "Subgroup effect was {{run:r1:subgroup.active.estimate}}."
    rendered = render_tokens(text, sample_runs, strict=True)
    assert rendered == "Subgroup effect was 0.55."


def test_render_tokens_unresolved_strict_raises(sample_runs):
    text_bad_run = "Result {{run:r99:estimate}}."
    with pytest.raises(UnresolvedTokenError) as exc_info:
        render_tokens(text_bad_run, sample_runs, strict=True)
    assert "r99" in str(exc_info.value)

    text_bad_field = "Result {{run:r1:nonexistent_metric}}."
    with pytest.raises(UnresolvedTokenError) as exc_info2:
        render_tokens(text_bad_field, sample_runs, strict=True)
    assert "nonexistent_metric" in str(exc_info2.value)


def test_render_tokens_preview_preserves_unknown(sample_runs):
    text = "Known {{run:r1:estimate}}, unknown {{run:r99:metric}}."
    rendered = render_tokens(text, sample_runs, strict=False)
    assert rendered == "Known 0.62, unknown {{run:r99:metric}}."
