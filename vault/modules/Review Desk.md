---
tags: [module, clinical-content, review]
status: built 2026-09-25 (flag ON, Home tile defOn false). Local only; server sync is wave 2.
flag: smd_review_desk (client, def:true, ?review=0 hides it)
---
# Review Desk and Source Watch

Two tools for keeping AI-drafted clinical content honest (owner's list F1, F2).

## Review desk (F1)
Home > Add Tool > "Review content" (`home.js` `act:"review"`, defOn false). Lists every protocol
([[Clinical Protocols]]), specialty kit ([[Specialty Kits]]) and consent template
([[Clinical Documents]]) with its review state. A reviewer reads an item ("Read it" opens it on top),
chooses **Approve**, **Approve after the minor edits I describe** or **Needs changes**, comments, and
exports all decisions as one JSON file through the share sheet (clipboard on the web).
- Decisions are stored on the phone (`smd_review_decisions`: content ids, decisions, comments; never
  patient data). Reviewer name from the account; Reg. No. from `SMD_RX.verifiedInfo()` (read-only then).
- `#smdReview` is z 870, just under the kit sheet (880) so "Read it" on a kit opens above it.

**Applying an export:** `node scripts/apply-reviews.mjs <file.json> [--dry] [--include-minor]
[--accept-unverified]`. Approve sets `review.status: "reviewed"` and `reviewer: "<name>, Reg. No. <n>,
<date>"`, rewriting only the `review` object in place (the rest of the hand-formatted JSON stays
byte-identical; the script checks the parse is otherwise equal). Approve-minor and needs-changes go to
`vault/handoff/review-feedback.md` as a checklist; approve-minor changes status only with
`--include-minor` once the edits are made. Already reviewed or approved items are never changed.
An unverified reviewer needs `--accept-unverified` (the owner vouches). Then the touched bundles are
rebuilt; run the tests and commit.

## Source watch (F2)
`node scripts/check-guideline-updates.mjs [--update] [--limit N]` fetches every URL cited by a protocol,
kit or consent template (719 on 2026-09-25) and compares it with `kb/source-watch.json`. Web pages are
fingerprinted by visible text (scripts, styles, tags stripped); PDFs by their length, Last-Modified and
ETag headers (not downloaded). The report (`vault/handoff/source-watch-report.md`) lists broken, moved,
changed, recovered, new, still-broken and blocked (401/403/429, publishers refusing bots). Weekly in
GitHub Actions (`.github/workflows/source-watch.yml`, Mondays 03:17 UTC + manual): job summary and an
artifact, nothing committed. Refresh the baseline locally with `--update` after reading a report.
- Baseline of 2026-09-25 (from the cloud sandbox): 537 ok, 175 blocked, 7 broken. Locally, set
  `NODE_USE_ENV_PROXY=1` behind a proxy (Node's fetch ignores HTTPS_PROXY otherwise).

## Wave 2 (server, not built)
Sync decisions to the server so the owner sees them without a file; reviewer identity from the
verified claim server-side. See [[Roadmap]].

Key files: `review-desk.js`, `clinical-docs.css` (styles), `scripts/apply-reviews.mjs`,
`scripts/check-guideline-updates.mjs`, tests in `test/kit-tools-docs.test.mjs` and
`test/run-specialty-kits-ui.mjs`.
