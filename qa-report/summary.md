# StewardMD - Production Validation: Executive Summary

_2026-08-05. Autonomous production-grade validation (all 13 phases), adapted to the real stack
(buildless Capacitor PWA + Cloudflare Functions/Worker - **not** Flutter/Dart). Method: 6 specialized
domain auditors run in parallel (security x2, clinical, performance, UX, appsec) + hands-on static/test/
device passes. Full detail in the sibling reports._

## Headline

**The app is engineered with real care and is largely production-solid - but the drug-interaction engine
has patient-safety gaps that must be closed before wider release.** No secrets leaked, no live API hole,
auth/tenant-isolation is strong, 99.6% of tests pass. The critical risks are clinical (missed tier-1 drug
interactions + false alerts), one OOM vector (KardioX), and accessibility.

## Metrics

| | |
|---|---|
| Scale | 9,654 files, 177 JS modules (~109K LOC), 192 function files, 27 native plugins |
| Syntax (Phase 2) | **0 failures** / 177 modules + all functions |
| Unit tests (Phase 3) | **1,630 tests, 1,624 pass (99.6%)**; 6 fail -> triaged (1 fixed, 2 = 1 documented quota bug, 3 = env-dependent) |
| UI harnesses (Phase 4) | 97 CDP headless-browser tests present; SknX flow verified green |
| Secrets (Phase 8) | **CLEAN** across source + 2,668 commits - nothing to rotate |
| Fixed this pass | 1 (calculators.js emoji; no-UI-emoji now green) |

## Top risks (priority order)

1. **[CRITICAL - Clinical] Drug-interaction engine misses tier-1 interactions + fires false alerts.**
   Engine-reproduced: warfarin+antibiotics (cipro/metronidazole/co-trimoxazole) not flagged; colchicine has
   zero coverage (colchicine+clarithromycin = fatal, not flagged); paracetamol/naloxone mis-tagged ->
   false "coma and death" alerts on safe combos, eroding the real opioid+benzo alert (alert fatigue). Plus
   ~10 more well-known misses (DOAC+azole, K-sparing+K, lithium+thiazide...). **-> `clinical_safety.md`.
   NOT auto-fixed (per your rule). This is the #1 item.**
2. **[CRITICAL - Performance] KardioX loads 7 ONNX models (~157 MB) concurrently per ECG analysis** -> OOM
   risk on mid-range devices. A safe sequential pattern already exists elsewhere in the codebase. `performance.md`.
3. **[CRITICAL - Accessibility] No real text-scaling** (pinch-zoom disabled + 125% cap) and **ICU vitals /
   GHIS labs encode severity by color only** (VoiceOver hears nothing); **Code Blue is 4+ taps deep.** `recommendations.md`.
4. **[HIGH - Security] Native SknX/ThoreX POST patient images directly to raw Cloud Run**, bypassing the
   authenticated edge that already exists. Blocks production enablement of those cloud engines (flag-OFF today). `security.md`.
5. **[HIGH - Performance] Cold-start bloat:** 26 MB KB + 67 feature scripts (~4.3 MB) parsed on every launch
   regardless of use - the lazy-load pattern is already proven in-codebase for the KB. `performance.md`.

## What's solid (verified good)
Server auth (RS256, server-derived uid, no client-id trust), Firestore rules (deny-by-default, per-user
isolation), portal/share tokens (HMAC, expiring, revocable), Connect FHIR (envelope-encrypted, SSRF-gated,
HMAC ingest), AI proxies (auth + no-body-logging + TEXT-only), EXIF-strip before egress, the Firestore
native-storm fix, and the **calculators/dosing math (no defects found)**. Logout fix in place.

## Gate recommendation
**NOT ship-ready as-is** for clinician-facing release: close the clinical CRITICALs (CR1-CR3) + add a DDI
regression matrix; fix KardioX OOM (CR4); address the accessibility CRITICALs (CR5-CR7). H1 (native image
egress) blocks turning the cloud vision engines on. Everything else is Medium/Low hardening. Chain the
clinical fixes through R1 (clinical) + the AI reviewer; run the release gate (R7) before build.

## Phase coverage note (honest)
Phases 1-3, 6-8, 10-13 were run to completion (see reports). **Phase 5 (device integration) + Phase 9
(crash)** were exercised deeply on the connected Pixel 9 for the SknX pipeline (this session: cold-start,
DNS-retry, OOD, consent, malformed input) and the auditors identified the crash/OOM vectors statically; a
full every-screen device sweep of 177 modules is beyond a single automated pass and is the recommended next
manual/CI step. Phase 4: the 97 existing CDP harnesses are the widget-test layer; running the full harness
suite in CI (headless Chrome) is recommended.

## Reports in this folder
`architecture.md` (Phase 1) - `coverage.md` (2,3) - `security.md` (8,9) - `clinical_safety.md` (6,13) -
`performance.md` (7) - `recommendations.md` (10,11) - `bugs.md` (consolidated) - `summary.md` (this).
