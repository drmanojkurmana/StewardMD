# ResearchMD: the complete plan (v2.1)

One plan, A to Z. v2 (2026-11-23) applied the first Gemini Neon audit (`AUDIT_GEMINI_NEON_2026-11-23.md`, 6.5/10). v2.1 applies the re-audit (`AUDIT_GEMINI_NEON_v2_2026-11-23.md`, 8.0/10): corrected numeric gates, engine split into its own file, pull-queue protocol, pinned metafor settings, `.gitignore` fix, PHI false-positive limit, flag-off export, offline conflict policy, ordering fixes, 5B to 5D packaged. `RESEARCHMD_MASTER_PLAN.md` stays as the original vision.

---

## 1. What ResearchMD is

A research module inside the StewardMD app (iOS and Android). A doctor runs a whole study in it, from the first question to the journal submission, with AI help at each step and a human signing off on every result.

- **Lives in:** the StewardMD app, as an overlay opened from a Home tile. Never a separate product, never a web version (StewardMD is mobile-only).
- **Screens (D-1, locked):** phone for quick work (screening a batch, checking progress, verifying a single value, approving, reading summaries); tablet and landscape layouts for heavy work. Phase 3 PDF extraction and Phase 5A manuscript editing are tablet-first: on a phone they are view, comment and approve only.
- **First use:** systematic review and meta-analysis. **Market:** medical research first; other fields later.
- **Role:** an assistant. The researcher stays responsible for design, interpretation, ethics, authorship and submission.

## 2. Locked decisions

| Area | Decision |
|---|---|
| Where it lives | Module inside the StewardMD app, flag `smd_research` (default OFF) |
| Frontend | House pattern: ES5 IIFE, buildless, `www/` bundle. Code reaches phones by OTA (`vault/modules/OTA Updates.md`) or native release; `?v=` only busts the WebView cache |
| Frontend spec | Section 5.1, written before Phase 2 |
| Stats | `research-engine.js`: pure, no DOM, dual export (browser global `SMD_RESEARCH_ENGINE` and ES/CommonJS module). Canonical for univariate meta-analysis (Phases 1 to 4): the phone runs it for previews, the API imports the same file for saved runs. The Python worker is canonical for regression, survival and diagnostic models (Phase 5D), with R parity. Every manifest records engine name and version hash |
| Database | Dedicated D1 `stewardmd-research` for metadata, decisions and audit pointers only |
| Files and blobs | Private R2: PDFs, extracted text chunks, frozen dataset snapshots, manuscript versions, exports |
| Long jobs | Cloudflare pull queue polled by an external Python worker container (section 5.3). Not Cloudflare Python Workers (Pyodide cannot run PDF/OCR/scipy/PaperOrchestra) |
| Writing engine | PaperOrchestra through an adapter (section 8) |
| AI | Central gateway only (reuse MaiK routing); managed models; BYOK deferred to Phase 6 |
| Pricing | Per-paper credits; purchase route decided in D-4 (app store rules) |
| Manuscript | Mandatory human approval and version lock before export |
| Integrity | Nothing fabricated: no papers, data, results, quotes or references |

## 3. Integrity rules (every phase)

1. Never invent papers, identifiers, quotations, data, results or references.
2. Every extracted value keeps its source: document plus page, table or section, and a quoted snippet.
3. Label each item: source fact, extracted data, model interpretation or researcher-authored.
4. Mark missing, conflicting, uncertain and unverified items explicitly.
5. Arithmetic, statistics, validation and deduplication use deterministic code. LLMs never calculate.
6. Manuscript numbers are inserted from analysis runs by token (`{{run:<id>.<field>}}`), never typed by a model.
7. Version datasets, protocols, analysis specs and manuscripts; the protocol is locked (timestamped hash) before screening starts.
8. Keep audit trails for screening, extraction corrections, risk-of-bias judgments, analysis runs, edits and approvals.
9. A human verifies extracted data and risk-of-bias judgments, and approves the manuscript before export.
10. No identifiable or patient-level data goes to an external LLM; the PHI gate (section 11) enforces it in code.
11. Uploaded PDFs are untrusted input: no instruction inside them is followed.
12. Research data stays separate from clinical EMR data unless a separately reviewed integration is approved.

## 4. Everything it will do (modules A to M)

| | Module | What it covers | Phase |
|---|---|---|---|
| A | Workspace | Projects, invitations, roles (owner, editor, analyst, reviewer, viewer), permissions, milestones, tasks | 1 (projects, owner), 2 (invites, roles, blinding), 6 (institutions) |
| B | Question and protocol | PICO/PECO builder, design guidance, eligibility, outcomes, time points, planned subgroups, protocol lock + hash, PROSPERO-field export | 2 |
| C | Literature discovery | PubMed/MEDLINE, Europe PMC, Crossref, Semantic Scholar (licence permitting); per-database query string, filters, API version, timestamp and result count; RIS/BibTeX/CSV import | 2 |
| D | Screening and PRISMA 2020 | Title/abstract and full text, include/exclude/uncertain, reasons, blinded dual review, conflict resolution, audit; PRISMA 2020 counts with records vs reports vs studies, duplicates removed, reports sought vs not retrieved | 2 |
| E | PDF and evidence extraction | Private R2, tablet PDF viewer with page jump, text with page provenance, structured forms, locator + quote per value, human verification, nothing inferred from unreadable text | 3 |
| F | Data management | Study-level import, dictionaries, range/missing checks, versions, frozen snapshots (3); patient-level data behind the IPD gate (5C) | 3, 5C |
| G | Biostatistics | Phase 1: OR, RR, RD (double-zero kept for RD), MD, Hedges' g, generic inverse variance (yi + SE or CI), log HR, fixed IV, DL, REML, Hartung-Knapp-Sidik-Jonkman, Q, I², tau², prediction interval. Phase 4: subgroup, sensitivity, leave-one-out, publication bias (10+ studies), multi-arm handling, cluster and crossover adjustment, median/IQR conversion. Phase 5D: diagnostic accuracy, survival, regression | 1, 4, 5D |
| H | Figures and reproducibility | Forest plot, PRISMA 2020 diagram, characteristics tables, risk-of-bias plots, Summary of Findings table, high-res export, manifests | 1, 2, 3, 4 |
| I | Manuscript and integrity | IMRAD, structured abstract, token-inserted numbers, verified references, claim-to-source links, version lock, DOCX | 5A |
| J | Guidelines and submission | PRISMA 2020 checklist first, then CONSORT, STROBE, CARE, STARD, TRIPOD, SPIRIT; journal matching, cover letter, declarations, submission pack, reviewer responses | 5B |
| K | Other disciplines | Adapters for public health, life sciences, psychology, social sciences, engineering | 7 |
| L | Risk of bias | RoB 2, ROBINS-I, QUADAS-2, Newcastle-Ottawa forms; dual assessors; supporting quote + locator per judgment; conflict resolution | 3 |
| M | Certainty of evidence | GRADE domains per outcome, Summary of Findings table | 4 |

## 5. Architecture

```text
StewardMD app (iOS/Android, www/ bundle; phone + tablet layouts)
  research-engine.js (canonical stats, no DOM) + research.js (shell)
  + research-store.js + research-screen-*.js
        │ Firebase ID token
        ▼
stewardmd.in/api/research/*   Pages Function: auth + project role on every call,
                              imports research-engine.js for saved runs, spend caps
        ├─ D1 stewardmd-research   metadata, decisions, roles, audit pointers
        ├─ R2 private              PDFs, text chunks, snapshots, search ID lists, manuscripts, exports
        └─ pull Queue ◄── polled by Python worker container (external)       [Phase 3]
                              ├─ PDF text/tables + page provenance, OCR
                              ├─ PaperOrchestra adapter                      [3, 5A]
                              └─ calls the central AI gateway (PHI gate first)
```

### 5.1 Frontend spec (written in Phase 1.0, binding from 1.2)
- Files at the repo root (so `build-www.sh` copies them with no change): `research-engine.js` (stats only), `research.js` (shell, navigation, `SMD_RESEARCH.open`), `research-store.js` (state), `research-screen-<name>.js` (one file per screen). One builder per file.
- One global `SMD_RESEARCH` with sub-namespaces per screen, plus `SMD_RESEARCH_ENGINE`; no other globals.
- All dynamic text goes through one escaping helper; raw `innerHTML` with data is banned (lint check in CI).
- One small state store per project; screens re-render from it.
- Tablet breakpoint 768 px; heavy screens two-pane on tablet, single-pane with tabs on phone.
- PDF viewing: the bundled pdf.js (`vendor/pdfjs/`), lazy-loaded; render only the current page plus or minus 1, at most 3 live canvases, capped canvas resolution, offscreen canvases destroyed (iOS WebView memory limit).
- Offline: queued writes with idempotency keys; every record carries `version`; the API rejects stale writes with HTTP 409 and the screen shows both values for the user to choose. Screens show sync state.
- Headless UI tests run at 375 px, 768 px and 1024 px landscape, plus network-dropped and app-backgrounded cases.

### 5.2 Contracts (frozen before each phase's builders start)
`docs/research/contracts/phase-N/`: D1 migrations, JSON schemas for every request and response, the locator schema (manual entry in Phase 1, PDF page/box in Phase 3, same shape), standard error envelope and codes, pagination rules. Builders code to these files; changing one is a Claude-reviewed commit.

### 5.3 Worker runtime and queue protocol (decided in 3.0)
- The API puts small job messages (job id, idempotency key, R2 pointers) on a Cloudflare **pull** queue. No relay.
- The external Python container polls the queue over the HTTP pull API with a visibility timeout longer than the job's ceiling, extends the lease for long jobs, and acks only after the result is written. An un-acked message reappears and is retried; after the retry limit it goes to the dead-letter queue, which alerts.
- Jobs are idempotent by key, cancellable (the container checks a cancel flag between steps), and bounded by the ceilings in section 6.
- Results go to R2; the container then calls the API callback signed with HMAC, verified server-side. The worker holds no user tokens.
- Container CPU, memory and timeout limits are fixed in the 3.0 contract. Host choice is decision D-3.

### 5.4 Operations
D1 migrations forward-only with a tested rollback script per migration; DLQ alerting; app-bundle and API version skew handled by an API version header and a minimum-bundle check (old bundles get a clear "update the app" message). Flag OFF hides the tile but keeps data; while a user has projects, Settings shows "Export my research data" (CSV, manifests, PDFs list) even with the flag off.

## 6. AI routing, cost and spend caps

| Tier | Work | Approach |
|---|---|---|
| T0 | Stats, arithmetic, validation, dedup, citation resolution, number insertion | Deterministic code, no LLM |
| T1 | Metadata, classification, screening and extraction suggestions | Low-cost fast model |
| T2 | Evidence synthesis, section drafting | Mid-tier model |
| T3 | Independent critique, hard claim audits | Strong model, only when justified |

- Every call goes through the central gateway, after the PHI gate, with token logging per job, per user and per project.
- **Spend caps exist before the first AI call (Phase 3.0):** per-step ceilings (max tokens, max retries, max refinement rounds, max PDFs per batch), per-project and per-user daily caps, hard stop with a clear message.
- **Target:** US$0.50 to 2.00 managed AI spend per standard review. Unit economics also count worker compute, R2, store fees (up to 15 to 30% if bought in-app) and taxes. Measured on real reviews in Phase 5 before any price is set.

## 7. Credits

Quote with per-step ceilings → reserve the ceiling → run → record actual usage → settle → release the rest; on partial failure, charge only completed steps; server reconciliation daily. Reuse the MaiK wallet adapter. The client never writes balances. Purchase route per D-4.

## 8. AI steps and PaperOrchestra

Steps: question assistant, protocol assistant, literature suggester, deterministic dedup, screening suggester, PDF/evidence extractor, risk-of-bias suggester, data-quality reviewer, stats-method adviser, deterministic analysis, section writer, citation/claim auditor, guideline reviewer, independent critic. Each has a JSON schema, explicit permissions, completion criteria, ceilings from section 6, provenance, audit metadata and a human gate. Suggestions are always unverified until a human accepts them.

**PaperOrchestra** (google-research/paper-orchestra, Apache 2.0, about 4,700 lines of Python) is used through an adapter, not rewritten:

- Vendored unchanged into `backend/research/paperorchestra/upstream/` with LICENSE and NOTICE; our code lives in `backend/research/paperorchestra/adapter/`. Upstream updates merge cleanly.
- The adapter replaces at the seams: LLM client → our gateway client; Semantic Scholar search → our connectors (PubMed, Europe PMC, Crossref, S2); input loader → ResearchMD project, protocol and analysis manifest; output writer → IMRAD/Vancouver DOCX instead of CVPR/ICLR LaTeX.
- Used: outline agent, literature review agent (as a suggester), section writing agent, content refinement loop, autoraters. Not used: plotting agent (plots stay deterministic), LaTeX templates.
- Hard gates run inside the refinement loop before any reviewer score: every number is a `{{run:...}}` token, every citation resolves to a DOI or PMID, every claim has a source link.
- If the adapter seams prove too invasive during Phase 3.7, fall back to keeping its prompts and autorater rubrics in a lean pipeline (decision D-5).
- Runs only on the Phase 3 worker. Its benchmark is on AI-research papers; clinical quality is measured in Phase 5A.

## 9. Who builds it

| Builder | Use for |
|---|---|
| **Claude** (this session) | Plans, contracts, briefs, wiring into the app, CI, security, reviewing every diff, tests, UI skill passes, commits and PRs |
| **Muse** (`muse-spark-1.3`, xhigh, contributor mode) | Logic: engine, API, schema, worker, connectors, PaperOrchestra adapter |
| **agy** (`gemini-3.8-flash-medium`) | Screens to the frontend spec, headless UI tests |
| **Gemini desktop** (computer use; Hydrogen small, Neon big; three accounts) | Independent reviews and audits, clinician copy review, journal/guideline/database-terms research. Not used to verify arithmetic (R scripts do that) |

Rules: build to the frozen contracts; edit only your package's files; never two builders on one file at once; no merge, deploy, provisioning or secret changes; no commits (Claude reviews and commits); ES5 in app files; no em-dash in app text; report files changed, tests run and real output.

## 10. Phases

Every phase starts with its contracts (5.2) and ends with its numeric gates (section 12).

### Phase 0: Make PR #2730 sound
| Package | Builder | Status |
|---|---|---|
| Fix double-escaped regexes in the research API | Claude | Done, uncommitted |
| Security-scan recognises `verifyFirebaseClaims` | Claude | Done, 0 findings, uncommitted |
| Retire `backend/research/app/services/meta_analysis.py` (the JS engine is canonical; it had the CI-level bug) | Claude | Pending |
| Anchor `.gitignore` rule to `/research/` (it was meant for Appllama downloads and was hiding `docs/research/`) | Claude | Done, uncommitted |
| Move the built engine out of `research.js` into `research-engine.js`; test file follows | Claude | Pending |
| Push; Pages build and all checks green | Claude, with owner OK to push | Pending |

### Phase 1: Meta-analysis in the app
| # | Package | Builder |
|---|---|---|
| 1.0 | Phase 1 contracts; frontend spec 5.1; the pinned reference call for every method (below) | Claude |
| 1.1 | Engine: OR/RR/RD/MD/SMD, fixed IV, DL, Q/I²/tau², manifest, refuses unverified | Muse (done: 15/15 tests, BCG matches metafor) |
| 1.1b | Engine: generic inverse variance, log HR input, RD keeps double-zero studies, REML, HKSJ, prediction interval; DL-only runs show a method notice | Muse |
| 1.2 | Screens (phone + tablet): project list, study table, locator + verified, run, forest plot (SVG), CSV + manifest export, offline queue with 409 handling | agy |
| 1.3 | API: projects, studies CRUD with `version`, saved runs computed server-side by importing `research-engine.js`, two-user isolation test | Muse |

Pinned reference calls (the parity script and the engine both follow these; any change is a reviewed contract change):
- Effect sizes: `metafor::escalc(measure=..., add=1/2, to="only0", drop00=TRUE)` for OR/RR; `drop00=FALSE` for RD; `measure="SMD"` (Hedges' g, `vtype="LS"`).
- Fixed: `rma(yi, vi, method="FE")`. DL: `rma(yi, vi, method="DL")`. REML: `rma(yi, vi, method="REML", control=list(stepadj=0.5, maxiter=1000))`, tau² clamped at 0.
- HKSJ: `test="knha"` without truncation by default; the engine also reports the truncated variant (`adhoc` per Röver et al.) when the HKSJ CI is narrower than the Wald CI, and the UI notes it.
- Prediction interval: `predict(rma_fit)` (t with k-2 df under `test="knha"`, normal otherwise); not shown when k < 3.
| 1.4 | Home tile, script tag, vault note | Claude (done, uncommitted) |
| 1.5 | R/metafor parity script in CI (R installed on the runner) over dat.bcg and 5 more metadat sets | Claude + Muse |
| 1.6 | Independent review of the Phase 1 screens and copy | Gemini desktop |
| 1.7 | Review, `npm test`, headless UI test, UI skill pass, PR | Claude |
| 1.8 | Provision D1 `stewardmd-research` | Owner approves, Claude runs |

### Phase 2: Systematic review workflow
| # | Package | Builder |
|---|---|---|
| 2.0 | Phase 2 contracts | Claude |
| 2.0b | Database terms, licences, API keys and rate limits (PubMed E-utilities key + tool/email params, Crossref polite pool, Semantic Scholar terms) before any connector is built | Gemini desktop, Claude confirms |
| 2.1 | PICO/protocol builder, protocol lock (hash + timestamp), PROSPERO-field export | Muse (API), agy (screens) |
| 2.2 | Invitations, roles, server-enforced permissions | Muse |
| 2.3 | Connectors per 2.0b: PubMed, Europe PMC, Crossref, S2 if terms allow. Each search run stores the per-database query, filters, a date upper bound, API version, timestamp, count, and the full returned ID list (PMID/DOI) in R2 | Muse |
| 2.4 | RIS/BibTeX/CSV import, normalisation, deterministic DOI/PMID/title dedup | Muse |
| 2.5 | Screening: title/abstract and full text, blinded dual review (a reviewer cannot see the other's vote until both decide), conflicts, reasons, audit | agy (UI), Muse (API) |
| 2.6 | PRISMA 2020: records vs reports vs studies, duplicates, reports sought/not retrieved; diagram | Muse (counts), agy (diagram) |

### Phase 3: Safe AI foundation, PDFs, extraction, risk of bias
| # | Package | Builder |
|---|---|---|
| 3.0 | Before any AI call or PDF: threat model; PHI/PII gate (detect and block patient identifiers before the gateway; published-paper content such as author names, hospitals, enrolment dates and age brackets is allowed; tested on synthetic PHI and on the clean 25-PDF set for false positives); retention and deletion policy; worker runtime + callback auth (5.3); spend caps and token logging (section 6); prompt-injection test set | Claude + Muse |
| 3.1 | Provision R2 + Queue + worker host | Owner approves, Claude runs |
| 3.2 | Worker: PDF text, tables, OCR, page provenance, idempotent jobs, retries, DLQ | Muse |
| 3.3 | Tablet PDF viewer with page jump and locator highlight | agy |
| 3.4 | Extraction forms, locator + quote per value, verification, correction audit | agy (UI), Muse (API) |
| 3.5 | T1 extraction and screening suggestions via the gateway, unverified until accepted | Muse |
| 3.6 | Risk-of-bias module L: RoB 2, ROBINS-I, QUADAS-2, NOS forms, dual assessors, quote + locator per judgment | Muse (API), agy (UI) |
| 3.7 | PaperOrchestra vendored + adapter; literature agent as a suggester into screening | Muse |
| 3.8 | Study-level data import, dictionaries, checks, versions, snapshots in R2 | Muse |
| 3.9 | Extraction benchmark build: 25 PDFs stratified (scanned, rotated, multi-page and merged-cell tables, median/IQR) | Claude + Gemini desktop for sourcing licensed PDFs |

### Phase 4: Statistical depth and certainty
| # | Package | Builder |
|---|---|---|
| 4.1 | Subgroup, sensitivity, leave-one-out, publication bias (funnel, Egger) at 10+ studies | Muse |
| 4.2 | Multi-arm (split shared control), cluster and crossover adjustment, median/IQR to mean/SD conversion with method shown | Muse |
| 4.3 | GRADE module M and Summary of Findings table | Muse (API), agy (UI) |
| 4.4 | Risk-of-bias plots, characteristics tables, high-res export | agy |
| 4.5 | Method-choice guidance, signed by a human statistician | Gemini desktop draft, statistician signs |

### Phase 5A: Manuscript engine
| # | Package | Builder |
|---|---|---|
| 5A.1 | PaperOrchestra adapter for outline and section writing from protocol, verified evidence, RoB, GRADE and saved runs | Muse |
| 5A.2 | `{{run:...}}` number tokens rendered deterministically; citation resolver; claim-link checker; all as hard gates | Muse |
| 5A.3 | Manuscript editor (tablet-first), versions, approval, version lock, DOCX (IMRAD, Vancouver) | agy (UI), Muse (export) |
| 5A.4 | Autoraters + quality study on curated medical reviews; measure cost per review | Muse, Gemini desktop review |

Phases 5B, 5C and 5D are provisional: their packages are re-cut after Phase 4 is used on real reviews.

### Phase 5B: Checklists and submission (provisional)
| # | Package | Builder |
|---|---|---|
| 5B.1 | PRISMA 2020 checklist auto-filled from project data, with page/section pointers into the manuscript | Muse (logic), agy (UI) |
| 5B.2 | CONSORT, STROBE, CARE, STARD, TRIPOD, SPIRIT checklists on the same engine | Muse, agy |
| 5B.3 | Journal matching and author-instruction lookup | Muse, Gemini desktop for journal source checks |
| 5B.4 | Cover letter, declarations, submission pack export; no "direct submission" claim until built and tested | Muse, agy |
| 5B.5 | Reviewer-response workspace linking each response to manuscript changes | agy, Muse |

### Phase 5C: Patient-level data compliance (provisional)
| # | Package | Builder |
|---|---|---|
| 5C.1 | Applicability review: DPDP Act (India), GDPR, HIPAA; IRB/consent evidence upload required per project | Claude + Gemini desktop research, owner approves |
| 5C.2 | Encryption at rest for IPD snapshots, data residency, access logs, breach logging | Muse + Claude |
| 5C.3 | IPD gate: no patient-level upload until 5C.1 evidence is on file; patient-level rows never reach an LLM (enforced in code) | Muse |

### Phase 5D: Other study designs (provisional)
| # | Package | Builder |
|---|---|---|
| 5D.1 | Cohort, RCT, observational, diagnostic and prognostic templates | Muse (API), agy (UI) |
| 5D.2 | Regression and survival in the Python worker, canonical for these models, with R parity in CI | Muse |
| 5D.3 | Diagnostic accuracy (bivariate model) with R parity | Muse |

### Phase 6: Commercial readiness
| # | Package | Builder |
|---|---|---|
| 6.1 | Purchase route per D-4, then credit lifecycle on the MaiK wallet | Muse |
| 6.2 | BYOK (only if D-6 says yes): envelope-encrypted keys, rotation and revocation, zero-logging, still charged platform credits | Muse + Claude |
| 6.3 | Cost reports per project and user; pricing from measured costs | Muse |
| 6.4 | Full security review, audit exports | Claude |
| 6.5 | Institution workspaces, pilot onboarding | agy |

### Phase 7: Other disciplines
Adapters only after real researchers have finished reviews end to end in the medical workflow.

## 11. Security, privacy and governance (from Phase 3.0, not Phase 6)

Tenant isolation and project roles enforced server-side; least privilege; private R2 with short-lived signed access; paywalled full text isolated per project, never shared or cached across tenants; PHI/PII gate before every AI call; prompt-injection hardening and a test set; HMAC-signed worker callbacks; retention and deletion policy; access and export audit logs; provider data-processing review; database-terms and copyright compliance; visible ethics and consent duties. Software never replaces ethics review, a qualified statistician or the researcher's responsibility.

## 12. Evaluation and numeric release gates

| Gate | Threshold | From |
|---|---|---|
| Stats parity with R/metafor | Estimates, SEs, CIs, Q, I², tau²: abs diff <= 1e-4 OR rel diff <= 1e-4; exact agreement on boundary cases (tau² = 0, RD double-zero kept, OR/RR double-zero dropped, k = 2), in CI | Phase 1 |
| Isolation | 0 cross-project reads in the two-user test | Phase 1 |
| Offline sync | 0 silent overwrites in the stale-write test (every conflict returns 409 and is shown) | Phase 1 |
| Search reproducibility | Replaying from the archived ID list reproduces 100%; re-running the date-bounded query live matches at least 99% of stored IDs | Phase 2 |
| Dedup | F1 at least 0.98 on a known set | Phase 2 |
| PRISMA | Counts equal stored decisions, 100% | Phase 2 |
| PHI gate | 100% of the synthetic PHI test set blocked AND false-positive block rate under 2% on the clean 25-PDF set | Phase 3 |
| Prompt injection | 0 instructions followed from the test set | Phase 3 |
| Locator accuracy | At least 95% on the 25-PDF benchmark | Phase 3 |
| Extraction | Error rate reported per field type; no AI value reaches analysis unverified | Phase 3 |
| Numbers in manuscript | 100% of statistical outputs in Abstract and Results (effects, CIs, p-values, sample sizes, heterogeneity) are `{{run:...}}` tokens; 0 untokenised numeric claims in Results (years, counts of reviewers and thresholds are allowed); a deterministic check passes that every direction and significance phrase agrees with its token (for example "reduced" needs an estimate below the null, "significant" needs a CI excluding it) | Phase 5A |
| Citations | 100% resolve to DOI or PMID | Phase 5A |
| Cost | Measured per review on at least 5 real reviews before pricing | Phase 5A |

Also tracked: screening agreement, human correction rate, time saved, failure and retry rates, offline sync errors.

## 13. Owner decisions

| ID | Decision | Needed by |
|---|---|---|
| D-1 | Tablet/landscape layouts for heavy screens within the mobile-only rule | Locked in v2.1 (section 1) |
| D-2 | Approve D1, then R2/Queue provisioning | Decided 2026-11-23: provisioned (D1 stewardmd-research, R2 stewardmd-research, queues research-jobs + research-jobs-dlq, HTTP pull consumer) |
| D-3 | Worker host (an external container service) | Decided 2026-11-23: Cloudflare Containers |
| D-4 | Credit purchase route | Decided 2026-11-23: reuse the MaiK wallet, plus institution invoicing (admin-granted credits) |
| D-5 | PaperOrchestra adapter vs prompts-only fallback, after the 3.7 spike | 3.7 |
| D-6 | Offer BYOK at all | Phase 6 |
| D-7 | Human statistician for 4.5 sign-off | Phase 4 |

## 14. Definition of done (every package)

Built to its contract; works end to end in a test environment; auth and roles verified; provenance and audit saved; failure, retry, idempotency and offline cases tested; `npm test` and the headless UI test pass; its numeric gates pass; limits written down; human gates work; vault note updated; deploy status reported exactly. Behind `smd_research` until the owner turns it on.

## 15. Where it stands (2026-11-23)

- Branch `researchmd-v1`, worktree `~/Developer/wt-researchmd`, cut from `feat/stewardmd-research-foundation` (PR #2730).
- Done, uncommitted: regex fix, security-scan fix, `.gitignore` anchored, engine 1.1 (15/15 tests, BCG matches metafor; still inside `research.js`, moves to `research-engine.js` in Phase 0), Home tile + action, script tag, vault note.
- Not started: 1.0, 1.1b onward. Nothing deployed; D1/R2/Queue not provisioned. PaperOrchestra not vendored yet.
