"""Deterministic token renderer for ResearchMD manuscripts (Package 5A.3).

Renders {{run:<runId>:<field>}} tokens to formatted strings per a strict rule table:
- effects: 2 decimals (e.g. 0.62)
- p values: APA 7th edition rules (< .001, > .999, exact as .020 without leading zero)
- CIs: formatted as (95% CI a to b)
- counts: integers (e.g. 12)
- heterogeneity: 1 decimal percentage (e.g. 35.2%)

Shared by docx_export and by UI/engine preview.
"""
from __future__ import annotations

import re
from typing import Any, Callable

TOKEN_RE = re.compile(r"\{\{run:([A-Za-z0-9_-]+)[:.]([A-Za-z0-9_.]+)\}\}")


class UnresolvedTokenError(ValueError):
    """Raised when a {{run:...}} token cannot be resolved from saved runs."""

    def __init__(self, token: str, detail: str = ""):
        self.token = token
        self.detail = detail
        msg = f"Unresolved token: {token}"
        if detail:
            msg += f" ({detail})"
        super().__init__(msg)


def format_effect(val: Any) -> str:
    """Format effect size to 2 decimal places."""
    return f"{float(val):.2f}"


def format_apa_p_value(val: Any, *, digits: int = 3, leading_zero: bool = False) -> str:
    """Format p-value per APA 7th edition rules (section 6.32).
    - If p < .001: '< .001'
    - If p > .999: '> .999'
    - Exact p-value without leading zero: e.g. '.020', '.045'
    """
    v = float(val)
    if v < 0.001:
        return "< 0.001" if leading_zero else "< .001"
    if v > 0.999:
        return "> 0.999" if leading_zero else "> .999"
    formatted = f"{v:.{digits}f}"
    if not leading_zero:
        formatted = formatted.lstrip("0")
        if not formatted.startswith("."):
            formatted = "." + formatted
    return formatted


def format_ci(lower: Any, upper: Any, level: int = 95) -> str:
    """Format confidence interval as (95% CI a to b)."""
    return f"({level}% CI {float(lower):.2f} to {float(upper):.2f})"


def format_count(val: Any) -> str:
    """Format count as integer."""
    return str(int(round(float(val))))


def format_heterogeneity(val: Any) -> str:
    """Format heterogeneity statistic (I^2) to 1 decimal place with percent."""
    return f"{float(val):.1f}%"


RULE_TABLE: dict[str, Callable[[Any], str]] = {
    # Effects: 2 decimals
    "estimate": format_effect,
    "effect": format_effect,
    "yi": format_effect,
    "or": format_effect,
    "rr": format_effect,
    "rd": format_effect,
    "md": format_effect,
    "smd": format_effect,
    "hr": format_effect,
    "hedges_g": format_effect,
    "ciLower": format_effect,
    "ciUpper": format_effect,
    "ci_lower": format_effect,
    "ci_upper": format_effect,
    "tau2": format_effect,
    "tau": format_effect,
    "se": format_effect,
    "se_yi": format_effect,
    "q": format_effect,
    # p values: APA style
    "p": format_apa_p_value,
    "pValue": format_apa_p_value,
    "p_value": format_apa_p_value,
    "pval": format_apa_p_value,
    # counts: integers
    "k": format_count,
    "n": format_count,
    "total": format_count,
    "sample_size": format_count,
    "count": format_count,
    "studies": format_count,
    "participants": format_count,
    "events": format_count,
    "events_intervention": format_count,
    "events_control": format_count,
    "df": format_count,
    # heterogeneity
    "i2": format_heterogeneity,
    "i_squared": format_heterogeneity,
}


def normalize_runs(runs: list | dict) -> dict[str, dict]:
    """Normalize runs argument into a dictionary keyed by runId."""
    if isinstance(runs, list):
        out = {}
        for r in runs:
            if isinstance(r, dict) and "runId" in r:
                out[str(r["runId"])] = r
        return out
    if isinstance(runs, dict):
        if any(":" in k for k in runs.keys()):
            # Token table format: reconstruct run dicts
            out = {}
            for k, entry in runs.items():
                run_id, _, field_path = k.partition(":")
                if run_id not in out:
                    out[run_id] = {"runId": run_id, "result": {}}
                val = entry.get("value") if isinstance(entry, dict) else entry
                out[run_id]["result"][field_path] = val
                if isinstance(entry, dict) and "measure" in entry:
                    out[run_id]["measure"] = entry["measure"]
            return out
        return runs
    return {}


def format_value_for_field(field_path: str, value: Any) -> str:
    """Format a value according to the rule table or sensible fallback."""
    last_component = field_path.split(".")[-1]
    if field_path in RULE_TABLE:
        return RULE_TABLE[field_path](value)
    if last_component in RULE_TABLE:
        return RULE_TABLE[last_component](value)
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def render_tokens(text: str, runs: list | dict, *, strict: bool = False) -> str:
    """Deterministic token -> formatted value substitution.

    If strict=True: raises UnresolvedTokenError if any token cannot be resolved.
    If strict=False: leaves unresolved tokens unchanged (for preview).
    """
    normalized = normalize_runs(runs)

    def sub(match: re.Match) -> str:
        token_str = match.group(0)
        run_id = match.group(1)
        field_path = match.group(2)

        run = normalized.get(run_id)
        if run is None:
            if strict:
                raise UnresolvedTokenError(token_str, f"run '{run_id}' not found in saved runs")
            return token_str

        result = run.get("result", {})
        if not isinstance(result, dict):
            if strict:
                raise UnresolvedTokenError(token_str, f"run '{run_id}' has invalid result object")
            return token_str

        # Composite CI tokens
        if field_path.lower() in ("ci", "ci95", "confidence_interval", "confidenceinterval"):
            lo = result.get("ciLower") if "ciLower" in result else result.get("ci_lower")
            hi = result.get("ciUpper") if "ciUpper" in result else result.get("ci_upper")
            if lo is None or hi is None:
                ci_pair = result.get("ci")
                if isinstance(ci_pair, (list, tuple)) and len(ci_pair) == 2:
                    lo, hi = ci_pair[0], ci_pair[1]
            if lo is None or hi is None:
                if strict:
                    raise UnresolvedTokenError(token_str, f"missing ciLower/ciUpper in run '{run_id}'")
                return token_str
            return format_ci(lo, hi)

        # Lookup by exact field path or dot-path traversal
        value = None
        if field_path in result:
            value = result[field_path]
        else:
            curr = result
            parts = field_path.split(".")
            for part in parts:
                if isinstance(curr, dict) and part in curr:
                    curr = curr[part]
                else:
                    curr = None
                    break
            value = curr

        if value is None:
            if strict:
                raise UnresolvedTokenError(token_str, f"field '{field_path}' not found in run '{run_id}'")
            return token_str

        return format_value_for_field(field_path, value)

    return TOKEN_RE.sub(sub, text or "")
