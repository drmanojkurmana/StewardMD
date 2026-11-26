---
tags: [module, research]
---
# ResearchMD

Meta-analysis and systematic-review workspace inside the app. A doctor enters study data, cites the source page for every number, marks it verified, runs a fixed-effect or DerSimonian-Laird pool and sees a forest plot; Phase 2 adds the full review workflow (protocol lock, searches, import, dedup, blinded dual screening, conflicts, PRISMA 2020). Plan (v2.1, phases 0 to 7, owner decisions D-1 to D-7): `docs/research/RESEARCHMD_PLAN.md`; long-term vision and integrity rules: `docs/research/RESEARCHMD_MASTER_PLAN.md`.

## Flag + default
- `smd_research`: **DEFAULT ON** (owner 2026-11-24). Off per device with `localStorage.smd_research = "0"` or `?research=0`.
- While OFF: no Home tile, no All tools or search entry. `research.js` still loads.
- **Apply migration 0002 before turning the flag on** (see Resources); the Phase 2 API routes fail without its tables and the PRISMA view.

## Key files
- `research-engine.js` (`SMD_RESEARCH_ENGINE`, dual browser/CommonJS export): the ONE canonical stats engine, pure, no DOM. Phase 1 measures + Phase 4.1/4.2 depth. ES5.
- `research.js` (`window.SMD_RESEARCH`): overlay shell `#researchMD`, navigation, API client (`SMD.api.request`/`upload`), tabs Studies/Protocol/Search/Screening/Conflicts/PRISMA/Run/GRADE. ES5.
- `research-store.js`: per-project state; `research-screen-*.js`: one file per screen (projects, studies, run, protocol, search, screening, conflicts, prisma, grade).
- `research-grade.js` (`SMD_RESEARCH_GRADE`) + `research-screen-grade.js`: Phase 4.3 GRADE module M + Summary of Findings. Assessments persist device-local (`localStorage smd_research_grade_v1`) until the Phase 4.3 API contract lands; suggestions apply only on human Accept.
- Entry: `home.js` HOME_TOOLS row `research` + `ACT.research`; `researchOn()` reads the flag directly because `home.js` loads first.
- Server: `functions/api/research/[[path]].js` (Firebase auth via `verifyFirebaseClaims`, project membership + role on every resource), `_connectors/` (pubmed, europepmc, crossref, semanticscholar stub, import parsers), `_dedup.js`, `_engine.js` (imports the canonical engine for saved runs).
- Contracts: `docs/research/contracts/phase-1/`, `phase-2/` (0002 migration + rollback, blinding, connector-api, prisma2020, errors, schemas). Integration additions 2026-11-23: `phase-2/contract-additions.md` (GET protocol version list, POST import-uploads multipart -> R2 -> `{storageKey}`, 5 MiB limit).
- Tests: `test/research-engine.test.mjs`, `test/research-engine-phase4.test.mjs`, `test/research-grade.test.mjs`, `test/research-api.test.mjs`, `test/research-phase2-api.test.mjs`, `test/research-phase2-e2e.test.mjs` (full screen sequence in-process, PRISMA equals independently derived counts, outsider isolation), `test/research-connectors.test.mjs`, `test/research-dedup.test.mjs`, `test/research-import.test.mjs`, headless `test/run-research-ui.mjs` + `test/run-research-phase2-ui.mjs` (API mocked), R parity `scripts/research-parity.R` in CI.
- Worker: `workers/research-worker/` (Cloudflare Containers, cron -> DO -> container `/drain`) runs `backend/research/` (pdf_extract, stats_model, manuscript_draft). Deployed (active since 2026-11-24; redeployed 2026-11-27 with `RESEARCH_GATEWAY_URL`/`RESEARCH_API_URL` forwarded). Needs worker secrets DRAIN_TOKEN, CF_QUEUES_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, RESEARCH_CALLBACK_SECRET (must equal the Pages one), RESEARCH_IPD_KEK.

## Resources (provisioned 2026-11-23, owner decision D-2; bindings in `wrangler.toml`)
- D1 `stewardmd-research` -> `RESEARCH_DB`. Metadata, decisions, roles, audit pointers only.
- R2 `stewardmd-research` (private) -> `RESEARCH_R2`. PDFs, search ID archives, import uploads (`projects/{id}/imports/{sha256}.{ext}`).
- Queues `research-jobs` + `research-jobs-dlq` -> `RESEARCH_QUEUE` producer; HTTP pull consumer (visibility 900 s, 3 retries, then DLQ), polled by the external Python worker container (plan 5.3, D-3 Cloudflare Containers).
- **Migrations forward-only, applied in order before the flag is turned on**: Phase 1 base (`functions/db/research_schema.sql` mirrors the applied schema for tests), then `docs/research/contracts/phase-2/0002_research_v2.sql` (rollback: `0002_rollback.sql`). 0002 adds protocols, invitations, search runs, records, reports, dedup, decisions, conflicts, exclusion reasons and the `research_prisma_counts` view.

## Rules
- `research-engine.js` is the ONE canonical stats engine: the phone runs it for previews, the API runs the same file for saved runs. Manifests carry its version.
- No AI call before Phase 3.0 ships the PHI gate, spend caps and token logging (`docs/research/RESEARCHMD_PLAN.md` s6, s11).
- Heavy screens (PDF verification, conflicts, manuscript, GRADE form) are tablet-first; every screen still works on a phone. Never a web version.
- A run refuses any study not marked verified.
- Study CIs are converted to SE at the study's own stated level, not the analysis level.
- Never invent study data; fixtures come only from cited published sources.
- Protocol lock is one-way (SHA-256 hash + timestamp); screening votes are blinded until both reviewers decide; PRISMA counts derive from stored rows only.

## Status (2026-11-23, branch `researchmd-v1`)
- Phase 1: engine, screens, API, contracts done; R parity job in CI.
- Phase 2 (2.1 to 2.6): API + screens built and **integrated**. Every screen call has a matching route; the two unfrozen calls (protocol version list, import-uploads) added as documented contract additions. `test/research-phase2-e2e.test.mjs` drives the whole sequence in-process and asserts PRISMA equals counts derived independently from stored decisions (plan s12 gate, 100%); outsider gets 404 on every route. Headless UI harnesses pass at 375/768/1024 px.
- Phase 4.1 (subgroup, sensitivity, leave-one-out, Egger/funnel at 10+ studies) and 4.2 (split shared control, cluster/crossover adjustment, median/IQR conversion): in `research-engine.js`, covered by `test/research-engine-phase4.test.mjs`. Not yet surfaced in a dedicated screen beyond Run.
- Phase 4.3 GRADE: engine + screen wired into the shell (GRADE tab, `?v=rmd2` tags). Device-local persistence until the API contract lands; SoF table read-only on phone.
- (2026-11-23 note superseded) As of 2026-11-27: D1 has migrations through 0007; server switches `RESEARCH_TRIALS_ENABLED` and `RESEARCH_PO_ENABLED` are "1" in `wrangler.toml` production; app flags `smd_research_trials`, `smd_research_retraction`, `smd_research_openalex`, `smd_rmd_po` default ON ("0" turns one off on a device).