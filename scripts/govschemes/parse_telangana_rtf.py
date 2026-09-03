#!/usr/bin/env python3
"""StewardMD — Government Health Schemes: parse the Telangana Aarogyasri
"Surgery/Therapy List (Consolidated)" text (exported via `textutil -convert txt`
from a .rtf the owner supplied — the portal itself has no reachable package
master with codes+amounts, see functions/db/govschemes_verified_sources_batch1.md).

Line layout (one field per physical line, confirmed by inspection, NOT by guessing):
  Header block: title line, then 7 header-name lines (ICD CODE / SURGERY CODE /
  SYSTEM / PREAUTH EVIDENCE / CLAIM EVIDENCE / PACKAGE AMOUNT / RESERVED FOR
  GOVERNMENT), then a blank separator.

  After that, records run back-to-back with NO reliable separator between them
  (blank lines appear sometimes, inconsistently) so record boundaries are
  detected structurally, not by blank-line counting:

  - HEADING row (speciality or sub-heading, e.g. "S1"/"GENERAL SURGERY" or
    "S01.8"/"Varicose Veins"): 2 content lines (code, name) followed by up to
    3 blank/space-only lines and NO "Yes"/"No" terminator before the next
    code-looking line.
  - DATA row starting with a surgery code (matches ^S\\d, e.g. "S1.8.1"):
    ICD code column absent for this row. 6 fields: code, name, preauth,
    claim, amount, reserved(Yes/No).
  - DATA row starting with anything else (a numeric ICD code like "29.2", or
    "-" placeholder): 7 fields: icd_code, surgery_code, name, preauth,
    claim, amount, reserved(Yes/No).

Never guesses a field boundary past the terminator: a data row's 6th/7th
line MUST be exactly "Yes" or "No" (post-strip) or the record is rejected
and reported, not silently absorbed.

Emits: scripts/govschemes/parse_telangana_rtf.py <in.txt> <out.json>
  out.json: {"records": [...], "errors": [...], "headings": [...]}
Each record: {icd_code, treatment_code, treatment_name, preauth, claim,
  package_amount, reserved, speciality_code, speciality_name}
speciality_code/speciality_name come from the last-seen top-level heading
(code has no dot, e.g. "S1", "S7", "M2") that precedes the record.
"""
import sys, json, re

SCODE_RE = re.compile(r"^[SM]\d")  # surgical (S-) AND medical-management (M-) code families
TOPLEVEL_RE = re.compile(r"^[SM]\d+$")  # e.g. S1, S14, M2, M15 - no dot
YESNO = {"yes": "Yes", "no": "No"}


def is_blank(s):
    return s.strip() == ""


def main():
    in_path, out_path = sys.argv[1], sys.argv[2]
    raw = open(in_path, encoding="utf-8").read().split("\n")
    # drop trailing empty from final newline
    if raw and raw[-1] == "":
        raw.pop()

    # Skip title + 7-line header block + its separator.
    i = 0
    while i < len(raw) and raw[i].strip() != "SURGERY CODE":
        i += 1
    # rewind to consume the whole header block: ICD CODE .. RESERVED FOR GOVERNMENT
    # (SURGERY CODE is line 2 of that 7-line block; walk to end of block)
    while i < len(raw) and raw[i].strip() != "RESERVED FOR GOVERNMENT":
        i += 1
    i += 1  # past "RESERVED FOR GOVERNMENT"
    if i < len(raw) and is_blank(raw[i]):
        i += 1

    records, errors, headings = [], [], []
    cur_top_code, cur_top_name = "", ""

    def peek(idx):
        return raw[idx] if idx < len(raw) else None

    while i < len(raw):
        if is_blank(raw[i]):
            i += 1
            continue

        field_a = raw[i].strip()
        field_b = peek(i + 1)
        field_b = field_b.strip() if field_b is not None else None

        if field_b is None:
            errors.append({"at_line": i, "reason": "dangling field, no pair", "field_a": field_a})
            break

        # Heading detection: field_a/field_b are code+name, and the next up-to-3
        # lines are blank/space-only, with no Yes/No found in that window.
        c_idx = i + 2
        blanks = 0
        while c_idx + blanks < len(raw) and blanks < 3 and is_blank(peek(c_idx + blanks)):
            blanks += 1
        window = [peek(c_idx + k) for k in range(0, blanks)]
        looks_heading = blanks >= 1 and not any(
            (w is not None and w.strip().lower() in YESNO) for w in window
        )
        # A data row's field_a would be a code or numeric ICD code or "-"; a
        # heading's field_a is a bare S/M-number or dotted sub-code, field_b
        # is prose with no trailing Yes/No within 3 lines. Also require the
        # line right after the blanks NOT be a continuation of THIS record's
        # own evidence text (i.e. genuinely blank in source, already checked).
        if looks_heading:
            code, name = field_a, field_b
            top = TOPLEVEL_RE.match(code)
            if top:
                cur_top_code, cur_top_name = code, name
            headings.append({"code": code, "name": name, "top_level": bool(top)})
            i = c_idx + blanks
            if i < len(raw) and is_blank(raw[i]):
                i += 1
            continue

        # Data row. Decide 6-field vs 7-field by whether field_a is a surgery code.
        if SCODE_RE.match(field_a):
            icd_code = ""
            surgery_code = field_a
            name = field_b
            f_preauth = peek(i + 2)
            f_claim = peek(i + 3)
            f_amount = peek(i + 4)
            f_reserved = peek(i + 5)
            consumed = 6
        else:
            icd_code = field_a
            surgery_code = field_b
            name = peek(i + 2)
            f_preauth = peek(i + 3)
            f_claim = peek(i + 4)
            f_amount = peek(i + 5)
            f_reserved = peek(i + 6)
            consumed = 7

        if any(v is None for v in (name, f_preauth, f_claim, f_amount, f_reserved)):
            errors.append({"at_line": i, "reason": "truncated record", "field_a": field_a, "field_b": field_b})
            break

        reserved_norm = f_reserved.strip().lower()
        if reserved_norm not in YESNO:
            errors.append({
                "at_line": i, "reason": "reserved field not Yes/No — record shape mismatch",
                "field_a": field_a, "field_b": field_b, "raw_reserved": f_reserved,
            })
            # resync: advance one line and retry rather than cascading garbage
            i += 1
            continue

        amount_raw = f_amount.strip()
        amount_digits = re.sub(r"[^\d]", "", amount_raw)
        if amount_digits == "":
            errors.append({
                "at_line": i, "reason": "empty/non-numeric package amount",
                "surgery_code": surgery_code, "name": name, "raw_amount": amount_raw,
            })
            i += consumed
            continue

        records.append({
            "icd_code": icd_code,
            "treatment_code": surgery_code,
            "treatment_name": name.strip(),
            "preauth_evidence": f_preauth.strip(),
            "claim_evidence": f_claim.strip(),
            "package_amount": int(amount_digits),
            "reserved_for_government": YESNO[reserved_norm],
            "speciality_code": cur_top_code,
            "speciality_name": cur_top_name,
        })
        i += consumed
        if i < len(raw) and is_blank(raw[i]):
            i += 1

    out = {"records": records, "errors": errors, "headings": headings,
           "record_count": len(records), "error_count": len(errors)}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(f"records: {len(records)}  errors: {len(errors)}  headings: {len(headings)}", file=sys.stderr)
    if errors[:10]:
        print("first errors:", file=sys.stderr)
        for e in errors[:10]:
            print(" ", e, file=sys.stderr)


if __name__ == "__main__":
    main()
