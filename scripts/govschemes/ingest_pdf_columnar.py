#!/usr/bin/env -S uv run --with pdfplumber --script
"""StewardMD — Government Health Schemes: header-position-aware PDF table adapter.

The successor to ingest_layout_pdf.py's "Nth numeric token" heuristic, which this session
found unsafe on Punjab, Himachal, and Odisha: whenever a row's Stratification/Implant/LOS
columns can ALSO render a bare number (a price band like "100000 - 500000", an implant cost
"ASD Device - 62000", or a plain LOS day-count), counting numeric tokens by ordinal position
picks the wrong one on some rows and the right one on others, unpredictably.

This adapter instead reads real per-word bounding boxes via pdfplumber (not `pdftotext`'s
space-approximated columns) and assigns every data-row word to a column by X-POSITION against
column boundaries derived from the PDF's own header row — the same technique a human reading
the table visually would use, and the only one immune to a stray number matching by coincidence.

WHY THIS WORKS WHERE COUNTING DOESN'T: two "7,000" values can sit in a Punjab row (Procedure
Price AND Total Package Price happen to be equal for a no-addon procedure) - counting numeric
tokens can't tell them apart, but their X-positions are on opposite sides of the page and never
collide with the OTHER real column's position, verified against the source PDF's own printed
values (functions/db/govschemes_verified_sources_batch2.md's recorded samples).

HOW COLUMN BOUNDARIES ARE FOUND (read before reusing on a new PDF):
  1. Every header column in these PDFs is rendered TWICE at different y-offsets on the page:
     once letter-spaced/rotated (illegible as words — pdfplumber splits it into 1-3 char
     fragments) and once as normal, cleanly-spaced words. Locate the clean rendering by
     searching for the operator-given --rate-header phrase (e.g. "Total Package Price") as an
     exact adjacent-word sequence (same `top`, increasing x0, small gaps) - never guessed by
     picking "a" header line, the phrase itself proves it's the right one.
  2. Once found, ALL words sharing that same `top` (within tolerance) are the OTHER column
     headers on that clean line - sorted by x0, they give the full column layout for the page.
  3. A column's assignment range is the MIDPOINT to its immediate neighbours on each side (not
     its own label's bounding box) - a right-aligned number is often wider than its header
     label and extends past the label's own edge; the midpoint rule is what correctly separates
     the two "7,000"s above (466.7 falls in the Procedure-Price bucket, 677.7 in Total-Package-
     Price's, verified against exact coordinates before this script existed).
  4. Column layout is derived per page (defensive - a scanned/rotated page could differ) but
     reuses the last successfully-found layout as a fallback, since in every PDF checked so far
     it's identical on every page.

WHAT'S STILL A HEURISTIC (documented, not hidden): treatment_name is reconstructed from words
whose x-center falls in the "Procedure Name" column's boundary (the column immediately after
Procedure Code) - both on the code's own physical line AND on codeless continuation lines
whose leftmost word also falls in that SAME x-range (filters out the trailing Y/N-flag and
leading page-header leakage that polluted ingest_layout_pdf.py's output, since those sit at
DIFFERENT x-positions than the actual name column). package_amount, by contrast, is read only
from the code's own physical line - never guessed from a continuation line - because the rate
always prints on the same line as its code in every source checked so far; if that's ever not
true for a new PDF, this script reports 0 matches for that row rather than guess.

Usage:
  ingest_pdf_columnar.py FILE --jurisdiction punjab --scheme-id punjab-sha-hbp \\
    --scheme-name "..." --authority "..." --version-label "HBP 2.2" \\
    --rate-header "Total Package Price" --rate-tier "Total Package Price" \\
    --source-url "https://..." [--pages 1-50] > out.sql
"""
import sys, re, time, random, hashlib, argparse, pathlib
import pdfplumber

CODE_RE = re.compile(r'^[A-Z]{2}[0-9]{3}[A-Z]$')
AMT_RE = re.compile(r'^[0-9]+(\.[0-9]+)?$')
TOP_TOL = 1.5   # points; words on "the same physical line" of a clean header


def sql_str(s):
    return "'" + str(s if s is not None else "").replace("'", "''") + "'"


def new_id(prefix):
    return f"{prefix}{int(time.time()*1000):x}{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))}"


def find_header_line(words, phrase):
    """Locate `phrase` (e.g. "Total Package Price") as an exact sequence of adjacent words
    sharing one `top` value. Returns (top, [word,...]) for every word sharing that top,
    sorted by x0 - the full column layout for this page - or None if not found."""
    target = phrase.split()
    by_top = {}
    for w in words:
        by_top.setdefault(round(w['top'] * 2) / 2, []).append(w)
    for top, ws in by_top.items():
        ws = sorted(ws, key=lambda w: w['x0'])
        texts = [w['text'] for w in ws]
        for i in range(len(texts) - len(target) + 1):
            if texts[i:i + len(target)] == target:
                # confirm they're contiguous (small x-gaps, not coincidentally-matching text
                # scattered across the line)
                seq = ws[i:i + len(target)]
                gaps_ok = all(seq[j + 1]['x0'] - seq[j]['x1'] < 15 for j in range(len(seq) - 1))
                if gaps_ok:
                    return top, ws
    return None


def build_columns(header_words):
    """header_words: all words on the clean header line, sorted by x0. Returns a list of
    (label_words_start_idx_is_unused, x0, x1, midpoint_left, midpoint_right) — actually
    returns a list of dicts: {"x0","x1","left_bound","right_bound"} per DISTINCT column
    (adjacent words with a small gap are merged into one column label, e.g. "Total"+"Package"+
    "Price"). Multi-word labels are merged by small-gap adjacency, same rule as find_header_line."""
    cols = []
    cur = [header_words[0]]
    for w in header_words[1:]:
        if w['x0'] - cur[-1]['x1'] < 15:
            cur.append(w)
        else:
            cols.append(cur)
            cur = [w]
    cols.append(cur)
    out = []
    for c in cols:
        out.append({"label": " ".join(x['text'] for x in c), "x0": c[0]['x0'], "x1": c[-1]['x1']})
    for i, c in enumerate(out):
        c["left_bound"] = -1e9 if i == 0 else (out[i - 1]["x1"] + c["x0"]) / 2
        c["right_bound"] = 1e9 if i == len(out) - 1 else (c["x1"] + out[i + 1]["x0"]) / 2
    return out


def smart_join(word_objs):
    """Reconstruct real words from a sorted-by-x0 list of pdfplumber word dicts, where some
    genuine words got split into 1-3 char fragments by an inconsistent letter-tracking pass
    this PDF applies to SOME wrapped body text (confirmed by measurement, not assumed): a
    fragment boundary within one real word has essentially zero gap (touching/overlapping,
    <0.5pt, often negative), while a genuine word-boundary gap is consistently ~1pt. Below
    0.5pt: concatenate with no space. At or above: join with a space."""
    if not word_objs:
        return ""
    out = [word_objs[0]['text']]
    prev_x1 = word_objs[0]['x1']
    for w in word_objs[1:]:
        gap = w['x0'] - prev_x1
        if gap < 0.5:
            out[-1] = out[-1] + w['text']
        else:
            out.append(w['text'])
        prev_x1 = w['x1']
    return " ".join(out)


def col_for_x(cols, xc):
    for c in cols:
        if c["left_bound"] <= xc < c["right_bound"]:
            return c
    return None


def cluster_lines(words):
    """Group words into physical lines by `top`, tolerant of the small (~2-3pt) jitter seen
    within one visual line. Returns list of word-lists, each sorted by x0, in top-to-bottom
    order."""
    words = sorted(words, key=lambda w: (w['top'], w['x0']))
    lines, cur, cur_top = [], [], None
    for w in words:
        if cur_top is None or abs(w['top'] - cur_top) <= 2.5:
            cur.append(w)
            cur_top = w['top'] if cur_top is None else (cur_top + w['top']) / 2
        else:
            lines.append(sorted(cur, key=lambda x: x['x0']))
            cur, cur_top = [w], w['top']
    if cur:
        lines.append(sorted(cur, key=lambda x: x['x0']))
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--jurisdiction", required=True)
    ap.add_argument("--scheme-id", required=True)
    ap.add_argument("--scheme-name", required=True)
    ap.add_argument("--authority", default="")
    ap.add_argument("--version-label", required=True)
    ap.add_argument("--rate-header", required=True,
                     help="EXACT header phrase for the price column, e.g. 'Total Package Price'")
    ap.add_argument("--rate-tier", required=True, help="tier/ward label stored verbatim on every row")
    ap.add_argument("--code-header", required=True,
                     help="EXACT header phrase for the procedure-code column, e.g. 'Procedure Code' "
                          "- used only to find the LEFT edge of the name gap (the name label itself "
                          "may not render as clean words - see script docstring)")
    ap.add_argument("--name-right-header", default="",
                     help="EXACT header phrase whose LEFT edge bounds the name gap on the right "
                          "(usually the price column, e.g. 'Procedure Price'); default: rate-header")
    ap.add_argument("--source-url", default="")
    ap.add_argument("--pages", default="", help="1-based inclusive page range, e.g. 1-50")
    a = ap.parse_args()

    p = pathlib.Path(a.file)
    pdf = pdfplumber.open(str(p))
    total_pages = len(pdf.pages)
    if a.pages:
        lo, hi = (int(x) for x in a.pages.split("-"))
        lo, hi = max(1, lo), min(total_pages, hi)
    else:
        lo, hi = 1, total_pages

    recs, seen, skipped_no_amount, skipped_no_header = [], set(), 0, 0
    last_cols, last_header_bottom = None, None
    pages_with_header, pages_without = 0, 0

    for pno in range(lo, hi + 1):
        page = pdf.pages[pno - 1]
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        found = find_header_line(words, a.rate_header)
        if found:
            header_top, header_words = found
            cols = build_columns(header_words)
            # This table's header is rendered as 2-3 STACKED lines a few points apart (one
            # clean, the others letter-spaced/rotated - see script docstring). Everything
            # within that stack is header, never row content, however far its individual
            # letter-fragments' x-position happens to land - so continuation search below must
            # never cross above this y-line, or the header text itself gets read as a name.
            header_region = [w for w in words if abs(w['top'] - header_top) <= 8]
            header_bottom = max((w['bottom'] for w in header_region), default=header_top)
            pages_with_header += 1
        elif last_cols is not None:
            cols, header_bottom = last_cols, last_header_bottom
            pages_without += 1
        else:
            skipped_no_header += 1
            continue
        last_cols, last_header_bottom = cols, header_bottom

        rate_col = None
        for c in cols:
            if c["label"] == a.rate_header:
                rate_col = c
                break
        if rate_col is None:
            skipped_no_header += 1
            continue

        # The "Procedure Name" column has no clean header rendering in these PDFs (it only
        # appears on the letter-spaced/fragmented header line - see script docstring), so its
        # boundary is derived as the RAW GAP between two columns that DO render cleanly: the
        # code column's own right edge, and the rate-neighbouring column's own left edge. This
        # is deliberately NOT the shared midpoint used elsewhere (that would only give the name
        # column half of its actual width, splitting it with its neighbours).
        code_hdr_col = next((c for c in cols if c["label"] == a.code_header), None)
        name_right_label = a.name_right_header or a.rate_header
        name_right_col = next((c for c in cols if c["label"] == name_right_label), None)
        name_region = None
        if code_hdr_col and name_right_col:
            name_region = (code_hdr_col["x1"], name_right_col["x0"])

        def in_name_region(w):
            if not name_region:
                return False
            xc = (w['x0'] + w['x1']) / 2
            return name_region[0] <= xc < name_region[1]

        lines = cluster_lines(words)
        for i, line in enumerate(lines):
            code_word = next((w for w in line if CODE_RE.match(w['text'])), None)
            if not code_word:
                continue
            treatment_code = code_word['text']

            # package_amount: words on THIS SAME physical line only, in rate_col's x-range
            amt_words = [w['text'] for w in line
                         if rate_col["left_bound"] <= (w['x0'] + w['x1']) / 2 < rate_col["right_bound"]]
            amt_text = "".join(amt_words).replace(",", "")
            if not AMT_RE.match(amt_text) or amt_text == "":
                skipped_no_amount += 1
                continue
            amount = int(round(float(amt_text)))

            # treatment_name: words in the name gap on THIS line, plus codeless continuation
            # lines both BEFORE and AFTER it. Genuinely ambiguous in this source (confirmed by
            # inspection, not assumed): a long name can wrap onto lines BOTH above AND below its
            # own code line for the SAME row (e.g. BM001A: "% Total Body Surface Area Burns
            # (TBSA) - any %" prints above the code, "(not requiring admission). Needs at least
            # 5-6 dressing" prints below it) - so there is no position-only rule that always
            # draws the boundary against a neighbouring row's own wrap correctly; multi-line
            # names may include a few words of the adjacent row's text. package_amount is NOT
            # affected (read only from the code's own line, never from a continuation line).
            name_parts = [smart_join([w for w in line if in_name_region(w)])]
            j = i + 1
            while j < len(lines) and not any(CODE_RE.match(w['text']) for w in lines[j]):
                extra = smart_join([w for w in lines[j] if in_name_region(w)])
                if extra:
                    name_parts.append(extra)
                j += 1
            before = []
            k = i - 1
            while (k >= 0 and lines[k][0]['top'] > header_bottom
                   and not any(CODE_RE.match(w['text']) for w in lines[k])):
                extra = smart_join([w for w in lines[k] if in_name_region(w)])
                if extra:
                    before.insert(0, extra)
                k -= 1
            name_parts = before + name_parts
            treatment_name = " ".join(p for p in name_parts if p).strip()

            key = treatment_code
            if key in seen:
                continue
            seen.add(key)
            recs.append({"treatment_code": treatment_code, "treatment_name": treatment_name,
                         "package_amount": amount})

    if not recs:
        sys.exit(f"no rows parsed (pages_with_header={pages_with_header} "
                 f"pages_without={pages_without} skipped_no_header={skipped_no_header})")

    canon = "\n".join("|".join([r["treatment_code"], r["treatment_name"], str(r["package_amount"])])
                      for r in recs)
    content_hash = hashlib.sha256(canon.encode()).hexdigest()
    now = int(time.time() * 1000)
    src, svid = new_id("gssrc"), new_id("sv")

    o = ["-- Generated by scripts/govschemes/ingest_pdf_columnar.py -- DO NOT HAND-EDIT.",
         f"-- Source: {p.name} rate_header={a.rate_header!r} tier={a.rate_tier!r}",
         f"-- {len(recs)} procedures ({skipped_no_amount} rows dropped: no numeric value in the "
         f"rate column's x-range; {skipped_no_header} pages skipped: no header found and no prior "
         f"page's column layout to fall back on), content_hash={content_hash}",
         f"-- pages_with_own_header={pages_with_header} pages_using_fallback_layout={pages_without}",
         ""]
    o.append(f"INSERT OR IGNORE INTO schemes (id, jurisdiction_id, name, authority, status) VALUES "
             f"({sql_str(a.scheme_id)}, {sql_str(a.jurisdiction)}, {sql_str(a.scheme_name)}, {sql_str(a.authority)}, 'active');")
    o.append(f"INSERT INTO sources (id, jurisdiction_id, authority, url, homepage, document_type, "
             f"document_date, retrieved_ts, verification_status, enabled, created_ts) VALUES "
             f"({sql_str(src)}, {sql_str(a.jurisdiction)}, {sql_str(a.authority)}, {sql_str(a.source_url)}, "
             f"'', 'pdf', '', {now}, 'unverified', 1, {now});")
    o.append(f"INSERT INTO scheme_versions (id, scheme_id, version_label, source_id, effective_date, "
             f"content_hash, status, published_ts, created_ts) VALUES ({sql_str(svid)}, {sql_str(a.scheme_id)}, "
             f"{sql_str(a.version_label)}, {sql_str(src)}, '', {sql_str(content_hash)}, 'draft', 0, {now});")
    o.append("")

    cols_sql = "id, scheme_version_id, treatment_code, treatment_name, package_amount, rate_tier"
    vals = [f"({sql_str(new_id('pkg'))}, {sql_str(svid)}, {sql_str(r['treatment_code'])}, "
            f"{sql_str(r['treatment_name'])}, {r['package_amount']}, {sql_str(a.rate_tier)})"
            for r in recs]
    CHUNK = 50
    for i in range(0, len(vals), CHUNK):
        o.append(f"INSERT INTO packages ({cols_sql}) VALUES\n" + ",\n".join(vals[i:i + CHUNK]) + ";")
    o.append("")
    o.append(f"INSERT INTO crawl_logs (id, ts, source_id, status, detail, rows_in, rows_out) VALUES "
             f"({sql_str(new_id('cl'))}, {now}, {sql_str(src)}, 'new', "
             f"{sql_str('ingest_pdf_columnar.py ' + p.name + ' rate_header=' + a.rate_header)}, "
             f"{len(recs) + skipped_no_amount}, {len(recs)});")
    print("\n".join(o))
    print(f"-- {a.jurisdiction}: {len(recs)} procedures ({skipped_no_amount} no-amount dropped) "
          f"@ {a.rate_tier} [pages_with_header={pages_with_header} fallback={pages_without}]",
          file=sys.stderr)


if __name__ == "__main__":
    main()
