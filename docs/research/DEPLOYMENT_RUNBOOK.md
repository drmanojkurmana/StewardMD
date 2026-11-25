# StewardMD Research — production provisioning runbook

## Findings from current production configuration

- The Pages project is stewardmd; root wrangler.toml contains existing D1 and R2 bindings.
- Production is a named Wrangler environment with separately declared bindings. Do not assume root-level bindings or vars automatically appear in production.
- The production Pages configuration is close to Cloudflare's 128 text-binding limit. Avoid adding many vars; use a dedicated KV config object if more flags are needed.
- Current config has no Research D1 database, Research R2 bucket or Research Queue binding.
- Production AI provider is currently Runware-first in env.production.vars. Do not assume the previous Vertex/Gemini path is the live default.
- MaiK credits are rupee/MT based. Their atomic reservation/reconciliation path must be verified before charging Research users. This pilot does not debit credits.

No production resource IDs or secrets are committed. Provisioning is a separate operator step.

## Resource provisioning

Use the Cloudflare account that owns the StewardMD Pages project.

    npx wrangler d1 create stewardmd-research
    npx wrangler r2 bucket create stewardmd-research-private
    npx wrangler queues create stewardmd-research-jobs
    npx wrangler queues create stewardmd-research-dlq

Record the returned D1 database ID. Do not paste account credentials or API tokens into GitHub.

## D1 migration

After adding production Pages binding RESEARCH_DB to the new database, apply:

    npx wrangler d1 execute stewardmd-research --remote --file functions/db/research_schema.sql

Verify tables exist before enabling the pilot.

## Pages production bindings

Configure in Cloudflare Pages → stewardmd → Settings → Functions → Bindings, for Production:

- D1: RESEARCH_DB → stewardmd-research
- R2: RESEARCH_R2 → stewardmd-research-private
- Queue producer: RESEARCH_QUEUE → stewardmd-research-jobs

Configure preview bindings separately if preview testing is wanted. Keep Research disabled until access-control, retention, backup and security review are complete.

## Pages secrets and flags

Use Cloudflare Pages environment variables/secrets; never commit them:

- RESEARCH_CALLBACK_TOKEN: random 32+ byte secret shared only with the queue consumer.
- RESEARCH_MODE: keep unset or disabled; set to pilot only for the approved test cohort.
- (No second feature flag is required; this keeps the Pages text-binding count low.)

The API currently requires RESEARCH_MODE=pilot. Pilot mode is not credit metering; keep it limited to explicitly authorised test accounts until credit reservation is integrated.

## Python Research API

Deploy backend/research/Dockerfile to the approved container runtime. Set RESEARCH_ENV=production and RESEARCH_WORKER_TOKEN to a different random 32+ byte secret shared only with the orchestrator Worker. Restrict ingress to the Cloudflare orchestrator where supported. Monitor /health. Production docs are disabled.

## Queue consumer Worker

Deploy from workers/research-orchestrator after creating queues:

    cd workers/research-orchestrator
    npx wrangler secret put RESEARCH_WORKER_TOKEN
    npx wrangler secret put RESEARCH_CALLBACK_TOKEN
    npx wrangler deploy

Set RESEARCH_API_URL to the restricted Python service base URL and RESEARCH_CALLBACK_URL to https://stewardmd.in as Worker environment variables. Configure the Pages queue producer binding above.

## Go-live gates

1. Apply D1 migration and verify tables/indexes.
2. Verify project isolation with two Firebase test accounts.
3. Verify PDF type/size checks and private R2 access.
4. Verify queue retries, dead-letter handling and duplicate delivery.
5. Verify Python token rejection and callback token rejection.
6. Verify successful and failed jobs reach terminal states.
7. Add credit quote/reserve/settle/release integration before charging any customer.
8. Validate calculations against independent reference datasets and R/metafor or equivalent.
9. Complete security/privacy review and define full-text retention/deletion.
10. Only then enable the pilot for named testers.

## Known limitations in this sprint

- Meta-analysis accepts supplied study effect estimates and confidence intervals; PDF extraction and evidence provenance are not automated yet.
- Estimators: inverse-variance fixed effect and DerSimonian–Laird random effects with normal confidence intervals. This is not a replacement for statistical review.
- Forest plot output is chart-ready JSON; image rendering and DOCX manuscript generation are later tasks.
- Credit metering is intentionally not active in this pilot API.
