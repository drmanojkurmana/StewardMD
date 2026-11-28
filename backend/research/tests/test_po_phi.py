"""PHI gate tests (contracts/phase-3/phi-gate.md, plan section 12 gate).

Synthetic identifiers only. The 200-case synthetic set and the 25-PDF clean
set live with the 3.9 benchmark; this file proves the stub's rules, checksum
gating and the clean-paper allowance the 3.7 brief asks for.
"""
from __future__ import annotations

import pytest

from paperorchestra.adapter.po_adapter import phi


def valid_aadhaar() -> str:
    base = "12345678901"
    return base + str(phi.verhoeff_check_digit(base))


def invalid_aadhaar() -> str:
    good = valid_aadhaar()
    return good[:-1] + str((int(good[-1]) + 1) % 10)


def test_verhoeff_tables():
    assert phi.verhoeff_valid(valid_aadhaar())
    assert not phi.verhoeff_valid(invalid_aadhaar())


def test_nhs_mod11():
    assert phi.nhs_mod11_valid("9999999999")
    assert not phi.nhs_mod11_valid("1234567890")


def test_bibliographic_ids_are_not_patient_identifiers():
    # A ten-digit run inside a record id can pass the NHS checksum; the real
    # PaperOrchestra snapshot blocked on rec_86eaba4595964145...
    clean = ("rec_86eaba4595964145bafaaeae92d02357 | [SCREENED INCLUDE] "
             "Kashanian M et al. (2022) [PMID:35241023] doi 10.1080/07853890.2024.2389302")
    assert phi.scan(clean)["blocked"] is False
    assert phi.scan("NHS number 9999999999 for the patient")["blocked"] is True


SYNTHETIC_PHI = [
    ("Patient Ramesh Kumar, MRN 483920, admitted on 12/03/2024", {"mrn", "patient_name", "admission_date"}),
    ("UHID: AB123456 was reviewed.", {"mrn"}),
    ("medical record no 48392011", {"mrn"}),
    ("Contact the patient at +91 9876543210 today.", {"phone"}),
    ("Call 9876543210 for the ward.", {"phone"}),
    ("Phone +14155552671 after discharge.", {"phone"}),
    ("Email: ramesh.kumar@example.com", {"email"}),
    ("Aadhaar: " + valid_aadhaar(), {"aadhaar"}),
    ("Aadhaar " + valid_aadhaar()[:4] + " " + valid_aadhaar()[4:8] + " " + valid_aadhaar()[8:], {"aadhaar"}),
    ("SSN 123-45-6789 on file.", {"ssn"}),
    ("NHS number 9999999999", {"nhs"}),
    ("DOB: 12/03/1980", {"dob"}),
    ("The patient was born on 12 March 1980.", {"dob"}),
    ("Address: 12 MG Road, Bengaluru", {"address"}),
    ("PIN code: 560001", {"address"}),
    ("Mr. Ramesh Kumar was diagnosed with diabetes.", {"patient_name"}),
    ("The patient was admitted on 2024-03-12.", {"admission_date"}),
    ("Mrs. Asha Devi, bed no 12, discharged on 13/03/2024.", {"patient_name", "admission_date"}),
]


@pytest.mark.parametrize("text,categories", SYNTHETIC_PHI)
def test_synthetic_phi_blocked(text, categories):
    report = phi.scan(text)
    assert report["blocked"], text
    assert categories <= {h["category"] for h in report["hits"]}


CLEAN_TEXTS = [
    # Clean paper abstract: author bylines, hospitals, enrolment period, ages,
    # sample sizes, identifiers, page ranges. Must NOT block.
    ("Smith J, Doe A, Kumar R. Department of Cardiology, Hospital of Example, "
     "London. Background: Outcome Y is common. We enrolled adults between "
     "January 2018 and March 2020. Participants were aged 45-64 years "
     "(mean age 58.2, median 61, IQR 52-70). We included 1200 participants. "
     "The trial was registered as NCT01234567. DOI: 10.1000/example. "
     "PMID: 12345678. Pages 123-130."),
    "John Smith and Jane Doe wrote this paper about hospital care.",
    "enrolled from 2015 to 2019; follow-up until March 2020",
    "Accession 1234567890 and grant GR/2020/1234",
    "DOI 10.1234/6123456789 resolves to the article",
    # Near-misses: invalid checksums must not block on the id rule.
    "Aadhaar " + invalid_aadhaar(),
    "NHS 1234567890",
    "SSN 000-45-6789",
    "SSN 123-00-6789",
    "SSN 123-45-0000",
]


@pytest.mark.parametrize("text", CLEAN_TEXTS)
def test_clean_text_allowed(text):
    report = phi.scan(text)
    assert not report["blocked"], (text, report["hits"])


def test_hits_never_carry_matched_text():
    report = phi.scan("Patient Ramesh Kumar, MRN 483920")
    for hit in report["hits"]:
        assert set(hit) == {"category", "rule", "start", "end"}


def test_phi_blocked_error_categories_only():
    report = phi.scan("Email: ramesh.kumar@example.com, MRN 483920")
    err = phi.PhiBlockedError(report["hits"])
    assert err.code == "phi_blocked"
    assert err.categories == ["email", "mrn"]
    assert "ramesh" not in str(err).lower()


def test_invalid_checksum_not_aadhaar_but_other_rules_still_apply():
    # 12 invalid-checksum digits alone: allowed. With an MRN label: blocked.
    assert not phi.scan(invalid_aadhaar())["blocked"]
    assert phi.scan("MRN " + invalid_aadhaar()[:8])["blocked"]
