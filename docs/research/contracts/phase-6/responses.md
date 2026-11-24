# ResearchMD Phase 6: reviewer-response workspace (5B.5), `_responses.js`

Migration 0005: `research_reviewer_comments`, `research_reviewer_responses`.
Every route verifies Firebase claims and the project role; outsider 404.
Comments are immutable reviewer input (append-only); responses are editable
with the house optimistic-concurrency `version` (stale -> 409 `stale_version`
with the current row).

## Routes

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/v1/projects/{pid}/reviewer-comments` | owner/editor/analyst | `{round?, reviewerLabel, text, sectionRef?}`; round >= 1 default 1; 201 |
| GET | `/v1/projects/{pid}/reviewer-comments?round=` | all | list, round ASC then createdTs ASC |
| POST | `/v1/reviewer-comments/{cid}/responses` | owner/editor/analyst | `{text, manuscriptVersionId, sectionId, changeNote}`; 201 |
| GET | `/v1/reviewer-comments/{cid}/responses` | all | list for the comment |
| GET | `/v1/projects/{pid}/reviewer-responses` | all | workspace list, newest first |
| PUT | `/v1/reviewer-responses/{rid}` | owner/editor/analyst | `{version, text?, status?, manuscriptVersionId?, sectionId?, changeNote?}`; version bump |

## Mandatory link (plan 5B.5)

Every response carries, at creation:
- `manuscriptVersionId` (1-120 chars): pointer to the Phase 5A manuscript
  version the change landed in;
- `sectionId` (1-120 chars): the manuscript section changed;
- `changeNote` (1-2000 chars): what changed.
A response without all three is 400 `invalid_response`. The 5A manuscript
store is not in D1 yet (it lives in the Phase 5A backend contract), so the
link is a validated pointer, not a foreign key; referential enforcement lands
with the 5A D1 store. `status` is `draft` (default) or `final`; marking final
is a human action, never automatic.

Field bounds: `reviewerLabel` 1-80, comment/response `text` 1-8000,
`sectionRef` <= 200. Audit events: `reviewer_comment_added`,
`reviewer_response_added`, `reviewer_response_updated`.
