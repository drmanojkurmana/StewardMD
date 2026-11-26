"""Shared PHI gate vectors (contracts/phase-3/phi-vectors.json).

The SAME file is run by test/research-phase3-api.test.mjs against the JS
port (functions/api/research/_phi.js) and here against phi.py, so the two
gates cannot drift: every expect=block case must block with the named
category present, every expect=allow case must pass, and hit positions must
be identical in both implementations (the JS test asserts the same).
A vector may carry "mode": "user"; it is scanned with mode="user" in both
gates (the plain any-full-date rule). Vectors without a mode use the default
literature-safe scan.

All identifiers in the vector file are synthetic. The full 200-case
synthetic set and the 25-PDF clean set belong to the 3.9 benchmark; this
file is the shared cross-language pin.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from paperorchestra.adapter.po_adapter import phi

VECTORS = (
    Path(__file__).resolve().parents[3]
    / "docs" / "research" / "contracts" / "phase-3" / "phi-vectors.json"
)


def _cases():
    return json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]


def test_vector_file_exists_and_is_substantial():
    cases = _cases()
    assert len(cases) >= 90
    assert sum(c["expect"] == "block" for c in cases) >= 50
    assert sum(c["expect"] == "allow" for c in cases) >= 30


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["id"])
def test_shared_vector(case):
    report = phi.scan(case["text"], mode=case.get("mode", "default"))
    if case["expect"] == "block":
        assert report["blocked"], f"{case['id']} must block: {case['text']}"
        if not case["category"].startswith("near_miss"):
            assert any(h["category"] == case["category"] for h in report["hits"]), (
                f"{case['id']} must hit category {case['category']}"
            )
        # Hits never carry the matched text (categories only).
        for hit in report["hits"]:
            assert set(hit) == {"category", "rule", "start", "end"}
    else:
        assert not report["blocked"], (
            f"{case['id']} must pass: {case['text']} hits {report['hits']}"
        )


def test_every_blocked_category_covered():
    cats = {c["category"] for c in _cases() if c["expect"] == "block"}
    for want in ("mrn", "aadhaar", "ssn", "nhs", "phone", "email", "dob",
                 "address", "patient_name", "admission_date"):
        assert want in cats, f"category covered: {want}"


def test_checksum_gating_is_the_false_positive_control():
    # A 12-digit number failing Verhoeff is not an Aadhaar hit; a 10-digit
    # number failing mod-11 is not an NHS hit (phi-gate.md).
    good = "12345678901" + str(phi.verhoeff_check_digit("12345678901"))
    bad = good[:-1] + str((int(good[-1]) + 1) % 10)
    assert phi.scan("Aadhaar " + good)["blocked"]
    assert not phi.scan("Accession " + bad)["blocked"]
    assert not phi.scan("Sample id 1234567890")["blocked"]
