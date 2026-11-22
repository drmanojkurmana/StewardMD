# StewardMD Research — implementation backlog

Status: architecture baseline; implementation not yet started. Branch: `feat/stewardmd-research-foundation`.

## Product decisions (locked)
- Pricing: per-paper credits.
- AI infrastructure: hybrid managed gateway + BYOK.
- Launch: medical-first; discipline adapters must keep the core domain-agnostic.
- Manuscript export/publication package: mandatory human approval.

## Architecture constraints discovered in the repository
- Frontend is static HTML/CSS/vanilla JS; keep that pattern.
- Cloudflare Pages Functions are the public API edge.
- Firebase ID tokens are already verified by `functions/_fbauth.js`.
- MaiK has an existing provider gateway and usage/metering code in `functions/api/ai/[[path]].js`, `functions/_ai_usage.js`, `functions/_credits.js`, and `functions/_usage.js`.
- Existing D1, KV and R2 patterns should be reused. Do not add a second wallet or duplicate provider-key storage.
- Existing AI Control Center already has a `research` usage module. Extend it deliberately; do not silently overload its current Evidence Review semantics.
- Cloudflare Workers AI was deliberately removed after a cost incident. Do not bind it back into Research without explicit cost approval.
- Existing Python FastAPI services establish the pattern for a separately deployed analysis/orchestration service.

## Target topology
1. Static Research workspace in the existing app shell.
2. `/api/research/*` Cloudflare Pages Function: Firebase auth, project membership, request validation, quota/credit reservation, rate limits, request IDs, proxy to the Python service.
3. Python FastAPI Research service: domain logic, orchestration, literature connectors, deterministic statistics, document rendering, provider adapters.
4. D1: project/job/version metadata, state transitions, audit metadata, credit holds. No raw patient-level rows.
5. R2: private encrypted uploads, immutable dataset snapshots, figures and manuscript exports. Signed, short-lived access only.
6. Durable async execution: queue/workflow adapter with idempotent jobs and resumable steps. Select Cloudflare Queues/Workflows vs existing host worker after deployment inventory; do not use in-memory background tasks for production.
7. AI calls go through one model router and provider gateway. BYOK secrets are envelope-encrypted and never returned to the client.

## Delivery milestones

### P0 — foundation and safety (must pass before pilot)
- [ ] Confirm current production bindings, deployment target, auth helper and AI gateway integration with live config; do not assume repo config equals deployed config.
- [ ] Add Research feature flag, routes and navigation entry hidden unless enabled.
- [ ] Implement Firebase-authenticated edge proxy using `verifiedClaimsFor` / `identify`; enforce project membership server-side on every resource.
- [ ] Add D1 migration from `DATABASE_SCHEMA.sql`; create private R2 bucket/binding and lifecycle policy for abandoned uploads.
- [ ] Add FastAPI service skeleton, health/version endpoints, typed settings, structured logs, request correlation and internal service-token authentication.
- [ ] Add upload preflight, MIME/magic-byte/size checks, signed upload/download, checksum, malware-scan hook and deletion.
- [ ] Implement job state machine, idempotency key, lease/heartbeat, retry budget, cancellation and audit events.
- [ ] Implement credit quote → reserve → settle/refund with atomic ledger semantics; integrate existing MaiK Token wallet through a single adapter. No direct client-side balance writes.
- [ ] Threat model PHI, tenant isolation, BYOK key custody, prompt injection, citation poisoning, upload abuse and export controls.
- [ ] Add unit/integration tests, migration tests, auth tests and deterministic fake provider.

### P1 — first usable medical research paper (vertical slice)
- [ ] Create project and structured PICO/PEO question.
- [ ] Upload CSV/XLSX/SPSS/Stata/REDCap export; inspect schema and produce data dictionary.
- [ ] Deterministic data profiling, validation, missingness report, duplicate detection and immutable cleaned dataset version.
- [ ] Statistical analysis plan (SAP) builder with explicit endpoint/variable definitions and researcher sign-off.
- [ ] Run deterministic descriptive statistics and common tests using Python libraries; save code, package versions, input hash and outputs.
- [ ] Produce tables/figures from analysis artefacts, never from LLM-invented numbers.
- [ ] Literature discovery via PubMed/Europe PMC/Crossref/Semantic Scholar adapters; deduplicate DOI/PMID and retain provenance.
- [ ] Evidence extraction with quoted span/page/section provenance and human verification status.
- [ ] Generate IMRAD manuscript draft with every result linked to a frozen analysis output and every citation linked to a source record.
- [ ] Add claim-citation checker, numeric consistency checker, reporting checklist and hallucination/integrity gate.
- [ ] Review screen: approve/reject/edit sections; final export is blocked until an authorised human approves the exact manuscript version.
- [ ] Export DOCX first; add PDF and journal-specific formatting after stable DOCX.

### P2 — research breadth and quality
- [ ] Systematic review workflow: protocol, search strategies, screening, PRISMA flow, extraction, risk of bias.
- [ ] Meta-analysis: effect sizes, heterogeneity, fixed/random effects, forest/funnel plots, sensitivity analyses; validate against known datasets and R packages.
- [ ] Survival analysis (Kaplan–Meier, log-rank, Cox diagnostics), regression, propensity scores and competing risks.
- [ ] Reporting templates: STROBE, CONSORT, PRISMA, CARE, STARD, TRIPOD, SPIRIT and ARRIVE.
- [ ] Study design and protocol authoring; sample-size/power calculations are deterministic and assumptions visible.
- [ ] Journal finder, author instructions parser, cover letter, submission checklist and reviewer-response workspace.
- [ ] Discipline packs: public health, biology, psychology, engineering and social sciences without contaminating medical-specific rules.

### P3 — collaboration and commercialisation
- [ ] Team workspaces, role-based access, comments, reviewer assignment and institution tenancy.
- [ ] Credit packs, purchase/receipt reconciliation, institutional pools and BYOK plan controls.
- [ ] Usage/cost dashboard per project, paper, stage, model and provider.
- [ ] Version comparison, reproducibility bundle and signed audit export.
- [ ] Optional journal submission integrations only after user confirmation and provider terms review.

## First coding tasks (recommended order)
1. Add schema migration + migration test.
2. Add Python service skeleton and domain models.
3. Add edge auth/proxy with project membership guard and feature flag.
4. Add deterministic CSV profiler and dataset-version persistence.
5. Add job runner adapter and fake provider; test resumability.
6. Add credit reservation/settlement adapter to existing MaiK wallet.
7. Add first deterministic statistical analysis (descriptive table + confidence intervals) and reproducibility manifest.
8. Add literature source adapter and citation provenance.
9. Add manuscript section model + human approval state machine.
10. Add Research UI vertical slice.

## Acceptance gates
- No raw patient-level dataset rows or direct identifiers sent to an LLM.
- No LLM-generated p-values, confidence intervals, sample sizes or statistical tables.
- Every manuscript result traces to a versioned analysis artefact; every citation resolves to a source.
- Failed/cancelled jobs refund unspent reserved credits; retries cannot double-charge.
- A researcher cannot access another project's files, jobs, citations or exports by changing an ID.
- Export is impossible until the exact current manuscript version has a human approval record.
- Cost report includes provider-reported input/output/reasoning tokens, retries, embeddings and non-AI infrastructure separately.
- Pilot benchmark reports quality and all-in cost per paper; no sub-$1 promise until measured.
