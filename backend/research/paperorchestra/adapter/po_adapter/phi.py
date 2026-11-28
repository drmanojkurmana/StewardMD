"""Deterministic PHI/PII gate, per docs/research/contracts/phase-3/phi-gate.md.

scan(text, mode="default") -> {"blocked": bool, "hits": [{"category", "rule", "start", "end"}]}
The default mode is literature-safe: every rule EXCEPT the plain any-full-date
rule, so published search results with publicationDate pass. mode="user" adds
dates/full_date and is for text a person typed. Birth and admission dates stay
context-gated in both modes.
Hits never carry the matched text (callback/log rule: categories only).
No LLM is involved. Checksum validators gate the id regexes: a 12-digit number
that fails Verhoeff is not an Aadhaar hit, a 10-digit number that fails mod-11
is not an NHS hit. This is the main false-positive control.

This is the 3.7 stub implementation of the shared 3.5 gate: same interface,
same categories. When the shared gate lands, llm.py imports it from one place.
Known limitation (measured on the 25-PDF clean set in 3.9, not here): the
patient-name rule is the literal contract rule (capitalized bigram within 40
chars of a patient label), so a place name next to a clinical verb can hit.
"""
from __future__ import annotations

import re

# --- Verhoeff (Aadhaar) -----------------------------------------------------

_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]
_VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_valid(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def verhoeff_check_digit(digits: str) -> int:
    """Check digit for a 11-digit base; used by tests to build synthetic ids."""
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[(i + 1) % 8][int(ch)]]
    return _VERHOEFF_INV[c]


def nhs_mod11_valid(digits: str) -> bool:
    if len(digits) != 10 or not digits.isdigit():
        return False
    total = sum(int(digits[i]) * (10 - i) for i in range(9))
    check = 11 - (total % 11)
    if check == 11:
        check = 0
    if check == 10:
        return False
    return check == int(digits[9])


# --- patterns ---------------------------------------------------------------

_MONTH = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
# Full day-level dates in common formats. Month-year and bare years are NOT
# full dates (allowed: enrolment periods, study dates).
# Digit guards keep a date out of longer id runs (CTRI/2020/01/023456).
_FULL_DATE = (
    r"(?<!\d)(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"
    r"|\d{4}-\d{1,2}-\d{1,2}"
    rf"|\d{{1,2}}\s+{_MONTH}\s+\d{{2,4}}"
    rf"|{_MONTH}\s+\d{{1,2}},?\s+\d{{4}})(?!\d)"
)

_PATIENT_LABEL = (
    r"\b(?:patient|Mr\.|Mrs\.|Ms\.|admitted|discharged|diagnosed"
    r"|ward|bed no|IP no|OP no)\b"
)
_NAME_BIGRAM = r"\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?\b"
_BIRTH_LABEL = r"\b(?:DOB|date of birth|born on|birth date)\b"
_ADMISSION_LABEL = r"\b(?:admitted on|admission date|discharged on)\b"
_STREET = r"(?:road|street|nagar|colony|lane|avenue|apt|flat)"
# House label plus number, then a comma and a locality word: "H.No 12-3-45,
# Ameerpet", "#14, 2nd Cross". A bare label plus number ("Table #14",
# "Flat 5 patients") stays allowed. "Flat" must start with a capital F; the
# other labels keep the old case-insensitive forms by spelling both cases.
# The locality must start with a capital letter or a digit ordinal.
_HOUSE = (
    r"(?:\b(?:"
    r"[Hh]\.?\s?[Nn][Oo]\.?|[Hh]\s+[Nn][Oo]\.?|[Hh][Oo][Uu][Ss][Ee]\s+[Nn][Oo]\."
    r"|[Dd][Oo][Oo][Rr]\s+[Nn][Oo]\.?|[Dd]\.?\s?[Nn][Oo]\.?|F[Ll][Aa][Tt](?:\s+[Nn][Oo]\.?)?"
    r")[\s:.#-]*\d[A-Za-z0-9/-]*|#\s*\d[A-Za-z0-9/-]*)"
    r",\s*(?:[A-Z][A-Za-z]*|\d+(?:st|nd|rd|th)\b)"
)

_RULES = [
    # (category, rule, compiled regex, validator or None)
    ("mrn", "labelled_id", re.compile(
        r"\b(?:MRN|UHID|medical\s+record(?:\s+(?:no|number|#))?|hospital\s+no"
        r"|IP\s+no|OP\s+no|IP/OP\s+no)\b[\s:.#-]*([A-Za-z0-9-]{4,16})",
        re.IGNORECASE), "mrn_id"),
    ("aadhaar", "verhoeff_12", re.compile(
        r"(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)"), "verhoeff"),
    # ABHA address (client rule, phi-india.js) and 2-4-4-4 number forms.
    # Unbroken 14 digits count only when labelled ABHA.
    ("abha", "addr", re.compile(
        r"\b[A-Za-z0-9._-]{2,}@(?:abdm|sbx)\b", re.IGNORECASE), None),
    ("abha", "number_14", re.compile(
        r"(?<!\d)\d{2}[ -]\d{4}[ -]\d{4}[ -]\d{4}(?!\d)"), None),
    ("abha", "labelled_number", re.compile(
        r"\bABHA(?:\s*(?:No\.?|Number|ID))?\b[\s:.#-]*(\d{14})(?!\d)",
        re.IGNORECASE), None),
    ("ssn", "area_group_serial", re.compile(
        r"(?<!\d)(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)"), None),
    ("nhs", "mod11_10", re.compile(r"(?<!\d)\d{10}(?!\d)"), "mod11"),
    ("phone", "e164", re.compile(r"(?<![\w.])\+[1-9]\d{7,14}(?!\d)"), None),
    # "/" in the lookbehind keeps DOI suffixes (10.1234/6123456789) out.
    ("phone", "indian_mobile", re.compile(
        r"(?<![\w./])(?:\+91[ -]?|0)?[6-9]\d{9}(?![\dA-Za-z])"), None),
    # Spaced mobile: "98765 43210". Same guards as indian_mobile. The optional
    # separator also matches the unspaced form; scan() dedupes identical spans.
    ("phone", "indian_mobile_spaced", re.compile(
        r"(?<![\w./])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\dA-Za-z])"), None),
    ("email", "addr_spec", re.compile(
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), None),
    # Any day-level date blocks on its own in user mode only. Month-year and
    # bare years stay allowed (enrolment periods, study dates), and published
    # literature keeps the default exemption.
    ("dates", "full_date", re.compile(_FULL_DATE, re.IGNORECASE), None),
    ("dob", "date_near_birth_label", re.compile(_FULL_DATE, re.IGNORECASE), "birth_context"),
    ("address", "street_number", re.compile(
        rf"\b\d{{1,5}}[A-Za-z]?\s+(?:[A-Za-z]+\s+){{0,3}}{_STREET}\b",
        re.IGNORECASE), None),
    ("address", "house_locality", re.compile(_HOUSE), None),
    ("address", "pin_with_label", re.compile(
        r"\b(?:PIN\s*code|PIN|postal\s+code|zip\s*code)\D{0,10}(\d{6})\b",
        re.IGNORECASE), None),
    ("patient_name", "name_near_patient_label", re.compile(_NAME_BIGRAM), "name_context"),
    ("admission_date", "date_near_admission_label", re.compile(
        _FULL_DATE, re.IGNORECASE), "admission_context"),
]

_WINDOW = 40  # chars, per phi-gate.md
_USER_ONLY_RULES = {("dates", "full_date")}


def _near(text: str, start: int, end: int, label_re: re.Pattern) -> bool:
    lo = max(0, start - _WINDOW)
    hi = min(len(text), end + _WINDOW)
    return label_re.search(text[lo:hi]) is not None


def _same_sentence(text: str, start: int, end: int) -> str:
    lo = max(text.rfind(".", 0, start), text.rfind("!", 0, start),
             text.rfind("?", 0, start)) + 1
    stops = [text.find(ch, end) for ch in ".!?"]
    stops = [s for s in stops if s != -1]
    hi = min(stops) + 1 if stops else len(text)
    return text[lo:hi]


_HONORIFIC_RE = re.compile(r"\b(?:Mr|Mrs|Ms|Dr)$", re.IGNORECASE)
_END_PATIENT_RE = re.compile(r"\s+(?:Patient|Patients)$", re.IGNORECASE)
_LEAD_PATIENT_RE = re.compile(r"^(?:Patient|Patients)\s+", re.IGNORECASE)
_CITATION_MARKERS = (
    "--- INPUT: citation_map.json (Reference Library) ---",
    "--- CITATION MAP (Reference Truth) ---",
)


def _same_line_sentence(text: str, start: int, end: int) -> str:
    line_lo = max(text.rfind("\n", 0, start), text.rfind("\r", 0, start)) + 1
    candidates = [i for i in (text.find("\n", end), text.find("\r", end)) if i != -1]
    line_hi = min(candidates) if candidates else len(text)
    line = text[line_lo:line_hi]
    rel_start = start - line_lo
    rel_end = end - line_lo
    sent_lo = 0
    for idx in range(rel_start - 1, -1, -1):
        ch = line[idx]
        if ch in ".!?" and not (ch == "." and _HONORIFIC_RE.search(line[max(0, idx - 4):idx])):
            sent_lo = idx + 1
            break
    sent_hi = len(line)
    for idx in range(rel_end, len(line)):
        ch = line[idx]
        if ch in ".!?" and not (ch == "." and _HONORIFIC_RE.search(line[max(0, idx - 4):idx])):
            sent_hi = idx + 1
            break
    return line[sent_lo:sent_hi]


def _name_context_ok(match: re.Match) -> bool:
    phrase = match.group(0)
    if _END_PATIENT_RE.search(phrase):
        return False
    if _LEAD_PATIENT_RE.search(phrase):
        rest = _LEAD_PATIENT_RE.sub("", phrase).strip().split()
        if len(rest) < 2:
            return False
    text = match.string
    if not _near(text, match.start(), match.end(), re.compile(_PATIENT_LABEL, re.IGNORECASE)):
        return False
    return re.search(_PATIENT_LABEL, _same_line_sentence(text, match.start(), match.end()),
                     re.IGNORECASE) is not None


_CITATION_END_RE = re.compile(
    r"\n--- (?:INPUT:|CURRENT |EXPERIMENTAL |CONFERENCE |CITATION )"
)


def _citation_library_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for marker in _CITATION_MARKERS:
        pos = 0
        while pos < len(text):
            idx = text.find(marker, pos)
            if idx == -1:
                break
            tail_start = idx + len(marker)
            m = _CITATION_END_RE.search(text, tail_start)
            end = len(text) if m is None else m.start()
            spans.append((idx, end))
            pos = end + 1
    return spans


def _mrn_id_ok(match: re.Match) -> bool:
    value = match.group(1)
    return any(ch.isdigit() for ch in value) and 4 <= len(value) <= 16


_VALIDATORS = {
    "mrn_id": _mrn_id_ok,
    "verhoeff": lambda m: verhoeff_valid(re.sub(r"[ -]", "", m.group(0))),
    "mod11": lambda m: nhs_mod11_valid(m.group(0)),
    "birth_context": lambda m: _near(m.string, m.start(), m.end(),
                                     re.compile(_BIRTH_LABEL, re.IGNORECASE)),
    "name_context": _name_context_ok,
    "admission_context": lambda m: (
        _near(m.string, m.start(), m.end(), re.compile(_ADMISSION_LABEL, re.IGNORECASE))
        and re.search(_PATIENT_LABEL, _same_sentence(m.string, m.start(), m.end()),
                      re.IGNORECASE) is not None
    ),
}


_ID_TOKEN_RE = re.compile(
    r"(?:\[?PMID\s*:?\s*\d+\]?|PMC\d+|DOI\s*:?\s*10\.[^\s,;)\]]+|NCT\d{8}|ISRCTN\d+|CTRI\/[^\s,;]+"
    r"|\b(?:rec|st|run|job|prj|srch|ddg|pdf|prot|aut|ma)_[A-Za-z0-9]+)",
    re.IGNORECASE,
)
_NUMERIC_CATEGORIES = {"nhs", "aadhaar", "abha", "ssn", "phone", "dob", "admission_date", "dates"}


def _identifier_spans(text: str) -> list[tuple[int, int]]:
    """Bibliographic ids are not patient ids; a ten-digit run inside a record
    id can pass the NHS checksum, so numeric rules skip these spans."""
    return [(m.start(), m.end()) for m in _ID_TOKEN_RE.finditer(text)]


def scan(text: str, mode: str = "default", allow_citation_library_names: bool = False) -> dict:
    """Scan the exact assembled prompt text. Any hit blocks the call.

    mode="user" adds the plain any-full-date rule; the default literature-safe
    mode omits it (owner decision A: published dates are not patient dates).
    """
    user_mode = mode == "user"
    cite_spans = _citation_library_spans(text) if allow_citation_library_names else []
    id_spans = _identifier_spans(text)
    hits = []
    seen = set()
    for category, rule, pattern, validator in _RULES:
        if not user_mode and (category, rule) in _USER_ONLY_RULES:
            continue
        for match in pattern.finditer(text):
            if validator is not None and not _VALIDATORS[validator](match):
                continue
            if category == "patient_name" and cite_spans and any(
                lo <= match.start() and match.end() <= hi for lo, hi in cite_spans
            ):
                continue
            if category in _NUMERIC_CATEGORIES and id_spans and any(
                lo <= match.start() and match.end() <= hi for lo, hi in id_spans
            ):
                continue
            # indian_mobile and indian_mobile_spaced overlap on the unspaced form.
            key = (category, match.start(), match.end())
            if key in seen:
                continue
            seen.add(key)
            hits.append({"category": category, "rule": rule,
                         "start": match.start(), "end": match.end()})
    hits.sort(key=lambda h: (h["start"], h["category"]))
    return {"blocked": bool(hits), "hits": hits}


class PhiBlockedError(Exception):
    """The job fails with code phi_blocked; only categories are logged."""

    code = "phi_blocked"

    def __init__(self, hits):
        self.categories = sorted({h["category"] for h in hits})
        super().__init__("phi_blocked: " + ",".join(self.categories))
