# Review Checklists (consolidated, actionable)
_The daily-use checklists for the 7 reviewers. Full rationale in `MASTER_REVIEW_FRAMEWORK.md`; agents in `.claude/agents/`. Report confidence ≥ 80, grouped Critical / Important / Advisory._

## R1 · Clinical Safety & Evidence — MANDATORY/blocking on clinical changes
- [ ] **Golden/regression suite run; outputs unchanged (or change intended + documented).**
- [ ] No false negatives: interactions fire **both directions**; dose/renal/hepatic/QT gates fire on out-of-range; malformed input errors, never silent-passes.
- [ ] Calculators/scores match the published spec exactly (edition/source cited).
- [ ] Emergency (Code Blue) logic correct; critical alerts non-dismissable; override reason logged.
- [ ] Drug matching normalizes strength/ingredient (product vs clinical layer) before grouping/matching.
- [ ] Evidence current: no deprecated guideline; references cite current edition; hierarchy (ICMR ▸ guideline ▸ hospital-overlay) respected.
- [ ] Audit trail on clinical CRUD; units canonical + displayed correctly.

## R2 · AI Safety — MANDATORY on AI changes
- [ ] Untrusted inputs (image/OCR/ASR/PDF/user text/web) delimited; cannot override the system prompt or trigger tools/actions.
- [ ] Minimal/zero PHI to model providers; identifiers stripped; DPDP consent + residency honored.
- [ ] No cross-patient/tenant context bleed; RAG/context scoped to current user.
- [ ] Input validation: image type/size caps, audio-length caps, reject malformed/adversarial.
- [ ] Guardrails intact: calibration + defer/`reviewRecommended`; no confident output on OOD/garbage; life-threatening findings not demoted.
- [ ] No PHI/full-prompt/full-response/raw-image/audio in logs; `loggingBehavior` none in prod; model pinned + fallback exists.

## R3 · Security & Privacy — MANDATORY on data/auth/net (see SECURITY_FRAMEWORK.md §1–10)
- [ ] No secret/token/credential in diff/bundle/config (regex-scan; redact when quoting).
- [ ] Keychain (not UserDefaults/localStorage) for tokens; Secure Enclave for biometric-gated keys.
- [ ] HTTPS/TLS≥1.2 everywhere; no disabled cert validation; cert-pinning on PHI/clinical + model endpoints (advisory→high).
- [ ] No PHI in logs, URLs, local storage, analytics/crash payloads, or provider requests.
- [ ] Auth: token lifecycle + rotation; secure logout clears Keychain/PHI/session/watch state; gate + experimental-access enforced server-side; Firestore per-user/facility isolation.
- [ ] Medical-data lifecycle: temp images/audio/PDFs encrypted + deterministically deleted; `isExcludedFromBackup` for PHI temp files.
- [ ] Background-snapshot/screen-capture/clipboard PHI protections; dependencies not vulnerable/duplicated.

## R4 · Platform & Reliability
- [ ] No force-unwrap/`try!`/`as!` in production paths; `precondition`/`throw` used correctly (not `assert` for release-critical).
- [ ] Concurrency: no data races on shared clinical state; `@MainActor` for UI; structured tasks + cancellation; no main-actor blocking.
- [ ] Memory: no retain cycles (`[weak self]`); delegates `weak`.
- [ ] SwiftUI: correct property wrappers; no heavy work in `body`; previews compile.
- [ ] Reliability: offline mode + retry/backoff; background execution within budget; **watch sync integrity + clears on logout**; local DB integrity (no orphan/cascade loss).
- [ ] Widgets/Live Activities/Dynamic Island within reload budget; no PHI on locked surfaces beyond policy.
- [ ] `xcodebuild build`/`swiftlint`/`swift test` green (if scheme present).

## R5 · Clinical UX & Accessibility
- [ ] Every interactive control has an accessible label/role; clinical values screen-reader-exposed.
- [ ] Critical alerts not color-only; live regions announce dynamic alerts.
- [ ] Contrast ≥ 4.5:1 (≥3:1 large); tap targets ≥ 44×44pt; visible focus + sane focus order.
- [ ] Dynamic Type: no clipping/truncation of clinical values at largest sizes; no hard-coded font points.
- [ ] Emergency usability: key actions reachable one-handed; works in low-light/night-shift; error recovery/undo present.
- [ ] HIG conformance; haptics on key confirmations.

## R6 · Performance
- [ ] **No single bundled asset near/over 25 MiB** (Pages/Worker limit — deploy-breaker).
- [ ] No loading multiple heavy models per request (OOM on constrained devices — load one at a time / isolate).
- [ ] No main-thread jank; large lists virtualized; images right-sized.
- [ ] Cloud Run cold-start acceptable; Firestore queries indexed/paginated (no N+1 / listener storms).
- [ ] Watch polling/transfers battery-aware; offline path efficient. Micro-opts only when measured.

## R7 · Release — FINAL GATE (needs R1 + R3 clear)
- [ ] Golden/regression run + green; unit/integration/UI/snapshot/perf tests present + green for the change.
- [ ] Production config; debug flags OFF; `loggingBehavior` none; logging + crash reporting + analytics PHI-scrubbed.
- [ ] Secrets removed from bundle; only runtime-injected.
- [ ] `PrivacyInfo.xcprivacy` valid + matches App Store privacy form + actual behavior; HealthKit + permission usage strings minimal/accurate.
- [ ] ATS/entitlements/associated-domains correct; APNs env matches build.
- [ ] Native rebuild covers JS-only changes (WKWebView cache); no 25 MiB asset; `CACHE_VERSION` bumped if needed; access gate correct for audience.
- [ ] DPDP consent gate + deletion path intact; recovery tag/branch + one-command rollback known; release notes accurate.
- [ ] **Verdict: GO / GO-WITH-FIXES / NO-GO.**
