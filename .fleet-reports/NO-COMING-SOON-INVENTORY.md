# NO-COMING-SOON INVENTORY (PrepNucleus, origin/main @3fa888eed)

Date: 2026-10-12. Owner rule: nothing student-visible may say "coming soon".
Method: 6-agent sweep + parent verification of every code surface below
(`grep -n` on the listed files). Counts marked [agent] come from the sweep;
strings marked [verified] were re-checked by the parent on origin/main.

Ledger at inventory time: 214 rows, $112.28 total, $79.72 headroom to the
$192 global stop. This job's own budget: $30 (ledger /tmp/no-coming-soon-spend.tsv).

## 1. Student-visible "coming" surfaces [verified]

| # | File:line | Text | Trigger |
|---|-----------|------|---------|
| 1 | prep.js:1483 | `questions coming soon` (subject tile) | subject q==0 via countFor |
| 2 | prep.js:1514 | `Questions coming soon` (subject hero) | subject q==0 |
| 3 | prep.js:1531 | `Questions coming soon` (module row) | module n==0, row aria-disabled |
| 4 | prep.js:1868 | `Explanation coming soon.` | PYQ item (`it._py`) with no explanation |
| 5 | prep-tests.js:302 | `Format available, question bank coming.` + bank note | `bankStatus(p)==="coming"`; also :514 More-formats, :644 toast |
| 6 | prep-arena.js:148 | `Coming soon: questions for this exam are still being prepared.` | errWord 503 (NOT a real 503 path; bank-empty refusal) |
| 7 | prep-arena.js:163 | fallback `questions for this exam are still being prepared` | soonFor when bank.status==="coming" |
| 8 | prep-arena.js:205 | `Arena: coming soon` + soon note (home row) | soonFor(exam) non-null |
| 9 | prep-qgen.js:39 | `Creating modules with MaiK is not open yet.` | feature flag off for account; entry row already gated by `canCreate()` (prep.js:1407,2584) so students never reach a dead end |
| 10 | prep-social.js:28 | `Friends and groups are not open yet. Try again later.` | 404 with no code; entry rows already gated by `G.PrepSocial` existing |
| 11 | specialty-bank.js:175 | `The question bank is being prepared. It will appear here soon.` (+HI) | Test-tab 404 (missing index) |
| 12 | specialty-tools.js:182-183 | `Screen coming in the next update` / long form (+HI) | pending-sim entry whose screen has not shipped |
| 13 | specialty-learn none str | `No lessons yet. They are being written; the Test tab is ready now.` | Learn tab with zero lessons (no banned words, kept) |
| 14 | ophthalmos-learn none str | `No lessons yet. They are being written; Reference below and the Test tab are ready now.` | same (kept) |
| 15 | prep-lessons.js:829 | `No lessons for this subject yet.` | neutral (kept) |

Negative [verified]: no coming tiles on tokos/narke/kardiox/ophthalmos homes;
kardiox-screens.js:1720 is a loading skeleton. `qbSummary` (prep.js:2599) is
neutral. prep-assess.js L133-134 comment naming PLAB/AMC/MCCQE "coming" is a
stale comment (comments allowed, updated anyway with the UI patch).

## 2. Exam bank status (prep/assess/profiles/*.json) [verified]

- available: neet-pg, ini-cet, fmge, neet-ss, ini-ss, usmle-step1, plab-1,
  amc-mcq, mccqe-1, mrcs-part-a.
- coming: usmle-step2-ck (`no Step 2 CK clinical items in the bank yet`),
  mrcp-part1 and mrcp-part2-written (`no MRCP ... questions in the bank yet`).
- Plan scope: prep-plan.js has 10 choices, prep.js 8 tabs; MRCP is in NEITHER,
  so MRCP "coming" is unreachable via tabs today (needs plan choice + tab as
  new scope). Step2CK "coming" shows at profile/Tests level (usmle tab resolves
  to step1 via forTab).
- "MRCP now landed #1524: flip it" could NOT be verified: #1524 is not on
  origin/main, `find prep -iname '*mrcp*'` returns only the two profiles, and
  no MRCP bank exists under prep/bank/. MRCP profiles STAY "coming" until a
  bank lands. (Parallel pilots exist: ledger `bank-mrcp-gen-*` ~$2.4 spent,
  logs ~/prep-data/assessment/muse-bank-mrcp.log; nothing merged.)

## 3. Live bank counts [agent] (v5 176430 items / 33 subjects / 2271 modules + overlays)

Per-exam live totals (subjects summed by index ex tag):
neet-pg=130645, ini-cet=130645, usmle=97492, neet-ss=28801, amc-mcq=1550,
mccqe-1=1521, mrcs-part-a=0, plab-1=0. Grand live total 163017.
Manifest per-subject items/modules match index counts.all, 0 mismatches.

- Zero-item modules: 191 = 183 scaffold (11 MRCS subjects x8, 19 PLAB
  subjects x5; count 0 in v5, no overlay mapping) + 8 real SS gaps:
  ss-critical-care/scc-shock-approach;
  ss-infectious-diseases/sid-newer-agents, sid-hsct-id;
  ss-medical-oncology/son-trial-design, son-nsclc-driver, son-geriatric-aya,
  son-cardio-oncology; ss-rheumatology-immunology/srh-outcome-measures.
- Thin (nonzero <10) modules: 174. Worst subjects: mcc-chronic-care 24,
  adult-health-medicine 18, mcc-acute-care 16, mcc-health-promotion 13,
  ss-general-medicine 12, womens-health 11, adult-health-surgery 10,
  population-health-and-ethics 10, child-health 8, mental-health 8,
  mcc-professional-behaviours 8, ss-neurology 6, ss-rheumatology-immunology 6,
  ss-medical-oncology 5, ss-nephrology 5, ss-infectious-diseases 4,
  ss-critical-care 3, ss-pulmonology 3, ss-endocrinology 2,
  ss-biostatistics 1, ss-cardiology 1. Zero MBBS subjects below 10.
- PYQ items with no explanation: NOT countable from repo (live file R2-only;
  manifest pyq.explained=942, total unstated). Unresolved.
- kb/policies/CUSTOM.json ~50 "coming soon" antibiogram notes: owner/admin
  template, no referencing code found; student-visibility unconfirmed.

## 4. Build order (big plans first) and cost to finish

1. PLAB-1 scaffold 95 zero modules (bank available, live 0, plan-visible).
2. MRCS-A scaffold 88 zero modules (available, live 0, plan-visible).
3. NEET-SS 8 real zero modules + thin ss-subjects (in-plan).
4. USMLE-Step2-CK clinical bank, then flip profile to available.
5. MCCQE-1 thin 61 modules (1521 base). 6. AMC thin 47 modules (1550 base).
7. MRCP-1/2 banks + plan choice + tab (new scope, after banks land).
8. PYQ explanations for items that have none (count unknown, see above).

Rate evidence (ledger): bank-amc-mccqe 10 rows $1.5595 for ~3071 items;
bank-plab-mrcs 12 rows $2.4187 so far; bank-mrcp-gen-* ~$2.4 pilot spend.
~365 modules x min 25 = ~9100+ items ≈ $5-10 generation + verification at
observed rates: fits the $30 job budget and the $79.72 headroom. Generation
runs through the existing pipeline (gen.mjs/qgen, haiku gen, sonnet blind-key
verify, gates g1-g5/style/g9b/verbatim/dup jaccard>=0.6, dedupe, overlays
maikfill*), in flight by parallel bank agents (plab-mrcs/step2ck/mrcp logs).

## 5. UI patch (this job, separate PR)

- prep.js: hide zero-q subject tiles and zero-count module rows
  (filterModules excludes n==0); hero/modRow fallbacks reworded neutral, never
  printed for visible rows; PYQ-no-explanation line unified to `No explanation
  is stored for this question yet.`
- prep-tests.js: comingSection/toast reworded to `No questions for this exam
  in the bank yet.` (structure kept: format shown, no test buttons).
- prep-arena.js: 503 becomes `Arena is temporarily unavailable, try again`;
  soonFor fallback neutral; home gate row neutral (`Arena is unavailable`).
- prep-qgen.js / prep-social.js: `not open yet` becomes `not available right
  now` (entries already flag-gated; no dead ends).
- specialty-bank.js none + specialty-tools.js simSoon/simSoonLong: neutral
  `not available` / `No questions in this bank yet.` (+HI).
- No profile status flipped (no bank landed). Step2CK/MRCP sections stay
  gated on bank.status==="coming" with neutral wording until banks merge.
- Guard: test/prep-no-coming-soon.test.mjs fails on `coming`/`will be added`
  in student-visible code/data of the prep surfaces (comments ignored) and
  asserts filterModules hides zero-count modules.
