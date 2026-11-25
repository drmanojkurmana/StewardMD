# Polish, journal format check, reference import (server contract)

Client mocks should match these JSON shapes. No em dash or en dash in `detail`, `label`, `reason` or error messages.

Write role for polish and import: owner, editor, analyst. Viewer and reviewer get 403 `not_member`. An outsider gets 404 `project_not_found`.

Format check is a read: owner, editor, analyst, reviewer and viewer. An outsider still gets 404.

There is no `requestId` in a success body. Header `x-request-id` is set. Errors use `{ "error": { "code", "message", "requestId" } }`.

## A. POST /v1/projects/{pid}/ai-draft task `polish`

Same pipeline as the other Ask MaiK tasks (`ai-draft.md`): PHI gate, caps, MaiK token reserve, one provider call, temperature 0, usage log, settle. The draft is stored only in `research_ai_drafts` with `status: "unverified"`. It is not written into the manuscript.

Request:

```json
{
  "task": "polish",
  "input": {
    "text": "The effect was {{run:run_1.ciLower}} to {{run:run_1.ciUpper}} and patients improved.",
    "journalId": "bmj",
    "sectionId": "discussion"
  }
}
```

`text` wins when it is a non-empty string. Otherwise the server reads `sectionId` from the latest manuscript version and does not write it back. Missing both, or an empty section, is 400 `invalid_body` ("Section text is required."). Unknown section is 404 `section_not_found`. No manuscript is 404 `manuscript_not_found`. Text longer than 5000 characters is 400 `invalid_body`.

`journalId` is optional. Spelling follows the journal id. American: `nejm`, `jama`, `jama_internal_medicine`, `annals`, `plos_medicine`. Anything else, including a missing id and an Indian journal id, is British.

Output cap is 2000 tokens (the T1 ceiling). One call.

Success 200:

```json
{
  "draft": {
    "id": "draft_...",
    "status": "unverified",
    "task": "polish",
    "polished": "The effect was {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, and patients improved.",
    "changes": [
      { "before": "ciUpper}} and", "after": "ciUpper}}, and", "reason": "grammar" }
    ],
    "sectionId": "discussion",
    "journalId": "bmj",
    "spelling": "British"
  },
  "model": "gemini-3.1-flash-lite",
  "costInr": 0.12
}
```

`changes[].reason` is exactly one of:

- `grammar`
- `clarity`
- `concision`
- `academic tone`
- `tense consistency`
- `British spelling`
- `American spelling`

The spelling reason must match `draft.spelling`. `before` is an exact substring of the section (empty `before` is an insertion). `after` is an exact substring of `polished` (empty `after` is a deletion). `before` and `after` are not equal.

Hard checks. Any failure is 422 `invalid_draft` and the row is not stored:

- Every `{{run:...}}` token survives unchanged, with the same count.
- No new number. Digits inside a `{{run:...}}` token do not count as a number in the section, so writing that number in words outside the token is rejected.
- No new citation. Citations are `[@key]`, `\cite{key}`, numbered `[1]` or `[1-3]`, and author-year `(Smith, 2020)`.
- `polished` length is at most 1.2 times the section. The comparison is integer: `polished.length * 5 <= text.length * 6`.
- A changed text with an empty `changes` array is rejected. A listed change with identical text is rejected.

402, before the provider is called, when the wallet cannot reserve the call:

```json
{ "error": { "code": "insufficient_credits", "message": "You need more MaiK tokens", "requestId": "..." } }
```

PHI in the section is 422 `phi_blocked` and the provider is not called.

## B. GET /v1/projects/{pid}/format-check?journal={id}

Deterministic. No model call and no MaiK tokens. `journal` is required (400 `invalid_body` when missing). Unknown journal is 404 `journal_not_found`. No manuscript version is 404 `manuscript_not_found`. The latest version is used.

Success 200. The body is an object, not a bare array:

```json
{
  "journalId": "bmj",
  "journalName": "The BMJ",
  "checks": [
    {
      "check": "word_count",
      "status": "warn",
      "detail": "120 words in the main text. No main-text word limit is on file for The BMJ.",
      "label": "Word count (how many words the paper has)",
      "sectionId": "results"
    }
  ]
}
```

`status` is `pass`, `warn` or `fail`. `label` is the scientific term, then the plain meaning in brackets. `sectionId` is the manuscript section a Fix button should open.

`checks` is always these 11 ids, in this order:

| check | sectionId | pass | warn | fail |
| --- | --- | --- | --- | --- |
| `word_count` | `results` when a results section exists, else `manuscript` | main text within `word_limit_main` | limit is null | over the limit |
| `abstract` | `abstract` | structured headings and within `word_limit_abstract` | headings present, limit null | missing, missing heading, or over the limit |
| `title_length` | `title` | within `limits.titleWords` when a test supplies it | no title limit on file (the route always warns) | empty title, or over a supplied limit |
| `tables_figures` | `results` | both limits known and within them | either limit null (the route always warns) | over a known limit |
| `reference_count` | `references` | within `limits.references` when supplied | no reference-count limit (the route always warns) | over a supplied limit |
| `reference_style` | `references` | in-text cites match numbered (Vancouver, AMA) or author-year | style null or unknown, no in-text cites, or only `[@key]` | mixed styles, or the other family |
| `run_tokens` | section that contains `{{run:`, else `results` | every token resolves, or there are none | never | unresolved or malformed `{{run:...}}` |
| `citations` | `references` | every reference is cited and every in-text cite is in the list | no list and no cites | a reference is uncited, or a cite is not in the list |
| `keywords` | the keywords section id, else `keywords` | 3 to 6 keywords | never | 0, 1, 2, or 7 or more |
| `required_sections` | first missing id, or `introduction` when all are present | Introduction, Methods, Results, Discussion, ethics, funding, conflicts, data availability | never | one or more missing |
| `reporting_checklist` | `checklist` | 100% of the paper-type checklist | paper type has no checklist, or 1 to 99% | 0% |

Word limits and reference style come from `research_journals` (`_journals.js`). Null numeric limits are `warn`. The route does not invent title, table, figure or reference-count limits. A pure checker used by tests may pass `journal.limits` `{ titleWords, tables, figures, references }` to score those three checks.

Main-text word count skips abstract, references, keywords, ethics, funding, conflicts, data availability and title. Abstract structure looks for `Background` or `Objective` or `Aim`, `Methods`, `Results`, and `Conclusion`, each with a colon. A keyword line inside the abstract is not counted as abstract words.

`{{run:id.field}}` resolves from `research_runs.result_json` (nested numeric fields, and a length-2 numeric array) and from the version `tokens_json` when `value` is not null. `{{run:id.ci}}`, `{{run:id.ci95}}` and `{{run:id.confidence_interval}}` also resolve when both `ciLower` and `ciUpper` exist.

Citations match a reference by `[@key]` or `\cite{key}`, by 1-based number (`[1]`, `[1-3]`, `[1, 2]`), or by first-author family plus year `(Smith, 2020)`.

Keywords are the keywords section, or a `Keywords:` line, split on `;` or `,`.

Paper type (`research_projects.study_type`) selects the checklist: rct / randomised / randomized to CONSORT, cohort / observational / cross_sectional / case_control to STROBE, diagnostic to STARD, prognostic to TRIPOD, systematic_review / meta_analysis to PRISMA, case_report / case_series to CARE, protocol to SPIRIT. Completion is non-empty `research_checklist_manual` rows whose item number is on that checklist, divided by the item count.

## C. POST /v1/projects/{pid}/imports

`format` is `ris`, `bibtex`, `csv`, `csl-json`, `endnote-xml` or `nbib`. Aliases accepted by the server: `csl` and `json` parse as CSL-JSON, `endnote` and `xml` as EndNote XML, `medline` as NBIB. Anything else is 400 `invalid_search`.

Upload (`POST /v1/projects/{pid}/import-uploads`) accepts `.ris`, `.bib`, `.bibtex`, `.csv`, `.json`, `.xml`, `.nbib`. Other extensions, including `.txt`, are 415 `file_type`.

Parsers:

- CSL-JSON: a JSON array (Zotero Better CSL JSON), `{ "items": [ ... ] }`, or one object (some Mendeley exports). Authors are `{ "family", "given" }`, `literal`, or a string. Year is `issued.date-parts[0][0]` or `issued.raw`. DOI is `DOI` or `doi` (a `https://doi.org/` prefix is stripped). PMID is `PMID` or `pmid`.
- EndNote XML: each `<record>`. Title from `<titles><title>`. Authors from `<authors><author>`. Year from `<dates><year>`. DOI from `<electronic-resource-num>`, `<isbn>` or `<accession-num>` when the value matches `10.xxxx/...`. A numeric accession that is not a DOI is the PMID.
- NBIB (PubMed MEDLINE): `PMID-` starts a record. Continuation lines are indented at least three spaces. `FAU` is preferred over `AU`. Year is `DP` or `DEP`. DOI is the `10.xxxx/...` value in `LID` or `AID`.

Stored `source` is the canonical value, not the alias: `import:csl-json`, `import:endnote-xml`, `import:nbib`. `externalId` is the normalised DOI, else the PMID, else `t` plus an 8 hex FNV-1a of title, year and first author.

Success 201, same shape as RIS / BibTeX / CSV:

```json
{
  "import": {
    "searchRunId": "srch_...",
    "recordsAdded": 42,
    "duplicatesFlagged": 5,
    "groupIds": ["ddg_..."]
  }
}
```

The client line "42 added, 5 duplicates skipped" uses `recordsAdded` and `duplicatesFlagged`.

Dedup:

- Same `source` and `externalId` already stored: not inserted. Counts as a flagged duplicate. Re-import of the same file adds 0.
- Same DOI, same PMID, or same normalised title + year + first author as a record that already existed before this import: not inserted. Counts as a flagged duplicate. This is what skips a Zotero export of papers already in the project.
- A duplicate inside the new file, against another row of that same file, is still inserted and then flagged by the existing dedup pass. PRISMA can count it. This keeps the phase 2 rule: within one file, duplicates are flagged, not dropped.

`recordsAdded` is the number of inserted rows. `duplicatesFlagged` is skipped rows plus inserted rows that are not the canonical member of a dedup group.
