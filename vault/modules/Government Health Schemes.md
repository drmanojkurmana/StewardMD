---
tags: [module, data, clinical]
status: PHASE 1 in progress. Schema + jurisdiction registry written, not yet applied to remote D1 (needs an explicit go-ahead - real infra). First real dataset (Dr. NTR Vaidya Seva Trust, Andhra Pradesh, 3713 rows) inspected and ingestion built. API layer, admin UI, and the other 35 jurisdictions' source discovery not started. See [[Decisions]] (2026-09-02).
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
28/28 states, 8/8 UTs, Central: registry (name/type/code) seeded. Scheme-level inventory
(which scheme(s) each jurisdiction actually runs, authority, official source) collected so far:
**1/37 — Andhra Pradesh (Dr. NTR Vaidya Seva)**. The rest is open Phase 1/2 work.

Deps: [[Decisions]]
