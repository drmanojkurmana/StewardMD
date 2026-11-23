# ResearchMD Phase 2 connector interface (2.3 builder contract)

One adapter per database. The API calls the adapter server-side from the
search-run endpoint; the adapter never touches D1 or R2 directly. It returns
plain data, and the API persists the search run, the records and the archived
ID list. Language is the 2.3 builder's choice (Pages Function JS or Python
worker); the shapes below are the contract either way.

## search(query, filters, dateTo)

```js
// query: the per-database query string, stored verbatim on the search run.
// filters: database-native filters (language, study type, date range, ...).
// dateTo: "YYYY-MM-DD" upper bound (or null when the database has no date
//   filter; the 2.0b terms report may make it mandatory everywhere).
search(query, filters, dateTo) -> {
  ids: [string],        // EVERY matching external ID, in database order
  totalCount: number,   // database-reported total, before paging
  metadata: {
    apiVersion: string,  // database API version string, stored on the run
    executedAt: string,  // ISO-2026 timestamp of the first request
    queryEcho: string    // query as the database parsed it, when available
  }
}
```

Rules:

- Page through ALL results (`ids.length` must equal `totalCount` or the run
  fails with `search_failed`; a short page is a bug, not a result).
- `dateTo` binds the query when the database supports it; when it does not,
  the adapter filters client-side and records that in `queryEcho`.
- One search run means one database: cross-database merging happens only in
  dedup, never in a connector.
- Returns IDs plus metadata only. Full-record fetch is `normalise`, below;
  connectors never download paywalled full text.

## normalise(raw)

```js
// raw: one database-native record (whatever the API returned for one ID).
normalise(raw) -> {
  source: string,       // pubmed | europe_pmc | crossref | semantic_scholar
  externalId: string,   // PMID or DOI, the dedup key
  title: string,
  authors: [string],    // "Family FM" strings, in order
  year: number | null,
  doi: string,          // "" when unknown
  extra: object         // database-native leftovers, kept for audit
}
```

Rules: `externalId` is never empty (throw `invalid_search` otherwise);
`title` falls back to `""`, never null; `extra` keeps fields the schema
drops so a re-normalisation can run without re-fetching.

## Rate limits and retries

- Each adapter carries its own token bucket matching the database terms
  (see the TODO table below); buckets are per deployment, shared across
  projects, and logged per search run.
- On HTTP 429 or 5xx: exponential backoff with jitter, at most 5 retries,
  then the run fails with `search_rate_limited` (429, retryable) or
  `search_failed` (502). The partial result is NEVER saved as a run.
- Requests carry the project contact/credentials from server config, never
  from the client. Per-request timeout 30 s; per-run ceiling 10 min, then
  `search_failed`.
- Idempotency: re-submitting the same `(database, query, filters, dateTo)`
  within 24 h returns the existing run instead of re-querying.
- Quota spend (per-database daily caps from 2.0b) is checked before the
  first request; over quota answers `search_rate_limited` immediately.

## Required parameters (TODO pending the 2.0b terms report)

The 2.0b database-terms report (Gemini desktop research, Claude confirms)
fills this table before any connector is built. No connector ships with a
row still TODO.

| Database | Credential / contact param | Rate limit | Date-bounded re-query | ID-list reuse terms |
|---|---|---|---|---|
| PubMed E-utilities | TODO: API key + `tool`/`email` params | TODO: requests/s with and without key | TODO | TODO |
| Europe PMC REST | TODO: email param, if required | TODO | TODO | TODO |
| Crossref REST | TODO: polite-pool `mailto`, plus-address | TODO | TODO | TODO |
| Semantic Scholar API | TODO: allowed at all under current terms; key if yes | TODO | TODO | TODO |

Until 2.0b lands, `apiVersion` on the search run records whatever version
string the database returns (or `"unknown"`), and `dateTo` is required in the
request schema but enforced per database only where the adapter supports it.
