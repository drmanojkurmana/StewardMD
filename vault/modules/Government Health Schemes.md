---
tags: [module, data, clinical]
status: PHASE 1 in progress. **D1 provisioned 2026-09-02** (`stewardmd-govschemes`, id 2ad07897-93b7-424c-b1fc-e3d9643937f5, binding GOVSCHEMES_DB, region APAC) - schema + all 37 jurisdictions + the first real dataset (Dr. NTR Vaidya Seva Trust, Andhra Pradesh, 3713 packages) are LIVE and verified by remote query (exact-code lookup + FTS both working). **2026-09-03: API + UI + flag built and CDP-tested end to end** (fail-safe GET routes at `functions/api/schemes/[[path]].js`, `SMD_GOVSCHEMES` full-screen overlay, `smd_govt_schemes` flag) - see Key files below. Still OFF by default; admin review pass for Phase 1 hasn't run. See [[Decisions]] (2026-09-02).
flag: smd_govt_schemes - module master, default OFF (data unverified until Phase 1's review pass exists)
---
# Government Health Schemes

National database of India's government health-assurance schemes (28 states + 8 UTs + Central,
including PM-JAY) — every scheme's native package/code system, clinical mappings, rates,
eligibility, investigations, documentation, and source provenance, searchable by disease,
procedure, or government code. Three-phase build (see the owner's original spec, kept verbatim
in this session's transcript): Phase 1 foundation + data engine (this note's current scope),
Phase 2 national data + clinical crosswalk, Phase 3 production UI + maintenance.

**Read [[Decisions]] (2026-09-02 entry) before touching this module** — every schema/versioning
choice below traces back to that entry and the precedent it cites (Medical Updates, Drugs DB,
ONCQIS review).

## Key files
- `functions/db/govschemes_schema.sql` — the D1 schema (database `stewardmd-govschemes`, binding
  `GOVSCHEMES_DB`, not yet created remotely). `jurisdictions` / `sources` / `schemes` /
  `scheme_versions` / `packages` (+ `packages_fts` FTS5, triggers) / `crawl_logs` /
  `clinical_concepts` / `clinical_synonyms` / `concept_package_map` (Phase 2 shape, empty now).
- `functions/db/govschemes_seed_jurisdictions.sql` — 28 states + 8 UTs + Central, seeded once.
- `scripts/govschemes/ingest_ntr_vaidya_seva.py` — the first real ingestion adapter: parses the
  Dr. NTR Vaidya Seva Trust XLSX (raw zipfile+XML, NOT openpyxl - see gotcha below) into
  normalized `INSERT` SQL matching the schema above.
- `functions/_schemes_repo.js` + `functions/api/schemes/[[path]].js` — the read API (2026-09-03).
  GET-only, fail-safe (DB/binding error -> 200 + `{error:"unavailable"}`, never 5xx): `/jurisdictions`,
  `/search?q=&state=&limit=`, `/compare?q=`, `/package/<id>`. `rate_tier` is always carried alongside
  `package_amount` (safety-critical - amounts are only comparable with the tier visible).
- `govschemes.js` + `govschemes.css` + `govschemes-flags.js` — the UI: `window.SMD_GOVSCHEMES`
  full-screen overlay (search / state filter / cross-state compare / package detail), same pattern
  as the Drugs Database overlay in `api.js`. Every detail panel shows the source's
  `verification_status` and flags anything not literally `"verified"` with a visible amber warning.
- `test/govschemes-api.test.mjs` (unit, no D1) + `test/run-govschemes-ui.mjs` (real headless-Chrome
  CDP test against `wrangler pages dev` + local D1) — both green as of 2026-09-03.

## Design decisions worth knowing
- **Native codes are never altered.** `packages.treatment_code`/`speciality_code` store exactly
  what the government document says. A correction is a new `scheme_version`, never an in-place
  edit — see the schema file's own header comment.
- **Versioning is per scheme_version (one published document), not per package row.** These
  documents are issued as whole replacements, not incremental diffs.
- **Natural key is `(scheme_version_id, speciality_code, treatment_code)`, not treatment_code
  alone.** Confirmed against the real NTR dataset: 332 treatment codes are legitimately reused
  across different specialities with different amounts (e.g. `S11.36.3` under Cardiothoracic,
  ENT, and General Surgery). Don't "dedupe" these on import.
- **Admin review is currently the lighter Medical-Updates-style flow** (AI-assisted draft →
  human eyeballs it → single admin publish), not the two-gate ONCQIS accept/reject/edit/verify
  state machine. That's a deliberate Phase 1 trade-off, not the intended Phase 3 production
  review gate — see the Decisions entry's trade-off paragraph before shipping this to real users.

## Gotcha
The NTR Vaidya Seva workbook (`~/Downloads/Dr. Nandamuri Taraka Rama Rao Vaidya Seva Trust.xlsx`)
makes `openpyxl.load_workbook()` throw `TypeError: Fill() takes no arguments` — a malformed
stylesheet in the file, not a code bug. Worked around by parsing `xl/worksheets/sheet1.xml` +
`xl/sharedStrings.xml` directly via `zipfile`/`xml.etree`, handling BOTH shared-string (`t="s"`)
and inline-string (`t="inlineStr"`) cell types (this file uses inline strings exclusively -
`sharedStrings.xml` has zero entries). Other states' workbooks may use either form or may open
fine in openpyxl - don't assume the raw-XML path is universally required, but keep it as the
fallback since government-authored XLSX files are not reliably well-formed.

## National scheme registry status
28/28 states, 8/8 UTs, Central: registry (name/type/code) seeded and live in D1.

**Ingested (live data, verified by remote query 2026-09-04):** 19/37 jurisdictions, 46,200
packages — Tamil Nadu 4,298 · West Bengal 4,388 (5 scheme_versions: Grade A 1,921 · Grade B 1,563
· Grade C 404 · Grade R 218 · Critical Illness Package 282) · Nagaland 4,008 (2 scheme_versions:
CMHIS-EP semi-private 2,004 · CMHIS General/PM-JAY 2,004) · Andhra Pradesh 3,713 · Karnataka 3,155
· Bihar 2,675 · Rajasthan 2,439 · Gujarat 2,315 · Kerala 2,286 · Uttarakhand 1,585 · Punjab 1,229
· Assam 1,577 · Telangana 1,867 · Mizoram 2,003 · Uttar Pradesh 2,000 · Delhi 1,991 ·
Chhattisgarh 1,735 · Central PM-JAY HBP 2022 1,646 · Haryana 1,290. Each row carries its source's `rate_tier` verbatim where the source publishes one
(Tier 2, Tier1(X), Non-NABH, A1, ...) - amounts are only comparable with the tier visible.
Telangana's source publishes a single price per procedure (no tier split) - `rate_tier` is
intentionally blank there, not guessed. All `scheme_versions.status = 'draft'` (Phase 1's admin
review pass hasn't run - see the module's own trade-off note above before flipping
`smd_govt_schemes` on).

**QA pass across all 15 jurisdictions, 2026-09-04 (remote query, read-only, no data changed):**
zero-rate percentage is fine everywhere (0-23%, all attributable to genuinely-priced-differently
rows like haemophilia factor concentrates or "Included in package") EXCEPT one real defect worth
the owner's attention before the admin review pass: **`treatment_name` is blank on 86% of
Haryana's 1,290 rows (1,110), 22% of Central PM-JAY's 1,646 (256), and 19% of UP's 2,000 (379)**
- all three came from `ingest_layout_pdf.py`. Root cause confirmed by direct query: on the
affected Haryana rows, `package_name` holds a fragment of wrapped criteria text ("dressings etc.
as deemed necessary;") instead of either the real package name or the procedure name - the
two-pass parser's leading/trailing text-buffer logic is picking up the wrong wrapped-cell text
for these specific rows. Not re-parsed tonight (a live fix risks the exact kind of guessing this
project won't do unsupervised) - flagging precisely so it's fixed with the source PDF in hand,
not guessed from the DB.

**Telangana (2026-09-04)** — the portal has no reachable package master (confirmed in
`govschemes_verified_sources_batch1.md`: the rate-revision GO PDFs 404 even from inside the
portal). The owner supplied the full "Surgery/Therapy List (Consolidated)" as an `.rtf` export
instead of the image-only 142pp PDF this session had been trying (and failing) to OCR. Converted
via `textutil -convert txt`, parsed by `scripts/govschemes/parse_telangana_rtf.py` (one field per
physical line; record shape - 6 vs 7 fields - detected structurally, not guessed; a data row's
terminator MUST be exactly "Yes"/"No" or it's rejected, never absorbed). 1869/1876 rows parsed
clean (7 rejected: 3 have a genuinely blank package amount in the source, 4 Rheumatology ICU rows
carry an extra "Routine Ward-.../ICU..." stay-cost column this parser doesn't handle - left out
rather than guessed at). 2 duplicate treatment codes in the source (S8.3.1, M19.1, each under a
different name/amount) - first occurrence kept, both logged in `crawl_logs.detail`, never merged.
Spot-checked 5 known-correct rows (S1.19A, S1.2.1, S1.21.1A, S5.16.1A, M15.1.1) against the source
before loading - exact match on code/name/amount/ICD/reserved. `sources.verification_status =
'unverified'` (no live URL to re-verify against) and `sources.document_type = 'rtf'` - this is
recorded honestly as owner-supplied, not portal-verified.

**Assam solved 2026-09-04 via a different, cleaner source than the MMLSAY PDF this project already
rejected.** The MMLSAY PDF still fails the same way (overlapping text boxes shift prices between
columns) - but Assam ALSO runs AA-MMJAY (Atal Amrit Abhiyan), whose "PMJAY Package Master" page
(`atalamritabhiyan.assam.gov.in/information-services/pmjay-package-master`) is a plain
server-rendered Drupal HTML `<table>`, not a React SPA and not a PDF - confirmed by `curl` (exact
bytes, table present with no JS execution needed). `scripts/govschemes/ingest_assam_html.py`
(stdlib `html.parser` only) extracts it by exact column index from the real `<th>` header row -
no "Nth numeric token among free text" heuristic like the PDF adapters need, because Package
Price sits in its own `<td>`. 1,578 rows found, 1 dropped (`US001A`'s Package Price cell is the
literal text "Upto 1 lakh", not a number — caught by requiring a clean `^[0-9,]+(\.[0-9]+)?$`
match, not silently mis-parsed as ₹1 from the stray "1" in "1 lakh" — an early version of this
script did exactly that before the check was added). Spot-checked BM001A (₹7,000) and the doc's
own recorded first-row sample against the loaded data - exact match.

**Punjab solved 2026-09-04 with a NEW header-position-aware parser
(`scripts/govschemes/ingest_pdf_columnar.py`) — 1,229 packages loaded.** The "Nth numeric token"
heuristic in `ingest_layout_pdf.py` was correctly identified as unfixable-by-tuning (Punjab's
Stratification/Implant free text sometimes contains numbers, inconsistently row to row - see the
git history for the full original writeup). The real fix, built and validated this session: read
real per-word bounding boxes via `pdfplumber` (not `pdftotext`'s space-approximated columns), and
assign every data-row word to a column by comparing its X-POSITION against boundaries derived
from the PDF's OWN header row - the same way a human reading the table would, and the only
technique immune to a stray number matching by coincidence. Confirmed on real ambiguous rows:
IN004A's two "look-alike" numbers (Procedure Price and Total Package Price can print the exact
SAME value, e.g. both "7,000", when a row has no addon) are correctly told apart by which side of
the page they're on - verified against the source doc's own recorded samples (IN004A=150,000,
IN004B=75,000, MC005A=90,700, MC007A=98,900, all exact). 1,229/1,668 codes priced (73.7%, in line
with Central's 87%/UP's 85%); every one of the 439 unpriced rows checked traces to a genuine
non-flat-rate cell (ward-stay bands like "HDU-3300", age-stratified bands like "Adult-14000") or
a rare boundary edge case - never a wrong number silently emitted. `treatment_name` is
best-effort for multi-line-wrapped entries (documented limitation: this PDF's own layout
genuinely splits one procedure's wrapped text both above AND below its code line, an ambiguity
inherent to the source, not this parser) - `package_amount` is unaffected, since it's read only
from the code's own physical line, never a continuation line. See the script's own docstring for
the full technique (column-boundary derivation, the letter-spacing artifact this PDF applies to
some wrapped text and how `smart_join` reconstructs real words from it, and what remains a
documented heuristic vs. what's now geometrically exact).

**Himachal not yet re-tried with the new columnar parser** - its header layout differs
structurally from Punjab's (repeating "Total" labels at per-row, not per-page, y-positions on a
first look) and needs its own investigation before reusing the technique. Real next step, not
attempted tonight.

**Still not loaded:** Assam's OWN MMLSAY PDF (superseded by the AA-MMJAY HTML table already
loaded - MMLSAY not retried), Ladakh (its PDF is a code crosswalk with no prices).

A PaddleOCR-based fallback
(`scripts/govschemes/paddle_tables.py`, plain OCR + geometric row-reconstruction, since
PP-StructureV3's full pipeline OOMs on this machine) was trialed on 1 Telangana page before the
RTF made that moot - it read codes/names/amounts correctly but doesn't merge wrapped-cell
continuation lines into their parent row, so it's not yet trustworthy for a full run on
Punjab/Himachal/Assam without a human spot-check pass. Left for the owner: OCR output is a digit
transcription risk this project has been explicit about never guessing past.
**Uttarakhand solved 2026-09-04 via the live JSON API** (`POST sha.uk.gov.in/CMS/GetSpecDetails`,
body `SPEC_CODE=<code>`, one call per each of the 24 speciality codes the portal itself lists) -
the safest source shape ingested so far: PROC_AMT is a plain numeric JSON string, no free-text or
layout-position guessing at all. 1,622 rows fetched (exact match to the count recorded in
`govschemes_verified_sources_batch2.md`, confirming the API is stable), 37 genuine duplicates in
the source itself (same code/package/amount, differing only by typographic encoding - curly vs
straight apostrophe, bullet vs "o") deduped to first-seen, 1,585 loaded.
`scripts/govschemes/ingest_uttarakhand_json.py` reads the fetched JSON files (fetch step kept
separate/inspectable, documented in the script's own docstring - not baked into the ingester).
11.1% zero-rate, checked and genuine (General Medicine conditions like malaria/dengue/sepsis
priced by ward-stay in the source, not a flat package - same pattern already seen in other states'
"M2.x General Medicine" sections).

**West Bengal solved 2026-09-04**, also via a live server-rendered HTML endpoint - Swasthya
Sathi's package search (`POST tms.swasthyasathi.gov.in/portal/SSPPackage.asp?dw=<grade>`, classic
ASP, needs BOTH the querystring `dw` AND a form-encoded body `cbo_pckg=<grade>&cbo_Procedure=` or
it either 411s or re-renders the empty search form). `scripts/govschemes/ingest_westbengal_html.py`
- same `html.parser` approach as Assam. Ten hospital-grade/category values exist
(`govschemes_verified_sources_batch3.md`); 4 fetched and loaded tonight as 4 SEPARATE
scheme_versions (Grade A/B/C/R + Critical Illness Package - never merged into one natural-key
space, since the same procedure can recur across grades at a different price): 4,388 rows total.
The remaining 5 (Implants ORTHOPAEDICS/CARDIO/ONCOSURGERY, Investigation Package NABH/Non-NABH,
`dw=5/6/11/8/9`) do NOT work the same way - the server correctly registers the selected category
(confirmed: the returned page's `<option value="5" selected>` shows it) but renders the empty
search form instead of a results table, unlike Grade A/B/C/R/Critical-Illness which all returned
results from the identical request shape. Needs real investigation (probably a required
`cbo_Procedure` value for these categories, or a session/cookie step) before it's worth
attempting again - not guessed at or forced tonight.
One real near-miss caught before loading: the page is served as cp1252 (single-byte, confirmed by
byte-histogram - no UTF-8 multi-byte sequences present), and decoding it as UTF-8 with
`errors="replace"` turned every en-dash into a "�" replacement glyph in clinical procedure names; fixed by
decoding as cp1252 properly instead of papering over it.

**Odisha's signed-URL problem WAS solved 2026-09-04** (Chrome DevTools MCP: navigated to the GO
index, clicked "Download PDF", read the freshly-minted `secure-file/view?f=...&e=...&s=...` URL
off the resulting network request, fetched it with plain `curl` before its ~10-minute expiry -
120pp, matches the doc's recorded size/page-count exactly) - **but the data itself isn't safe to
load**, for the SAME reason Punjab and Himachal were rejected, now confirmed a third time: LOS
sometimes renders as a bare number (not consistently "NA" or "X days" text), so 2,121/2,604 code
rows (81.5%) have more than one numeric token after the procedure code and the existing "Nth
numeric token" rate-column heuristic can't tell "255500" (the real Package cost) from "5" (LOS)
apart reliably. This is now the THIRD state confirming the same systemic weakness in
`ingest_layout_pdf.py`'s rate-column selection - **the real fix is a header-position-aware
columnar parser** (build column x-boundaries from the actual header row, bucket each data line's
tokens by which boundary they fall in, rather than counting numeric tokens by ordinal position) -
worth doing properly in a session with time to re-validate every already-loaded
`ingest_layout_pdf.py` jurisdiction against it - **built and validated on Punjab the same day**
(`scripts/govschemes/ingest_pdf_columnar.py`, see above). Odisha itself not yet re-run with it -
its "Package cost" column and header layout haven't been checked against the new parser's
assumptions (the `--code-header`/`--rate-header`/`--name-right-header` phrases are Punjab's own
wording, need Odisha's equivalents located first). Real next step.

**No usable source located yet (need a PDF from the owner):** Madhya Pradesh, Chandigarh, J&K,
Jharkhand, Puducherry, Goa, Tripura, Maharashtra, Meghalaya (2 of 3 tables are small/client-side;
the large IPD table needs a WordPress AJAX nonce this session couldn't mint from a plain fetch),
Manipur, Sikkim, A&N Islands, Lakshadweep, DNH&DD, Arunachal Pradesh (table exists but has no
prices).

**`scripts/govschemes/ingest_layout_pdf.py`** (2026-09-03) — adapter for HBP-family PDFs that
docling can't parse (column headers print only on page 1, not on continuation pages). Runs
`pdftotext -layout`, which keeps column x-position on every page without needing headers, then
reconstructs rows with a two-pass line-position parser (not a simple line-regex - a table cell
taller than one row, e.g. the wrapped "Procedure Name" criteria text or the speciality name,
prints at its OWN vertical center on separate output lines, interleaved with the row it doesn't
belong to). `treatment_code`/`package_amount`/`rate_tier` are exact (parsed from the same
physical line, or rejected outright - a garbled/unpriced row is dropped, never guessed at 0).
`package_name` is kept only when it's IDENTICAL across every procedure sharing a package prefix
(majority vote) - Haryana's column order puts Procedure Name BEFORE the code, so a naive
"last token before the code" grab pulls criteria text instead; the vote catches and blanks that.
`speciality_name` isn't attempted at all (unreliable whether it's inline or wrapped, per state) -
left blank on purpose. Central/UP: ~87%/85% of code rows carry a fixed rupee amount (the rest
are genuinely priced "Included in package" / by ventilator-day / per-unit in the source PDF, not
a parser miss - spot-checked). Haryana: ~69% (same causes, plus more "No change" rows). Read the
script's own docstring before reusing it on another HBP-style PDF.

**`treatment_name` page-header leakage - found 2026-09-04, not yet fixed, likely also affects the
already-loaded Haryana/Central/UP `treatment_name` gaps flagged in the QA section above.** Tried
this script on Mizoram's Annexure B (Private EHCP, 154pp PDF, structurally the safest-looking
candidate of the night - single unambiguous rate column per procedure, verified by a full
numeric-token scan: 0 rows with more than one numeric token after the code). It parsed fine at
first glance (BM001A -> ₹8,800, exact match to the source doc's sample) but 129/1683 rows (7.7%)
carry a REPEATING PAGE HEADER phrase ("Reservation Private Hospitals (Y/N)", "Rates (₹)", "Sl.No")
leaked into `treatment_name`, prefixed or appended - HEADER_NOISE doesn't include this state's
exact header wording, so the leading/trailing-continuation state machine absorbs it as if it were
wrapped procedure-name text on a fresh page. Not loaded - would need HEADER_NOISE (or a smarter
"does this line look like the recurring header block" check) extended per-state, and every
already-loaded ingest_layout_pdf.py jurisdiction re-checked for the same failure mode before
trusting `treatment_name` there. Left as a real next step, not patched under time pressure
tonight (touching the shared script risks a subtle regression on already-loaded data with no
time left to re-validate all of it before the owner wakes).

**Source inventory (research, not yet ingested):** `functions/db/govschemes_source_inventory.md`,
compiled by agy 2026-09-02 — **29/35 FOUND** (a package master located on an official govt
domain), **6/35 PARTIAL** (Manipur, Sikkim, Tripura, A&N Islands, DNH&DD, Lakshadweep: scheme
identified but no standalone state package master - they run 100% on the central NHA PM-JAY
HBP 2022 master), 0 NOT FOUND. Two structural findings worth knowing before Phase 2 ingestion:
- Most converged states inherit the central **PM-JAY HBP 2022** master (1,949 procedures) as
  their baseline, so ingesting that ONE central document covers a large share of India at once;
  state-specific masters are then deltas/extensions on top of it, not independent universes.
- Employee schemes (Delhi DGEHS, Rajasthan RGHS, Assam MMLSAY, Nagaland CMHIS-EP) benchmark
  against **CGHS** rate lists - a second shared baseline.

**URL liveness sweep (2026-09-02, `functions/db/govschemes_url_sweep_2026-09-02.txt`)** - all 79
unique inventory URLs curl'd (HEAD, follow redirects, 20s, browser UA). Results and what they mean:
- **55 reachable (200), 4 redirects to live sites, 20 unreachable (status 000).**
- **The 20 unreachable are NOT geo-blocking and NOT dead links** (an earlier draft of this note
  said geo-blocking - wrong, corrected the same day: the machine is IN India, Andhra Pradesh,
  `125.62.195.178`). Real diagnosis: `pmjay.gov.in` (`14.143.233.34`) is filtered at the TCP level
  on BOTH ports 80 and 443 - `nc` reports closed/filtered, curl connect time 0.000s (immediate
  failure, not slow). DNS resolves fine. Chrome on this Mac (real network, not the sandbox) times
  out on it and on `cghs.gov.in` too. ~20 NIC-hosted portals (`14.143.x`, `164.100.x` address space)
  failing identically points at this ISP blackholing routes toward NIC, not 20 simultaneous
  outages. **Confirm by retrying from a different network (mobile hotspot).** `pmjay.gov.in` and
  `cghs.gov.in` are known-live sites.
- **One genuine anomaly:** `mjpjay.gov.in` has NO DNS record at all - unlike the timeouts, that is a
  wrong/defunct hostname. `www.jeevandayee.gov.in` is the real Maharashtra MJPJAY portal.
- **HTTP 200 proves nothing on these portals.** All 55 "successes" are `text/html`, and loading one
  in a real browser (`cmchistn.com/package_master`) showed a React app rendering a soft "404 Page
  Not Found" behind the 200. So agy's deep-links are unreliable in BOTH directions: a timeout is
  not dead, and a 200 is not found. An earlier draft here listed "5 real package-master HTML
  pages" off those 200s - also wrong, withdrawn. **Only a URL loaded in a real browser and SEEN to
  contain codes + amounts counts as found.** That verification is the `govschemes_verified_sources_
  batch{1,2,3}.md` files (Claude subagents driving Chrome via DevTools MCP, 2026-09-02).
- **Central PM-JAY workaround:** `nha.gov.in/PM-JAY` (the same authority, National Health
  Authority) IS reachable (200) while `pmjay.gov.in` is not - the HBP 2022 master should be
  sourced from there.

Deps: [[Decisions]]
