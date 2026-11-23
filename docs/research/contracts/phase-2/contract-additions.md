# Phase 2 contract additions (2026-11-23, integration)

The Phase 2 screens and API were built in parallel. Two calls the screens make
were never frozen in 2.0; the integration pass adds them as small API routes
instead of changing screens. Everything else the screens call already matched
the frozen routes (records, reports, searches, imports, dedup, decisions,
conflicts, exclusion-reasons, prisma). Auth, role gates, error envelope and
audit follow the existing Phase 2 routes exactly (`errors.md`).

## GET /v1/projects/{projectId}/protocols

Protocol version list, loaded by `research-screen-protocol.js` with
`?limit=100`. Schema: `schemas/protocol-list.response.json`.

- All member roles (owner, editor, analyst, reviewer, viewer).
- One version chain per project (0002 `UNIQUE(project_id, version)`).
- Every item is a protocol object as in `protocol-get.response.json`, but `id`
  is the **chain handle**: the first version's id, shared by every row. The
  screen groups versions by `id`; per-version identity is `(id, version)`.
  All `/v1/protocols/{id}` routes already resolve any chain id to the project
  and act on the chain, so the handle works for `GET ?version=N`, `POST
  versions` and `POST lock`.
- Ordering `created_ts DESC, id DESC`; pagination per the Phase 1 convention
  (`?limit` 1-100 default 20, opaque `?cursor`, `nextCursor`). The cursor
  encodes the real row id, not the shared handle.
- No audit event (read-only list, same as the other Phase 2 list routes).

## POST /v1/projects/{projectId}/import-uploads

Multipart reference-file upload, called by `research-screen-search.js`
(`SMD.api.upload`) before `POST /imports`. Schema:
`schemas/import-upload.response.json`.

- Request: `multipart/form-data`, one file in the `file` field. Filename
  extension must be `.ris`, `.bib`, `.bibtex` or `.csv` (case-insensitive).
  Size 1 byte to 5 MiB.
- Owner, editor or analyst only (same gate as `POST /imports`). Non-members
  get 404 `project_not_found`; weaker roles get 403 `not_member`.
- Storage: private R2 (`env.RESEARCH_R2`) at
  `projects/{projectId}/imports/{sha256}.{ext}`; identical bytes reuse the
  same key. No D1 row is written here; the import step files the search run.
- Response 201: `{storageKey, sha256, bytes}`. The screen passes `storageKey`
  to `POST /v1/projects/{projectId}/imports` (`import-create.request.json`),
  which parses and normalises the file deterministically.
- Errors: 400 `invalid_multipart` / `missing_file`, 413 `file_size`, 415
  `file_type`, 503 `storage_unavailable`.
- Audit event: `import_uploaded` (resource id = storageKey; metadata: bytes,
  sha256, ext).

`import-create.request.json` previously described the upload as "a signed-URL
step outside this contract"; that description is superseded by this route.