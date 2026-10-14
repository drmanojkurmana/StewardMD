# Topic-diverse question selection in module sessions — DONE (2026-10-13)

Branch `diverse-sessions-1013` off `origin/main`. A 30-question session now covers as many DISTINCT concepts
of the module as possible instead of drawing at random.

## What changed

- `prep.js` PURE (ES5, deterministic per seed): `conceptKeyOf` / `conceptKeys` / `diversePick` / `diverseOrder`.
  Concept key priority: (1) Know-more `x.links` first target (kb/dr/pr/ls, pipeline confidence order) or a
  caller-supplied links map from a cached v2 shard; (2) fallback: answer head (first 2 content words of the
  correct option) + the 2–3 rarest stem words (pool-local document frequency, no network). Token memos are
  cached on the item (`_ckw`, link keys `_ck`); rarity is counted once per call.
- `customDraw` (mocks, QBank, custom module, setup leaf): module pools concept-ordered first, module
  round-robin kept, final take interleaved.
- `startModule`: test mode draws diverse; study keeps FSRS due reviews first, fills with diverse
  (unseen → previously wrong → oldest-seen, adaptive target difficulty kept), fallback likewise.
- `prep-setup.js` `draw` (Quick practice): quotas exact, then `diversifySwap` (repeats swapped for unused
  concepts inside the SAME type/seen/difficulty bucket), then interleave.
- `prep-assess.js` `assemble` (`diverse:true`, set by `prep-tests.js`): concept round-robin inside each
  subject quota bucket (module order otherwise kept), final take interleaved. Blueprint quotas unchanged;
  mistake-scoped takes (`opts.only`) keep the legacy path; diagnostic level-pairing untouched.
- `prep-plan.js` `startNew`: diverse per-module picks + diverse final order.
- `functions/_prep-arena.js` `drawItems`: server-side port (same stopwords/rule), pools ordered + final set
  interleaved; subject spread unchanged.
- Untouched as ordered: Nucleus360, Know-more drills, My mistakes review (`startWeak`/`startPlan`/incorrect
  composition all unchanged).

## Before / after: distinct concepts in a 30-question session (pools = bank + overlays, as `loadModule` merges)

| module (subject) | pool | concepts | biggest cluster | old exam | new exam | old study | new study |
|---|---|---|---|---|---|---|---|
| ans-cpr | 85 | 75 | `ls:ans_cpr` x10 | 29 | 30 | 26 | 30 |
| cm-arboviral | 190 | 173 | `ls:cm_arboviral` x10 | 29 | 30 | 30 | 30 |
| ent-aom-ome | 154 | 139 | text x2 | 29 | 30 | 29 | 30 |
| med-acs | 231 | 213 | `ls:med_acs` x10 | 29 | 30 | 29 | 30 |
| obg-abnormal-labour | 293 | 274 | text x3 | 30 | 30 | 30 | 30 |
| pat-acute-leukaemias | 212 | 192 | text x3 | 30 | 30 | 28 | 30 |
| ans-coexisting-disease | 65 | 63 | text x2 | 30 | 30 | 29 | 30 |
| ana-abdominal-wall | 191 | 176 | text x4 | 30 | 30 | 28 | 30 |
| ana-arm-elbow | 123 | 120 | text x2 | 30 | 30 | 30 | 30 |
| bio-amino-acid-disorders | 294 | 274 | text x5 | 30 | 30 | 29 | 30 |

Sharpest real case (`med-envenomation`, 46 items incl. 10 overlay items on lesson `med-envenomation`):
old random take held **8 of those 10** (the reported failure mode); the diverse take holds **1**.
Method: `node /tmp/diverse-analysis.cjs` (kept out of the repo; pools from the local v5 bank copy +
`prep/overlays`, fixed seeds; old exam = `shuffle().slice(0,30)`, old study = `adaptiveNew` fresh store
target 2, new = `diversePick` with the same history/target).

## Key granularity (rule fixed, not examples)

- Measured first: 0/176,430 bank items carry `x.links`, so the text fallback is the workhorse; overlay
  items DO carry `x.links` (lesson targets) and key on them first — verified on `gap1013a` envenomation.
- Too coarse: none. Largest cluster anywhere sampled is one 10-item overlay wave on one lesson (a real
  shared topic, correctly one concept).
- Too fine, fixed in the rule: first version used the full option text + all rare words (94% unique keys;
  vignette numbers/ages made every item unique). Fix: pure numbers never count in the stem, answer reduced
  to its head (first 2 content words, numbers kept: `t 15 17`). Text top-clusters now read as real teaching
  points (`delirium tremens`, `sevoflurane|rise+intracranial+pressure`, `metabolic acidosis`). Mirrored in
  the arena port. Bank `prov` is `LIC` almost everywhere (licence marker, useless as a key); items carry no
  set stamp, so overlay `set` names are not used (too coarse anyway).
- Weights hook (`opts.weights`, e.g. blueprint/PYQ frequency) is implemented and tested; no caller passes
  weights yet (no per-concept weights exist in the bank), so all concepts weigh equal.

## Tests

- `test/prep-diverse.test.mjs` (14 tests, pass): 200-item/40-concept module → 30 distinct, max 1 per concept;
  even repeats when concepts < N; determinism per seed; unseen → wrong → oldest-seen; difficulty target kept;
  empty/tiny/n=0/duplicate ids; weights; interleave adjacency at the theoretical minimum; customDraw module
  spread + concept evenness; memoisation; blueprint buckets (legacy 25 → diverse 32 distinct, quotas identical,
  mistake scope composition untouched); Quick-practice Mix quotas exact + 30 distinct + deterministic.
- Performance: `diversePick` over a 3,000-item module = ~15 ms in node (budget 30 ms phone-class; node is
  faster than a phone, so this is necessary-not-sufficient evidence; algorithm is linearithmic with small
  constants, one df pass + sorts).
- Browser: `test/run-diverse-session.mjs` (repo raw-CDP convention) runs a real 30-question study session on
  a 200-item/40-concept module and counts pool-context concept keys (asserts >= 30 distinct, 0 adjacent
  repeats). NOT executed here: this sandbox denies listening sockets (EPERM) so no local server or CDP
  browser runs; run with `CHROME=<binary> node test/run-diverse-session.mjs`. The identical flow was
  verified in node through the real `draw` + `diversePick` path (30/30 distinct, quotas intact).
- Existing suites: prep-app (1 pre-existing `overlay releases` failure, fails on untouched base too —
  worktree predates the overlay sets the test names), prep-setup, prep-assess, prep-plan, prep-tests-collapse,
  arena-server all pass.

## Compliance

No visible UI touched (selection logic only; same screens, same order of due reviews, same quotas) — the
standing UI rules require no action. No new library (uses the repo's own helpers). No Anthropic API used.
