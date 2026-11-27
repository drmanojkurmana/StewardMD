"""Bounded repair of hard gate violations (one gateway call per round).

The gates stay exactly as strict: this module never relaxes a check. It asks
the model to fix only the sentences that tripped a gate, splices the returned
sections back into the draft by heading, and re-runs the same gates. At most
MAX_REPAIR_ROUNDS rounds are attempted. If violations remain, the caller
raises GateError with the LAST violations, exactly as before.

Any parse failure, a changed heading, or a returned section that was not
asked for leaves the original text untouched, so the caller fails as today.
CeilingError from the gateway is never caught here.
"""
from __future__ import annotations

import re

from . import gates, writer

# The writer model the section agent uses (pipeline.run_section_draft).
REPAIR_MODEL = "researchmd-writer"
MAX_REPAIR_ROUNDS = 2

_HEADING_RE = re.compile(r"\\(section|subsection|subsubsection)\*?\{([^}]*)\}")


def _blocks(tex):
    """Raw heading blocks: [{cmd, heading, body_start, body_end, block}].
    Returns None when headings repeat (splicing by heading would be ambiguous)."""
    matches = list(_HEADING_RE.finditer(tex or ""))
    blocks = []
    seen = set()
    for i, match in enumerate(matches):
        heading = match.group(2).strip()
        if heading in seen:
            return None
        seen.add(heading)
        body_start = match.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(tex)
        blocks.append({"cmd": match.group(1), "heading": heading,
                       "body_start": body_start, "body_end": body_end,
                       "block": tex[match.start():body_end]})
    return blocks


def _headings_by_id(tex):
    return {s["id"]: s["heading"] for s in writer.parse_latex_sections(tex or "")}


def _affected_blocks(tex, violations):
    """(required headings, blocks) for the sections named in the violations."""
    blocks = _blocks(tex)
    if not blocks:
        return None
    by_heading = {b["heading"]: b for b in blocks}
    ids = _headings_by_id(tex)
    wanted = []
    for violation in violations:
        sid = str(violation.get("section") or "").lower()
        heading = ids.get(sid)
        if heading and heading not in wanted:
            wanted.append(heading)
    if not wanted:
        return None
    found = [by_heading[h] for h in wanted if h in by_heading]
    if len(found) != len(wanted):
        return None
    return wanted, found


def _violation_lines(violations):
    lines = []
    for violation in violations:
        gate = violation.get("gate", "")
        section = violation.get("section", "")
        detail = (violation.get("number") or violation.get("sentence")
                  or violation.get("token") or violation.get("key")
                  or violation.get("word") or "")
        reason = violation.get("reason")
        if reason:
            detail = f"{detail} ({reason})" if detail else str(reason)
        lines.append(f"- gate: {gate} | section: {section} | {detail}")
    return "\n".join(lines)


def _allowed_tokens(token_table):
    keys = sorted((token_table or {}).keys())
    return "\n".join("{{run:" + key + "}}" for key in keys) or "(none)"


def _allowed_citations(citation_map):
    keys = sorted((citation_map or {}).keys())
    return "\n".join("\\cite{" + key + "}" for key in keys) or "(none)"


def _system_prompt():
    return (
        "You repair hard integrity gate violations in a LaTeX manuscript. "
        "Change only the sentences named in the violation list. Return only "
        "the full LaTeX of the sections you were given, each with its "
        "original \\section, \\subsection or \\subsubsection heading. "
        "No commentary."
    )


def _user_prompt(violations, section_tex, token_table, citation_map):
    return (
        "VIOLATIONS\n" + _violation_lines(violations) + "\n\n"
        "SECTIONS TO REPAIR (LaTeX)\n" + section_tex + "\n\n"
        "ALLOWED TOKENS\n" + _allowed_tokens(token_table) + "\n\n"
        "ALLOWED CITATIONS\n" + _allowed_citations(citation_map) + "\n\n"
        "RULES\n"
        "1. Change only the sentences that contain a violation.\n"
        "2. An untokenised number must be replaced by the matching {{run:...}} "
        "token if one exists; otherwise remove the number by rephrasing. "
        "Never invent a token, a number or a citation.\n"
        "3. A claim without a source must get an existing \\cite{...} or "
        "{{run:...}} token, or be rephrased so it no longer asserts an "
        "effect.\n"
        "4. Keep all other text byte-identical.\n"
        "5. Return the full LaTeX of the affected sections only, with the "
        "same \\section and \\subsection headings.\n"
    )


def _strip_fence(raw):
    match = re.search(r"```latex\s*(.*?)\s*```", raw or "",
                      re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.search(r"```\s*(.*?)\s*```", raw or "",
                      re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1)
    return (raw or "").strip()


def _splice(tex, returned, required_headings):
    """Replace only the returned section bodies, by heading. Returns the
    original tex when the output is unparseable or a heading changed."""
    original = _blocks(tex)
    repaired = _blocks(returned)
    if not original or not repaired:
        return tex
    original_by = {b["heading"]: b for b in original}
    repaired_by = {b["heading"]: b for b in repaired}
    if any(h not in original_by for h in repaired_by):
        return tex
    if any(original_by[b["heading"]]["cmd"] != b["cmd"] for b in repaired):
        return tex
    if any(h not in repaired_by for h in required_headings):
        return tex

    required = set(required_headings)
    pieces = []
    pos = 0
    for block in original:
        pieces.append(tex[pos:block["body_start"]])
        if block["heading"] in required and block["heading"] in repaired_by:
            body = returned[repaired_by[block["heading"]]["body_start"]:
                            repaired_by[block["heading"]]["body_end"]].strip()
            pieces.append("\n" + body + "\n\n" if body else "\n")
        else:
            pieces.append(tex[block["body_start"]:block["body_end"]])
        pos = block["body_end"]
    pieces.append(tex[pos:])
    return "".join(pieces)


def repair_violations(client, tex, violations, token_table, citation_map):
    """ONE gateway call (purpose "repair"). Returns the repaired tex, or the
    original tex when the affected sections cannot be isolated or the model
    output cannot be spliced back safely."""
    affected = _affected_blocks(tex, violations)
    if affected is None:
        return tex
    required, blocks = affected
    section_tex = "\n".join(block["block"].strip() for block in blocks)

    result = client.call_text(
        _user_prompt(violations, section_tex, token_table, citation_map),
        REPAIR_MODEL,
        result_parsing_func=lambda raw: raw,
        generation_configs={"system_instruction": _system_prompt()},
        purpose="repair")
    raw = result.get("raw_response") or result.get("parsed_response") or ""
    return _splice(tex, _strip_fence(raw), required)


def apply_repair(client, tex, token_table, citation_map, manifest=None,
                 gate_context=None):
    """Repair up to MAX_REPAIR_ROUNDS times, re-running the same gate check
    after each round. Returns (tex, remaining violations). Every hit and every
    repair attempt is recorded on gate_context when one is supplied."""
    violations = gates.check_paper(tex, token_table, citation_map, manifest)
    if not violations:
        return tex, []
    if gate_context is not None:
        gate_context.setdefault("gate_hits", []).extend(violations)
        gate_context.setdefault("repairs", [])

    rounds = 0
    while violations and rounds < MAX_REPAIR_ROUNDS:
        rounds += 1
        if gate_context is not None:
            gate_context["repairs"].append({"repaired": rounds,
                                            "violations": list(violations)})
        tex = repair_violations(client, tex, violations, token_table,
                                citation_map)
        violations = gates.check_paper(tex, token_table, citation_map, manifest)

    if gate_context is not None and violations:
        gate_context["gate_hits"].extend(violations)
    return tex, violations
