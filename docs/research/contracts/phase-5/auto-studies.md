# Find studies and auto-add (server contract)

Client code should match these JSON shapes. Read role: owner, editor, analyst, reviewer, viewer.
Write role: owner, editor, analyst. An outsider (no membership) gets 404 `project_not_found`.
A member whose role is too weak gets 403 `not_member`.

Every error body is `{ "error": { "code", "message", "requestId" } }` with header `x-request-id`.
Success bodies do not include `requestId`. The header is still set.

No em dash is used in these messages. Scientific terms stay first, with the plain meaning in brackets.

## POST /v1/projects/{pid}/find-studies

Read role. No AI call and no MaiK token charge.

Request:

```json
{ "q": "bcg tuberculosis", "limit": 20 }
```

`q` is a string of 1 to 4000 characters. `limit` is optional, default 20, integer 1 to 50.
Above 50, a non-integer, or a missing `q` is 400 `invalid_body`.
Missing `RESEARCH_CONTACT_EMAIL` is 503 `search_unconfigured`.
Both PubMed and Europe PMC failing is 502 `search_failed` with message
"The literature databases could not be searched. Try again."
One source failing still returns the other.

Response 200:

```json
{
  "results": [
    {
      "pmid": "111",
      "doi": "10.1000/same.1",
      "title": "BCG and hospital admission",
      "authors": ["Smith A"],
      "year": 2020,
      "journal": "Lancet",
      "abstract": "PubMed abstract text",
      "freeFullText": true,
      "source": "pubmed"
    }
  ]
}
```

`authors` is an array of strings (at most 30). `year` is a number or null.
`abstract` is at most 1200 characters. `freeFullText` is boolean.
`source` is `"pubmed"` or `"europe_pmc"`.
PubMed and Europe PMC are queried once each, capped at `limit`, then de-duplicated
by DOI, then PMID, then title plus year plus first author. The earlier record wins
(PubMed is treated as earlier). Order is not significant. At most `limit` rows are returned.

## POST /v1/projects/{pid}/studies/auto-add

Write role.

Request:

```json
{
  "items": [{ "pmid": "111", "doi": "10.1000/same.1" }],
  "outcome": "hospital admission",
  "measure": "RR"
}
```

`items` is 1 to 20 objects. Each item needs `pmid` and/or `doi`.
`outcome` is 1 to 500 characters.
`measure` is optional: `RR`, `OR`, `HR`, `MD` or `SMD`.
When omitted, the latest protocol `content.measure` or `content.outcomes.measure`
is used when it is one of those five. Otherwise the measure is `RR`.
A bad measure is 400 `invalid_body`.

Response 200:

```json
{
  "results": [
    {
      "status": "filled",
      "study": {
        "id": "st_...",
        "projectId": "p_...",
        "label": "Smith 2020",
        "measure": "RR",
        "inputs": { "events1": 237, "n1": 2373, "events2": 326, "n2": 2371 },
        "locator": {
          "kind": "manual",
          "citation": "PMID 111. DOI 10.1000/same.1",
          "page": "",
          "section": "abstract",
          "table": "",
          "quote": "Hospital admission was 237/2373 (10.0%) vs 326/2371 (13.7%).",
          "aiSuggested": true,
          "method": "parser"
        },
        "quote": "Hospital admission was 237/2373 (10.0%) vs 326/2371 (13.7%).",
        "verified": false,
        "verifiedBy": "",
        "verifiedAt": null,
        "version": 1,
        "createdBy": "u-alice",
        "createdAt": 0,
        "updatedAt": 0
      },
      "fields": { "events1": 237, "total1": 2373, "events2": 326, "total2": 2371 },
      "quote": "Hospital admission was 237/2373 (10.0%) vs 326/2371 (13.7%).",
      "location": "abstract",
      "method": "parser"
    }
  ]
}
```

`status` is `filled`, `needs_pdf` or `failed`.
`method` is `parser`, `ai`, `cache`, or `""` when nothing was stored.
`needs_pdf` and `failed` use `study: null`, `fields: null`, `quote: ""`, `location: ""`, `method: ""`,
plus `message`. A filled row omits `message`.

`needs_pdf` message: "The abstract did not contain a complete result. Upload the PDF (the full paper) so the numbers can be read from a table."
`failed` message: "This record could not be read. Check the PMID (PubMed identifier) or DOI (digital object identifier)."

Estimate rows use `fields` `{ "estimate", "ciLower", "ciUpper" }` and study `inputs`
`{ "effect", "ciLower", "ciUpper" }` (the estimate is stored as `effect`).
Count rows store totals as `n1` and `n2`. `HR`, `MD` and `SMD` are estimate-only.
The study is always `verified: false`. The server never calls the verify path.
A second add of the same paper inserts another unverified study.

Cache key, shared across users and projects, in `research_paper_numbers`:

`sha256( pmid + "||" + normalisedDoi + "|" + normalisedOutcome + "|" + measure )`

`pmid` is digits or `""`. The DOI is lowercased with the resolver prefix removed.
The outcome is lowercased and punctuation becomes spaces.
A hit does no fetch, no AI call and no charge. The request key is the one that is read.
A second key is written when the loaded PMID or DOI differs from the request.

Path, cheapest first: cache, then abstract plus open-access table rows and numbered sentences
(kept text at most 6,000 characters), then the deterministic parser, then one AI call.
Open-access XML is fetched only from `https://www.ebi.ac.uk/europepmc/webservices/rest/{PMCID}/fullTextXML`
when the PMC id is `PMC` plus digits, the record is open access, and a present licence is not NC or ND.

The AI call uses temperature 0 and at most 300 output tokens. The quote must be an exact
substring of the kept snippets, and every number in the row must appear in the quote
as its own numeric token (digit boundaries, and a dot only when a digit follows it,
so 237 does not match inside 2373, 49 does not match inside 0.49, and a sentence-ending
period does not hide 90 or 2371). A token equal to the value counts, so 0.80 matches 0.8.
Otherwise the item is `needs_pdf`.
A 402 or a PHI 422 aborts the whole request. Other provider failures mark that item `failed` and continue.

402 body, AI path only (the parser and the cache do not charge):

```json
{ "error": { "code": "insufficient_credits", "message": "You need more MaiK tokens", "requestId": "..." } }
```

Migration: `0007_research_v7.sql` and `0007_rollback.sql`. The same tables are appended to
`functions/db/research_schema.sql`.
