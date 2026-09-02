---
tags: [module, data, clinical]
status: PHASE 1 in progress. **D1 provisioned 2026-09-02** (`stewardmd-govschemes`, id 2ad07897-93b7-424c-b1fc-e3d9643937f5, binding GOVSCHEMES_DB, region APAC) - schema + all 37 jurisdictions + the first real dataset (Dr. NTR Vaidya Seva Trust, Andhra Pradesh, 3713 packages) are LIVE and verified by remote query (exact-code lookup + FTS both working). API layer, flag file, admin UI not started; the other 35 jurisdictions' source discovery is running (agy). See [[Decisions]] (2026-09-02).
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

**Ingested (live data):** 1/37 — Andhra Pradesh (Dr. NTR Vaidya Seva, 3713 packages).

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
