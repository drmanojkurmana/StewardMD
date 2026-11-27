r"""Hard integrity gates (SEAMS.md seam 6, plan sections 8 and 12).

Run BEFORE any autorater score (seams.py wraps perform_review_agentreview)
and again on the final manuscript (pipeline.py). Any violation fails the job
with code gate_failed; partial work is never saved as a result.

Gates:
  numbers      every number in Abstract/Results is a {{run:<runId>.<fieldPath>}}
               token (the canonical format, contracts/phase-5/tokens.md).
               Allowed bare numbers (plan section 12): years, counts
               of reviewers, stated thresholds. Unknown tokens fail anywhere;
               a non-canonical {{run:...}} (e.g. the retired colon form) fails
               as malformed_token.
  citations    every \cite{key} / [@key] resolves to a DOI or PMID present in
               the manifest (references or evidence sources).
  claim_links  every claim sentence in Abstract/Results/Discussion carries a
               source link (a run token or a citation).
  direction    direction and significance words agree with the token values:
               "reduced" needs estimate < null, "increased" > null,
               "significant" needs a CI excluding the null, "not significant"
               a CI crossing it (null 1 for OR/RR/HR, 0 for MD/RD).
"""
from __future__ import annotations

import re

from .writer import parse_latex_sections

# Canonical token: {{run:<runId>.<fieldPath>}} (contracts/phase-5/tokens.md).
TOKEN_RE = re.compile(r"\{\{run:([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}")
# Any {{run:...}} spelling, used only to flag non-canonical tokens.
LOOSE_TOKEN_RE = re.compile(r"\{\{run:([^}]*)\}\}")
_NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_])\d+(?:\.\d+)?(?![A-Za-z0-9_])")
_YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")
_REVIEWER_COUNT_RE = re.compile(
    r"\b\d+\s+(?:reviewers|assessors|screeners)\b"
    r"|\b(?:reviewers|assessors|screeners)\s*(?:=|:)\s*\d+", re.IGNORECASE)
_THRESHOLD_RE = re.compile(
    r"\b(?:threshold|cutoff|alpha|significance level|type I error)\b[^.!?]{0,30}?\d+(?:\.\d+)?\\?%?"
    r"|\b(?:heterogeneity|I2|I\u00b2)\b[^.!?]{0,30}?\b(?:25|50|75)\s*\\?%"
    r"|\b(?:90|95|99)\s*\\?%[~\s]*(?:CI|confidence)\b",
    re.IGNORECASE)
# An exponent is notation, not a result: I$^2$, \\chi^{2}, \\textsuperscript{2}.
_EXPONENT_RE = re.compile(r"(?:\^\{?|\\textsuperscript\{)\s*\d+(?:\.\d+)?")
_CITE_RE = re.compile(r"\\cite\{([^}]+)\}|\[@([A-Za-z0-9_:-]+)\]")
_CLAIM_RE = re.compile(
    r"\b(?:reduc\w*|decreas\w*|increas\w*|improv\w*|worsen\w*"
    r"|significant\w*|associat\w*|superior|inferior)\b", re.IGNORECASE)
# A research question or objective is not a result claim; it needs no source.
_WHETHER_RE = re.compile(r"\bwhether\b", re.IGNORECASE)
_OBJECTIVE_RE = re.compile(
    r"\b(?:aim(?:s|ed)?|objective|purpose|we (?:sought|set out) to"
    r"|this (?:review|study|analysis) (?:asks|examines|assesses|evaluates|addresses))\b",
    re.IGNORECASE)
_DIR_DOWN_RE = re.compile(r"\b(?:reduc\w*|decreas\w*|lower(?:ed|ing|s)?|declin\w*)\b",
                          re.IGNORECASE)
_DIR_UP_RE = re.compile(r"\b(?:increas\w*|higher|elevat\w*|greater)\b", re.IGNORECASE)
_SIG_NEG_RE = re.compile(r"\b(?:not|no|without)\s+significan\w*|\bnon-?significan\w*",
                         re.IGNORECASE)
_SIG_RE = re.compile(r"\bsignificant(?:ly)?\b", re.IGNORECASE)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")

NUMBER_GATE_SECTIONS = {"abstract", "results"}
CLAIM_GATE_SECTIONS = {"abstract", "results", "discussion"}
# Composite CI fields resolve when the run carries both bounds (tokens.md).
CI_ALIASES = {"ci", "ci95", "confidence_interval", "confidenceinterval"}


class GateError(Exception):
    code = "gate_failed"

    def __init__(self, violations):
        self.violations = violations
        super().__init__("gate_failed: " + ", ".join(
            sorted({v["gate"] for v in violations})))


def _mask_tokens(text: str) -> str:
    return TOKEN_RE.sub(lambda m: " " * len(m.group(0)), text)


def _allowed_numbers(text: str) -> set:
    allowed = set()
    for pattern in (_REVIEWER_COUNT_RE, _THRESHOLD_RE, _EXPONENT_RE):
        for match in pattern.finditer(text):
            for num in _NUMBER_RE.finditer(match.group(0)):
                allowed.add((match.start() + num.start(), match.start() + num.end()))
    return allowed


def check_numbers(sections, token_table) -> list:
    violations = []
    for section in sections:
        sid = str(section.get("id", "")).lower()
        heading = str(section.get("heading", "")).lower()
        text = section.get("text", "")
        gated = any(k in sid or k in heading for k in NUMBER_GATE_SECTIONS)
        masked = _mask_tokens(text)
        allowed = _allowed_numbers(text) if gated else set()
        if gated:
            for match in _NUMBER_RE.finditer(masked):
                raw = match.group(0)
                span = (match.start(), match.end())
                if _YEAR_RE.match(raw) or span in allowed:
                    continue
                violations.append({"gate": "untokenised_number", "section": sid or heading,
                                   "start": match.start(), "end": match.end(),
                                   "number": raw})
        for match in TOKEN_RE.finditer(text):
            run_id, field = match.group(1), match.group(2)
            key = f"{run_id}.{field}"
            if key in token_table:
                continue
            if (field.lower() in CI_ALIASES
                    and f"{run_id}.ciLower" in token_table
                    and f"{run_id}.ciUpper" in token_table):
                continue
            violations.append({"gate": "unknown_token", "section": sid or heading,
                               "token": match.group(0)})
        for match in LOOSE_TOKEN_RE.finditer(text):
            if TOKEN_RE.fullmatch(match.group(0)) is None:
                violations.append({"gate": "malformed_token", "section": sid or heading,
                                   "token": match.group(0)})
    return violations


def _manifest_identifiers(manifest) -> set:
    ids = set()
    for ref in (manifest or {}).get("references") or []:
        for field in ("doi", "pmid"):
            if ref.get(field):
                ids.add(str(ref[field]).lower())
    for study in (manifest or {}).get("evidence") or []:
        src = study.get("source") or {}
        for field in ("doi", "pmid"):
            if src.get(field):
                ids.add(str(src[field]).lower())
    return ids


def _entry_identifiers(entry) -> tuple:
    ext = entry.get("externalIds") or {}
    doi = entry.get("doi") or ext.get("DOI") or ""
    pmid = entry.get("pmid") or ext.get("PMID") or ""
    return str(doi), str(pmid)


def check_citations(sections, citation_map, manifest=None) -> list:
    violations = []
    manifest_ids = _manifest_identifiers(manifest)
    refs_by_key = {r["key"]: r for r in (manifest or {}).get("references") or []
                   if r.get("key")}
    for section in sections:
        sid = str(section.get("id", "")).lower()
        for match in _CITE_RE.finditer(section.get("text", "")):
            keys = match.group(1) or match.group(2)
            for key in [k.strip() for k in keys.split(",") if k.strip()]:
                entry = (citation_map or {}).get(key) or refs_by_key.get(key)
                if entry is None:
                    violations.append({"gate": "unresolved_citation", "section": sid,
                                       "key": key, "reason": "not_in_library"})
                    continue
                doi, pmid = _entry_identifiers(entry)
                if not doi and not pmid:
                    violations.append({"gate": "unresolved_citation", "section": sid,
                                       "key": key, "reason": "no_doi_or_pmid"})
                    continue
                if manifest_ids and not (
                        doi.lower() in manifest_ids or pmid.lower() in manifest_ids):
                    violations.append({"gate": "unresolved_citation", "section": sid,
                                       "key": key, "reason": "not_in_manifest"})
    return violations


def _sentences(text):
    return [s for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def check_claim_links(sections) -> list:
    violations = []
    for section in sections:
        sid = str(section.get("id", "")).lower()
        heading = str(section.get("heading", "")).lower()
        if not any(k in sid or k in heading for k in CLAIM_GATE_SECTIONS):
            continue
        for sentence in _sentences(section.get("text", "")):
            if not _CLAIM_RE.search(sentence):
                continue
            if _WHETHER_RE.search(sentence) or _OBJECTIVE_RE.search(sentence):
                continue
            if TOKEN_RE.search(sentence) or _CITE_RE.search(sentence):
                continue
            violations.append({"gate": "claim_without_source", "section": sid,
                               "sentence": sentence[:120]})
    return violations


def _run_field(token_table, run_id, field):
    entry = token_table.get(f"{run_id}.{field}")
    return entry["value"] if entry else None


def check_direction(sections, token_table) -> list:
    violations = []
    for section in sections:
        sid = str(section.get("id", "")).lower()
        for sentence in _sentences(section.get("text", "")):
            run_ids = {m.group(1) for m in TOKEN_RE.finditer(sentence)}
            if not run_ids:
                continue
            down, up = _DIR_DOWN_RE.search(sentence), _DIR_UP_RE.search(sentence)
            sig_neg = _SIG_NEG_RE.search(sentence)
            sig = _SIG_RE.search(sentence)
            for run_id in sorted(run_ids):
                entry = next((e for k, e in token_table.items()
                              if e["runId"] == run_id), None)
                if entry is None:
                    continue
                null = entry["null"]
                estimate = _run_field(token_table, run_id, "estimate")
                if estimate is not None and (down or up):
                    if down and not estimate < null:
                        violations.append({"gate": "direction_mismatch", "section": sid,
                                           "runId": run_id, "word": down.group(0),
                                           "estimate": estimate, "null": null})
                    if up and not estimate > null:
                        violations.append({"gate": "direction_mismatch", "section": sid,
                                           "runId": run_id, "word": up.group(0),
                                           "estimate": estimate, "null": null})
                if sig:
                    lo = _run_field(token_table, run_id, "ciLower")
                    hi = _run_field(token_table, run_id, "ciUpper")
                    if lo is None or hi is None:
                        continue
                    excludes = lo > null or hi < null
                    if sig_neg and excludes:
                        violations.append({"gate": "significance_mismatch", "section": sid,
                                           "runId": run_id, "claim": "not significant",
                                           "ci": [lo, hi], "null": null})
                    elif not sig_neg and not excludes:
                        violations.append({"gate": "significance_mismatch", "section": sid,
                                           "runId": run_id, "claim": "significant",
                                           "ci": [lo, hi], "null": null})
    return violations


def run_gates(sections, token_table, citation_map=None, manifest=None) -> list:
    violations = []
    violations += check_numbers(sections, token_table)
    violations += check_citations(sections, citation_map, manifest)
    violations += check_claim_links(sections)
    violations += check_direction(sections, token_table)
    return violations


def check_paper(text, token_table, citation_map=None, manifest=None) -> list:
    """Gate a whole draft (LaTeX or plain text) by splitting it into sections."""
    sections = parse_latex_sections(text)
    if not sections:
        sections = [{"id": "results", "heading": "Results", "text": text}]
    return run_gates(sections, token_table, citation_map, manifest)


def enforce(sections, token_table, citation_map=None, manifest=None) -> None:
    violations = run_gates(sections, token_table, citation_map, manifest)
    if violations:
        raise GateError(violations)
