# PaperOrchestra in ResearchMD: Operator Runbook

This runbook covers operator procedures for PaperOrchestra manuscript drafting in ResearchMD.
StewardMD is a Capacitor mobile app. All production actions are operator-executed owner steps;
nothing is applied automatically by pull requests.

## What PaperOrchestra Does in ResearchMD

PaperOrchestra generates structured IMRaD manuscript drafts (Introduction, Methods, Results,
Discussion) from a frozen ResearchMD systematic review project snapshot.

Core clinical integrity rules:
1. Canonical tokens: Numbers in Abstract and Results are never bare numbers. Every statistical
   result is written as a canonical token in the form `{{run:<runId>.<fieldPath>}}`. Tokens
   reference verified analysis runs from the project snapshot.
2. Verified citations: Citations must resolve to references with a valid DOI or PMID present in
   the project manifest.
3. Hard integrity gates: Before any draft is accepted, the pipeline enforces strict validation
   in code (`gates.py`):
   - numbers: All numbers in Abstract and Results must be tokens, except allowed years, reviewer
     counts, and stated thresholds.
   - citations: Every citation must resolve to a verified DOI or PMID.
   - claim_links: Every claim in Results and Discussion must link to a token or citation.
   - direction: Directional terms ("reduced", "increased") and significance statements must
     accurately reflect the estimate and 95% confidence interval relative to null.
4. Fail closed: Any gate violation stops the job with status `failed` and error code `gate_failed`.
   Violations are saved to `result.json`. No partial draft is ever returned as a result.

## The Off Switches

PaperOrchestra is controlled by two independent off switches. Both must be set to "1" to operate.
Both default to off.

1. Server environment variable:
   - Variable name: `RESEARCH_PO_ENABLED`
   - Location: Cloudflare Pages environment variables (stewardmd project).
   - Expected value: `"1"` (enabled). Default is unset or `"0"` (disabled).
   - Behavior when off: Server rejects manuscript draft job creation requests.

2. Mobile app feature flag:
   - Flag name: `smd_rmd_po`
   - Location: Client feature flags registry (`research-flags.js`).
   - Expected value: `"1"` (enabled). Default is `"0"` (disabled).
   - Behavior when off: The mobile app hides manuscript drafting UI and entry points.

If either switch is off, PaperOrchestra is inactive. Both switches fail closed.

## Prerequisites in Order (Owner Steps)

Follow these steps in exact sequential order. Every step requires explicit owner action.

### Step 1: Backup D1 and Apply Migration 0006
Take a full backup of the remote Research D1 database before making schema changes:
```bash
npx wrangler d1 export stewardmd-research --remote --output backup-research-pre-0006.sql
```

Apply migration 0006 to widen the job kind check and create manuscript tables:
```bash
npx wrangler d1 execute stewardmd-research --remote --file docs/research/contracts/phase-5/0006_research_v6.sql
```

Verification:
- Ensure tables exist: `research_manuscript_versions`, `research_manuscript_sections`,
  `research_manuscript_approvals`, `research_manuscript_exports`, `research_checklist_manual`.
- Verify `research_job_runs` table check allows `'manuscript_draft'`.

### Step 2: Configure R2 Bucket and Queue Bindings
Verify Cloudflare Pages production and staging bindings in Pages settings:
- R2 bucket binding: `RESEARCH_R2` mapped to `stewardmd-research-private`.
- Queue producer binding: `RESEARCH_QUEUE` mapped to `stewardmd-research-jobs`.
- Dead-letter queue: `stewardmd-research-dlq` attached to `stewardmd-research-jobs` (max 3 retries).

The worker container pulls from `stewardmd-research-jobs` and writes outputs to `RESEARCH_R2`.

### Step 3: Configure Worker Secrets and Gateway Settings
Set the shared callback secret on Cloudflare Pages:
```bash
npx wrangler pages secret put RESEARCH_CALLBACK_SECRET --project-name stewardmd
```

Set the matching callback secret on the research worker:
```bash
cd workers/research-worker
npx wrangler secret put RESEARCH_CALLBACK_SECRET
```

Ensure worker environment variables are configured:
- `RESEARCH_GATEWAY_URL`: URL of the Research API gateway (e.g. `https://stewardmd.in/api/research`).
- `RESEARCH_CALLBACK_URL`: Base URL for callbacks (e.g. `https://stewardmd.in`).
- Cloudflare queue and R2 credentials: `CF_ACCOUNT_ID`, `CF_QUEUE_ID`, `R2_ENDPOINT`, `R2_BUCKET`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

### Step 4: Build and Deploy the Worker via GitHub Actions
Trigger the deployment workflow manually:
1. Go to GitHub repository -> Actions -> "Deploy Research Worker".
2. Click "Run workflow".
3. Select `environment`: `staging`.
4. Enter `confirm`: `deploy`.
5. Run the workflow.

The workflow executes test suites, builds the worker container image from context `backend/research`,
pushes the image to `ghcr.io/<owner>/stewardmd-research-worker:<sha>`, and triggers the deploy hook.

### Step 5: Enable Server Variable on Staging First
In Cloudflare Pages settings for the staging environment:
- Set environment variable `RESEARCH_PO_ENABLED="1"`.
- Verify staging end to end before considering production activation.

## Guards and Caps

PaperOrchestra enforces multiple safety guards and consumption caps:

1. Role guard:
   User must hold an `owner`, `editor`, or `analyst` role on the project. Users with `viewer` role
   or external users receive HTTP 403.
2. Systematic Review project guard:
   Manuscript drafting is permitted only on Systematic Review projects (`project_type = 'systematic_review'`).
   Other study designs are rejected.
3. Locked protocol guard:
   The systematic review protocol must be finalized and locked with a cryptographic `lockHash`.
   Draft or unlocked protocols fail with `protocol_unlocked`.
4. Saved run guard:
   The project must have at least one completed statistical analysis run. If no runs exist, token
   generation cannot succeed and the job fails with `invalid_run`.
5. One active job guard:
   Only one manuscript draft job may be in `queued` or `running` state per project at any time.
   Concurrent creation requests return HTTP 409 or 429.
6. Project daily cap:
   Maximum 3 manuscript draft jobs per project per UTC day. Breaches return `project_daily_cap`.
7. User daily cap:
   Maximum 5 manuscript draft jobs per user per UTC day. Breaches return `user_daily_cap`.
8. Reserved T2 call budget:
   Each draft job is reserved for at most 64 LLM calls at tier T2 (Gemini Flash synthesis, 16,000 input
   and 4,000 output token ceilings). Exceeding 64 calls stops the job with `ceiling_calls`.

## Patient identifier override (/ai-draft only)

Interactive drafting via `POST /v1/projects/{id}/ai-draft` includes a single-request patient identifier override for cases where a clinician confirms the text is safe or authorised to send (for example, false positives or properly consented case material):

- **What it does**: If the client-side scan (`RMDPhi.scan` in `research.js`) or the server PHI gate detects possible identifiers on `POST /v1/projects/{id}/ai-draft` (HTTP 422 `phi_blocked` with `overridable: true`), the mobile app opens the "Possible patient identifiers" dialog inside `#researchMD`. The dialog shows only plain-word identifier categories (never the flagged text itself). If the user ticks "I accept these terms" and taps "I take responsibility, send anyway", the client resends that single `/ai-draft` request once with `phiOverride: { accepted: true, termsVersion: "rmd-phi-override-v0" }`. For client-side blocks, the resent payload keeps all automated `SMD_redactPHI` and `SMD_PHI_INDIA` redactions applied. A second block after an override rejects without looping.
- **Where it is never applied**: The override is strictly restricted to interactive `POST /v1/projects/{id}/ai-draft`. It is never applied to PaperOrchestra project snapshots, `manuscript_draft` jobs (`/v1/projects/{id}/jobs`), the PaperOrchestra AI gateway (`functions/api/research/_gateway.js`), suggestion routes (`/extraction/suggestions`, `/screening-suggestions`, `/grade-suggestions`, `/studies/auto-add`), or any automated or background path.
- **Audit event**: Every accepted override writes an `ai_phi_override` row to the ResearchMD D1 audit table (`research_audit_events`, via `api.audit`) with `uid`, timestamp, and `meta` (`{ route: "ai-draft", task, categories, rules, termsVersion }`). Neither the matched text nor the request body text is ever logged.
- **Terms document**: `docs/research/PHI_OVERRIDE_TERMS.md` (version `rmd-phi-override-v0`, currently marked `DRAFT - NEEDS LEGAL REVIEW`).

## How to Test One Job End to End

1. Prepare a staging test project:
   - Create or select a project with type `systematic_review`.
   - Lock the protocol with title, question, PICO criteria, and outcomes.
   - Add verified study evidence with locator pages and direct quotes.
   - Add verified risk of bias assessments with supporting quotes.
   - Complete at least one meta-analysis run to produce verified statistical output.

2. Enqueue the draft job:
   - In the mobile app: Navigate to ResearchMD -> Manuscript screen and tap "Draft Manuscript".
   - Or via API:
     ```bash
     curl -X POST "https://stewardmd.in/api/research/v1/projects/<PROJECT_ID>/jobs" \
       -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
       -H "Content-Type: application/json" \
       -d '{"kind": "manuscript_draft", "idempotencyKey": "test-draft-001"}'
     ```

3. Monitor job execution:
   - Check status endpoint:
     ```bash
     curl "https://stewardmd.in/api/research/v1/jobs/<JOB_ID>" \
       -H "Authorization: Bearer <FIREBASE_ID_TOKEN>"
     ```
   - Verify status transitions: `queued` -> `running` -> `succeeded`.

4. Verify resulting artifacts:
   - In R2: Verify object `projects/<PROJECT_ID>/jobs/<JOB_ID>/result.json` exists.
   - Confirm result JSON has `status: "done"`, `usage`, `aiUsage`, and `draft` manuscript.
   - Confirm Abstract and Results sections contain `{{run:<runId>.<fieldPath>}}` tokens and no raw numbers.
   - In D1: Verify GET `/v1/projects/<PROJECT_ID>/manuscript/versions` lists version 1 in `draft` status.
   - In the mobile app: Open the Manuscript screen and verify the generated sections load cleanly.

## How to Read a Failed Job

Inspect the job status via API or query D1 directly:
```sql
SELECT id, status, error_code, completed_ts FROM research_job_runs WHERE id = '<JOB_ID>';
```

When a job fails with `gate_failed`, read the `violations` list in R2 `result.json`:
```bash
# Check result.json violations
cat result.json | jq .violations
```

Stable error codes from `job-messages.md`:

- `gate_failed`: Hard integrity gate violation in generated text. Check `violations` array:
  - `untokenised_number`: A raw statistical number was written in Abstract or Results without a token.
  - `malformed_token`: Token did not match canonical `{{run:<runId>.<fieldPath>}}` format.
  - `unknown_token`: Token references a run ID or field path not present in token table.
  - `unresolved_citation`: Citation key has no matching DOI or PMID in references or evidence.
  - `claim_without_source`: Claim sentence in Results or Discussion lacks a token or citation.
  - `direction_mismatch`: "reduced" or "increased" contradicts effect estimate relative to null.
  - `significance_mismatch`: "significant" contradicts whether 95% CI excludes null.
- `input_missing`: The project snapshot file was not found in R2 storage.
- `snapshot_invalid`: The snapshot JSON file failed validation or was malformed.
- `protocol_unlocked`: Protocol does not contain a valid lock hash.
- `unverified_value`: Study evidence value was not marked verified by human reviewer.
- `missing_provenance`: Evidence value or RoB assessment missing page locator or text quote.
- `unverified_rob`: Risk of bias judgment was not marked verified.
- `invalid_grade`: GRADE row missing outcome or contains invalid certainty level.
- `invalid_run`: Run result missing required statistical fields.
- `invalid_reference`: Reference entry missing citation key.
- `phi_blocked`: Patient identifiers detected by PHI gate; AI call was aborted before reaching provider.
- `gateway_unconfigured`: Worker missing `RESEARCH_GATEWAY_URL` configuration.
- `gateway_*`: Network or gateway error communicating with Research API.
- `ceiling_seconds`: Processing time exceeded wall clock limit (600 seconds).
- `ceiling_calls`: Job exceeded maximum permitted AI calls (64 calls).
- `ceiling_input_tokens` / `ceiling_output_tokens`: Request breached token ceilings.
- `manuscript_failed`: Unexpected internal error during manuscript generation pipeline.

## Rollback Procedure (Owner Steps)

If an issue occurs in production, follow these steps to roll back:

### Step 1: Disable Server Variable
In Cloudflare Pages settings (stewardmd project):
- Set `RESEARCH_PO_ENABLED="0"` (or delete the variable).
- This immediately blocks any new manuscript draft jobs from being created.

### Step 2: Disable Mobile App Flag
In the client feature flags configuration:
- Set `smd_rmd_po="0"`.
- This hides the drafting UI on client devices.

### Step 3: Run Database Rollback Script
Execute rollback script 0006 against the Research D1 database:
```bash
npx wrangler d1 execute stewardmd-research --remote --file docs/research/contracts/phase-5/0006_rollback.sql
```

DESTRUCTIVE ACTION WARNING:
- `0006_rollback.sql` removes the `manuscript_draft` check from `research_job_runs` and executes:
  `DELETE FROM research_job_runs WHERE kind = 'manuscript_draft';`
- It drops all manuscript tables: `research_manuscript_versions`, `research_manuscript_sections`,
  `research_manuscript_approvals`, `research_manuscript_exports`, and `research_checklist_manual`.
- All manuscript drafts, section edits, approvals, and manuscript job records will be permanently deleted.
- Always export a D1 backup before running the rollback script.
