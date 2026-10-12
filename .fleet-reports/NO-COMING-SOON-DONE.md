# NO-COMING-SOON DONE (PrepNucleus, 2026-10-12)

## Top finding

No student-visible "coming soon" remains in PrepNucleus: 18 surfaces found
(15 original + 3 "being added" from #1520 plan-scope), all reworded to
neutral truth or hidden, with a guard test that fails on regression. While
rebasing, #1524 landed the MRCP banks (Part 1: 1,507; Part 2 Written: 1,551;
`prep/bank/v5/mrcp-*` verified present) and flipped both MRCP profiles to
available data-driven, so Tests and Arena are open for MRCP with no code
change. Content: all 6 live zero-item modules filled with 163
blind-verified MCQs (overlay set maik26, shipped to R2 and wired into the
app); 186 thin modules and PYQ-without-explanation remain, costed below.

## What was built this turn (branch `fleet/no-coming-soon-ui-guard`)

Per exam/subject before → after (student-visible wording):

- NEET-PG / INI-CET / FMGE / NEET-SS / INI-SS / USMLE-Step-1 / PLAB-1 /
  AMC / MCCQE-1 / MRCS-A (banks available): nothing said "coming soon"
  except empty-module rows/cards. Now: zero-count modules are excluded from
  lists (`filterModules` drops n==0), zero-q subject tiles are not rendered
  (`tile` returns ""), hero/modRow fallbacks reworded to `No questions in
  this subject/module for this exam yet` (deep-link only, never printed for
  visible rows). Counts unchanged (no MCQs added or removed).
- USMLE-Step-2-CK / MRCP-Part-1 / MRCP-Part-2-Written (bank.status
  "coming", no bank landed): Tests `Format available, question bank
  coming.` → `No questions for this exam in the bank yet.` (+ neutral
  note); toast likewise; Arena home gate `Arena: coming soon` →
  `Arena is unavailable` + bank note; `soonFor` fallback neutral.
  Structure kept: format shown, no test buttons, Arena closed. No profile
  flipped by this patch itself: #1524 (rebased in) flipped both MRCP
  profiles on banked evidence (`prep/bank/v5/mrcp-*` verified present).
- Arena 503: `Coming soon: ...` → `Arena is temporarily unavailable,
  try again` (only on real server 503).
- Qgen `not open yet` → `not available right now`; Social likewise.
  Entries were already flag-gated (`canCreate()`, `G.PrepSocial`); no dead
  ends. If the flags are off for everyone the rows stay hidden.
- PYQ without explanation: `Explanation coming soon.` → `No explanation
  is stored for this question yet.` (same as bank items).
- specialty-bank 404 + specialty-tools pending-sim: neutral `No
  questions in this bank yet.` / `This simulator screen is not available`.
- specialty-learn / ophthalmos-learn / prep-lessons empty-lesson lines
  contain no banned words; kept.

## Remainder (content, NOT done) with cost to finish

## Content built: maik26 (all 6 zero modules filled, 163 verified MCQs)

Pipeline: tools/prep-qgen.mjs (Message Batches), haiku-5-5 generation,
sonnet-5-5 blind key verification only, engine gates + local jaccard>=0.6
screen (functions/_prep-core.js) against R2 sibling stems, overlay set maik26.

| Module | Before | After (verified ok) |
|---|---|---|
| ss-infectious-diseases / sid-newer-agents | 0 | 28 |
| ss-infectious-diseases / sid-hsct-id | 0 | 26 |
| ss-medical-oncology / son-trial-design | 0 | 26 |
| ss-medical-oncology / son-geriatric-aya | 0 | 29 |
| ss-medical-oncology / son-cardio-oncology | 0 | 26 |
| ss-rheumatology-immunology / srh-outcome-measures | 0 | 28 |

Zero-item modules bank-wide: 6 → 0 (PLAB/MRCS zeros were already covered by
plab1a-d/mrcs1a-d sets). Every item: 4 options, reasoning explanation,
neet-ss exam tag, blind-verified key. One self-dup dropped at the local
screen; R2 dedupe ran with bank stems on 5 of 6 first batches (first
sid-newer-agents batch missed the token; covered by the local screen: 0 dups
in 246 stems). Shipped: overlay/maik26 (6 files, R2, live-verified), prep.js
OVERLAYS +3 subjects, prep/bank/overlay-counts.json +maik26 (16 unrelated
sets restored after the counts tool dropped what it cannot see from this
sandbox; documented in PR), share-ID index republished (927 shards, verify
0 wrong over 207,469 MCQs + 1,769 lessons).

## Remainder (content, NOT done) with cost to finish

- 186 thin (<10) modules, mostly AMC/MCCQE/Australian/UK-plan subjects:
  ≈ 3,700 items ≈ $2-4 at the observed $0.017/item. Priority: MCCQE-1 thin,
  AMC thin, then PLAB/MRCS-plan and SS thin modules.
- PYQ items with no explanation: count still unknown from repo (live PYQ
  file R2-only; explained=942). Needs an R2-side count, then explanation
  batches for items that have none.
- Profiles: MRCP available (bank-backed); only usmle-step2-ck intentionally
  left "coming" until its clinical bank merges.

## Spend

Content spend this turn: $2.80 API (14 batch jobs, haiku gen + sonnet
verify, 123k in / 598k out tokens) for 163 verified MCQs ($0.017/item).
Job ledger: /tmp/no-coming-soon-spend.tsv (14 rows). Global ledger file is
read-only from this sandbox (still 213 rows, $112.28 on disk): the 14 rows
must be appended by the ledger owner; true total then $115.08, far from the
$192 stop and inside the $30 job budget.

## Verification

- New test/prep-no-coming-soon.test.mjs: 3/3 pass. Retro-probe of the same
  scan logic against HEAD: 9 hits (proves the guard catches the old code).
- Neighbour suites green with the prescribed flags
  (`--experimental-test-module-mocks --experimental-sqlite`):
  prep-app 32, prep-assess 20, prep-arena-server 14, prep-qgen 26,
  prep-social-server 7, prep-create 37, specialty-bank 10,
  specialty-tools 9, specialty-engine 5, prep-core 18, prep-nav 10,
  prep-lessons 23, prep-subject 6.
- Known-set failures only, both unrelated to this diff:
  ophthalmos-module (?v= tokens / byte-identical check; files untouched).
  prep-arena-server without the prescribed flags fails on
  `mock.module is not a function` (harness flags, not product code).
