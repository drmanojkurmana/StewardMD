# Item-quality sidecar (question status + audit history)

Plan sections 7 and 11. One status per question, an audit history of every status
and key change (never silent), and disputed items excluded from tests.

## Statuses

| status | meaning | in tests? |
|---|---|---|
| `draft` | legacy starting point, unreviewed | yes (flagged, never silently removed) |
| `automated_checks_passed` | pipeline-verified (bank build, key screen). This is NOT expert review and is never called that | yes |
| `requires_review` | disputed, flagged, reported or statistically suspect; needs a qualified reviewer | NO |
| `approved` | a qualified reviewer actually reviewed it (named in the history) | yes |
| `rejected` | a reviewer judged it unfixable | NO |
| `retired` | withdrawn for good (duplicate, removed) | NO |

Default (no record): an item in a verified bank is treated as
`automated_checks_passed`. The sidecar stores only exceptions (about 21k of
200k at v1), so absence always means "pipeline-verified, eligible".

## Store

R2 `prep-bank/quality/` (bucket `stewardmd-offline`, binding `PREP_BANK_R2`),
served by `functions/api/prep/bank/[[path]].js`:

- `quality/index.json` (short cache): `{ v, generated_at, version, subjects }`,
  naming the current per-subject files;
- `quality/v<n>/<subject>.json` (immutable): `{ v, subject, quality_version,
  generated_at, records }`, one record per item id:
  `item_id, bank, bank_version, status, status_changed_at, key?, history`.

History entries use the schema vocabulary (`prep/assess/schemas/item-quality.schema.json`):
`created, checked, flagged, status_change, key_change_proposed, key_change_approved,
explanation_upgraded, retired`. Every entry carries `at, by` (actor: role, tool
or reviewer) and `source` (screen tool, bank build, student report, owner review,
item statistics); every status or key change carries a `reason`. History is
append-only: older entries are never edited, reordered or dropped
(`verify` enforces this).

The sidecar is a generated deployable (like the share-ID index): it lives in R2,
not in git. Regenerate with `node tools/prep-quality.mjs seed`.

## Seed v1 (2026-10-12): sources, no invented facts

From 200,520 live items: 20,895 records in 22 subject files.

- Bank flags (live, via the ids cache): `disputed` (18,694: the independent
  blind solve disagreed with the key, `tools/prep-screen-keys.mjs`),
  `exp-letter / exp-text / dup-key / dup-stem` (2,428 bank build checks) ->
  all `requires_review` with one `flagged` entry per flag. `exp-pending`
  (explanation unwritten) is not a verdict and seeds nothing.
- Hidden ids (live `GET /api/prep/flag?hidden=1`, empty at seed) ->
  `requires_review` + `flagged` (source: student report). `sync-flags`
  re-merges these at each publish; reaching the flag.js threshold (3 separate
  reporters) always writes a history entry. Items stay hidden as today.
- Owner key reviews (`~/prep-data/keyfix`, rounds 1-3, all 2026-10-10):
  242 applied/rebuilt/split -> `approved` + `key_change_approved` with
  from/to keys and `key.confidence: verified_human` (spot-checked live: the
  new keys match the banks); 2 still held (CT neck items 242/243, figure
  conflict) -> `requires_review`; 1 dropped duplicate -> `retired`.
- Withdrawn share IDs (ids index `x`): counted in the seed report (2 live at
  seed), NOT stored per item: a share ID is a hash of its key and cannot name
  its item. Per-item retirement happens through explicit review (`set-status
  retired`), which is how the duplicate above retired.

## Operations

```sh
node tools/prep-quality.mjs seed [--no-fetch] [--out dir]   # rebuild from live + keyfix
node tools/prep-quality.mjs verify [--out dir]              # schema, append-only, reasons, reviewers
node tools/prep-quality.mjs set-status --id <id> --status <s> --reason <text> --by <actor> [--reviewer <name>]
node tools/prep-quality.mjs record-key-change --id <id> --from A --to C --reason <text> --by <actor> [--approve]
node tools/prep-quality.mjs sync-flags [--token <owner>]    # merge live reports (hidden + top)
node tools/prep-quality.mjs publish [--yes]                 # upload to R2 (new versioned files, index last)
```

Rules the tool enforces: reasons are mandatory (min 8 chars); `approved`
needs `--reviewer` naming a person (never a tool); `--approve` on a key change
needs `--by owner:*`; `record-key-change` never touches bank files (a re-key
ships through the normal release flow, then `set-status` approves).

## Exclusion points (all ship ON)

- Engine tests (`prep-tests.js prepare`): the assembler gets the sidecar and
  `eligible()` blocks requires_review/rejected/retired, disputed keys and
  rubric fails.
- Ready-made fixed papers, build time (`tools/prep-fixed-tests.mjs`): the
  sidecar applies by default (`--quality none` disables).
- Ready-made fixed papers, run time (`fxResolve`): every resolved item is
  re-checked, so a paper built before a flag still drops the item (placeholder,
  left out of the marks, counted as Unavailable).
- Legacy mocks (`prep.js startMock`) and PYQ papers (`prep-pyq.js`): filtered
  through the same records (`usable`/`poolFor` honour an optional quality map).
- Items without records behave exactly as before (eligible if clean).

No student-facing UI changes except the exclusion itself (and the honest
"under review" word in the Unavailable line).
