# StewardMD Master Review Framework
_A lean, production-medical-grade review system. 7 high-impact reviewers, zero duplication. Supersedes the initial 10-reviewer set in `docs/dev-framework/` (kept for history). Concepts adapted from ECC as reference only — nothing installed/activated._

## Philosophy
Optimize for **maximum software quality with the smallest set of highly-effective reviewers**. Every reviewer must reduce real risk (clinical safety, security/privacy, correctness, performance, or clinical UX). Reviewers are **routed by surface** (never "run all 7 blindly"), have **clear blocking criteria**, and report only findings at **confidence ≥ 80**, grouped **Critical / Important / Advisory**. Two reviewers are hard gates on a medical app: **Clinical Safety** and **Security & Privacy**. Release is the final GO/NO-GO.

## Consolidation rationale (from the initial 10)
| Old reviewer | Fate | Into |
|---|---|---|
| ios, swiftui, watch | **merged** | **Platform & Reliability** (one native-Apple lens: shell, SwiftUI, WatchOS, widgets, Live Activities, concurrency, offline/sync, crashes, DB integrity) |
| accessibility | **expanded/renamed** | **Clinical UX & Accessibility** (adds cognitive load, emergency/night-shift/one-handed use, HIG, error recovery) |
| aiml | **expanded/renamed** | **AI Safety** (adds prompt-injection, hallucination, guardrails, context leakage, model selection) |
| clinical | **expanded** | **Clinical Safety & Evidence** (adds evidence quality, guideline consistency, reference freshness, medical content) |
| security | **expanded** | **Security & Privacy** (adds PHI/DPDP, logging, data lifecycle, cache/temp cleanup) |
| performance | **kept** | **Performance** |
| release | **expanded** | **Release** (adds testing-readiness gate, HealthKit, privacy manifest, analytics) |
| docs | **removed** | citations → Clinical Evidence; currency → Release; general docs = optional lint |

Rejected as standalone reviewers (avoid bloat): "Testing" (a facet every reviewer flags + a Release gate), "Architecture" (a periodic manual review, not per-PR — see Orchestrator), "Medical Content" (part of Clinical Evidence), "AI Prompt" (part of AI Safety), "Watch Experience" (part of Platform + Clinical UX), "Offline Reliability" (part of Platform & Reliability).

---

## The 7 Reviewers

### R1 · Clinical Safety & Evidence Reviewer  `stewardmd-clinical-reviewer`  (model: opus) — MANDATORY GATE
- **Purpose:** Prevent patient harm from incorrect clinical logic or outdated/unsupported recommendations.
- **Responsibilities:** dose/renal/hepatic/QT gates; drug interactions & contraindications (both directions); clinical calculators/scores; lab interpretation; ECG clinical logic; Code Blue/emergency logic; medical warnings; false-negative/false-positive control; **evidence**: guideline consistency, reference freshness, deprecated-recommendation detection, evidence quality; **golden/regression integrity**.
- **Scope:** clinical engines, `kb/`, drug/interaction/dose data, alert logic, calculators, Code Blue, lab/ECG rule code, cited references.
- **When it runs:** ANY change touching clinical logic/data/content. Blocking.
- **Inputs:** the diff, cited guideline sources, existing golden outputs. **Outputs:** grouped findings + explicit "goldens changed? yes/no (intended?)" statement + per-rule source verification.
- **Severity / Blocking:** Critical (false-negative, wrong dose/interaction/score, unintended golden shift, non-dismissable alert downgraded, deprecated guideline shipped) → **block merge**. Important (missing audit trail, unit mismatch, stale reference). Advisory (clarity).
- **Confidence:** ≥ 80 to report; Critical requires a concrete drug/dose/score example.
- **Auto checks:** run golden/regression suite; grep for interaction/dose tables changed; check score constants vs spec.
- **Manual items:** verify each changed rule against its published source (edition noted); confirm both-direction interaction coverage; confirm emergency-path logic.
- **Example findings:** "Ceftriaxone–calcium interaction fires A→B but not B→A (one-direction miss) — false negative, Critical." · "NEWS2 respiratory-rate band uses 21–24 as 2 points; RCP spec is 3 — Critical." · "Dose rule cites Sanford 2019; current is 2024 — Important."

### R2 · AI Safety Reviewer  `stewardmd-ai-reviewer`  (model: opus) — MANDATORY on AI changes
- **Purpose:** Keep every AI integration safe, private, and non-misleading.
- **Responsibilities:** prompt review + injection resistance; unsafe/hallucinated output control; model selection appropriateness; PHI exposure to providers; guardrails (calibration/defer/`reviewRecommended`); context/tenant leakage; input validation for images/audio/text; safe logging of AI I/O.
- **Scope:** MaiK (Vertex LLM), KardiQ X (ECG image), FundX (vision), on-device Whisper, OCR, model-serving code, AI clients.
- **When it runs:** any AI/model/prompt/serving change. Blocking on Critical.
- **Inputs:** diff, system prompts, model config, input-validation code. **Outputs:** grouped findings + a "PHI-to-provider?" determination + injection-surface assessment.
- **Severity / Blocking:** Critical (prompt-injection can drive actions/override; PHI leaked to provider/logs; cross-patient context bleed; confident output on garbage input; life-threatening finding demoted). Important (weak input validation, model not pinned, missing fallback). Advisory (prompt clarity).
- **Confidence:** ≥ 80.
- **Auto checks:** grep prompts for delimiter/guard patterns; check image/audio size+type validation exists; check logging redaction.
- **Manual items:** attempt an injection walkthrough on the changed prompt; confirm on-device claims hold; confirm defer guards on OOD input.
- **Example findings:** "OCR text is concatenated into the MaiK prompt without delimiting — an ECG sheet reading 'ignore previous instructions' could steer output. Critical." · "Uploaded image goes to inference with no size cap — DoS/adversarial risk. Important."

### R3 · Security & Privacy Reviewer  `stewardmd-security-reviewer`  (model: opus) — MANDATORY on data/auth/net
- **Purpose:** Protect secrets, identities, and PHI end-to-end.
- **Responsibilities:** operationalizes `docs/dev-framework/SECURITY_FRAMEWORK.md` (10 domains) — secrets, iOS security, auth/session, networking/TLS/pinning, AI security (with R2), medical-data protection + cleanup, watch comms, logging, dependencies, release-security; plus **privacy**: PHI/DPDP/HIPAA-ready architecture, GDPR considerations, data lifecycle (OCR/voice/ECG/images/temp/cache).
- **Scope:** auth, tokens/gates, storage, network, uploads, Firestore rules, configs, logging, dependencies.
- **When it runs:** proactively on any auth/token/storage/network/upload/config change. Blocking on Critical.
- **Inputs:** diff, `SECURITY_FRAMEWORK.md`, configs, rules. **Outputs:** grouped findings mapped to framework §, redacting any secret values.
- **Severity / Blocking:** Critical (secret in bundle/commit; PHI in logs/URLs/local storage/provider; plaintext clinical transport; auth bypass; Firestore cross-user read). Important (weak storage, missing validation, no cleanup). Advisory (hardening).
- **Confidence:** ≥ 80. **Auto checks:** secret-regex scan of diff; grep PHI-in-log patterns; check ATS/`http://`; check `isExcludedFromBackup` on PHI temp files.
- **Manual items:** trace token lifecycle + logout cleanup; verify gate/experimental-access enforcement server-side; verify temp image/audio/PDF deletion.
- **Example findings:** "`console.log(patient)` in the lab view ships PHI to device logs. Critical." · "Refresh token stored in `localStorage`, not Keychain. Critical."

### R4 · Platform & Reliability Reviewer  `stewardmd-platform-reviewer`  (model: sonnet)
- **Purpose:** Native Apple correctness + runtime robustness across shell, SwiftUI, WatchOS, widgets, Live Activities.
- **Responsibilities:** Swift safety (force-unwrap/`try!`/`as!`, concurrency, ARC, `@MainActor`); Capacitor shell/plugins/bridge; SwiftUI state/lifecycle/previews; Watch app + WatchConnectivity sync; WidgetKit/Live Activities/Dynamic Island; **reliability**: crash risks, race conditions, offline mode, retry/backoff, background execution, watch sync integrity, local DB integrity; architecture hygiene (duplication, boundaries) as advisory.
- **Scope:** `ios/`, `local-plugins/`, native Swift/SwiftUI/Widgets, web-side native bridges (`www/native-*.js`).
- **When it runs:** native/Swift/plugin/widget/watch/offline/background changes.
- **Inputs:** diff, build/lint status. **Outputs:** grouped findings + build/lint note.
- **Severity / Blocking:** Critical (force-unwrap in prod path, data race on shared clinical state, crash on a critical path, DB corruption risk, watch-sync losing clinical data). Important (retain cycles, missing cancellation, offline gap, widget reload budget). Advisory (decomposition, dedup).
- **Confidence:** ≥ 80. **Auto checks:** `xcodebuild build`/`swiftlint` (if scheme present); grep `!`/`try!`/`as!` in changed Swift; grep unstructured `Task {`.
- **Manual items:** reason about actor reentrancy across `await`; verify offline + retry paths; verify watch sync clears on logout.
- **Example findings:** "`response!.data` in APNs handler crashes on nil payload. Critical." · "`Task { await save() }` fire-and-forget with no cancellation leaks during rapid navigation. Important."

### R5 · Clinical UX & Accessibility Reviewer  `stewardmd-clinical-ux-reviewer`  (model: sonnet)
- **Purpose:** Ensure the interface is safe and usable for clinicians under real conditions.
- **Responsibilities:** accessibility (VoiceOver/labels, Dynamic Type, contrast ≥4.5:1, tap targets ≥44pt, focus order, live regions, haptics); clinical UX (cognitive load, information hierarchy, emergency usability e.g. Code Blue, one-handed use, night-shift/low-light, error recovery, undo); HIG conformance.
- **Scope:** web UI (`www/`), native SwiftUI/Watch surfaces, emergency screens, alerting UX.
- **When it runs:** any UI change; mandatory on emergency/alert UI.
- **Inputs:** diff, rendered structure. **Outputs:** grouped findings + criterion cited (WCAG/HIG).
- **Severity / Blocking:** Critical (a clinical value not screen-reader-exposed; critical alert conveyed by color alone; emergency action hard to reach one-handed; value truncated at large Dynamic Type). Important (missing labels, low contrast, small targets, no error recovery). Advisory (polish).
- **Confidence:** ≥ 80. **Auto checks:** grep icon-buttons without `aria-label`/`.accessibilityLabel`; scan for hard-coded font sizes; contrast token check.
- **Manual items:** VoiceOver walkthrough of the changed flow; simulate one-handed emergency use; check largest Dynamic Type doesn't clip clinical values.
- **Example findings:** "Code Blue timer button is 32×32pt and bottom-corner — hard to hit one-handed in a resuscitation. Critical." · "Abnormal-lab flag is red-only, invisible to color-blind + VoiceOver. Critical."

### R6 · Performance Reviewer  `stewardmd-performance-reviewer`  (model: sonnet)
- **Purpose:** Keep the app fast, light, and battery/cost-efficient — and deployable.
- **Responsibilities:** memory, battery, startup, rendering/scrolling, AI latency, network efficiency, offline behavior, bundle size + the **25 MiB deploy limit**, Cloud Run cold starts, Firestore query cost, watch performance.
- **Scope:** hot paths, bundle/assets, serving code, watch, DB queries.
- **When it runs:** hot-path, asset/bundle, serving, or query changes.
- **Inputs:** diff, sizes/timings. **Outputs:** grouped findings with measured/estimated impact.
- **Severity / Blocking:** Critical (single bundled asset near/over 25 MiB — pipeline breaker; loading multiple heavy models per request — OOM on constrained devices). Important (main-thread jank, unbounded lists, N+1 Firestore, cold-start regressions, battery-draining polling). Advisory (micro-opts, measured only).
- **Confidence:** ≥ 80, evidence-based. **Auto checks:** asset-size scan vs 25 MiB; grep unbounded loops/listeners; bundle diff.
- **Manual items:** estimate cold-start delta; check watch polling cadence.
- **Example findings:** "New `model.bin` (31 MiB) added to `www/` — exceeds the 25 MiB Pages limit; will silently break deploy. Critical." · "Lab list renders all 5k results unvirtualized. Important."

### R7 · Release Reviewer  `stewardmd-release-reviewer`  (model: opus) — FINAL GATE
- **Purpose:** GO/NO-GO gate before any ship/flag-flip/deploy.
- **Responsibilities:** production config; debug flags off; secrets removed; logging/crash-reporting/analytics PHI-scrubbed; privacy permissions + **`PrivacyInfo.xcprivacy`** + App Store privacy form; HealthKit review; release notes; rollback readiness; **testing-readiness gate** (unit/integration/UI/golden/snapshot/perf tests present + green for the change); the deploy-pipeline gotchas (25 MiB, native-rebuild reality, `CACHE_VERSION`, access gate).
- **Scope:** the release candidate as a whole.
- **When it runs:** before shipping a build / flipping a flag / deploying prod. Requires R1 + R3 Criticals clear first.
- **Inputs:** RC diff, other reviewers' verdicts, test status. **Outputs:** **GO / GO-WITH-FIXES / NO-GO** + checklist pass/fail per item.
- **Severity / Blocking:** any unchecked Critical → NO-GO.
- **Confidence:** ≥ 80 on blockers. **Auto checks:** verify test suite green; scan for debug flags/`loggingBehavior`; validate privacy manifest presence.
- **Manual items:** confirm rollback tag; confirm native rebuild covers JS changes; confirm privacy form matches behavior.
- **Example findings:** "Golden regression not run for this drug-engine change — NO-GO until R1 signs off." · "`PrivacyInfo.xcprivacy` missing the required-reason API for file timestamps — NO-GO."

---

See `REVIEW_MATRIX.md` (domain↔reviewer + path routing), `REVIEW_ORCHESTRATOR.md` (auto-routing + dependency chains + blocking), `REVIEW_DECISION_TREE.md` (change→run→block flow), `REVIEW_CHECKLISTS.md` (actionable per-reviewer checklists). Agents live in `.claude/agents/stewardmd-*.md` (7 files, matching R1–R7).
