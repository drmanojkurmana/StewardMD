# Update from the cloud build thread, 27 Nov 2026

The WIP commit was cherry-picked onto the current `origin/rmd-od-3-drafts` (94ff3a2d) as branch
`rmd-od-4-fallback-limits-cc`; merge conflicts in llm.py, pipeline.py, seams.py and index.html kept both sides.
Migrations renumbered: phase 3 job_steps is 0009, phase 4 cloud fallbacks is 0010.

Fixed since the WIP:
- Plan resolution: entitlement records store the Trainee plan as `student`, which normalizeTier rejected, so every user
  resolved to Free. `_cloud_fallback.js` now maps it to `trainee` and reports it back as `student`.
- Real bug in `convertJobToCloud` (`_jobs.js`): it wrote a `worker_id` column that does not exist and set NULL into the
  NOT NULL `error_code`. Both fixed.
- "Older clients get 402" was not a code bug: the test KV shim ignored `{type: "json"}`, so the wallet read as empty.
  Jobs sent without `fallback` skip the allowance check entirely.
- Cloud fallback API tests rebuilt against the real schema (approved IRB and consent evidence, real dataset keys and
  envelopes, systematic-review project). 9/9 pass.
- On-device runner (`research-ondevice-jobs.js`): the timers did use the fake clock; the tests counted a fixed number of
  microtask turns, fewer than the checkpoint reads and writes need. Tests now drain with setImmediate turns. One real
  ordering change: for stats, the ethics (IPD) gate now runs before the quota call, so it works offline. New `holdClock`
  on the job context lets phase 5's native background job stop the too-slow clock while the OS has paused it. 8/8 pass.

Still open:
- Container-hours alerts (6 h, 100 h) are logged once per month per threshold and returned on the admin endpoints;
  there is no push channel, so nobody is notified automatically.
- backend/research pytest was not run here (httpx is not installed in the cloud container); research-ci runs it on the PR.
- Nothing exercised on a device.

# Phase 04 handoff (Mac session to cloud build thread), 27 Nov 2026 18:45 IST

Branch `rmd-od-4-fallback-limits`, one WIP commit on top of the Mac session's local `rmd-od-3-drafts` (740df8b8c).
That base does NOT contain the cloud thread's later commits on `origin/rmd-od-3-drafts` (ca639d262 "add the missing 0008
migration and rollback", and anything after). Rebase or merge onto the current phase 3 branch before building on this.

Written by agy Gemini 4 Hydrogen High (accounts 1 then 2; one write pass, no fix pass).
NOT reviewed: Opus 5.5 on account 4 was out of quota and the review fallback had a flag bug. No REVIEW.md exists.
Phase 05 was never started (no branch, no files).

## Test results at handoff (Mac, this worktree)
- test/research-po-device-api.test.mjs: 6/6 pass
- test/research-phase3-api.test.mjs: 17/17 pass
- backend/research pytest: 426 passed, 1 skipped (includes new test_po_step_ids.py and the 600 s per-call check)
- test/research-ondevice-jobs.test.mjs: 3 pass, 4 fail (3 of them hang until the test timeout; run with --test-timeout)
- test/research-cloud-fallback-api.test.mjs: 2 pass, 7 fail
- full npm test: not run for this WIP

## Done and tested
- Part C, Python: llm.py/pipeline.py send the same stepIds as the JS runner; elapsed time checked before every call,
  ceiling_seconds past 600 s (pytest green).
- Part D: IDLE_MS 5 min -> 1 min in workers/research-worker/src/index.js (not deployed). Container-minutes helper with
  6 h / 100 h alert thresholds (its test passes); check whether it raises through a real alert path or only exposes the number.
- Part B migration: research_cloud_fallbacks table (0009 on this branch) applies over 0001..0008 and rolls back (test passes).
- Part A: first-try success clears the count and shows the on-device privacy line; offline / cancel / every data-problem
  code never retries or goes to cloud; crash detection via `running: true` (tests pass).

## Half done (code exists, tests fail)
- Part A retries and timing (research-ondevice-jobs.js): the "retry 1 of 2 / 2 of 2 with 3 s wait" test fails fast; the
  needs_cloud notice, the Continue-with-0-remaining and the too-slow fake-clock tests hang to the timeout. Likely the 3 s
  wait or timers are not driven by the injected fake clock. Not verified on a device.
- Part B allowance (functions/api/research/_cloud_fallback.js, _caps.js CLOUD_FALLBACKS_PER_MONTH, GET /v1/me/research-cloud,
  402 checks in _jobs.js / _ipd.js / extraction upload, refunds in _callback.js / _credits.js):
  - plan resolution returns "free" for every user in tests (expected student/coresident/pro/...), so every allowance is 0;
    check how the test seeds the entitlement vs getEntitlement/effectiveTierFor in _entitlements.js;
  - REAL BUG: a job created WITHOUT `fallback` (older app versions) gets 402 on the free plan; the brief says those must be unchanged;
  - month rollover, refund-on-our-side-failure, daily-caps-still-apply and to-cloud route tests fail (likely downstream of the plan bug).
- Part C, to-cloud route `POST /v1/jobs/:jobId/to-cloud` exists in [[path]].js; its test fails (see above).
- Part E wiring: thesis, extract, find, masterchart and manuscript screens call SMD_RMD_JOBS.runWithFallback; index.html tag
  (?v=rod4) and build-www.sh copy added. Not exercised in a browser or on a device. The masterchart cloud path (IPD upload)
  NOTE from the brief not checked.

## Not started
- Phase 05 (background native OCR job).
- Review (Opus) of phase 4, and of phase 1 round 2, phases 2 and 3.

## Migration numbering (must fix before merge)
main already has `0008_research_v8` = research_publication_consents (F-12, PR #2791), and it is APPLIED to production D1.
So: phase 3's `0008_research_v8` (research_job_steps) becomes **0009**, and phase 4's `0009_research_v9`
(research_cloud_fallbacks) becomes **0010** (rename files, version comments, rollbacks, and every test that applies them
by name, e.g. test/research-phase6-api.test.mjs mirror check and test/research-cloud-fallback-api.test.mjs). Apply to
production D1 in that order after merge. This WIP commit leaves the phase 4 file at 0009 and does not include the phase 3
0008 files (they are on origin/rmd-od-3-drafts).
