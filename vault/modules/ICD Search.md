---
tags: [module, data, clinical]
status: LIVE 2026-09-04. D1 provisioned (`stewardmd-icd`, id b38bab39-65aa-41d3-9200-033ab41da541,
  binding ICD_DB), 106,367 codes loaded (71,704 ICD-10 + 34,663 ICD-11). No flag - default on for
  every device from launch, per owner's explicit "no more flagging" instruction (2026-09-04, same
  session as the Scheme Search flag-default-ON flip).
---
# ICD Search

Search WHO ICD-10 and ICD-11 diagnosis codes by name or code, from a "Search ICD" entry point
(Home tile + More sheet), and inline "Search ICD" buttons wired into OPD/EMR's provisional
diagnosis field and ICU's Working diagnosis card. Public, non-PHI reference data — code + title
only, no patient data in this table.

## Key files
- `functions/db/icd_schema.sql` — D1 schema (`icd_codes` flat table + `icd_fts` FTS5 title+code
  index, same trigger shape as `packages_fts` in `functions/db/govschemes_schema.sql`).
- `scripts/icd/README.md` — exact data provenance (WHO ICD-11 MMS public download, ICD-10-CM CSV
  from a public GitHub mirror) and how to refresh when WHO publishes a new ICD-11 release.
- `functions/_icd_repo.js` + `functions/api/icd/[[path]].js` — read API, GET-only, fail-safe
  (DB/binding error → 200 + `{error:"unavailable"}`, never 5xx). Mirrors `functions/_schemes_repo.js`
  exactly: `hasDb()` guard, `ftsQuery()`/`isCodeLike()`/`clampLimit()` helpers, exact-code hits
  unioned ahead of FTS title matches. Routes: `/search?q=&system=&limit=`, `/code/<id>`.
- `icd.js` + `icd.css` — `window.SMD_ICD`, full-screen overlay, same pattern as `govschemes.js`
  (`ensureRoot`/`#icdOverlay`/`.icd-top`, real Back button). Two entry points: `SMD_ICD.open()`
  (stand-alone browse/search) and `SMD_ICD.pick(onSelect)` (picker mode — tapping a result calls
  `onSelect({id,system,code,title,chapter,is_leaf})` and closes, instead of opening a detail panel).
- `test/icd-api.test.mjs` — unit tests for the pure repo helpers + the placeholder-only-SQL guard.

## Integration points
- **OPD/EMR** (`opd-emr.js`): a "Search ICD" button (`icdBtn()`) sits next to the existing
  per-field dictation mic on the **provisional diagnosis** textarea only (Diagnosis & plan
  section). Picking a code **appends** `"CODE - Title"` as a new line via the same DOM-patch path
  as voice dictation (`putVoiceDom`) — additive, never replaces what the clinician already typed.
- **ICU ward** (`icu.js`): an "Attach/Change ICD-10 / ICD-11 code" button on the Working diagnosis
  card, in both the empty and populated states. **Deliberately a separate structured field**
  (`STATE.patient.diagnosisIcd = {system,code,title,id,at}`), never concatenated into
  `STATE.patient.diagnosis` — that free-text field drives `dxManagementHTML()`'s KB-name matching
  (`SMD_REASON`), and an ICD code+title string would break that match. Shown as its own removable
  badge (`.icu-dx-icd`) above the diagnosis text.
- **Home**: `HOME_TOOLS` tile (`defOn: true`, no `eligible` gate) + Hospital-hub "More" sheet row,
  same pattern as Scheme Search but with no flag — `ACT.icdsearch` → `SMD_ICD.open()`.

## MaiK-assisted suggestion (2026-09-04)
Diagnosis/symptom text → ranked ICD-10/ICD-11 suggestions, not just manual keyword search — a
second entry point next to the manual "Search ICD" button in both ICU and OPD/EMR ("Suggest ICD
code · MaiK" in ICU's Working diagnosis card; an ✨ icon next to the diagnosis field in OPD/EMR).

**Grounding, not free generation** — this is the important part: the model never picks a code out
of thin air.
1. Client sends the doctor's diagnosis/symptom text to `/api/ai/extract` with `kind:"icd-suggest"`
   (`www/icu.js openIcuIcdSuggest()` / `www/opd-emr.js openIcdSuggestForField()`), same one-shot
   `SMD_AI.extract(text, kind)` contract every other structured AI feature here uses.
2. Server (`functions/api/ai/[[path]].js`, the `icd-suggest` branch) first runs
   `functions/_icd_repo.js searchCodes({q: transcript, limit: 30})` against the SAME `icd_codes`
   D1 table the manual search uses, retrieving up to 30 REAL candidate rows.
3. `functions/api/ai/_icd-suggest.js icdSuggestPrompt()` hands the model the doctor's text PLUS
   that candidate list, instructing it to select `id`s **only** from the list, never invent one.
4. `sanitizeIcdSuggest()` re-validates every returned `id` against the same candidate array
   server-side — an id the model didn't copy exactly is silently dropped, not "corrected" or
   fuzzy-matched. The client only ever sees `{id,system,code,title}` fields the server itself
   already verified exist in the DB, never the model's own transcription of a code.
5. Same `"ocr"` quota gate as every other `/extract` kind (`checkQuota`/`recordUsage`) — no
   separate cost bucket for this feature.

**Advisory-only UI, copied from the house `opd-suggest`/Ask MaiK convention exactly**: an explicit
consent tap before anything is sent ("Send this working diagnosis and findings (no name or MR
number) to MaiK...?"), a confidence badge (high/medium/low) per suggestion, a one-line "why", and
a per-suggestion Accept button — nothing is attached to the chart until that specific row is
tapped. ICU stores an accepted suggestion in the same `STATE.patient.diagnosisIcd` field the
manual picker uses (tagged `source:"maik-suggest"`); OPD/EMR appends the same `"CODE - Title"`
line the manual picker does.

Unit-tested in `test/icd-suggest.test.mjs` (prompt shape + the sanitizer's candidate-validation,
dedup, cap-at-6, and malformed-input handling) — no network/LLM/D1 involved in that test.

## Design decisions worth knowing
- **No flag.** The owner's explicit instruction this session ("no more flagging") applies here
  too — this shipped default-on from the first commit, unlike Scheme Search's original
  default-OFF-then-flipped path. See `vault/decisions/Decisions.md` (2026-09-04 entries).
- **ICD-10-CM, not pure WHO ICD-10.** The most complete, freely machine-readable ICD-10 dataset
  available is the US CMS ICD-10-CM release (71,704 billable codes) — a superset of WHO's
  4-character ICD-10 categories. Documented explicitly in `scripts/icd/README.md` so nobody
  mistakes the code granularity for the plain WHO edition.
- **ICD-11 = WHO's own "Simple Tabulation" export**, not the live WHO ICD-11 API (that needs
  registered OAuth client credentials StewardMD doesn't hold). The public download is the MMS
  (Mortality and Morbidity Statistics) linearization, WHO release 2024-01 — current as of load
  time; re-download instructions are in the README for when WHO ships a newer release.
- **`diagnosisIcd` is additive everywhere it's wired**, never a silent rewrite of an existing
  free-text field — the same safety posture as Scheme Search's "never guess a rate" rule, applied
  to "never let a code search quietly change what the clinician already documented."
