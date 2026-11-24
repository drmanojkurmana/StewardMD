# Ask MaiK drafts, including thesis to paper (server contract)

Client code should match these JSON shapes. Write role: owner, editor, analyst.
Viewer and reviewer get 403 `not_member`. An outsider gets 404 `project_not_found`.

## POST /v1/projects/{pid}/ai-draft

Request:

```json
{ "task": "protocol", "input": {} }
```

`task` is `protocol`, `search_query`, `rob`, `checklist`, `title_abstract`, `thesis_to_paper` or `polish`.
Anything else is 400 `invalid_task`.
`polish` request and response shapes are in `polish-format-import.md`.
`input` is optional. A non-object is treated as `{}`.

Success 200. There is no `requestId` in the body. Header `x-request-id` is set.

```json
{
  "draft": { "id": "draft_...", "status": "unverified", "task": "protocol" },
  "model": "gemini-3.1-flash-lite",
  "costInr": 0.12
}
```

`draft.status` is always `"unverified"`. The row is inserted only into `research_ai_drafts`.
Nothing is written to `research_protocols`, `research_rob_assessments`, `research_checklist_manual`
or manuscript tables. A person saves through those routes.

Every task uses temperature 0 and one provider call (thesis: one call per section), through the
same pipeline as extraction suggestions: PHI gate, caps, MaiK token reserve, one provider call,
usage log, settle. Drafts are never auto-applied.

402, before the provider is called:

```json
{ "error": { "code": "insufficient_credits", "message": "You need more MaiK tokens", "requestId": "..." } }
```

PHI on a protocol, search, rob, checklist or title task (the assembled prompt):

```json
{
  "error": {
    "code": "phi_blocked",
    "message": "Patient identifiers detected; the AI call was blocked.",
    "requestId": "..."
  },
  "categories": ["email"]
}
```

A draft that fails schema checks is 422 `invalid_draft` and is not stored.
The provider may already have been called.

### protocol (max 1200 tokens)

`input.studies` is optional: `[{ "title", "abstract" }]`. The server also sends the project
title, study type, question, latest protocol outcomes and up to 30 stored study quotes.

`draft` adds:

```json
{
  "title": "BCG and hospital admission",
  "pico": { "population": "Adults", "intervention": "BCG", "comparison": "Placebo", "outcome": "Hospital admission" },
  "peco": null,
  "eligibility": ["Adults admitted with tuberculosis"],
  "outcomes": { "primary": "Hospital admission", "secondary": ["Death"] },
  "analysis": { "measure": "RR", "model": "random-effects" }
}
```

`peco` is an object only when `exposure` is non-empty, otherwise null.
`analysis.measure` is `RR`, `OR`, `HR`, `RD`, `MD` or `SMD` (anything else becomes `RR`).
`analysis.model` defaults to `"random-effects"`.
Empty title, empty eligibility, or pico missing population, intervention or outcome is 422.

### search_query (max 500 tokens)

```json
{ "pubmed": "(bcg[tiab]) AND (tuberculosis[mh])", "europePmc": "(bcg) AND (tuberculosis)" }
```

`pubmed` must have balanced `()` and `[]` and only these field tags:
`ti`, `tiab`, `tw`, `ab`, `mh`, `mesh`, `majr`, `au`, `pt`, `dp`, `la`, `sh`, `sb`,
`nm`, `rn`, `pmid`, `doi`, `ta`, `jt`, `ad`, `all`, `ot`, `edat`, `crdt`, `ptyp`, `pl`,
`mh:noexp`, `mesh:noexp`.
A missing or unbalanced `europePmc` is derived by stripping `[tags]` from the PubMed query.
An invalid PubMed query is 422 and no draft row is stored.

### rob (max 1500 tokens)

Needs at least one stored study, or `input.studies` does not create studies by itself.
No studies is 422 before the provider call.
Message mentions "Risk of Bias 2 (RoB 2) (could the study design have skewed its result)".

```json
{
  "tool": "rob2",
  "studies": [
    {
      "studyId": "st_...",
      "domains": [
        { "key": "d1", "judgement": "low", "reason": "Envelopes were used.", "quote": "concealed with envelopes" },
        { "key": "d2", "judgement": "", "reason": "", "quote": "" }
      ]
    }
  ]
}
```

Domains are always `d1` through `d5`. `judgement` is `low`, `some_concerns`, `high` or `""`.
The quote must be an exact substring of that study's stored quote, or of
`input.studies[].abstract` / `snippet` for the same `studyId`. Otherwise that domain is cleared
(`judgement`, `reason` and `quote` become `""`). No row is written to `research_rob_assessments`.

### checklist (max 1500 tokens)

`input.guidelineId` or `input.guideline`. Default `strobe`.
Aliases: `consort`, `spirit`, `strobe`, `stard`, `tripod`, `prisma`, `care`.
Unknown id is 400 `invalid_body` before the provider call.

```json
{
  "guidelineId": "strobe",
  "name": "STROBE (Combined Checklist)",
  "items": [
    { "itemNum": "1a", "topic": "Title and abstract", "status": "covered", "section": "Results" },
    { "itemNum": "2", "topic": "Background/rationale", "status": "missing", "section": "" }
  ]
}
```

`status` is `covered` or `missing`. Covered is kept only when `section` matches a manuscript
heading or section id, or `"protocol"` when a protocol row has keys. Otherwise it is forced to
`missing` and `section` is cleared. Unknown item numbers are dropped. Items the model omits stay
`missing`. A null model JSON still stores the full checklist as missing.

### title_abstract (max 800 tokens)

```json
{
  "title": "BCG and tuberculosis",
  "abstract": {
    "background": "Background of the review.",
    "methods": "",
    "results": "Risk ratio (RR) was {{run:r1.effect}}.",
    "conclusions": ""
  }
}
```

The prompt lists token names from the latest `research_runs.result_json` keys, not the numeric values.
A bare number outside a `{{run:<id>.<field>}}` token is removed. At least one abstract section must
remain. A string `abstract` is placed in `results`.

### thesis_to_paper (max 1200 tokens per section)

`input`:

```json
{
  "text": "optional when pages are sent",
  "pages": [{ "n": 54, "text": "Table 7. The mean age was 54 years in 120 patients." }],
  "section": "results",
  "wordLimit": 3000,
  "paperType": "",
  "checklist": "",
  "journalId": "",
  "format": "",
  "filename": "",
  "docxBase64": ""
}
```

`section` omitted means five calls: abstract, introduction, methods, results, discussion.
`section` set means one call, and the whole word limit applies to that section.
`wordLimit` is `input.wordLimit` when it is an integer from 1 to 20000, else the journal
`word_limit_main` when `journalId` matches a row with a positive integer limit, else 3000.

There is no DOCX reader in this repo. `format` `"docx"`, a `.docx` filename, or `docxBase64`,
without extracted text, is 422 and does not call a provider:

```json
{
  "error": {
    "code": "docx_needs_pdf",
    "message": "This file is a DOCX (Word document). Export it as PDF (in Word: File, then Save As, then PDF) and upload the PDF.",
    "requestId": "..."
  }
}
```

If extracted `text` or `pages` are already present, that text is used even when a docx flag is set.
PDF upload stays on the existing pdf-uploads route. This task does not extract a PDF.

PHI runs on the full extracted thesis text before any provider call. A hit does not call the provider:

```json
{
  "error": {
    "code": "phi_blocked",
    "message": "Patient identifiers (protected health information, PHI) were found. Remove them before MaiK reads this thesis.",
    "requestId": "..."
  },
  "categories": ["email"],
  "pages": [54]
}
```

`pages` lists page numbers (`n`) that contain a hit. Matched text is not returned.

`draft` adds:

```json
{
  "paperType": "rct",
  "checklist": "CONSORT",
  "suggestion": {
    "paperType": "rct",
    "checklist": "CONSORT",
    "label": "Randomised controlled trial (RCT) (a trial that assigns people by chance)"
  },
  "wordLimit": 3000,
  "wordCount": 12,
  "trimmedToWordLimit": false,
  "sections": [
    {
      "id": "results",
      "heading": "Results",
      "text": "The mean age was 54 years in 120 patients.",
      "flags": [],
      "numbers": [
        {
          "value": "54",
          "locator": { "page": 54, "table": "Table 7", "label": "From your thesis, page 54, Table 7" }
        }
      ]
    }
  ],
  "suggestedTables": [
    { "id": "Table 7", "reason": "This table sits next to a result number in the thesis." }
  ],
  "references": [
    { "citation": "Smith 2019 BCG", "doi": "", "pmid": "", "flag": "check this reference" }
  ]
}
```

`suggestion` is deterministic from the thesis text, even when `input.paperType` is set
(`draft.paperType` then keeps the requested value):

- randomised, rct or placebo: `rct` / `CONSORT`
- systematic review or meta-analysis: `systematic_review` / `PRISMA`
- case series or case report: `case_series` / `CARE`
- else: `observational` / `STROBE`

`wordCount` is the number of whitespace-separated words across sections and is at most `wordLimit`.
`suggestedTables` is the first three distinct `Table N` mentions in the thesis.

Every number in a section must appear verbatim in the thesis text. A number that does not is removed
and that sentence is suffixed with " (check this number)". `flags` is `["check this number"]` when
any number was removed, else `[]`. Locators are attached only for numbers that remain after the
word trim. The label is "From your thesis, page 54, Table 7" when both are known.

`references` come from a `references` array on the model JSON (`citation`, optional `doi`, optional `pmid`).
The citation must be an exact substring of the thesis or the item is dropped.
`doi` and `pmid` are kept only when they appear verbatim in the thesis.
A kept reference with neither identifier has `flag` `"check this reference"`. Otherwise `flag` is `""`.
The server does not reformat the reference list into a journal style.
