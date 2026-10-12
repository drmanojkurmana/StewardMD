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

## Content built, wave 2: maik27 (61 MCCQE modules, 1,204 verified MCQs)

Same pipeline (haiku gen, sonnet blind verify, gates + local jaccard>=0.6
screen vs 1,521 R2 overlay stems; 10 dups dropped). MCCQE Part I vignettes
in Canadian practice. All 61 thin mcc-* modules now >=25.
Shipped: overlay/maik27 (61 files, R2, live-verified), prep.js OVERLAYS +4
subjects, counts +maik27, share-ID index republished (0 wrong). Spend $17.97.

## Content built, wave 3: maik28 (15 AMC modules, 273 verified MCQs)

child-health (7: jaundice, exanthems, cardiac, renal, endo, adolescent,
indigenous) + mental-health (8: depression, anxiety, ocd, ptsd, sleep,
drugs, child, crisis), Australian GP framing, screened vs 390 R2 stems
(2 dups dropped). Shipped: overlay/maik28 (15 files, R2, live-verified),
OVERLAYS +2 subjects, counts +maik28, share-ID index republished (211,262
MCQs, 0 wrong). Spend $4.43. Exception: ch-haem reached only 17/25 (heavy
gate losses, then its retry batch wedged 60+ min at 0/3) — still thin.

## Content built, wave 4: maik29 (12 modules, 216 verified MCQs)

ch-haem retry as a fresh batch (8/8 verified; 9 base + 16 new = exactly 25)
plus 11 NEET-SS thin modules to >=25: ss-cardiology 1 (pericardial),
ss-critical-care 3 (scoring, environmental, post-icu), ss-endocrinology 1
(polyglandular-immunotherapy), ss-nephrology 4 (alport, BK polyomavirus, GFR
biomarkers, paediatric), ss-pulmonology 2 (DAH-vasculitis, rare ILD).
Same pipeline (haiku gen, sonnet blind verify, gates + local jaccard>=0.6
screen vs R2 stems; 0 dups). Shipped: overlay/maik29 (12 files, R2,
live-verified per file), prep.js OVERLAYS +4 subjects (+maik29 on 2 more),
counts +maik29 (52 sets, nothing dropped/changed), share-ID index
republished (211,478 MCQs checked, 0 wrong). Spend $3.57 across 19 jobs.
Follow-up maik30: sen-monogenic-diabetes retry (steered with 223 R2 bank
stems) yielded 4/4 blind-verified; shipped with the 16 held items as
overlay/maik30 (19 items; the publish gate dropped one off-topic stem
about transient neonatal hyperinsulinism). Base 7 + 19 = 26, at the bar.
Spend $0.07. All 12 wave-4 SS modules plus ch-haem now >=25.

## Remainder (content, NOT done) with cost to finish

- Thin (<10) modules left: 97 (was 110 before wave 4, 186 before wave 2):
  AMC-plan adult-health-medicine 18, adult-health-surgery 10,
  womens-health 11, population-health-and-ethics 10; SS gen-med 12, neuro 6,
  rheum 6, onco 5, ID 4; PLAB/MRCS/MRCP-plan smalls 10. ≈ 1,675 items to
  the 25-bar ≈ $28.50 at $0.017/item — beyond the remaining $1.16 of the
  $30 job budget; needs a follow-up budget.
- PYQ without explanation: counted exactly — 2,570 of 10,483 live items
  (660 empty + 1,910 short, 19 subjects). Dry-run estimate $1.53 via
  tools/prep-explain.mjs (Vertex Batch) — NOT runnable from this sandbox
  (no PREP_VERTEX_PROJECT / gcloud auth). Run there when creds exist.
- Modules at 10-24 (never "thin", out of this job's scope): remainder of
  child-health/mental-health to 25 (~340 items ≈ $6), SS 10-24s.
- Profiles: MRCP + Step 2 CK available (bank-backed). NO exam profile has
  bank.status "coming" left: the coming-section/Arena-gate neutrals are now
  dormant fallbacks.

## Spend

Content spend, all waves: $28.84 API (146 batch jobs, haiku gen + sonnet
verify) for 1,875 verified MCQs ($0.0154/item):
maik26 $2.80 (163), maik27 $17.97 (1,204), maik28 $4.43 (273),
maik29 $3.57 (216), maik30 $0.07 (19).
Job ledger: /tmp/no-coming-soon-spend.tsv (146 rows). Global ledger file is
read-only from this sandbox (still 213 rows, $112.28 on disk): the rows must
be appended by the ledger owner; true total then $141.12, under the $192
stop and inside the $30 job budget ($1.16 left).

## Verification

- New test/prep-no-coming-soon.test.mjs: 3/3 pass. Retro-probe of the same
  scan logic against HEAD: 9 hits (proves the guard catches the old code).
- Neighbour suites green with the prescribed flags
  (`--experimental-test-module-mocks --experimental-sqlite`):
  prep-app 33, prep-assess 23, prep-arena-server 14, prep-qgen 26,
  prep-social-server 7, prep-create 37, specialty-bank 10,
  specialty-tools 9, specialty-engine 5, prep-core 18, prep-nav 10,
  prep-lessons 23, prep-subject 6.
- Known-set failures only, both unrelated to this diff:
  ophthalmos-module (?v= tokens / byte-identical check; files untouched).
  prep-arena-server without the prescribed flags fails on
  `mock.module is not a function` (harness flags, not product code).
