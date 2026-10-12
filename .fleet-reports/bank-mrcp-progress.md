# bank-mrcp progress (no item text here; safe to commit)

Job: MRCP Part 1 (~1,500) + MRCP Part 2 Written (~1,500) best-of-five banks.
Cap: $18 Claude API (haiku gen, sonnet blind verify). Spend log: /tmp/bank-mrcp-spend.tsv.
Pipe state: /tmp/bank-mrcp-pipe (waves, runs, grounding, publish staging).

Design (2026-10-12):
- Sets: maik18 (P1 text), maik19 (P2 text), maikimg10 (P2 images). See BANK-SETS-CLAIMED.md.
- Taxonomy: new branch `mrcp`, 16 Federation-category subjects (mrcp-cardiology ...).
  New tab `mrcp` (prep.js EXAMS + EXAM_CHOICES entries at switch-on).
- 5 options: app renderer already generic; generation via pipeline-local 5-option
  driver (no production engine change); toOverlay extended to accept o.length 5.
- P1/P2 separation: item-level `ex` tags (mrcp-part1 | mrcp-part2-written) +
  profile-aware filtering in fixed-tests examLists + Tests-tab prepare().
- Tiers: T3 textbook consensus (dual blind haiku+sonnet) + T4 NICE guidance
  (fetched excerpts, sonnet blind grounded). Disagreement -> review queue, no referee.

Log:
- 2026-10-12: discovery done; sets claimed; branch bank-mrcp-1 pushed.
- 2026-10-12 (restart, new worker): continued from origin/bank-mrcp-1 (c37795fdf).
  Text gen done a-d: 2763 kept post-gates (a 658, b 694, c 646, d 765).
  Pilot 0/24 verify-ok was stale code; live verify parses 40/40.
  Wave A verify: 583/658 ok, upgrade batch msgbatch_01Lyfc4jpNsFrPvubNaMPkj8 submitted;
  waves B/C/D verify+upgrade running. Spend ~$3.78/$18.
  Fixed mrcp-img.mjs: gen used legacy tools/tool_choice which readMessage cannot
  parse (all 180 bad-output); switched to output_config json_schema + engine gates
  + mrcp-* sid mapping (4 out-of-syllabus histology images dropped, 176 remain).
  NOTE: /tmp/mrcp-wt worktree vanished; adopted /private/tmp/bank-mrcp-wt.
- 2026-10-12 (restart, agy worker): verified text waves a-d DONE post-upgrade:
  2454 passed with explanations (P1 1392, P2 1062) + 309 review-queue.
  mrcp-img verify+upgrade DONE: 61 passed (all P2, CC-licensed, files staged) + 14 review.
  Appended 2763 wave stems to pipe dedup harvest (cross-wave protection).
  Launched mrcp-e P2-weighted top-up (all 16 subjects, P1 n=2/P2 n=6, 1024 req;
  gen batch msgbatch_01Gwjt8MJD82J8XKtTgnFPgq). Spend ~$8.12/$18.
- 2026-10-12 (agy, cont.): P1/P2 separation landed on branch (profile item_ex,
  prep-assess assemble filter, prep.js EXAMS+poolFor, plan choices, fixed-tests
  EXAMS; tests 21+22 pass) + pushed. Publish staging ready in
  /tmp/bank-mrcp-pipe/publish (maik18 1322 P1, maik19 1050 P2, maikimg10 61 P2).
  Quality gate found 82 items with placeholder short stems (e.g. 'Q4', topic
  slugs; vignette not stored): DROPPED from staging, reported, not released.
  Wave mrcp-e still in gen. Spend $8.12/$18.
- 2026-10-12 (agy, cont.): wave-e DONE (598 passed: 152 P1 + 446 P2, $2.29).
  Staging now maik18 1446 / maik19 1490 / maikimg10 61 (34 wave-e shorts dropped).
  Wave-f P1-only (128 req) in verify; gen 91 kept. Overlay dry-builds OK
  (maik18 128 mods, maik19 126, maikimg10 27); image items mapped to real
  curriculum topics (keyword match, fallback first module). Uploads wait for
  wave-f (overlay files immutable). Spend $10.41/$18.
- 2026-10-12 (agy, DONE pending merge): ALL PUBLISHED + PR #1524 open.
  Final: maik18 1507 P1 text, maik19 1490 P2 text, maikimg10 61 P2 image
  (mk-img-* ids) + 61 webp live; v5/mrcp-* indexes live; manifest union-merged;
  counts union-kept (48 sets incl. siblings' ck1/maik20-25/plab/mrcs/img);
  ID index rebuilt, verify 0 wrong (210,946 entries).
  159 fixed papers live (P1 77: 15 grand/15 mini/32 subject/15 daily10;
  P2 82: +5 image), index union-merged to 1,156; 10,680 paper items, 0 P1/P2 leaks.
  Profiles available (calibration stays provisional); item_ex scoping in
  assembler+poolFor; arena soonFor fixed; MaiK lines added for mrcp subjects.
  Successfully rebased twice (kept both sides; restored ck1/plab/mrcs/img sets
  that a sibling regen had dropped from counts).
  CI: all PR checks pass except unit-tests, whose failures are identical on
  main (maik queue, ophthalmos, MaiK-lines plab-anaesthesia, rad taxonomy/
  radmax/medcov, onco-store; all pre-existing, none in prep files I own).
  My suites: assess 21, plan 22, qgen 27, app 32, arena 14 pass.
  Spend $10.86/$18. Caches deleted, disk 4.24 GB free. Worktree kept at
  /private/tmp/bank-mrcp-wt (branch pushed, PR unmerged).
