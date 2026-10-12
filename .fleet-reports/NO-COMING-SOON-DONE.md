# NO-COMING-SOON DONE (PrepNucleus, 2026-10-12)

## Top finding

No student-visible "coming soon" remains in PrepNucleus: 15 surfaces found,
all reworded to neutral truth or hidden, with a guard test that fails on
regression. Content for the 191 empty + 174 thin modules is NOT built yet
(bank pipelines own generation; their quota was exhausted at ship time) and
is reported below as exact remainder with cost to finish.

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
  Structure kept: format shown, no test buttons, Arena closed. NO profile
  flipped: #1524 (MRCP bank) is not on origin/main and no MRCP bank exists
  under prep/bank/ (`find prep -iname '*mrcp*'` = 2 profiles only).
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

- 191 zero-item modules (183 PLAB/MRCS scaffold + 8 real SS gaps, §3 of
  inventory) and 174 thin (<10) modules: min 25 MCQs each ≈ 9,100+ items.
- PYQ items with no explanation: count unknown from repo (live PYQ file is
  R2-only; manifest gives explained=942, total unstated).
- Cost evidence (ledger): bank-amc-mccqe $1.5595/~3071 items;
  bank-plab-mrcs $2.4187 in flight; bank-mrcp-gen-* ~$2.4 pilot.
  Finish estimate ≈ $5-10 at observed rates: inside the $30 job budget and
  the $79.72 headroom to the $192 stop.
- Generation belongs to the bank pipelines (gen.mjs/qgen, haiku gen, sonnet
  blind-key verify, gates g1-g5/style/g9b/verbatim/dup, dedupe, overlays),
  already in flight (muse-bank-plab-mrcs / step2ck / mrcp logs); their API
  quota was 429-exhausted at ship time. Next: run the priority order in
  inventory §4 when quota resets, then flip Step-2-CK/MRCP profiles to
  available (data-driven, no code change) and re-run the guard.
- Profiles intentionally left "coming": usmle-step2-ck, mrcp-part1,
  mrcp-part2-written.

## Spend

This turn: $0 API (no generation calls). Ledger unchanged: 213 rows,
$112.28 total. Job ledger: /tmp/no-coming-soon-spend.tsv (header + $0 row).

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
