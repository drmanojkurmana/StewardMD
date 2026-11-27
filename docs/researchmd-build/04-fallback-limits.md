# Phase 04: two retries on the device, then cloud with a notice, within a monthly allowance
Branch: rmd-od-4-fallback (from rmd-od-3-drafts). Writer: Gemini Hydrogen, agy account 1. Reviewer: Claude Opus 5.5, agy account 4.

## Rules
Read CLAUDE.md and vault/modules/ResearchMD.md first. StewardMD is a mobile app (iPhone, iPad, Mac, Android). App files are ES5 IIFEs. No em or en dashes in app-facing text. No secrets or patient data in code, tests, logs or URLs. Every new behaviour is ON by default (Manoj, 27 Nov): its flag exists only as a kill switch, read as on unless localStorage holds "0". Edit only the files listed. No commit, no push, no PR, no merge, no deploy.

## The rule Manoj set (27 Nov 2026)
Every ResearchMD heavy job (PDF reading/OCR, stats model, manuscript draft) runs on the device first. If a try fails, the app retries on the device twice, automatically, back to back. Only after the third failed try does the cloud (today's research container) take over, and it sends nothing until the user taps Continue on a privacy notice. Cloud use is capped per user per calendar month by plan; today's daily caps stay as a ceiling on top.

## Part A: app, research-ondevice-jobs.js (NEW, window.SMD_RMD_JOBS)
`runWithFallback(kind, runDevice, runCloud, opts)` where kind is "pdf" | "stats" | "draft", runDevice(resume) and runCloud(checkpoint) return promises.
1. Try runDevice. On a counted failure: show "Retrying on this device (1 of 2)" (then "2 of 2"), wait 3 s, call runDevice(resume) with the latest checkpoint from SMD_RMD_CHECKPOINT. Counts are per job; success clears them.
2. Counted failures (each is one failed try):
   - crash or out of memory: on start, write checkpoint field `running: true` with the job key; if the app starts and finds `running: true` for a job not finished, that try counts as failed (the app or engine died mid-job);
   - too slow, measured only while the app is in the foreground: one PDF page > 30 s, a whole PDF > 10 min, a stats model > 2 min, one drafting step > 5 min not counting time waiting for AI replies. Put these numbers in one exported constant object so phase-1 device measurements can tune them;
   - engine error codes: ocr-failed, pdf-open-failed, ceiling_seconds (device), stats worker crash, device_failed;
   - engine won't load: ocr-unavailable, Worker construction failure.
3. Never counted (no retry, no cloud): offline (navigator.onLine false or fetch network error; on-device steps continue, drafts wait), app put away or phone locked (pause, resume on appStateChange active), user cancelled, and data problems: password, too-many-pages, invalid_formula, zero_cell, no_events, convergence warnings, invalid_spec, ipd_gate, gate_failed, phi_blocked, ceiling_calls, invalid_snapshot. Show the existing message for each.
4. After the third counted failure: state "needs_cloud". Show the notice for that kind (text below, verbatim) with Continue and Cancel. Cancel keeps the job on the device, saved where it stopped, with "Try again" later. Continue: first call GET /v1/me/research-cloud (Part B); if remaining is 0 show the limit line and stop; else call runCloud(checkpoint).
5. Every on-device job shows the small line: "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline."
6. Log for each fallback: kind, which rule triggered each of the 3 tries, device model and OS (@capacitor/device Device.getInfo, already in package.json), app version, engine. Sent with the cloud job (Part B), never with file content.

Notices (verbatim):
- PDF: "This device couldn't finish reading this PDF. To finish it in StewardMD cloud, the PDF is uploaded to StewardMD's servers and read there. It is kept while the project exists and deleted within 30 days after you delete the project."
- Patient data (stats; asked every time; Continue disabled unless the project has ethics approval on file, as createStatsJob checks compliance): "Privacy risk: this device couldn't run this analysis. Finishing it in StewardMD cloud uploads patient-level data to StewardMD's servers, where it is decrypted to run the analysis. Only the results are kept. Use this only if your ethics approval and patient consent allow data to leave this device."
- Drafts: "Writing help sends your project text to StewardMD's AI service over the internet. Patient identifiers are blocked before anything is sent. Your PDFs and patient datasets stay on this device."
- Limit reached (paid): "You've used this month's cloud fallbacks. The job stays on this device, saved where it stopped. Try again later or next month."
- Free plan: "Cloud fallback comes with the paid plans. The job stays on this device, saved where it stopped."

## Part B: server, monthly allowance
1. Allowances per calendar month (UTC), per user, no rollover, by plan key from functions/api/billing/[[path]].js tiers: free 0, student (Trainee) 15, coresident 15 for each seat holder, pro (Resident Pro) 25, physician (Clinician) 30, physicianpro (Clinician Pro) 100. Annual and founding members get the same number as the monthly plan. Resolve the user's plan with the existing helper (check functions/_entitlements.js, _features.js, _quota.js; reuse, do not duplicate). Put the table in functions/api/research/_caps.js as `CLOUD_FALLBACKS_PER_MONTH`.
2. Storage: NEW table research_cloud_fallbacks (id, uid, project_id, kind, job_id, month 'YYYY-MM', status 'used'|'refunded', reason_json, created_ts) via a new numbered migration next to the existing ones (docs/research/contracts/phase-*/00NN_research_vN.sql plus a matching 00NN_rollback.sql; take the next free number after the highest present) and the same table added to functions/db/research_schema.sql. If phase 03 already added a migration, use the next number after it.
3. NEW `GET /v1/me/research-cloud` -> { plan, allowance, used, remaining, resetsAt }.
4. Creating a cloud job with `fallback: { reasons, device }` in the body (pdf upload artifact/job, /stats-jobs, manuscript job with runner "container"): check remaining > 0 BEFORE accepting the upload or enqueueing; on 0 return 402 code "cloud_fallback_limit" (or "cloud_fallback_free" on free) with the lines above. Then insert a 'used' row. The existing daily caps (_caps.js) still apply after this check.
5. Refund: when such a job fails for our own reasons (same set as PO_FREE_FAILURE_SQL plus job_lost, storage/queue unavailable, worker crash), mark its fallback row 'refunded'. Do this where job status is settled (callbacks and expireLostBefore).
6. Jobs created without `fallback` (older app versions) are unchanged. Add a NOTE that enforcement for them can be switched on once old versions are gone.

## Part C: cloud picks up where the device stopped
- PDF: the cloud job reads the whole uploaded PDF (simplest; pages are cheap). Fine.
- Stats: reruns whole (it is short).
- Drafts: convert the existing device job to runner "container" (new route `POST /v1/jobs/:jobId/to-cloud`, owner only, checks the allowance) and enqueue it to the container. In backend/research/paperorchestra/adapter/po_adapter/llm.py and pipeline.py, send the SAME stepIds the JS runner sends (validate, outline, section:<name>, refine:<round>, final, with the same retry suffixes) so the gateway's step cache (phase 03) returns the device's finished steps for free and the container effectively resumes from the last saved step. Python tests: extend backend/research/tests/test_po_llm_timeout.py or add test_po_step_ids.py to assert the ids.
- Fix in the same files: llm.py checks PO_MAX_SECONDS (600 s) only after the pipeline ends; check elapsed time before every call and stop with ceiling_seconds once it passes 600 s.

## Part D: container cost controls
- workers/research-worker/src/index.js: IDLE_MS from 5 minutes to 1 minute. Do NOT deploy.
- Container hours alert: compute monthly container-minutes from research_job_runs and research_stats_jobs rows (started to completed, plus 1 idle minute per wake) in a small helper, expose it on the existing research admin or ops endpoint if one exists (grep functions/ for admin research stats), and raise an alert through the existing alerting path (grep for how other ops alerts are sent) when the month passes 6 hours and again at 100 hours. If no alerting path exists, expose the number and add a NOTE; do not invent an email sender.

## Part E: wire it
- research-screen-thesis.js, the study PDF screens, research-screen-masterchart.js and research-screen-manuscript.js: when their device flags (rmd_ondevice_ocr, rmd_ondevice_stats_v2, rmd_ondevice_draft) are on, run through SMD_RMD_JOBS.runWithFallback instead of the direct error fallbacks added in phases 01 to 03. The masterchart stats cloud path is the existing /stats-jobs route (it needs an IPD dataset upload: reuse uploadIpd's client path if one exists; if no client path exists, show the patient-data notice and then "Cloud analysis isn't available for this dataset yet" and say so in a NOTE).
- index.html script tag research-ondevice-jobs.js (?v=rod4); build-www.sh.

## Tests
- NEW test/research-ondevice-jobs.test.mjs: success first try; fail, retry, succeed (count clears); three counted failures -> needs_cloud with the right notice; offline, cancel and each data-problem code -> no retry and no cloud; crash detection via running:true on start; too-slow timers with a fake clock, AI wait excluded for drafts; resume passes the latest checkpoint; Continue with remaining 0 shows the limit line and does not call runCloud.
- NEW test/research-cloud-fallback-api.test.mjs: allowance per plan key (all six); month rollover; 402 on free and on limit; checked before upload; refund on our-side failure; daily caps still apply; old-client jobs without fallback unaffected; to-cloud route.
- Python: the step id test and the 600 s per-call check.

## Run
node --test --experimental-test-module-mocks --experimental-sqlite test/research-ondevice-jobs.test.mjs test/research-cloud-fallback-api.test.mjs test/research-po-device-api.test.mjs test/research-phase3-api.test.mjs
cd backend/research && PYTHONPATH=. pytest -q
