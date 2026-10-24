# Handoff 2026-10-25: CliniX final-year expansion, Kardia plan, open items

Session 6aa3996c. Read this first, then `docs/clinix/final-year-expansion-plan.md` and `docs/kardia/kardia-plan.md`.

## Working model (owner instruction)
The lead session (Claude Opus 5.5) is the orchestrator in ultra token save mode: supervisor and brain only. It writes briefs, launches workers, reviews output (diffs, tests, screenshots), fixes what workers got wrong, opens and merges PRs, and reports. All authoring and coding is done by workers chosen by difficulty:
- **muse wonder** (`muse-wonder-1.0`, Fable-class): hardest coding and design problems, effort medium.
- **agy** (default `gemini-3.8-flash-high`, Opus 4.8-class per owner): most coding and content jobs.
- **muse spark** (`muse-spark-1.3`, Sonnet 5.5-class): bounded content and fixes, effort high (medium for read-only checks).

### How to launch workers
- **muse:** `XDG_CONFIG_HOME=$HOME/.config/muse-acct2 ~/prep-data/cxp-briefs/run-muse-queue.sh <model> <effort> <max> <workspace> job...`
  - Briefs are `~/prep-data/cxp-briefs/cxp-<job>.md`. Logs are `muse-<job>.log`.
  - Slot 2 (`~/.config/muse-acct2`, stewardmd.in@gmail.com) has the subscription.
  - Slot 1 (`~/.config/muse`, drmanojkurmana@gmail.com) has `subs_active:false` and returns "Billing verification failed 402".
  - `muse-swap` falls back between the two slots.
  - The muse sandbox cannot write outside its workspace, so scratch files go in `<workspace>/work/`.
- **agy:** `~/prep-data/cxp-briefs/run-queue.sh <model> <max> job...`
  - It uses `~/prep-data/cb4/agy-wt.sh`, with cwd `~/Developer/wt-cxp`.
  - Logs are `~/prep-data/cb4/agy-cxp-<job>.log`.
  - `aswap` rotates 3 accounts; check them with `aswap list`. All 3 hit quota on 2026-10-24 at about 23:30 and reset around 03:00 to 03:15 IST.
  - The process count pattern is `pgrep -f 'bin/agy .*-p'` (the old `'agy -p'` matched nothing and launched every job at once).
- **Always:** run each job in its own git worktree and never in the main checkout. Workers do not run git; the lead commits.
- **Use bash, not zsh,** for any loop over an id list: zsh does not split `$VAR`, and this broke two launches.

## Done and merged (2026-10-24/25)
- #1765 Android R8 dontwarn rules; signed AAB versionCode 16 at `~/Downloads/stewardmd-release/stewardmd-release-v7-code16.aab` (upload key SHA1 AC:4B:35:...:75:41), owner to upload in Play Console.
- #1776 CliniX Practicals screen (browse, spotter quiz, viva rehearsal; 33 decks incl. surgery; 24 Tokós instrument photos linked with credits).
- #1777 OSCE exam mode (default): 5 options per step (authored > later-in-phase > other phase > pack distractors), arrange-in-order check for phases of 4+ steps (sequence hidden while arranging), critical and unsafe fails, Practice checklist kept. `clinix-osce-exam.js`.
- #1778, #1779, #1780 content batches: all 36 tier-2 diseases; paediatrics (12 stations) and surgery (14 stations) OSCE modules with 131 authored distractors; 9 presentations; 6 surgery practicals decks. CliniX now 109 pathways (obgyn 35, paediatrics 22, surgery 30, medicine 22). contentVersion 0.11.2-finalyear4.
- Live OTA v534 (commit 10713bd6) verified server-side: 14 chapters per pathway, one O&G tile, heart recordings. **#1776 to #1780 are NOT on phones yet: OTA publish needs the owner's yes** (`gh workflow run ota-publish.yml`).

## Merge pipeline for worker content (lead tools, in `~/prep-data/cxp-tools/`)
- `batch-merge.mjs <diseases,> <osce systems,> <pres subjects,> <practicals subjects,>` copies from wt-cxp into wt-cxb.
  - It merges shared skills (reporting id clashes) and dx vocabulary with a strict rule: a term that already resolves is skipped, synonyms must be 3+ characters, and the system id must be valid.
  - It also merges distractors and manifest entries, and lists probes without `accept`.
- `normalize-cases.mjs <files>` turns text vitals ("76 bpm", "bp":"120/80", bp_sys) into numeric `initialVitals`.
- Then: `node tools/clinix-practicals-index.mjs`, bump `contentVersion`, validate each disease (`tools/clinix-disease-validate.mjs <f> --packs core,<system>`), run `npm test`-style `node --test --experimental-test-module-mocks --experimental-sqlite test/clinix-*.test.mjs` (582 pass at batch 3), `test/run-clinix-ui.mjs`, `run-clinix-osce-exam-ui.mjs`, `run-clinix-practicals-ui.mjs`, `build-www.sh` and read the `www/` copy.
- **Known local-only failure:** `run-clinix-ui` "Mist background" fails in a dark-mode browser. It passes in CI.
- **Recurring worker bugs** to expect and fix:
  - vitals written as text;
  - history keys or cues containing everyday words (drink, sugar, bed, tone, examination);
  - accept terms that are substrings of other diagnoses;
  - differentials whose first accept terms are one idea;
  - stations built only from disease skills (no rubric);
  - probes without `accept`;
  - shared skill ids reused across subjects;
  - module tests that read `work/` files.

## Running now (started 2026-10-25 01:41 IST)
- **Independent fact-check of the 87 new pathways.**
  - muse spark slot 2 is checking ids 1 to 44. agy takes the other 43 from 03:20 (`resume-verify-agy.sh`).
  - Briefs: `cxp-verify-<id>.md`. Reports: `~/Developer/wt-cxb/work/verify/<id>.json` (15 claims each, with wrong, unsure, unsafe and contradictions). Workers do not edit content.
  - Next: read every report, fix the wrong and unsafe items in a worktree from main, and open one PR.
- A session cron `3d29931e` (every 2 h) re-runs "dont stop till everything is done". It is session-only, so a new session must recreate it if wanted.

## Open, needs the owner
1. OTA publish yes or no (for #1776 to #1780).
2. Calculators tile "crashing on opening": not reproduced headless (source and www bundle, 390 and 820 widths, 456 calculators, 0 errors). Needs device, symptom, or the iPad on USB unlocked with the app open for `ios_webkit_debug_proxy` (no reinstall).
3. Device confirmation that CliniX pathways load.
4. Clinical review of all CliniX content (everything `ai_drafted`).
5. muse slot 1 billing (dev.meta.ai team 1474746787905903) if a second muse account is wanted.
6. Kardia: who reviews echo content clinically; owner said plan only, do not build until he reviews `docs/kardia/kardia-plan.md`.

## Other open work (not started)
- Play Billing for Android: WIP uncommitted in `~/Developer/wt-android` (branch android-play-billing; JS tests 17/17, Java plugin never compiled with Gradle). Owner must create Play products and the `GOOGLE_PLAY_SA_JSON` service account.
- Heart-sound recording provenance (owner).
- Code Blue 2.0 device test and clinical review (owner).
