# Paste a study link (server contract)

Client code should match these JSON shapes. Read role: owner, editor, analyst, reviewer, viewer.
Write role for explain: owner, editor, analyst. A viewer or reviewer gets 403 `not_member`.
An outsider (no membership) gets 404 `project_not_found`.

Every error body is `{ "error": { "code", "message", "requestId" } }` with header `x-request-id`.
Success bodies do not include `requestId`. The header is still set.

No em dash is used in these messages. The study design is named first, with the plain meaning in brackets.

The card route does not call a model and does not charge MaiK tokens. `tokensUsed` is 0.

## POST /v1/projects/{pid}/paper-card

Read role.

Request:

```json
{ "link": "https://pubmed.ncbi.nlm.nih.gov/31535829/" }
```

`link` is a string of 1 to 4000 characters. Missing `link` is 400 `invalid_body`.

The server resolves the link without a model:

- a bare PMID (1 to 9 digits), `PMID: 123`, `pubmed.ncbi.nlm.nih.gov/<pmid>`, `ncbi.nlm.nih.gov/pubmed/<pmid>`
- `ncbi.nlm.nih.gov/pmc/articles/PMC<n>`, `pmc.ncbi.nlm.nih.gov/articles/PMC<n>`, `europepmc.org/article/PMC/PMC<n>`
- `europepmc.org/article/MED/<pmid>`, `europepmc.org/abstract/MED/<pmid>`
- a DOI at `doi.org`, `dx.doi.org`, a `doi:` label, or a DOI inside any URL path
- otherwise, for an https URL only, one GET of that page (6 second timeout, at most 300 KB, at most 3 redirects, https only). IP-literal hosts, localhost and private ranges are not fetched. The page is used only to read `citation_doi`, `dc.identifier` when it holds a DOI, or `citation_pmid`.

Nothing recognised is 400 `link_unrecognised`:

```json
{ "error": { "code": "link_unrecognised", "message": "Paste a PubMed, DOI, PMC or journal article link (a link to one study).", "requestId": "..." } }
```

Metadata comes from PubMed when a PMID can be resolved (PMCID and DOI go through the NCBI id converter, then a DOI-only lookup uses esearch `"<doi>"[doi]`). With no PMID, Crossref supplies the record. Nothing found is 404 `paper_not_found`.

Response 200:

```json
{
  "card": {
    "pmid": "31535829",
    "pmcid": "PMC...",
    "doi": "10.1056/nejmoa1911303",
    "title": "...",
    "journal": "...",
    "year": 2019,
    "authors": ["McMurray JJV", "..."],
    "url": "https://pubmed.ncbi.nlm.nih.gov/31535829/",
    "freeFullText": true,
    "design": {
      "key": "rct",
      "label": "Randomized controlled trial (RCT) (people were assigned to groups by chance)",
      "source": "publication_type"
    },
    "sampleSize": { "n": 4744, "quote": "..." },
    "structured": true,
    "sections": [
      { "label": "Background", "text": "..." },
      { "label": "Methods", "text": "..." },
      { "label": "Results", "text": "..." },
      { "label": "Conclusions", "text": "..." }
    ],
    "findings": [
      { "measure": "HR", "format": "estimate", "estimate": 0.74, "ciLower": 0.65, "ciUpper": 0.85, "p": "<0.001", "quote": "..." }
    ],
    "conclusion": "...",
    "mesh": ["Heart Failure", "..."],
    "keywords": [],
    "method": "api",
    "tokensUsed": 0
  }
}
```

`design` is null when no publication type or MeSH heading matches. `source` is `publication_type` or `mesh`.
`sampleSize` is null when the abstract has no plausible count. The quote is the matched text.
`structured` is true when the abstract had labelled sections.
`findings` holds every estimate with a confidence interval and every counts row the shared parser can read, each with its exact quote, at most 5. A counts row is `{ "format": "counts", "events1", "total1", "events2", "total2", "quote" }`.
`conclusion` is the Conclusions or Interpretation section, otherwise the last abstract sentence.
`method` is `api` on a fresh read and `cache` when the shared cache answered.
`freeFullText` is true when a PMCID is known.

Cache table `research_paper_cards`, shared across users. The key is `pmid:<digits>` or `doi:<lowercased doi>`. Both keys are written when both ids are known. A hit does no fetch and no charge. The audit event is `paper_card.viewed` and its metadata is the ids only.

## POST /v1/projects/{pid}/paper-card/explain

Write role. One model call, and only as a fallback.

Request:

```json
{ "pmid": "31535829", "doi": "10.1056/nejmoa1911303" }
```

At least one of `pmid` or `doi` is required. The card must already be in the cache (paste the link first).

When the cached card has `structured: true` and at least one finding, the response is 400 `not_needed`:

```json
{ "error": { "code": "not_needed", "message": "This study is already summarised for free.", "requestId": "..." } }
```

Otherwise one call through the same pipeline as extraction suggestions (PHI gate, caps, MaiK token reserve, temperature 0, at most 350 output tokens). The input is the title and the abstract only, capped at 3000 characters.

The model returns JSON `{ population, intervention, comparison, outcome, design, mainResult, conclusion }`, each a short string. `mainResult` is dropped when it contains a number that is not in the abstract. The object is saved on the same cache row as `card.ai` and `card.aiModel`. The next request returns that object and charges nothing.

402, before the provider is called:

```json
{ "error": { "code": "insufficient_credits", "message": "You need more MaiK tokens", "requestId": "..." } }
```

Response 200:

```json
{ "card": { "ai": { "population": "...", "mainResult": "..." }, "aiModel": "..." }, "model": "...", "costInr": 0.12 }
```

`card` is the cached card plus `ai` and `aiModel`. `tokensUsed` on the card stays 0. The charge for this fallback is `costInr`.
