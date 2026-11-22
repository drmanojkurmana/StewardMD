# ResearchMD
## Product strategy, architecture and delivery plan
**Powered by StewardMD · Medical research first · Multi-discipline by design**

- Product name: **ResearchMD**
- Repository: `drmanojkurmana/StewardMD`
- Implementation branch: `feat/stewardmd-research-foundation`
- Status: Product and engineering plan; Sprint 1 foundation is in progress and is not production-enabled.
- Audience: Clinicians, postgraduate trainees, clinical researchers, academic teams, biostatisticians and research institutions.

---

## 1. Product vision

ResearchMD will be an end-to-end AI-assisted research workspace that helps a researcher move from a research question and source material to a reproducible, evidence-grounded, journal-ready manuscript.

The ambition is to compete with EtAll and other autonomous research products, while differentiating through:
1. **Medical-grade workflow:** clinical study design, evidence appraisal, biostatistics, reporting guidelines and transparent source provenance.
2. **Reproducibility:** every extracted datum, analysis, figure, citation and manuscript claim should be traceable to its source or computation.
3. **Human accountability:** AI proposes and drafts; the researcher verifies, edits and approves. No fabricated data, references or results.
4. **Cost efficiency:** deterministic computation wherever possible, compact evidence representations, caching, low-cost models for routine tasks and escalation only when justified.
5. **Open-ended disciplines:** medical research is the launch vertical, but the core workflow must support other academic fields through discipline-specific schemas, agents and reporting templates.

ResearchMD is a research assistant and workflow system, not an autonomous author, substitute statistician, ethics committee or guarantee of journal acceptance. Authors remain responsible for the integrity and final content of their work.

## 2. Locked product decisions

| Decision | Locked direction |
|---|---|
| Commercial model | Per-paper credits |
| AI infrastructure | Hybrid: managed StewardMD gateway + bring-your-own-key (BYOK) |
| Initial market | Medical-first; broader academic disciplines supported by adapters |
| Manuscript release | Mandatory human approval before final export |
| Database | Dedicated Research database, isolated from clinical operational records |
| Background processing | Hybrid durable jobs: Cloudflare Queue/Workflow orchestration + separately deployed Python workers |
| File storage | Private R2 bucket; short-lived authorised access |
| First end-to-end pilot | Systematic review and meta-analysis |

## 3. Target users and jobs to be done

### Primary users
- Clinicians and postgraduate researchers developing thesis/dissertation projects.
- Medical faculty and clinical research teams.
- Oncology, internal medicine, surgery and other specialty researchers.
- Biostatisticians and evidence-synthesis teams.
- Research coordinators managing screening, extraction and manuscript preparation.

### Secondary users
- Researchers in public health, life sciences, engineering, psychology, social sciences and other disciplines.
- Institutions that need shared projects, audit trails and controlled collaboration.

### Core user journey
1. Create a project and define a PICO/PEO or discipline-appropriate research question.
2. Select study design or review type and create a protocol.
3. Search, import and deduplicate literature.
4. Screen studies and record inclusion/exclusion reasons.
5. Extract structured evidence with source-page/paragraph provenance.
6. Validate the dataset and approve extracted values.
7. Run reproducible statistical analysis and generate figures/tables.
8. Draft the manuscript from verified evidence and computed results.
9. Verify every citation and material claim.
10. Complete human review, approve the version and export the submission package.

## 4. Product scope and modules

### 4.1 Research workspace and project management
- Projects, collaborators, roles and activity timeline.
- Research question, objectives, hypotheses, population, intervention/exposure, comparator and outcomes.
- Protocol versions, amendments, milestones and task ownership.
- Immutable versions of source files, extracted datasets, analysis plans and manuscript drafts.
- Audit events for all material edits, approvals and exports.

### 4.2 Research question, protocol and study design
- PICO, PEO, PICOT and configurable question frameworks.
- Study design suggestions: RCT, cohort, case-control, cross-sectional, diagnostic accuracy, prognostic model, qualitative study, case series, systematic review and meta-analysis.
- Protocol builder with objectives, eligibility criteria, outcomes, variables, sample-size assumptions and analysis plan.
- Explicit warnings where a proposed design cannot answer the stated question.
- Protocol exports and version comparison.

### 4.3 Literature discovery and evidence library
- PubMed, Europe PMC, Crossref and other permitted bibliographic sources.
- DOI/PMID resolution, deduplication and query history.
- Search strategy builder with reproducible query strings and dates.
- Import of user-provided PDFs and citation files.
- Evidence cards with study design, population, intervention/exposure, comparator, outcomes, effect estimates and limitations.
- Every extracted statement linked to its source and location.
- Respect source licensing, access restrictions and full-text retention policies.

### 4.4 Screening and systematic-review workflow
- Title/abstract screening and full-text screening.
- Configurable inclusion/exclusion criteria.
- Human adjudication for conflicts and uncertain records.
- PRISMA flow accounting with auditable reasons.
- Dual-reviewer workflow and agreement statistics as a later institutional feature.
- Screening decisions must never be silently made final by an LLM.

### 4.5 Data extraction and management
- PDF/table extraction with page coordinates or source locators.
- Structured extraction forms by study design.
- CSV, XLSX, SPSS, Stata and REDCap-compatible imports.
- Data dictionary, variable typing, missingness, range checks and consistency validation.
- Immutable raw upload; derived cleaned dataset versions.
- Researcher confirmation for critical extracted outcomes and effect estimates.
- Patient-level data remains in the controlled compute environment and is not sent to an LLM.

### 4.6 Biostatistics and evidence synthesis
- Descriptive statistics and baseline tables.
- Confidence intervals, hypothesis tests, effect sizes and sample-size/power utilities.
- Regression: linear, logistic, Poisson/negative binomial and Cox proportional hazards.
- Survival analysis: Kaplan–Meier, log-rank, Cox model diagnostics.
- Diagnostic accuracy: sensitivity, specificity, likelihood ratios, ROC/AUC.
- Meta-analysis: fixed and random effects; binary and continuous outcomes; heterogeneity; subgroup analysis; sensitivity analysis; prediction intervals and publication-bias diagnostics after validation.
- Meta-regression and network meta-analysis are later advanced modules.
- Reproducibility manifest: input hash, analysis specification, code version, package versions, execution timestamp and output hashes.
- Independent statistical validation against established reference implementations before release.

### 4.7 Manuscript and journal workflow
- IMRAD and discipline-specific manuscript structures.
- Structured abstract, title, keywords, tables, figures, references and supplementary files.
- Methods and Results generated only from verified protocol, extraction and analysis artefacts.
- Discussion synthesis separates study findings, external evidence, interpretation and limitations.
- Citation resolver and claim-to-source audit.
- Journal formatting profiles, word limits, reference styles and submission checklist.
- Cover letter and response-to-reviewers assistance.
- Versioned editing with tracked changes/diff and explicit researcher approval.
- DOCX first; PDF and LaTeX exports as subsequent formats.

### 4.8 Research integrity and reporting
Medical reporting frameworks to support, as applicable:
- CONSORT and SPIRIT.
- STROBE.
- PRISMA and PRISMA-P.
- CARE.
- STARD.
- TRIPOD.
- ARRIVE.
- CHEERS.
- Relevant risk-of-bias tools and GRADE workflows, with human interpretation.

Integrity controls:
- No fabricated citations, participants, data, statistical results or ethics approvals.
- No unsupported causal claims.
- Flag retracted publications, corrections and expression-of-concern notices where data sources permit.
- Detect contradictions between manuscript text, tables and analysis output.
- Record AI assistance and researcher approvals.
- Do not claim plagiarism-free, journal acceptance or guaranteed scientific validity.

### 4.9 Collaboration and institutional capabilities
- Roles: owner, editor, reviewer, statistician and viewer.
- Comments, assignments and review queues.
- Institutional workspaces, access policy, retention settings and audit export.
- SSO, organisation-level billing and data residency options are later enterprise milestones.

## 5. Technical architecture

### 5.1 Repository integration
Keep the existing StewardMD architecture; do not introduce a frontend framework migration for ResearchMD.

- Frontend: existing static HTML/CSS/vanilla JavaScript patterns and app shell.
- Public API: Cloudflare Pages Functions under `/api/research/*`.
- Identity: existing Firebase authentication helper; derive user identity from verified claims only.
- Research service: separately deployed Python FastAPI application under `backend/research`.
- Metadata: dedicated Research D1 database for the initial Cloudflare deployment; keep database adapter portable for a future PostgreSQL deployment if scale or relational requirements demand it.
- Files: private R2 bucket for PDFs, datasets, figures and manuscript exports.
- Jobs: Cloudflare Queues/Workflows for durable orchestration; Python workers for CPU-heavy extraction/statistics. No in-memory production background tasks.
- AI: one ResearchModelRouter using the existing StewardMD/MaiK managed gateway plus BYOK adapters.
- Observability: structured logs, request/job IDs, cost telemetry, traces and redacted audit events.

### 5.2 Service boundaries
1. **Web app:** user interaction, review, editing and approvals.
2. **Pages API:** authentication, tenant/project authorisation, request validation, rate limits, credit holds, signed upload intents and service proxy.
3. **Research orchestration:** workflow state, agent graph, retries, checkpoints and human-in-the-loop pauses.
4. **Domain services:** literature, screening, extraction, data validation, statistics, reporting and manuscript generation.
5. **Model router:** policy-aware provider selection, BYOK, budgets, caching and usage reconciliation.
6. **Storage:** D1 metadata and job state; R2 immutable artefacts; cache for safe derived content.
7. **Compute:** isolated Python tasks for document parsing, tabular data processing and statistical analysis.

### 5.3 Core data entities
- `research_projects`, `research_members`, `research_roles`
- `research_protocols`, `research_protocol_versions`
- `research_sources`, `research_source_files`, `research_search_runs`
- `research_screening_decisions`, `research_extractions`
- `research_datasets`, `research_dataset_versions`, `research_data_dictionaries`
- `research_analysis_plans`, `research_analyses`, `research_analysis_runs`
- `research_jobs`, `research_job_steps`, `research_artifacts`
- `research_manuscripts`, `research_manuscript_versions`, `research_approvals`
- `research_model_usage`, `research_credit_quotes`, `research_credit_holds`
- `research_audit_events`

Keep patient-level clinical data out of D1 metadata and out of model prompts. Store only necessary project metadata, opaque object keys, hashes, status and audit information.

### 5.4 API design principles
- Version all public APIs under `/api/research/v1`.
- Require Firebase auth except health checks and authenticated service callbacks.
- Enforce project membership and role checks on every resource operation.
- Use idempotency keys for job creation, uploads and credit operations.
- Return asynchronous job IDs for long-running work; support status, progress, cancellation and resumability.
- Use short-lived signed URLs and server-generated object keys for R2.
- Keep internal worker endpoints separate and require service-to-service authentication.
- Never accept owner UID or credit balance from client payloads.
- Return stable error codes, request IDs and no-store cache headers.

### 5.5 Job state machine
`created → queued → running → awaiting_review → succeeded`

Failure/exit states: `failed`, `cancelled`, `expired`.

- Each step has an idempotency key, attempt count, timeout, checkpoint and structured output reference.
- Retries are bounded and classified; deterministic validation errors are not blindly retried.
- Human review steps pause the graph until an authorised user acts.
- Job state transitions and approvals are auditable.

## 6. AI strategy and low-cost-per-paper design

### 6.1 Routing tiers
| Tier | Task | Default |
|---|---|---|
| T0 | Statistics, calculations, validation, citation resolution, reporting checks | Deterministic code; no LLM |
| T1 | Metadata extraction, classification, variable mapping, structured screening suggestions | Low-cost fast model |
| T2 | Evidence synthesis, methods/discussion drafting, reviewer response | Mid-tier model |
| T3 | Independent critique, contradiction and claim-evidence audit | Strong model, bounded use |

All agents call the router, never provider SDKs directly.

### 6.2 Managed and BYOK modes
- Managed mode uses the existing MaiK/StewardMD gateway and its usage controls.
- BYOK keys are stored server-side in an encrypted secret store; never returned to the browser or logs.
- Provider/model IDs, prices, data-retention settings and allowed data classes are versioned configuration.
- Do not silently fail over confidential data to a provider or tier with weaker privacy terms.
- Confirm provider contractual terms, retention and institutional approvals before confidential data is processed.

### 6.3 Cost controls
- Cache literature metadata, search results and permissible derived evidence by canonical hash.
- Deduplicate references before downloading or extracting full text.
- Extract once into structured evidence cards; downstream agents consume compact cards and citations, not repeated PDFs.
- Never send raw patient-level rows to an LLM.
- Use deterministic statistical libraries and citation resolvers.
- Generate sections independently from verified artefacts; avoid repeated full-document rewrites.
- Limit retries and output tokens; escalate only on explicit validation failure.
- Use batch processing when lower cost and latency are acceptable.
- Track estimated and provider-reported actual cost per paper and per stage.
- Enforce a hard paper budget with a researcher-visible quote and approval for overage.

### 6.4 Credit lifecycle
1. Estimate work from project type, document count, pages and requested modules.
2. Present a transparent credit quote and included stages.
3. Reserve credits atomically through the existing MaiK wallet adapter.
4. Meter actual managed-provider usage and compute/storage units.
5. Settle on completion; release unused reservation on cancellation/failure.
6. Reconcile provider usage and ledger entries.
7. BYOK provider charges remain with the user's provider account; any Research platform credits cover only disclosed platform/compute charges.

Do not create a second wallet or write balances from the client. Credit billing is a go-live blocker, not assumed complete in the Sprint 1 pilot.

### 6.5 Cost and quality targets
Initial product target, to be measured rather than promised:
- Standard literature-assisted manuscript workflow: target managed AI spend of **US$0.50–2.00 per paper**, excluding third-party full-text fees, storage, compute, taxes and exceptional premium reviews.
- Every paper has a cost report by stage and provider.
- Benchmark at least 30 representative projects before fixing public credit pricing.
- Quality takes precedence over the cost target; do not suppress required validation to meet a spend ceiling.

## 7. Agent/workflow design

Use a checkpointed graph. Agents are bounded roles, not independent chatbots with unrestricted tool access.

1. **Research Planner:** converts the user question into a structured project plan and identifies missing inputs.
2. **Protocol Designer:** proposes design, eligibility, outcomes and analysis plan; researcher approves.
3. **Search Strategist:** drafts reproducible database queries and records search history.
4. **Literature Retriever:** calls permitted bibliographic APIs and deduplicates records.
5. **Screening Assistant:** suggests inclusion/exclusion with evidence; human confirms.
6. **Evidence Extractor:** extracts structured fields with page/paragraph locators and confidence.
7. **Data Validator:** deterministic checks for ranges, missingness, conflicts and units.
8. **Biostatistics Engine:** deterministic computations, diagnostics, figures and tables.
9. **Evidence Synthesiser:** drafts balanced synthesis from verified evidence cards.
10. **Manuscript Writer:** creates section drafts from approved protocol and computed artefacts.
11. **Citation and Integrity Auditor:** verifies references, claims, numerical consistency and reporting checklist.
12. **Journal Assistant:** formats a submission package and drafts cover letter/reviewer responses.
13. **Human Approval Gate:** authorised researcher reviews and approves the exact immutable version for export.

## 8. Delivery roadmap

### Sprint 1 — Foundation and meta-analysis pilot
**Status: initial code scaffold committed; deployment and validation outstanding.**

- Dedicated D1 schema and project/member/job metadata.
- Firebase-authenticated Pages API.
- Private R2 PDF upload path.
- Queue-to-Python execution path.
- Initial fixed-effect and DerSimonian–Laird engine.
- Dockerfile, tests, CI and provisioning runbook.

Exit criteria:
- Dedicated resources provisioned in a non-production environment.
- CI green, including Python tests, schema execution and JavaScript syntax.
- Two-user tenant isolation tests pass.
- Queue retry, duplicate delivery and failure handling pass.
- Statistical outputs match independent R/metafor reference cases within predeclared tolerances.
- No production enablement until security and privacy review.

### Sprint 2 — First complete systematic-review workflow
- PubMed/Europe PMC/Crossref search connectors.
- Search history and deduplication.
- PDF extraction with page-level provenance.
- Title/abstract and full-text screening queue.
- Human adjudication and PRISMA flow data.
- Structured extraction forms for binary and continuous outcomes.
- Researcher verification of extracted values.

Exit criteria:
- A reviewer can reproduce search strategy and screening counts.
- Every extracted critical datum links to a source location.
- No unverified extraction can enter the final pooled analysis.

### Sprint 3 — Statistical quality and reproducibility
- Independent validation suite against R/metafor.
- REML and Hartung–Knapp where appropriate.
- Prediction intervals and sensitivity/subgroup analyses.
- Forest/funnel plots and heterogeneity diagnostics.
- Analysis plan versioning and reproducibility manifests.
- Exportable tables and figures.

Exit criteria:
- Reference test suite passes with documented estimator assumptions.
- Analysis can be rerun from immutable input and configuration.
- Statistical limitations are displayed to the researcher.

### Sprint 4 — Manuscript generation and integrity
- IMRAD manuscript generation from verified evidence and analysis artefacts.
- Citation resolver and claim-to-source audit.
- Methods/Results numerical consistency checks.
- PRISMA checklist and flow diagram.
- DOCX export and human approval/version lock.
- No final export until the named approver confirms the exact version.

Exit criteria:
- Every citation resolves to a stored source.
- Every Results number maps to a reproducible analysis output.
- Unsupported claims are flagged.
- Approval and export are recorded in the audit log.

### Sprint 5 — Medical research platform
- Cohort/case-control/RCT/diagnostic/prognostic templates.
- CSV/XLSX/SPSS/Stata ingestion and data dictionary.
- Descriptive, regression and survival analysis modules.
- STROBE, CONSORT, STARD, CARE and TRIPOD checklists.
- Journal profiles, cover letters and reviewer response workspace.

Exit criteria:
- Complete pilot manuscripts across at least three study designs.
- Independent statistician review of benchmark outputs.
- Medical reporting checklist coverage validated.

### Sprint 6 — Commercial readiness
- Existing MaiK credit quote/reserve/settle/refund integration.
- Managed gateway routing and BYOK credential vault.
- Per-paper cost report and hard budgets.
- Rate limits, abuse controls, billing reconciliation and support tooling.
- Privacy/security threat model, retention/deletion and backup policies.
- Named pilot cohort and feedback instrumentation.

Exit criteria:
- Credit ledger reconciles with provider usage.
- No charge occurs without a confirmed quote and reservation.
- BYOK secrets are never exposed to clients or logs.
- Pilot support and incident runbooks are ready.

### Sprint 7 — Broader academic disciplines
- Discipline adapter interface for question schema, study types, extraction schema, methods, reporting standards and journal styles.
- Initial adapters for public health/life sciences, psychology/social sciences and engineering.
- General-purpose project workflow remains shared; domain rules remain isolated in adapters.

Exit criteria:
- At least two non-medical workflows completed without changes to the core job, storage, credit or approval systems.

## 9. Pilot benchmark and evaluation

### Benchmark set
Build a curated, legally usable evaluation set:
- 10 medical systematic reviews/meta-analyses with published reference results.
- 10 retrospective/prospective cohort studies with synthetic or de-identified datasets and known analyses.
- 5 diagnostic accuracy studies.
- 5 RCTs with published outcome tables.

### Evaluation dimensions
- Literature retrieval recall and deduplication accuracy.
- Screening agreement with expert adjudicators.
- Extraction accuracy for sample sizes, event counts, effect estimates and confidence intervals.
- Statistical agreement with reference implementation.
- Citation correctness and claim support.
- Numerical consistency across abstract, text, tables and figures.
- Reporting guideline completeness.
- Human editing time and reviewer-rated usefulness.
- Managed AI spend and total platform cost per paper.

### Release gates
- Zero fabricated references in the release benchmark.
- Zero silently invented data or statistical outputs.
- All material extracted outcomes traceable to source locations.
- All numerical manuscript claims traceable to analysis outputs.
- Independent statistical validation before enabling clinical study analyses.
- Human approval before manuscript export.
- Privacy and tenant-isolation tests pass.

Do not advertise an accuracy percentage until measured on a pre-registered evaluation set and independently reviewed.

## 10. Security, privacy and scientific integrity

- Separate Research data from patient-care records and operational clinical systems.
- Classify data before provider routing; default to denying patient-level data in LLM prompts.
- Use least-privilege access, tenant-scoped queries and server-side role checks.
- Encrypt data in transit and at rest; use private R2 buckets and short-lived signed URLs.
- Store secrets in managed secret storage; rotate service tokens.
- Audit project access, file access, model calls, approvals and exports without logging PHI or secrets.
- Validate uploaded file type, size, checksum and parsing safety; malware scanning before broad rollout.
- Protect against prompt injection in PDFs and retrieved web content; treat all external content as untrusted data.
- Keep raw uploads immutable and record hashes for derived artefacts.
- Provide retention, deletion, export and incident response procedures.
- Obtain required institutional/ethics approvals and provider contractual permissions before processing identifiable or sensitive research data.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hallucinated citations or claims | Citation resolver, source locators, claim audit and no unsupported auto-citation |
| Incorrect statistical methods | Deterministic engines, reference tests, method diagnostics and statistician review |
| Poor PDF extraction | Confidence scores, page provenance and mandatory verification of critical values |
| AI cost escalation | Per-paper budgets, caching, bounded retries, routing tiers and BYOK |
| PHI leakage | Data classification, no raw patient rows to LLM, isolated compute and audit |
| Provider outage/lock-in | Adapter-based router, queued jobs and explicit provider failover policy |
| Cross-tenant data exposure | Membership checks on every route, tenant-scoped storage keys and security tests |
| Workflow failures/duplicate jobs | Idempotency, checkpoints, bounded retries and dead-letter queue |
| Overstated product capability | Evidence-based benchmark claims and transparent limitations |

## 12. Immediate next actions

1. Finish Sprint 1 CI and review the draft PR; do not merge until tests and security review pass.
2. Provision dedicated non-production D1, private R2, Queue and dead-letter queue.
3. Deploy the Research FastAPI service and queue consumer to staging.
4. Run two-user isolation, upload validation, callback authentication and queue retry tests.
5. Validate meta-analysis outputs against independent R/metafor reference cases.
6. Add PubMed/Europe PMC literature discovery and source deduplication.
7. Implement PDF extraction with page-level evidence provenance.
8. Build screening and human-verified data extraction.
9. Add the first end-to-end PRISMA workflow.
10. Only after that workflow is reliable, add manuscript drafting and credit billing.

---

## 13. Definition of done for ResearchMD

ResearchMD is ready for its first public medical-research release only when a researcher can:

- Create a project and protocol.
- Reproduce a literature search.
- Screen and deduplicate records with an auditable trail.
- Extract and verify study data with source locators.
- Run validated, reproducible statistical analysis.
- Generate figures, tables and a manuscript from verified artefacts.
- Verify citations and numerical claims.
- Review and approve the exact manuscript version.
- Export a complete submission package.
- See the paper's credit quote, actual usage and cost breakdown.

**North star:** one reproducible research project, from question to human-approved manuscript, with every important claim traceable and every AI/computational cost visible.
