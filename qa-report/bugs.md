# Bugs - consolidated, severity-ranked

Cross-cutting list from all six domain audits + the test run. Detail + file:line are in the per-domain
reports (`clinical_safety.md`, `security.md`, `performance.md`, `recommendations.md`, `coverage.md`).
Per your rules: clinical logic was NOT auto-modified; one safe fix was applied (see bottom).

## CRITICAL (patient-safety / OOM - fix before wider release)

| # | Area | Issue | Where |
|---|---|---|---|
| CR1 | Clinical | Warfarin + cipro/metronidazole/co-trimoxazole/amiodarone **not flagged** (+ hyphen data bug: `cotrimoxazole` fires, `co-trimoxazole` misses) | `interaction-rules.js:21422,721,726,3863` |
| CR2 | Clinical | Colchicine has **zero** interaction coverage -> colchicine + clarithromycin (fatal) not flagged | `interaction-rules.js:16038` |
| CR3 | Clinical | Paracetamol + naloxone mis-tagged opioid/CNS-depressant -> **false "coma and death" alerts** on safe combos -> alert fatigue on the opioid+benzo alert | `interaction-rules.js:16684,7729,20662,20886` |
| CR4 | Performance | KardioX loads **7 ONNX models (~157 MB) concurrently, per analysis**, no reuse -> ~300-450 MB peak, OOM risk | `kardiox-ort.js:145-159`, `kardiox-providers.js:272-306` |
| CR5 | UX/A11y | **No accessibility text scaling** (pinch-zoom disabled + 125% cap, no Dynamic Type) - WCAG 1.4.4 fail across every clinical value | `index.html:18`, `home.js:4451` |
| CR6 | UX/A11y | **ICU vitals severity is color-only** - VoiceOver announces critical + normal values identically | `icu.js:1378-1406` |
| CR7 | UX/A11y | **Code Blue buried 4+ taps deep**, no global entry - unsafe friction during an arrest | `icu.js:3193-3196` |

## HIGH

| # | Area | Issue | Where |
|---|---|---|---|
| H1 | Security | Native SknX/ThoreX POST patient images **directly to raw Cloud Run**, bypassing the (existing) auth edge | `sknx-cloudvision.js:18`, `thorex-net.js:26` |
| H2-H8 | Clinical | Missed tier-1 DDIs: azathioprine+febuxostat, digoxin+clarithromycin, K-sparing+K, lithium+thiazide, anticoag+antiplatelet, DOAC+CYP3A4/P-gp; SknX melanoma can be rxEligible | see `clinical_safety.md` H1-H7 |
| H9 | Performance | 26 MB KB enrichment parsed on **every** cold start (comment says 4.8 MB) | `kb.enrichment*.js`, `index.html:1487` |
| H10 | Performance | 67 feature scripts (~4.3 MB) load on every boot regardless of use | `index.html` script list |
| H11 | Performance | GHIS search: no debounce + full re-render per keystroke; import fans out 25 concurrent proxy calls | `ghis-ward.js:942-959,516-650` |
| H12 | UX/A11y | GHIS abnormal labs color-only + red fails AA (3.76:1); header buttons 34x36 (<44pt); FollowCare empty/error states not announced | `ghis-ward.js`, `redesign-system.css:545`, `followcare.js` |
| H13 | Quota | AI daily research cap not enforced in test (`gateAndCount`) - possible cost/abuse; **billing-sensitive, not auto-fixed** | `functions/_ai_usage.js`, `functions/_research.test.mjs` |

## MEDIUM
Security: upload byte-cap spoofable (M1), empty-Origin app-gate (M2), admin trusts email w/o `email_verified`
(M6), no CSP on shared-case HTML (M7), client-side PHI redaction on public docs (M8), config files served at
web root (M9). Clinical: amiodarone+simvastatin, NTI CYP victims, misclassifications (clozapine/lisinopril),
AI ungrounded-dose surface, additive-toxicity pairs. Performance: Firestore listeners no `.limit()`,
interaction-rules eager parse, files approaching 25 MiB. UX: sub-AA muted text, ellipsis truncation, placeholder labels.

## LOW
pdf.js no SRI, ghis-proxy logs patient IDs (local tool), static unlock cookie, icu.js 60s heartbeat,
GoogleService-Info.plist committed (public-safe), owner emails in wrangler.toml [vars].

## ENVIRONMENT-DEPENDENT test failures (not code defects)
`firestore-rules/rules.test.mjs` (needs Firebase emulator), `maik-routing.test.mjs`, `maik-native-stream.test.mjs`
(need a live/staged backend).

## FIXED in this pass
- **CR1, CR2, CR3 (clinical CRITICALs) - FIXED, test-driven** (commit 34fc5153,
  `test/interaction-critical-fixes.test.mjs` 10/10, golden regression unchanged): warfarin+CYP2C9
  antibiotics/amiodarone + fluoroquinolones now flagged (new `cyp2c9_inhibitor` class + 2 rules + hyphen
  data-bug reconciled); colchicine x strong CYP3A4/P-gp inhibitor now CONTRAINDICATED; paracetamol/naloxone
  de-classified so the false "coma and death" alerts are gone while the genuine opioid+benzo alert is
  preserved. **R1 re-review in flight.** (H1-H8, quota H13, and all Medium/Low remain open.)
- **`calculators.js:5463`** - removed the `⚠️` emoji from a warning div (no-UI-emoji convention). `no-ui-emoji`
  test now green.
- Net: test failures 6 -> 5 (remaining 5 = documented quota bug + 3 environment-dependent).
