# ResearchMD plan audit: Gemini Neon, High thinking (2026-11-23)

Plan audited: `RESEARCHMD_PLAN.md`. Score: **6.5/10**. Summary of Gemini's reply (read from the Gemini app, condensed).

## Strengths
Integrity rules and provenance; deterministic stats with a metafor oracle already passing; pragmatic Phase 1 scope behind `smd_research`; T0 to T3 routing and measure-before-pricing; clear builder boundaries.

## Gaps, most severe first

### Critical
1. **Phone overlay vs desktop-class work** (s1, 2, 4, 10). Screening 1,000+ abstracts, side-by-side PDF verification, dual-reviewer conflicts and editing a manuscript at 375 px; multi-page PDF viewing in an ES5 WebView is unplanned.
2. **Sequencing contradiction**: Phase 2.7 vendors PaperOrchestra (Python + LLM) but Python workers and the gateway only arrive in Phase 3.
3. **Security and compliance too late**: PDFs and LLM calls in Phase 3, patient-level data in 5.6, but privacy, retention, deletion and security review in 6.3 to 6.4. No PHI/PII detection gate before LLM calls. No IPD compliance posture (DPDP, GDPR, HIPAA, IRB, residency, encryption, breach logging).
4. **Python worker runtime undefined**: Cloudflare Python Workers (Pyodide) cannot run heavy PDF/OCR/scipy/PaperOrchestra; external host, limits, queue pull vs push, dead-letter queue, cancellation and callback auth (HMAC/JWT/mTLS) not specified.
5. **BYOK undefined**: key storage, envelope encryption/KMS, rotation, zero-logging, whether BYOK bypasses credit reservations.
6. **App Store / Play billing ignored**: selling per-paper credits in the app triggers Apple 3.1.1 and Google Play billing rules. Also `?v=` cache-bust does nothing for a bundled `www/` without a store release or OTA.

### High
7. No risk-of-bias capture module (RoB 2, ROBINS-I, QUADAS-2, NOS) with dual assessors and quote locators before 4.4 displays; no GRADE / Summary of Findings.
8. Stats gaps: generic inverse-variance (yi + SE/CI) and log-HR input needed early (adjusted estimates are the norm); RD must keep double-zero studies; DL-only default until Phase 4 needs REML + HKSJ sooner or a visible notice; no multi-arm, cluster/crossover or median/IQR conversion safeguards.
9. Dual-reviewer screening in 2.4 needs invitations and roles that arrive only in 6.5; blinded screening not specified.
10. Spend caps and token accounting arrive in Phase 6, after LLM calls start in 3.4.
11. Phase 5 is three phases of work for one person.
12. PaperOrchestra vendoring: stripping its LLM client, plotting, LaTeX and S2-only search means rewriting most of it; consider keeping only its prompt patterns and autorater rubric in a lean 500 to 800 line pipeline.
13. ES5 IIFE ceiling for Phases 3 to 5 (PDF viewer, workbench, editor): no module namespace, sanitisation (`innerHTML` XSS) or state convention.
14. Three stats engines (phone JS, API JS, Python) with no single source of truth for saved runs.

### Medium
15. PRISMA 2020 study-vs-report hierarchy, reports sought vs retrieved; protocol freeze with a timestamped hash and PROSPERO export before screening.
16. PDF prompt injection; per-tenant isolation of paywalled full text.
17. Number-consistency checking by parsing prose is fragile; use structured inline tokens like `{{run_id:pooled_or}}`.
18. US$0.50 to 2.00 per paper looks tight; reservation needs per-step ceilings and partial-failure rules; IAP fees missing from unit economics.
19. D1 size/contention for PDF text and snapshots (move blobs to R2); no frozen contracts (migrations, JSON schemas, error codes, locator schema) for parallel builders.
20. No numeric pass/fail gates in s11; 5 trials too few for extraction checks; metafor parity in CI only at 4.3; no offline/flaky-network tests; Gemini hand-working stats is weaker than an R script.
21. Search strings do not port between databases; store per-database query, API version, timestamp, count. Semantic Scholar terms and PubMed API key/rate limits.
22. Phase 0 open decision on `meta_analysis.py`; no D1 migration/rollback runbook, DLQ alerting, or flag-off behaviour for existing projects.

## Gemini's route to 10/10
1. Form factor: add a responsive larger-screen shell on the same auth and API before Phase 3, or a strict ES5 frontend architecture spec (namespaces, escaping helper, state store, PDF.js strategy).
2. Fix sequencing: PaperOrchestra out of 2.7; invitations, roles and blinded screening into 2.4; spend caps and token logging into Phase 3; threat model, PHI guardrails, retention and callback auth into Phase 3 with an IPD compliance gate; split Phase 5 into 5A manuscript engine, 5B checklists and submission, 5C other designs.
3. Clinical/stats: generic IV and log-HR in Phase 1; RD double-zero retention; REML + HKSJ earlier; RoB module; PRISMA 2020; protocol lock + PROSPERO export; R parity in CI from Phase 1.
4. Infrastructure: exact worker runtime, queue pattern, DLQ, retries, callback auth; one canonical stats path for saved runs; D1 for metadata, R2 for blobs; BYOK design or drop BYOK until Phase 6; PHI redaction; prompt-injection tests; IAP compliance.
5. Contracts and gates: a `contracts/` folder per phase (migrations, JSON schemas, locator schema, error codes); numeric release gates (100% numeric consistency, 100% resolved DOIs/PMIDs, at least 98% dedup F1, at least 95% locator accuracy on a 25-PDF stratified set); per-step cost ceilings.
