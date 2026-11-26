"""Deterministic PHI/PII gate, per docs/research/contracts/phase-3/phi-gate.md.

scan(text) -> {"blocked": bool, "hits": [{"category", "rule", "start", "end"}]}
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
    r"\b(?:patient|patients|Mr\.|Mrs\.|Ms\.|admitted|discharged|diagnosed"
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
    # Any day-level date blocks on its own. Month-year and bare years stay
    # allowed (enrolment periods, study dates).
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


def _mrn_id_ok(match: re.Match) -> bool:
    value = match.group(1)
    return any(ch.isdigit() for ch in value) and 4 <= len(value) <= 16


_VALIDATORS = {
    "mrn_id": _mrn_id_ok,
    "verhoeff": lambda m: verhoeff_valid(re.sub(r"[ -]", "", m.group(0))),
    "mod11": lambda m: nhs_mod11_valid(m.group(0)),
    "birth_context": lambda m: _near(m.string, m.start(), m.end(),
                                     re.compile(_BIRTH_LABEL, re.IGNORECASE)),
    "name_context": lambda m: _near(m.string, m.start(), m.end(),
                                    re.compile(_PATIENT_LABEL, re.IGNORECASE)),
    "admission_context": lambda m: (
        _near(m.string, m.start(), m.end(), re.compile(_ADMISSION_LABEL, re.IGNORECASE))
        and re.search(_PATIENT_LABEL, _same_sentence(m.string, m.start(), m.end()),
                      re.IGNORECASE) is not None
    ),
}


def scan(text: str) -> dict:
    """Scan the exact assembled prompt text. Any hit blocks the call."""
    hits = []
    seen = set()
    for category, rule, pattern, validator in _RULES:
        for match in pattern.finditer(text):
            if validator is not None and not _VALIDATORS[validator](match):
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
