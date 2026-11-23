---
tags: [module, research]
---
# ResearchMD

Meta-analysis workspace inside the app. A doctor enters study data, cites the source page for every number, marks it verified, runs a fixed-effect or DerSimonian-Laird pool and sees a forest plot. Plan (v2, phases 0 to 7, owner decisions D-1 to D-7): `docs/research/RESEARCHMD_PLAN.md`; audit it answers: `docs/research/AUDIT_GEMINI_NEON_2026-11-23.md`; long-term vision and integrity rules: `docs/research/RESEARCHMD_MASTER_PLAN.md`.

## Flag + default
- `smd_research`: **DEFAULT OFF**. On per device with `localStorage.smd_research = "1"` or `?research=1`.
- While OFF: no Home tile, no All tools or search entry. `research.js` still loads.

## Key files
- `research.js` (`window.SMD_RESEARCH`): pure stats engine (exported to node via `module.exports`) plus the overlay `#researchMD`. ES5.
- Entry: `home.js` HOME_TOOLS row `research` + `ACT.research`; `researchOn()` reads the flag directly because `home.js` loads first.
- Server: `functions/api/research/[[path]].js` (Firebase auth via `verifyFirebaseClaims`, project membership on every resource), D1 `stewardmd-research` (`functions/db/research_schema.sql`). Not provisioned yet.
- Tests: `test/research-engine.test.mjs` (engine against metafor `dat.bcg` fixtures), `test/run-research-ui.mjs` (headless).
- Parked, not wired: `backend/research/` (Python) and `workers/research-orchestrator/` (Queue).

## Rules
- `research.js` engine is the ONE canonical stats engine: the phone runs it for previews, the API runs the same file for saved runs. Manifests carry its version.
- No AI call before Phase 3.0 ships the PHI gate, spend caps and token logging (`docs/research/RESEARCHMD_PLAN.md` s6, s11).
- Heavy screens (PDF verification, conflicts, manuscript) are tablet-first; every screen still works on a phone. Never a web version.
- A run refuses any study not marked verified.
- Study CIs are converted to SE at the study's own stated level, not the analysis level.
- Never invent study data; fixtures come only from cited published sources.

## Status
v1 in progress on branch `researchmd-v1` (2026-11-23). Nothing deployed; D1 not provisioned.
