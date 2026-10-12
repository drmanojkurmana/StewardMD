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
