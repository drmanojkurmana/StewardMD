# StewardMD — Pre-Launch QA Report

**Date:** 2026-07-09 · **Production baseline:** `gold284` (live) · **Recovery tag:** `pre-launch-qa-start` (on prod `main`)
**Scope:** full pre-launch QA cycle (mobile, ICU dashboard, diagnosis flow, calculators, MaiK, WardSync, Lab Watch, accessibility, performance, privacy/security) for iOS + Android + web.

> **Honesty note:** this report does **not** claim "zero bugs." It records what was found, what was fixed and re-tested, and what remains open with a recommendation. Clinical logic (deterministic diagnosis scoring, antibiotic/ICMR engine, formulas) was **not** altered; only validation guards, patient-context resets, store/a11y wiring, and tests were changed.

---

## 1. Executive summary

**Launch recommendation: 🟡 GO WITH CONDITIONS** — safe for **TestFlight / Play Console internal testing now**; public store review after the conditions below are met.

- **1 Critical bug found and fixed** (cross-patient contamination on the ward→ICU workflow) — the single most important finding; fix is in review (PR B, #313), reproduced and verified with an automated acceptance test.
- **High-value clinical-calculator "silent wrong result" bugs fixed** (PR C, #314) and **store/accessibility blockers fixed** (PR D, #315).
- **Mobile layout is clean** — zero horizontal overflow across iPhone-SE/iPhone-13/Android/iPad in light+dark on the primary screens.
- **Privacy/security posture is strong** — AI packets are de-identified, no analytics SDKs, push is payloadless, admin endpoint is server-protected, no committed secrets. A few egress/on-device gaps remain (documented).
- **Nothing merged automatically.** All fixes are isolated PRs awaiting your review + CI (all green on Cloudflare).

**Counts:** Critical found 1 / fixed 1 · High found 6 / fixed 5 (1 documented) · Medium found ~8 / fixed 3 (rest documented) · Low found ~7 (documented). Plus 1 pre-existing **engine golden drift** needing a deliberate clinical rebaseline (not introduced by this QA).

### Conditions before **public** store submission
1. **Merge** PR B (#313, critical), then C (#314), D (#315), and the earlier #312 (build-www vendor). Resolve the one-line `sw.js`/`?v=` version conflicts to the **highest** value.
2. **Golden rebaseline decision** (clinical owner): `run-golden.mjs` + `run-main-engine.mjs` are red due to a *pre-existing* differential re-ranking (HLH added to the non-infective differential; TTP case tops `ttp_hus` vs `MALARIA`). "11 changed, 0 new" — no disease broke. This needs a **deliberate** rebaseline (a clinical call), not a code fix. It is not a functional regression but it keeps CI red.
3. **GHIS/Ward Sync reviewer path:** the feature ships enabled and needs hospital credentials — a store reviewer cannot log in (Apple 2.1 risk). Provide **demo credentials in App Review notes** or default the flag off for store builds.
4. **Real-device smoke** on a physical iPhone + Android (emulation covered layout; it cannot cover Android hardware back button, keyboard-overlap on device, or notch/safe-area on real hardware).
5. Address the two documented **Medium privacy** items (shared-device localStorage scoping; ICU-share PHI consent) — acceptable to defer past internal testing, recommended before public launch.

---

## 2. Test matrix

| Area | Method | Result |
|---|---|---|
| **iOS layout** (SE 320 / 13 390 / iPad 768) | CDP device emulation, light+dark | ✅ no horizontal overflow; ⚠️ header touch targets 36–38px (<44px) |
| **Android layout** (360) | CDP emulation, light+dark | ✅ no horizontal overflow; ⛔ hardware back-button behaviour not tested (needs device) |
| **iPad / tablet** | CDP emulation | ✅ clean |
| **Dark / light mode** | CDP emulation across all screens | ✅ clean both modes |
| **Clinical engine integrity** | `run-golden`, `run-main-engine`, `run-kb-parity`, `run-reason-api`, `run-nextq`, `run-nlp`, `run-ws-golden` | 🟡 parity/reason-api/nextq/nlp/ws-golden GREEN; **golden + main-engine RED (pre-existing drift, see §4)** |
| **ICU dashboard + patient context** | `run-icu-nav/trends/wardsync/import/dx/dxflow/findpicker/correlation/imaging/modal-color/alerts/safety-ux/labwatch` + new `run-icu-patient-switch` | ✅ all GREEN after PR B |
| **ICU diagnosis flow** | `run-icu-dxflow`, `run-icu-correlation`, `run-icu-findpicker`, `run-icu-evidence` | ✅ GREEN |
| **Calculators** | new `run-calc-guards` + `run-drug-index` | ✅ GREEN (guards added; broader min/max + citations documented) |
| **MaiK AI** | privacy audit (de-id + admin-protection) + `run-maik-*` suite | 🟡 privacy verified; functional suite results in §3/appendix |
| **WardSync / GHIS** | `run-icu-wardsync`, `run-ghis-ward`, `run-ghis-import` + code audit | 🟡 context GREEN; 2 `run-ghis-ward` assertions are test-drift in the auth area (documented) |
| **Lab Watch** | `run-icu-labwatch` (21 checks) + patient-switch | ✅ GREEN (keying + badge reset hardened in PR B) |
| **Accessibility** | store audit + mobile audit | 🟡 permissions/disclaimers/labels present; touch-target Low finding |
| **Performance / offline** | code review (MAX_SERIES caps, SW strategy) | 🟡 not load-tested this cycle (documented) |
| **Privacy / security** | full pentest-style audit | ✅ strong; gaps documented in §3 |

Legend: ✅ pass · 🟡 pass with notes · ⛔ not tested · ⛔ blocker.

---

## 3. Bug list

Format: **ID · Severity · Area** — description → root cause → fix → proof → PR/status.

### CRITICAL

**C1 · Critical · ICU / WardSync** — Loading a second ward patient **merged onto the first** (cross-patient contamination).
- **Repro:** load synthetic Patient A via Ward Sync, enter weight 50 kg + a noradrenaline infusion + vitals; without clearing, load a **different** ward Patient B → B shows A's weight, A's pressor (banner "1 pressor"), A's vitals under B's name. A weight-based pump rate for B would compute on A's 50 kg.
- **Root cause:** `ingestFromWard`/`ingestWardHistory` deliberately **merge** into live STATE (contract: "callers reset/select the patient before syncing"), but `GHIS.loadIntoICU` never reset first; `ingestPatient` only overwrites the demographics keys it's given, so weight/infusions/vitals/findings/ABG persisted.
- **Fix:** `wardSwitchGuard()` at the top of both ingest functions resets STATE when `bundle.patientId` is present **and differs** from the loaded ward patientId (same-patient re-sync still merges; non-ward imports unaffected).
- **Proof:** `test/run-icu-patient-switch.mjs` — FAILED before (bWeight=50, bInfusions=1, bVitals=1), GREEN after; same-patient re-sync still merges. All ICU regressions GREEN.
- **PR B (#313) · fixed, in review.**

### HIGH

**H1 · High · Calculators** — MELD 3.0 silently defaulted every blank input to a normal value → falsely low score. → guard requires bilirubin/creatinine/INR/Na/albumin. **PR C (#314) · fixed** (`run-calc-guards`).

**H2 · High · Calculators** — PSI/PORT treated blank age as 0 → falsely "class I–II, outpatient." → guard on age. **PR C (#314) · fixed.**

**H3 · High · Calculators** — Rumack-Matthew read a blank paracetamol level as 0 = below the NAC treatment line (could contribute to withholding NAC). → guard requires time + level. **PR C (#314) · fixed.**

**H4 · High · Lab Watch (ICU)** — watches keyed on `_id||name||"cur"`; ward patients have no `_id`, so two same-first-name (or two unnamed) patients shared one watch bucket + alert feed. → key now prefers the stable ward `patientId`. **PR B (#313) · fixed.**

**H5 · High · Store readiness** — native legal links (`/privacy`, `/terms`, `/support`) broke in the Capacitor WebView (no clean-URL rewrite → fell back to index.html). → converted to the existing `openModal()` pattern. **PR D (#315) · fixed.**

**H6 · High · Privacy (documented, not fixed)** — the ICU **"Share"** (OS share sheet) and **print** egress full PHI (name/bed/hospital/labs/verbatim imaging) with no explicit consent gate. Clinician-initiated to their chosen recipient, so lower urgency, but recommend a one-time "contains patient-identifiable data" confirmation and/or a de-identified variant (reuse `imgRedact`/age-band). Touches `icu.js` → **recommended follow-up PR.**

### MEDIUM

**M1 · Medium · Calculators** — Cockcroft-Gault accepted implausible age (150 → **negative CrCl** displayed); Parkland accepted TBSA >100%. → plausibility guards. **PR C (#314) · fixed.**

**M2 · Medium · Privacy (public share)** — `caseshare.js phiScan` blocked MRN/phone/Aadhaar/email but **not names**; shared docs are public by code. → added a labelled-patient-name pattern (precision-verified). **PR D (#315) · fixed.**

**M3 · Medium · Privacy (documented)** — the live ICU patient buffer is persisted under a **non-account-scoped** key `stewardmd_icu_state` (unlike the roster/Lab Watch/drafts which are `ownerNow()`-scoped) and unencrypted; on a shared ward device, if the Firebase auth-change reset doesn't fire, the previous clinician's patient stays readable. → recommend per-owner namespacing + clear on `visibilitychange`. **Recommended follow-up (touches `icu.js`).**

**M4 · Medium · ICU** — no per-line **edit / stop / delete** of an infusion, so a discontinued pressor keeps showing in the banner, round summary, and discharge doc until the whole state is wiped. **Documented — recommended follow-up.**

**M5 · Medium · Lab Watch (ICU)** — `_lwBadge`/`_lwHighlight`/`_lwDraft` weren't cleared on patient switch (badge carried the previous patient's count). **PR B (#313) · fixed** (folded into `resetState()`).

**M6 · Medium · Calculators** — DDI engine silently drops drugs it can't resolve; the summary can read "No major issue detected" while an un-parsed drug is uncounted. → recommend surfacing "N medicine(s) not recognised — not checked." **Documented.**

**M7 · Medium · Store** — raw backend/error text rendered to the UI (`ghis-ward.js`, `caseshare.js` toasts). → generic message + console-only detail. **Documented.**

**M8 · Medium · Calculators** — weight-based electrolyte repletion (`electrolytes.js`) and the frozen `app.js` vasopressor calculator silently assume **70 kg** when weight is unset. The vasopressor case is the higher risk (a 40 kg patient → ~75% over-delivery on the displayed pump rate); the **stored** infusion record is computed from the canonical weight (correct) — only the on-screen calculator dose uses the silent 70 kg. `app.js` is frozen → recommend the owner add an "assuming 70 kg — enter weight" warning or block weight-based drugs until weight entered. **Documented (do not edit `app.js`).**

### LOW (documented, not fixed)

- **L1** ICU header chips 36–38px touch targets (<44px ideal) — recommend ≥44px.
- **L2** 173 calculator numeric inputs have no `min`/`max`; **L3** no in-UI formula citation (the `ref:` slot is unused on all 82 calcs); **L4** no per-result "verify/decision-support" banner (only a list-level one). Labeling/UX hardening.
- **L5** "Beta" badge on Clinical Reasoning (rendered by frozen `app.js`) — consider "AI-assisted" wording.
- **L6** manifest description terse / marketing "decision support" vs disclaimer "not a validated CDS tool" — align copy.
- **L7** manual-add infusion has no duplicate check (only the calculator path does).
- **L8** debug `alert()` behind `SMD_AUTH_DEBUG`; **L9** server accepts admin/bearer token via `?token=` query (header is primary) — strip/lock before release.

### NON-BUG (test-infrastructure / environment)
- `run-safety-overlay`, `run-onboarding-gate`, `run-search-recent`, `run-case-validation` default to a dev port (5173) / prod URL with **no auto-started server** → fail standalone but **pass with a server** (verified for safety-overlay: SMD_SAFETY renal/QT/hepatic all fire). CI-hygiene: make them self-contained.
- `run-medlist`/`run-medlist-scan` failures are the **native-only OCR scan** feature exercised in web-headless (scan buttons are native-gated → hidden on web). Needs native context to test.
- `run-ghis-ward`: 2 assertions ("keep me logged in" checkbox; ward endpoint routing) are test-drift in the WardSync **auth** area (a do-not-modify zone) — verify against intended behaviour.
- `run-workspaces`: 103/104 (1 overlay-open timing flake). `run-icu-nav`/`run-icu-trends` have a known first-visit render flake → GREEN on retry.

---

## 4. Known limitations

- **Engine golden drift (pre-existing, needs deliberate rebaseline):** `run-golden` (11 changed, 0 new — HLH enters the non-infective differential) and `run-main-engine` (TTP tops `ttp_hus` vs `MALARIA`) are RED. This predates this QA cycle (no PR here touches `reasoning.js`/`kb/`). It is a **re-ranking**, not a broken disease. A clinician must decide whether the new ranking is correct and rebaseline the golden snapshots deliberately. **Until then CI is red on these two.**
- **Background push (Lab Watch Phase 2)** is not implemented — in-app monitoring only (works while the app is open). True background alerts need a server-side patient-scoped subscription store + a scheduled worker with GHIS server-side access + APNs/FCM keys. The UI states this honestly; do not market 24/7 monitoring.
- **GHIS/Ward Sync** requires live hospital credentials; not testable end-to-end here and not reviewable by a store reviewer without demo creds.
- **Real-device behaviour** (Android hardware back button, on-device keyboard overlap, real notch/safe-area, cold-launch perf, offline transitions) was not exercised — emulation covers layout only.
- **Performance/load** (large lab history, many meds, long AI responses, rapid patient switching) was not stress-tested this cycle.
- **MaiK:** the safety-critical parts verified GREEN — `run-maik-usage` (quotas, rate limit, circuit breaker, per-user isolation, **no PHI** in payloads) — and the privacy audit confirmed prompts are de-identified and the admin endpoint is server-protected. `run-maik-routing` / `run-maik-relevance` / `run-maik-mobile` show failures in this environment that appear **AI-backend-dependent** (the live provider is prod-only here, like the evidence/RAG routes) — **recommend re-running the MaiK functional suite against prod/live AI** before public launch to separate env failures from any real routing/rendering issues.

---

## 5. Release checklist

| Item | Status |
|---|---|
| Production deploy version | `gold284` live; QA fixes bump to `gold285/286/287` on merge |
| Recovery tag | `pre-launch-qa-start` on prod `main` ✅ |
| CI (Cloudflare Pages) on QA PRs | #313 ✅ #314 ✅ #315 ✅ (all SUCCESS + mergeable) |
| Capacitor sync | `www/` build + `npx cap copy ios`/`android` done for gold284; **re-run after merging the QA PRs** |
| iOS build | not built this cycle — build + TestFlight after merge |
| Android build | not built this cycle — build + Play internal after merge |
| Store screenshots/assets | not audited for content this cycle (icons/version/permission strings ✅) |
| Permissions | iOS + Android usage strings present, human-readable, medically appropriate ✅ |
| iOS export compliance | `ITSAppUsesNonExemptEncryption=false` added (PR D) ✅ |
| Account + data deletion | implemented (delete account wipes Firestore + local + auth record; guest erase) ✅ |
| Privacy review | strong posture; 2 Medium gaps documented (M3, H6) |
| Golden/parity | parity GREEN; **golden + main-engine need deliberate rebaseline** ⛔ |
| Rollback | tag `pre-launch-qa-start`; each fix is an isolated, revertible PR |
| Open QA PRs | **#313 (B, critical), #314 (C), #315 (D)**, plus prior **#312 (build-www vendor)** — none merged |

---

## 6. Final recommendation

**Safe to submit to TestFlight (iOS internal) and Play Console internal testing** once PRs **#313 → #314 → #315** (and #312) are merged and the native apps are re-synced (`npm run build:www && npx cap copy ios/android`) and rebuilt. The critical cross-patient bug — the only launch-blocking defect found — is fixed and verified; the remaining fixed items remove falsely-reassuring calculator outputs and store-review friction; the mobile layout and privacy posture are sound.

**Hold public App Store / Play Store review** until: (a) the **golden rebaseline** decision is made by the clinical owner (so CI is green and the diagnosis ranking is intentional), (b) **GHIS demo credentials** are supplied to reviewers (or the flag is defaulted off for store builds), (c) a **real-device smoke pass** is completed, and (d) the two Medium privacy items (M3 shared-device scoping, H6 ICU-share consent) are addressed — these matter most on shared ward hardware.

This is a **GO WITH CONDITIONS**: ship to internal/TestFlight now; clear the four conditions before public review.

---

### Appendix — artifacts produced this cycle
- New tests: `test/run-icu-patient-switch.mjs`, `test/run-calc-guards.mjs`, `test/run-mobile-audit.mjs` (+ existing `run-icu-safety-ux`, `run-icu-labwatch` from prior work).
- PRs: **#313** ICU cross-patient safety (C1/M5/L7/H4) · **#314** calculator input guards · **#315** a11y + store readiness · (**#312** build-www vendor, pre-existing).
- Recovery tag: `pre-launch-qa-start`.
