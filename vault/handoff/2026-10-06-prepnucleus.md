# Handoff: PrepNucleus, 2026-10-06 evening

Read with [[modules/PrepNucleus]], [[plans/PrepNucleus-Plan2]], [[plans/PrepNucleus-Arena]], the 2026-10-05/06 PrepNucleus
entries in [[decisions/Decisions]], and [[plans/PrepNucleus-Phase4-OwnerChecklist]].

## Where the code is
- Worktree `~/prep-work/StewardMD-prep` (NOT under `.claude/worktrees`, which other sessions' cleanups delete),
  branch `feat/prepnucleus` at d62180e96 (pushed). It contains everything below; all 26 unit files + 10 headless
  `test/run-prep-*.mjs` suites green. Second worktree `~/prep-work/prep-native` (branch feat/prep-native, same head).
- Built: bank v1 (147,310 MedMCQA Q, Gemini-mapped 92.5%, key-screened, 17,419 disputed hidden) on R2; Phase 0;
  Layer B pilot (bank v2); Arena (Worker `prep-arena` live at prep-arena.drmanojkurmana.workers.dev, D1
  `prep-arena-db` 45bc1834-...); redesign + 33 subject icons + My stats; Lessons (reader + narration + 12 lessons);
  PYQs (4 papers, 327 Q, R2 `prep-bank/v2/pyq`, 237 with our explanation, 63 `exp-pending`, 32 disputed hidden);
  onboarding + plan + readiness + FMGE (NBEMS bulletin pattern); Flashcards (prep-flash.js, 39,963 cards generated);
  sync (AES-GCM, opt-in) + widgets + Live Activity + reminders; Pro pricing/free tier (flag `smd_prep_pro_enforce`
  OFF) + social (friends, challenges, college boards, study groups) + public accuracy page.

## Running (screen sessions; check `screen -ls`, `pgrep -fl prep-`)
| Job | Where | Done when |
|---|---|---|
| Layer B full fill (891 modules) | `prepfillall`, runner `tools/prep-fill.mjs`, state `prep/fill/work/*/state.json`, outputs `prep/fill/<module>.json` | `ls prep/fill/*.json` about 891; log `~/prep-data/fillall.log` is unreliable (two runners wrote it; use state files) |
| Full lessons (1,748 modules) | `preplessonsall`, out `prep/lessons/gen` (gitignored), work `prep/lessons/work-all` | `LESSONSALL-EXIT` in `~/prep-data/lessonsall.log` |
| PYQ zip (13 papers 2012-2024) | PYQ agent; data `~/prep-data/pyq/zip` | parse + paid stages (<$10, pre-approved), R2 upload, then DELETE `~/Desktop/pyqs.zip` and `~/prep-data/pyq/zip` (owner instruction) |
Cards output: `~/prep-data/cards-gen/` (865 files) + `gs://...-prep-batch/cards-gen` (not yet in R2).
To restart a Batch runner: `pkill -f <tool>.mjs`, confirm `pgrep`, then relaunch (screen quit does NOT kill node).

## Remaining steps, in order (owner authorised all of these)
1. When the fill ends: `node tools/prep-fill.mjs --merge` (writes bank v2, v1 untouched; packs extra root
   `PREP_PACKS_EXTRA=~/prep-data/packs-statpearls`), review reject rate + sample items, commit indexes/manifest +
   `prep/fill/*.json`, upload v2 (`node tools/prep-upload-bank.mjs` with the v2 dir, `--yes`), verify.
2. Lessons + cards served from R2: extend `functions/api/prep/bank/[[path]].js` whitelist with `v<n>/lessons/...` and
   `v<n>/cards/...` (+ tests), client loads them through the API (fall back to the bundled pilot), upload
   `prep/lessons/gen` and `~/prep-data/cards-gen`; SS modules have no cards (no v1 bank).
3. Flags ON for all: `smd_prep` and `smd_prep_arena` default ON (prep-loader.js `enabled`, home.js `eligible`,
   prep-arena flag, vault/Flags.md); `smd_prep_pro_enforce` stays OFF until a real payment test. Bump `?v=` token
   (currently prep10) in prep-loader.js + index.html.
4. D1: `npx wrangler d1 execute prep-arena-db --remote --file prep-arena-worker/migrations/0001_prep_sync.sql`
   and `.../0002_social.sql`. Redeploy Worker: `cd prep-arena-worker && npx wrangler deploy` (adds `room`).
5. Merge `feat/prepnucleus` to main (owner authorised; app not public), Pages auto-deploys; OTA:
   `gh workflow run ota-publish.yml`. Verify: `curl -s https://stewardmd.in/api/prep/bank/v1/manifest.json | head`,
   v2 pyq index, `/api/prep/arena/events` (401 without token), Worker `/health`.
6. Final report to the owner; update this note and memory.

## Owner decisions (2026-10-06)
Price list Rs 5,999/yr renewal; launch Rs 1,499 first year until 2027-03-31 23:59 IST; one-time win-back Rs 999
(48 h real expiry); "Cancel anytime" always shown and true; 7-day refund; student 20%; referral 1 month; no fake
discounts or resetting timers (built honest only). Free tier: 50 Q/day, 1 lesson/day, 10 cards/day, daily sprint,
first 2 modules per subject. Social: friends, challenges, college boards, study groups, public accuracy page.
Paid AI pre-approved to $25 more (ask if one run > $10). Finish: merge + deploy + ON for all.

## Open items for the owner (cannot be closed by Claude)
- Phone tests (iPhone USB + Android): app flows, offline, OCR deck, offline teacher, MaiK "10 questions on
  lymphoma", widgets, Live Activity, reminder, sync between two phones, friend challenge with two accounts.
- Native store builds (widgets/Live Activity need a store release, not OTA); full iOS/Android builds were not run
  (disk). Need about 7 GB free.
- Store products: App Store auto-renewable `in.stewardmd.prep.annual` Rs 5,999 + intro Rs 1,499 1 yr + offer code
  Rs 999 (promotional offer signing not built, so iOS shows no win-back); Play base plan + offers.
- Real payment test, then flip `smd_prep_pro_enforce`. Refund page scope paragraph (PhonePe only) to reconcile.
- Clinical read of the hand lessons/cards and a sample of AI content (doctor grading was deferred, D7).
- Billing reconciliation of Phase 0 against Cloud Billing (label run=measure-202610060513).

## Known gaps to keep in view
63 PYQs `exp-pending`; physiology/pharmacology lessons need physiology packs (KB is clinical; topic guard skips
them); SS modules get no cards until SS banks exist; 7 modules with no pack (trial design, NSCLC driver, geriatric/
AYA, cardio-oncology, rheum outcome measures, newer anti-infectives, HSCT ID); widget dark/tinted look follow-up;
accuracy page report counts null until reports exist; settings sheet has two reminder controls (product call);
sync copy wording to confirm.

## Spend so far (Vertex Batch, approx.)
Mapping 16.11 + samples 0.02 + key screen 2.84 + Phase 0 0.32 + pilots 0.10 + PYQ 0.14 + lessons pilot 0.05 + cards
about 8.6 + fill 28.57 (running) + lessons full about 9.5 (running) = about $66.

## Gotchas learnt
Vertex Batch for gemini-3.1-flash-lite only in `global`; one-letter schema keys ("f"/"t") read as booleans by Batch;
user gcloud login needs `x-goog-user-project`; headless runners must use free ports (test/free-port.mjs) and set
`SMD_PREP_ONBOARD=false`; repo is PUBLIC: no StatPearls text, PYQ text or competitor teardown in git.
