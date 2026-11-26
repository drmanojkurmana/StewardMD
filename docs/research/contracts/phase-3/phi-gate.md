# ResearchMD Phase 3 PHI/PII gate (3.0)

Plan rule 10: no identifiable or patient-level data goes to an external LLM.
The gate is deterministic code (regex plus checksum validators). No LLM ever
decides whether text is PHI; an LLM judging PHI would itself receive the PHI.

Interface (implemented in 3.5, shared by the API and the worker):

```
scan(text) -> { blocked: bool, hits: [ { category, rule, start, end } ] }
```

`scan` runs on the exact text about to leave for the gateway, after assembly
of the prompt. Any hit blocks the call; the job fails with `phi_blocked` and
the hit categories (never the matched text) are logged.

## Blocked (patient identifiers)

| Category | Detection |
|---|---|
| Patient name with clinical context | capitalized name bigram/trigram within 40 chars of a patient label or clinical verb: `patient`, `Mr.`, `Mrs.`, `Ms.`, `admitted`, `discharged`, `diagnosed`, `ward`, `bed no`, `IP no`, `OP no` |
| MRN / UHID / hospital number | label (`MRN`, `UHID`, `medical record`, `hospital no`, `IP/OP no`) followed by 4-16 digits or alphanumeric id |
| Aadhaar | 12 digits (optionally spaced 4-4-4) passing the Verhoeff checksum |
| ABHA | 14-digit ABHA number as `XX-XXXX-XXXX-XXXX` (hyphen or space separators), or 14 unbroken digits with an `ABHA` label; ABHA address `name@abdm` or `name@sbx` |
| SSN | `XXX-XX-XXXX` with valid area (not 000/666/9xx), group (not 00), serial (not 0000) |
| NHS number | 10 digits passing the mod-11 checksum |
| Phone | Indian mobile (10 digits starting 6-9, optional +91/0 prefix), the spaced form `98765 43210` (also shown with a hyphen), or E.164 `+` number, with word-boundary checks so DOIs and page ranges do not match |
| Email | standard addr-spec regex |
| Any day-level date | full date in a common format (`12/03/2021`, `2024-03-12`, `12 March 2024`, `March 12, 2024`) anywhere in the text, with or without a label. Month-year (`Jan 2023`) and bare years stay allowed |
| Exact date of birth | full date (any common format) within 40 chars of `DOB`, `date of birth`, `born on`, `birth date` |
| Address | street number plus street token (`road`, `street`, `nagar`, `colony`, `lane`, `avenue`, `apt`, `flat`) within one line, a house label plus number (`H.No`, `House No`, `Flat`, `Door No`, `D.No`, `#`), or a 6-digit PIN code with an address label |
| Admission date tied to a person | full date within 40 chars of `admitted on`, `admission date`, `discharged on` AND a patient label in the same sentence |

Checksum validators run first and gate the regex hits: a 12-digit number that
fails Verhoeff is not an Aadhaar hit (it may be an accession number). This is
the main false-positive control.

## Allowed (published-paper content)

- Author names in bylines and citation strings (`FirstAuthor et al`, author
  lists before an affiliation block).
- Affiliations, department and hospital names, city names without a street
  address.
- Enrolment periods and study dates (`between January 2018 and March 2020`,
  `enrolled from 2015 to 2019`): month-year or year ranges without a day.
  A day-level date is never allowed, so `enrolled Jan 2023 to Mar 2024` passes
  while `reviewed on 12/03/2021` blocks.
- Age brackets and summary ages (`aged 45-64 years`, `mean age 58.2`,
  `median 61 (IQR 52-70)`).
- Sample sizes, counts, DOIs, PMIDs, page ranges, trial registration numbers
  (NCT/CTRI ids), grant numbers.

Context rules implement the difference: a name is blocked only with a patient
label or clinical verb nearby; a birth or admission date additionally needs its
label. A day-level date blocks anywhere, on its own. Bare years, month-year
ranges and statistical numbers never match.

## Test sets and gates

Format: JSONL, one case per line, stored with the 3.9 benchmark:

```json
{ "id": "phi-001", "text": "Patient Ramesh Kumar, MRN 483920, admitted on 12/03/2024", "expect": "block", "category": "mrn", "note": "synthetic" }
{ "id": "clean-001", "text": "Smith J, Doe A. Hospital of Example, London. Enrolled between January 2018 and March 2020.", "expect": "allow", "category": "byline", "note": "clean paper excerpt" }
```

- Synthetic PHI set: at least 200 cases covering every blocked category,
  including near-misses (invalid checksums must NOT block on the id rule).
  All synthetic identifiers; never real patient data.
- Clean set: the 25 stratified PDFs from 3.9, full extracted text.

Gates (plan section 12, run in CI):

1. 100% of the synthetic PHI set blocked.
2. False-positive block rate under 2% on the clean 25-PDF set.

A rule change that moves either number is a reviewed contract change.

## Placement

- Mandatory: before every gateway call (API-side steps and worker-side steps).
- Defense in depth: the upload endpoint scans extracted text when a PDF is
  ingested and warns the uploader on hits; the hard block stays at the
  gateway boundary so published papers with incidental strings are not
  rejected at upload.
- pdf_extract (3.2) makes no LLM call, so the gate is not in its path; its
  output passes the gate in 3.5 before any suggestion call.