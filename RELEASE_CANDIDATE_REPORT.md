# StewardMD — Release Candidate Report

**Date:** 2026-07-09 (updated after the KI-H6 + KI-M3 fixes) · **RC version:** `gold289` (live in production) · **Recovery tag:** `pre-launch-qa-start`
**Status:** ✅ **Ready for TestFlight (iOS internal) + Play Console internal testing.** ⛔ **Not cleared for public store review** — see blockers in §6 (reduced from 5 → 3 code/decision items; KI-H6 and KI-M3 now fixed & live).

---

## 1. Merged PRs (in the requested order)

| # | PR | Scope | Merge |
|---|----|-------|-------|
| 1 | **#313** — PR B, ICU cross-patient safety (**C1 critical**) | `icu.js` + test | ✅ merged |
| 2 | **#314** — PR C, calculator input guards | `calculators.js` + test | ✅ merged (sw.js resolved → gold286) |
| 3 | **#315** — PR D, a11y + store readiness | `home.js`, `index.html`, `caseshare.js`, `Info.plist` + mobile-audit test | ✅ merged (sw.js resolved → gold287) |
| 4 | **#312** — build-www: bundle `vendor/` (pdf.js) | `scripts/build-www.sh` | ✅ merged |
| 5 | **#316** — pre-launch QA report | `PRE_LAUNCH_QA_REPORT.md` | ✅ merged |
| 6 | **#318** — KI-H6, PHI export consent gate (Share + Print) | `icu.js` + test | ✅ merged (→ gold288) |
| 7 | **#319** — KI-M3, account-scoped live ICU buffer | `icu.js` + test | ✅ merged (sw.js resolved → gold289) |

**Merge-gate checks confirmed before each merge:** CI green (Cloudflare Pages), **no clinical-engine / diagnosis-scoring / formula change**, no privacy regression (every PR *improves* isolation / PHI handling), no unresolved conflicts. Version conflicts resolved by **keeping the highest** value (final CACHE = `gold289`).

**Verified no engine/app.js/auth files touched by the release:** `git diff pre-launch-qa-start..main` includes **none** of `reasoning.js`, `kb/*`, `app.js`, `antibiogram-data.js`, `native-auth.js`.

---

## 2. Deployed version

- **Production (Cloudflare Pages, from `main`):** `sw.js` CACHE = **`stewardmd-gold289`** — confirmed live at `https://stewardmd.in` (CF build `completed/success`).
- **Asset versions on prod:** `icu.js?v=gold289`, `calculators.js?v=gold286`, `home.js?v=gold287`, `caseshare.js?v=gold287` (each a distinct cache-busting URL; CACHE ≥ all).
- **Deployed-fix spot checks (live):** `icu.js` contains `wardSwitchGuard` (C1) ✅, `phiExportConfirm` (KI-H6) ✅, and per-owner `bufKey` (KI-M3) ✅ · `calculators.js` contains the MELD guard ✅ · `home.js` uses `openModal('privacyModal')` and the broken `href="/privacy"` is gone ✅ · `Info.plist` has `ITSAppUsesNonExemptEncryption=false` ✅.
- **Native bundles re-synced** (`npm run build:www` → `npx cap copy ios` + `android`): both `ios/App/App/public` and `android/app/src/main/assets/public` carry `gold289`, all fixes above, and the bundled `vendor/pdfjs/`.

---

## 3. Post-merge regression results (against merged `main`)

| Regression area (as requested) | Test(s) | Result |
|---|---|---|
| ICU patient switch | `run-icu-patient-switch` | ✅ GREEN (B inherits none of A's data; same-patient re-sync merges) |
| WardSync selected-patient isolation | `run-icu-patient-switch`, `run-icu-wardsync` | ✅ GREEN |
| Infusion add / update / dashboard visibility | `run-icu-dxflow` (infusion bridge + dashboard) | ✅ GREEN |
| Deep Clinical Review load / result / error / retry | `run-icu-correlation`, `run-icu-dxflow` | ✅ GREEN |
| Working diagnosis flow | `run-icu-dxflow`, `run-icu-dx` | ✅ GREEN |
| Lab Watch patient-specific alerts | `run-icu-labwatch` (21 checks) | ✅ GREEN |
| Calculator guards / weight input handling | `run-calc-guards` (10 checks) | ✅ GREEN |
| Mobile navigation / bottom sheets / layout | `run-mobile-audit` (4 viewports × light/dark) | ✅ GREEN (zero horizontal overflow) |
| Tour Next / finding picker / import / alerts / safety-ux | `run-icu-{dxflow,findpicker,import,alerts,safety-ux}` | ✅ GREEN |
| MaiK quota / rate-limit / circuit-breaker / isolation / no-PHI | `run-maik-usage` | ✅ GREEN |

**Flakes (not regressions):** `run-icu-nav`, `run-icu-trends` fail on a first-visit render race and pass on retry (verified GREEN on re-run). **Not run against merged main:** MaiK functional request/error/source-display (`run-maik-routing/relevance/mobile`) — AI-backend-dependent (live provider is prod-only in CI); re-run against prod before public launch.

**Weight propagation note:** the vasopressor weight bridge (canonical `STATE.patient.weightKg` → calculator) is exercised in `run-icu-dxflow`; the **stored** infusion record is computed from canonical weight (correct). The only weight gap is the *on-screen* silent 70 kg fallback in the frozen `app.js` calculator when weight is unset — see known issue KI-8.

---

## 4. Known issues

### ✅ Fixed & live since the last report (gold288/289)
| ID | Sev | Issue | Fix (merged + live) |
|----|-----|-------|------|
| **KI-H6** | High | ICU "Share"/print egressed full PHI with no consent gate. | One-tap consent gate on Share + Print (`phiExportConfirm`, `icu.js`) — nothing egresses until confirmed. **PR #318, gold288.** Test `run-icu-phi-share.mjs` (7 checks). |
| **KI-M3** | Med | Live ICU buffer not account-scoped → shared-device cross-clinician read. | Per-account buffer key (`stewardmd_icu_state:<owner>`) + owner-aware reconcile + resume backstop (`icu.js`). **PR #319, gold289.** Test `run-icu-buffer-scope.mjs` (9 checks). |

### Still open (documented)
| ID | Sev | Issue | Plan |
|----|-----|-------|------|
| KI-golden | — | `run-golden` + `run-main-engine` RED from a **pre-existing** differential re-rank (HLH/TTP; "11 changed, 0 new"). Not introduced here; no engine file was touched. | **Deliberate clinical rebaseline** by the engine owner (public-store blocker). |
| KI-M4 | Med | No per-infusion **stop/delete** → a discontinued pressor lingers in banner/summary/discharge. | Add delete/edit per infusion line (`icu.js`). |
| KI-M6 | Med | DDI engine silently drops unrecognized drugs → "no issue" while an un-parsed drug is unchecked. | Surface "N medicine(s) not recognised — not checked" (`interactions.js`/`medlist.js`). |
| KI-M8 | Med | Vasopressor calc assumes **70 kg** silently when weight unset (frozen `app.js`; on-screen dose only — stored record uses canonical weight). | Owner of `app.js` to add "assuming 70 kg — enter weight" warning / block. |
| KI-M7 | Med | Raw backend error text in `ghis-ward.js`/`caseshare.js` toasts. | Generic message + console-only detail. |
| KI-Low | Low | Header touch targets 36–38px (<44px); no `min`/`max` on 173 calc inputs; no in-UI formula citation; "Beta" label (frozen app.js); URL-query token fallback; debug alert. | Batch a11y/labeling polish PR. |

Full repro/root-cause/fix detail for each is in `PRE_LAUNCH_QA_REPORT.md`.

---

## 5. Manual smoke-test checklist (real devices — required before public review)

Emulation covered layout only; the following **must be run on a physical iPhone and a physical Android** with a **synthetic patient** (no real PHI).

### iPhone (TestFlight build)
- [ ] Cold launch → splash → consent gate appears; accept → home renders (no serif/unstyled flash).
- [ ] Home footer **Privacy / Terms / Support** links each open a modal (not a blank/looping page).
- [ ] Bottom nav + syringe FAB do not overlap the home indicator (safe area); FAB opens Infusions ("Pumps").
- [ ] ICU: create a patient, enter **weight**; open Infusions → Noradrenaline → pump rate reflects the entered weight (not 70 kg).
- [ ] **Patient switch:** load Patient A (weight/pressor/vitals) → switch to Patient B → B shows **none** of A's data.
- [ ] Deep Clinical Review: shows loading → result; force offline → error + retry works (never hangs).
- [ ] Working-dx flow: add findings → find dx → select / add-own / continue-without.
- [ ] Lab Watch setup sheet fully visible; Start requests notification permission once; alert taps → correct patient's Trends.
- [ ] First-use tour: **Next / Back / Skip / Done** all visible and tappable (not clipped); "Don't show again" persists; replay from More.
- [ ] Keyboard: entering vitals/labs does not cover the Save button; bottom sheets not clipped.
- [ ] Calculators (MELD, PSI, Rumack, Cockcroft, Parkland): blank/implausible input → clear "enter values" message, **no** silent result.
- [ ] MaiK: ask a question → response renders with sources + disclaimer; trigger network failure → error + retry; no stuck spinner.
- [ ] PDF import (a lab report PDF) works **offline** (uses bundled pdf.js).
- [ ] Rotate to landscape (if used); dark mode toggle; large Dynamic Type — layout holds.

### Android (Play internal build)
- [ ] All iPhone items above, plus:
- [ ] **Hardware/gesture back button:** closes modals/sheets and steps back through ICU tabs without exiting the app unexpectedly or leaving a blank screen.
- [ ] Notification permission prompt (Android 13+) appears only after enabling device alerts in Lab Watch.
- [ ] App background → foreground restores the current patient (no stale/blank state).

---

## 6. Public-store blockers (must clear before public App Store / Play Store submission)

**Cleared since the last report:** ✅ ~~KI-H6 PHI share/print consent gate~~ (PR #318, live) · ✅ ~~KI-M3 live-buffer account-scoping~~ (PR #319, live). **3 hard blockers remain (was 5):**

1. ⛔ **Golden clinical rebaseline decision** — `run-golden`/`run-main-engine` are red on a pre-existing differential re-rank (HLH/TTP). The clinical owner must confirm the ranking is intended and rebaseline the snapshots deliberately (a clinical call, not a code fix). CI stays red until then.
2. ⛔ **GHIS/Ward Sync reviewer demo credentials** — the feature ships enabled and needs hospital login; a store reviewer cannot pass it (Apple 2.1 / Play data-safety). Supply demo creds in App Review notes **or** default `smd_ghis_ward` off for store builds.
3. ⛔ **Real-device iPhone + Android smoke tests** — §5 checklist, including Android hardware back button, on-device keyboard overlap, and safe-area on a notched device.

**Recommended (not hard blockers):** ⚠️ Per-infusion stop/delete (KI-M4) · ⚠️ Unrecognized-drug warning in DDI (KI-M6) · ⚠️ Silent 70 kg vasopressor fallback (KI-M8, frozen `app.js` — owner decision) · ⚠️ Generic error text (KI-M7) · ⚠️ Low a11y/labeling batch.

---

## 7. Release-readiness verdict

- **TestFlight (iOS internal):** ✅ **READY** — merges complete, prod deployed `gold289`, native synced, critical bug + both PHI blockers fixed & regression-verified. Build the iOS archive from the synced project and upload to TestFlight for internal testers.
- **Play Console internal testing:** ✅ **READY** — same basis; build the Android app bundle from the synced project and upload to the internal track.
- **Public App Store / Play Store review:** ⛔ **HOLD** until the **3** remaining blockers in §6 are cleared (recommended items addressed/accepted).

*No public submission has been made. The critical cross-patient defect is fixed and live; the remaining items are transparently listed above with owners/plans.*
