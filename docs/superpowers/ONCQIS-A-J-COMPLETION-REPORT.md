# ONCQIS - Adaptive Clinical Intelligence for Oncology - A->J Completion Report

Branch: claude/onco-protocol-engine (worktree onco-protocol). Tag: oncqis-arch-A-J. NOT on main. Everything behind default-OFF flags, R1-gated, reversible.

## Status: all phases A->J built, tested, R1-reviewed, committed
| Phase | What shipped | Commit |
|---|---|---|
| A | Multi-tenant Standard Protocol + Hospital Implementation schemas; validate-protocols.mjs; 15 drafts re-mapped to new schema (VERIFY unsourced, layered evidence, no dose change); Wave-1 inventory | df06c343, 4840809c |
| B | Recommendation engine onco-recommend.js + GET onco/recommend (phenotype -> ranked applicable protocols + why-suggested; never auto-selects) | d0e79368 |
| C | Evidence layers (core/guideline/institutional) + UPDATE AVAILABLE overlay + EVIDENCE DIVERGENCE UI (never silently reconciles) | 44bdfaeb |
| D | Doctor Find -> Compare -> Select -> patient-specific Tata longitudinal matrix (explicit-select-only, full dose lineage) | 57d83749 |
| E-F | Structured edit + audit (original dose never destroyed) + Create -> Confirm & Activate with pre-activation gate | a286856f |
| G-H | Structured EMR write (gated, PDF fallback, no silent write) + nurse view + Tata PDF from the plan object (no recompute) | ac867661 |
| I | Protocol status lifecycle (ACTIVE immutable, new version never mutates) + 6 ONCQIS roles/caps + Wave-1 proposal | b78a9257 |
| J-a | Knowledge Center ingestion: admin dashboard + protocol/evidence libraries + guideline upload + AI extraction via /api/ai/extract (no PHI, source-located, VERIFY) + batch Update Impact Report | 9da7f088 |
| J-b | Knowledge Center review/approval: clinical diff + proposed-version-as-DRAFT + R1 -> institutional approval -> activate/supersede + existing-patient UPDATE AVAILABLE + review-due + immutable audit | f1db5826 |

## Verification
- Onco unit suite: 223/223 pass (node --test test/onco-*.test.mjs, exit 0). CDP UI suites per phase pass.
- validate-content: 4959 files, 0 errors. validate-protocols: 15 files, 0 errors.
- Every phase code-reviewed + R1 clinical review; J-a/J-b also R2 AI-safety + G-H S2 PHI review - all APPROVE/GO, no Critical findings.
- Pre-existing unrelated red: test/sknx-flags.test.mjs (another module; confirmed red without this work).

## Safety invariants enforced (in code + tests)
- StewardMD suggests; physician decides. Never auto-select, auto-reconcile, auto-modify a dose, auto-activate, or silently write EMR.
- 4 objects separate: Standard Protocol / Treatment Plan / Cycle / Administration.
- Dose lineage always visible; original calculated dose never destroyed; overrides audited (original->modified->reason->physician->timestamp).
- VERIFY (never invent) for unsourced fields; unresolved VERIFY blocks ACTIVE.
- Versioning: ACTIVE immutable; new version = new DRAFT; existing Treatment Plans locked to their snapshot; UPDATE AVAILABLE, physician decides.
- Knowledge Center golden rule: AI may extract/compare/propose only; writes ONLY DRAFT proposed versions + change records (source-located); two human gates (R1 CLINICAL + INSTITUTIONAL) to activate; NO PHI to the AI.
- Multi-tenant / platform-agnostic: StewardMD Clinical Protocol -> Hospital Implementation (keyed by hospitalId) -> Treatment Plan. No hospital hard-coded; GIMSR is only one configured tenant. Source-agnostic (DeVita/Harrison/NCCN/ASCO/ESMO/institutional; not dependent on NCCN order templates).

## Flags (all default OFF - nothing active until you flip them)
smd_onco_protocols, smd_onco_home, smd_onco_staging, smd_onco_tallman, smd_onco_drugview, smd_onco_protoref, smd_onco_ctcae, smd_onco_iotox, smd_onco_recist, smd_onco_favorites, smd_onco_recommend, smd_onco_evidence_overlay, smd_onco_kb_admin. Caps: ONCQIS_PROTOCOL_AUTHOR / ONCQIS_CLINICAL_REVIEWER / ONCQIS_INSTITUTIONAL_APPROVER.

## Owner-gated (yours to decide - deliberately NOT done)
1. Wave-1 promotion: promote the proposed set (docs/superpowers/onco-wave1-proposal.md; top: modified-folfox-6, folfiri, folfirinox...) from staged DRAFT to ACTIVE - needs your + R1 + hospital sign-off; resolve each protocol's remaining VERIFY fields first.
2. Enable EMR-write (smd_onco flags + QUEUE_ONCO_WRITE) + Knowledge Center (smd_onco_kb_admin) - after your security sign-off.
3. Provide NCCN per-disease templates / ASCO / ESMO / institutional protocols to move protocols from textbook-grounded+VERIFY to guideline/hospital-grounded (you download; no scraping).
4. Merge to main (branch is 134 ahead; diverged since the Phase 8 merge - will need a fresh integration/PR when you say go).

## Not yet built (out of A-J scope, if you want later)
- The 15 re-mapped protocols are staged (docs/superpowers/onco-protocols-v2/), not in kb/protocols (that is Wave-1 promotion).
- Native app rebuild to pick up the client modules.
