# ResearchMD Phase 3 study-level data import contract (module F, 3.8)

Frozen before the screens. The server builder implements these routes. Auth,
roles, error envelope and pagination follow `../phase-2/errors.md`. This is
STUDY-LEVEL data only (one row per study). Patient-level data is behind the
IPD gate (5C) and is rejected here: a dictionary column typed `patient_id` or
a row count suggesting patient-level granularity returns 422 `ipd_gate`.

All validation is deterministic code (plan integrity rule 5); no LLM. Every
import is versioned and writes a frozen snapshot to R2 (retention.md layout).

## Data dictionary

Schema `data-import-dictionary.schema.json`. A project has one current
dictionary, versioned.

```
GET /v1/projects/{projectId}/data-dictionary
PUT /v1/projects/{projectId}/data-dictionary
```

GET all roles; PUT owner/editor/analyst. `{dictionary:{version, columns:
[{column, label, type, unit, required, range:{min,max}, allowed:[...]}]}}`.
`type` is `string|integer|number|date|category`. `category` uses `allowed`.
PUT carries `version` (409 `stale_version`). A dictionary must include a
`study_id` column (string, required) used to dedup and to link rows to studies.

## Upload

```
POST /v1/projects/{projectId}/data-uploads   (multipart, field "file")
```

Owner/editor/analyst. `.csv` only, 1 byte to 5 MiB. Stores to R2
`projects/{projectId}/data/{sha256}.csv`. Returns 201
`{storageKey, sha256, bytes, rowCount, columns:[...]}` (header parsed
deterministically). Errors: 400 `missing_file`/`invalid_multipart`,
413 `file_size`, 415 `file_type`, 503 `storage_unavailable`.

## Import (validate + version + snapshot)

```
POST /v1/projects/{projectId}/data-imports
```

Request `data-import-create.request.json`: `{storageKey, dictionaryVersion?}`.
Owner/editor/analyst. Parses the CSV against the dictionary and runs the checks
below. Returns 201 `{import}` (schema `data-import.schema.json`):
`{id, projectId, version, storageKey, snapshotKey, rowCount, rowsImported,
status:"ok"|"warnings"|"errors", checks:[{code, severity, row, column, message}],
dictionaryVersion, createdBy, createdTs}`.

A snapshot is ALWAYS written, even when checks fail, so the exact uploaded
bytes are frozen and auditable: R2
`projects/{projectId}/data/snapshots/{importId}.csv`. `status:"errors"` means
blocking errors exist; `rowsImported` counts only rows that passed blocking
checks. The screen shows every check; errors are never hidden.

### Validation checks (deterministic)

| code | severity | Trigger |
|---|---|---|
| `missing_required` | error | a required column is empty in a row |
| `type_mismatch` | error | a cell does not parse as the column type |
| `out_of_range` | error | a numeric cell is outside range.min/max |
| `not_allowed` | error | a category cell is not in allowed |
| `duplicate_study_id` | error | two rows share a study_id |
| `unknown_column` | warning | a CSV header has no dictionary entry |
| `missing_column` | warning | a dictionary column is absent from the CSV |
| `missing_optional` | warning | an optional cell is empty |

`row` is the 1-based CSV data row (header excluded); `column` is the header
name. `message` is a stable, human-readable string with no PHI.

## Versions and snapshots

```
GET /v1/projects/{projectId}/data-imports
```

`{imports:[...]}` ordered version DESC, paginated per phase 1.

```
GET /v1/data-imports/{importId}
```

`{import}` with full checks. All roles read.

```
GET /v1/data-imports/{importId}/snapshot
```

Returns the frozen snapshot bytes (`text/csv`) from R2, after the role check.
404 `import_not_found`. The snapshot is immutable; re-importing creates a new
version, never edits an old snapshot.

```
POST /v1/data-imports/{importId}/freeze
```

Owner/editor. Marks the import frozen (locks it as the analysis dataset);
returns `{import}` with `frozen:true`, `frozenTs`. A frozen import cannot be
deleted; a new import supersedes it. 409 `already_frozen` if already frozen.

## Error codes added

| HTTP | code | When |
|---|---|---|
| 404 | `import_not_found` | no such import in the project |
| 409 | `stale_version` | dictionary version old |
| 409 | `already_frozen` | freezing an already-frozen import |
| 422 | `ipd_gate` | patient-level data detected (5C gate) |
| 422 | `invalid_dictionary` | dictionary missing study_id or bad column spec |
