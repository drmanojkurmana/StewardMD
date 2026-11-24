# ResearchMD screening blinding rules (2.5 builder contract)

Dual independent review: every item is voted at two stages
(`title_abstract` on the record, `full_text` on the report) by two
reviewers. A reviewer never sees the peer vote until both have voted.
Enforcement is in the API; the schema stores one row per reviewer per
item per stage (`research_screening_decisions`) and the list view redacts
(`decision-list.response.json`).

## Rules

- **B1. Hidden until both decide.** The vote list shows the caller's own
  votes in full. The peer vote reads `decision: "hidden"` with no reason
  code and no timestamp until both reviewers have a current vote. Viewers
  see no votes at all, only the outcome. No endpoint, export or log
  bypasses this; the audit log records who viewed what, not the votes.
- **B2. Votes are immutable rows.** Re-voting before unblinding inserts a
  new row; the latest row per reviewer counts and earlier rows stay for
  audit. After unblinding (both decided, no open conflict) votes freeze:
  changing a vote then requires a conflict, not a re-vote.
- **B3. Conflicts open automatically.** Once both reviewers have a current
  vote, the API opens a conflict (one row per item per stage) when the
  votes disagree OR either vote is `uncertain`. A second vote that creates
  a conflict returns it (`conflictId`); voting on an item with an open
  conflict answers 409 `conflict_open`.
- **B4. Resolution is owner/editor only.** The resolver sees both votes
  (unblinded) plus reasons. The resolver should not be a voter on that
  item; a voter may resolve only when no non-voter owner/editor exists,
  and the resolution records that fact in its note. Resolution is
  `include` or `exclude` with a reason code required for `exclude`.
- **B5. Reasons are coded, never free text.** `exclude` and conflict
  resolutions that exclude require a global or project reason code
  (`reason-list`). Free-text notes stay out of PRISMA counts.
- **B6. No machine votes.** Suggestions (T1, Phase 3.5) never write votes
  and never resolve conflicts. A suggestion the reviewer accepts becomes
  the reviewer's own vote only when the reviewer submits it.
- **B7. Unblinding is an event.** The moment both votes exist, both
  reviewers may see both votes. The API logs the unblinding per item; the
  screen announces it so neither reviewer is surprised.

## Worked example

Record R has reviewers A and B at title/abstract. A votes `exclude`
(`WRONG_POPULATION`). B's list shows peer `hidden`; B votes `include`.
The API opens conflict C (outcome `conflict`, both votes now visible to
A and B per B7). Owner O (not a voter) resolves `exclude` with
`WRONG_POPULATION`. The PRISMA view counts R under `records_excluded`;
the by-reason breakdown counts one `WRONG_POPULATION`.
