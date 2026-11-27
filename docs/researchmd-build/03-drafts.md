# Phase 03: manuscript drafts run by the app, step by step
Branch: rmd-od-3-drafts (from rmd-od-2-stats). Writer: Gemini Hydrogen, agy account 3. Reviewer: Claude Opus 5.5, agy account 4.
This is the largest phase. If agy runs out of context, split it: 03a server (part A) then 03b app (parts B to D), same branch, same review loop after each.

## Rules
Read CLAUDE.md, vault/modules/ResearchMD.md, backend/research/paperorchestra/SEAMS.md and UPSTREAM.md first. StewardMD is a mobile app (iPhone, iPad, Mac, Android). App files are ES5 IIFEs. No em or en dashes in app-facing text (AI output is exempt). No secrets or patient data in code, tests, logs or URLs. Every new behaviour is ON by default (Manoj, 27 Nov): its flag exists only as a kill switch, read as on unless localStorage holds "0". Edit only the files listed. No commit, no push, no PR, no merge, no deploy.

## Goal
Today a manuscript_draft job runs in the research container: backend/research/manuscript/job.py drives backend/research/paperorchestra/adapter/po_adapter/pipeline.py (validate snapshot, outline, sections, gated refinement rounds, final gates, JSON manuscript), and every AI call goes to our gateway (POST /v1/internal/llm, per-job bearer token) from po_adapter/llm.py. The compute is light; the container only holds the steps together.
Move the step runner into the app. The server keeps everything that must stay server-side: job creation with caps and snapshot freezing, the AI gateway with its PHI gate, token ceilings and spend caps, and ingesting the finished draft. Only AI requests leave the device, exactly as today.

## Part A: server (functions/api/research/)
1. `_jobs.js` createManuscriptJob: accept `body.runner === "device"`. Same flag, role, study-type, caps (checkPoJobCaps), credits and snapshot freeze as today, but do NOT enqueue to the container. Return the job, the frozen snapshot manifest the container would have read (or its R2 key plus a GET route to fetch it), and a per-job token minted with the same function and lifetime the container gets. Store `runner: "device"` in the job's input/output json.
2. NEW `POST /v1/jobs/:jobId/token` (owner of the job only, job status queued or running, runner device): mints a fresh per-job token so a long or paused draft can continue. Rate-limit to one per 60 s per job.
3. `_gateway.js` POST /v1/internal/llm: accept optional `stepId` (string, max 80 chars, [a-z0-9:_-]). When present, look up a cached reply for (jobId, stepId); if found, return it with `cached: true` and charge nothing. Otherwise call the provider as today, then store the reply (text, model, usage) keyed by (jobId, stepId) in D1 (new table via a new numbered migration next to the existing ones (docs/research/contracts/phase-*/00NN_research_vN.sql plus a matching 00NN_rollback.sql; take the next free number after the highest present) and the same table added to functions/db/research_schema.sql) or R2 under projects/<pid>/jobs/<jobId>/steps/<stepId>.json; choose one and say why in a NOTE. Every existing check (PHI gate, ipd_blocked, token ceilings, spend caps, per-call counts) runs before a non-cached call exactly as now.
4. NEW `POST /v1/jobs/:jobId/device-result` (job owner, runner device, status queued or running): body `{ manuscript, usage }`. Validate the manuscript with the same final gates the server already applies when ingesting (`gateManuscript` in _manuscript.js) and the same JSON shape po_adapter/writer.py build_manuscript produces; write result.json to R2 at the key ingestManuscriptJob reads; mark the job succeeded with result_r2_key; call ingestManuscriptJob. Failure codes as the container's (gate_failed, phi_blocked, ceiling_*, invalid_*).
5. NEW `POST /v1/jobs/:jobId/device-fail` with `{ code, step }` for codes the device hits (gate_failed, phi_blocked, ceiling_calls, ceiling_seconds, invalid_snapshot, device_failed): marks failed. `device_failed` must count as our infrastructure failure for checkPoJobCaps (add it to PO_FREE_FAILURE_SQL's list) so it does not use up a daily slot.
6. Tests: NEW test/research-po-device-api.test.mjs following test/research-po-job.test.mjs and test/research-phase3-api.test.mjs fakes: device job creation skips the queue and returns manifest + token; token refresh rules; stepId cache hit returns cached and does not debit; non-cached path runs the PHI gate; device-result happy path ingests a version; gate failure rejected; device_failed does not count toward the daily cap.

## Part B: the step runner in the app
1. NEW `research-po-prompts.js`: the upstream prompt templates the adapter uses (OutlineAgent, SectionWritingAgent, ContentRefinementAgent and the autorater prompts reached through seams.gated_review), ported verbatim from backend/research/paperorchestra/upstream/methods/agents/*.py and the adapter's own text stand-ins. Keep the Apache 2.0 notice: a header comment naming PaperOrchestra, its LICENSE file path and "Modified: ported to JavaScript for StewardMD". Only the prompts with_literature=False reaches (the job runs with with_literature False).
2. NEW `research-po-gates.js`: JS ports of po_adapter/gates.py and po_adapter/phi.py (the scan the client runs before every call, which llm.py runs) and the parts of writer.py and loader.py the runner needs (build_inputs from the manifest, parse_latex_sections, build_manuscript). Behaviour must match Python; see Part D.
3. NEW `research-ondevice-draft.js` (window.SMD_RMD_ONDEVICE_DRAFT): `run(job, opts) -> Promise<manuscript>`.
   - Steps, each with a stable stepId: `validate`, `outline`, `section:<name>` for each section the outline lists, `refine:<round>` (rounds clamped by the tier's maxRefinementRounds from _caps.js TIER_CEILINGS), `final`.
   - Before every AI call: the PHI scan on the exact assembled text (system included); on a hit stop with phi_blocked. Count calls; stop at PO_MAX_CALLS (64) with ceiling_calls. Enforce per-call input/output token caps by the tier as llm.py does.
   - Each AI call: POST /v1/internal/llm with the job token and the stepId (and a suffix for retries inside a step, e.g. "section:methods:r1", so a step that re-asks after a gate failure is not served the cached failing reply). On 401 call /v1/jobs/:id/token once and retry.
   - Save after every step to SMD_RMD_CHECKPOINT (from phase 01) under "draft:" + jobId: outline, each section, each refinement round, call count, usage. `opts.resume` continues from the next step. Wall time spent waiting for AI replies is not counted against the device's step timer (phase 04 uses it).
   - Finish: final gates, then POST /v1/jobs/:id/device-result. Device-side failures call device-fail with the code and the step.
   - Errors are Error objects with err.code and err.step.
4. `research-screen-manuscript.js`: behind flag `rmd_ondevice_draft` (DEFAULT ON: on unless localStorage "smd_rmd_ondevice_draft" === "0") the existing "draft with PaperOrchestra" path creates the job with runner "device" and runs SMD_RMD_ONDEVICE_DRAFT, showing "Drafting on this device: outline", "section 2 of 6", "review round 1 of 2". If the app is reopened with a saved draft checkpoint for an unfinished job, offer "Continue draft". On error keep today's message and leave the job failed (phase 04 adds the retries and the cloud fallback). The quick "Ask MaiK to draft" path (/ai-draft) does not change.
5. index.html script tags (?v=rod3) for the three new files after research-ondevice-pdf.js; scripts/build-www.sh copies them.

## Part C: what stays
The container code (manuscript/job.py, po_adapter) is untouched in this phase; it remains the cloud fallback. Do not change how a non-device manuscript job is created or run.

## Part D: parity with Python
NEW test/research-po-device.test.mjs:
- PHI scan: run every vector in backend/research/tests/test_phi_vectors.py and test_po_phi.py through the JS scan (copy the vectors into a JSON fixture under test/fixtures/research/po/ with a comment naming the source test) and expect the same verdicts.
- Gates: the cases in test_po_gates.py and test_po_writer.py, same results.
- Runner with a fake gateway: step order and stepIds; checkpoint after every step; resume from "section:2" does not repeat outline or section 1; 64-call ceiling; PHI hit stops before the call; 401 refreshes the token once; device-result posted with the manuscript shape.

## Run
node --test --experimental-test-module-mocks --experimental-sqlite test/research-po-device.test.mjs test/research-po-device-api.test.mjs test/research-po-job.test.mjs test/research-manuscript-live-fixes.test.mjs test/research-ai-draft.test.mjs
cd backend/research && PYTHONPATH=. pytest -q tests/test_po_gates.py tests/test_po_phi.py tests/test_phi_vectors.py (to confirm the Python side still passes; it should be unchanged)
