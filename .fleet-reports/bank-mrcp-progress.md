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
