# Recommendations - UX/Accessibility (Phase 10) + Code Quality (Phase 11)

## UX & Accessibility (contrast ratios computed from the actual hex values)

### Critical
1. **No real accessibility text scaling.** `index.html:18` viewport sets `user-scalable=no, maximum-scale=1.0`
   (blocks pinch-zoom) and the in-app font slider caps at **125%** (`home.js:4451`, clamps at 4409/4423/4459)
   with no bridge to the OS Dynamic Type (no `ContentSizeCategory` read). A low-vision clinician on iOS
   "Larger Text" gets NO equivalent inside the app (WCAG 1.4.4 needs 200%). Affects every clinical value.
   **Fix:** remove `maximum-scale`/`user-scalable=no` and/or raise the slider to >=200% (verify no clipping).
2. **ICU vitals severity is color-only - no severity word reaches VoiceOver.** `icu.js:1378-1406`
   (`vitalCard`/`vstat`): a critical K+/SpO2 card gets the red `crit` class but the `aria-label` only says
   "SpO2: 88 %" - VoiceOver announces a normal and a life-threatening value identically. **Fix:** append the
   status word ("critical, below 88") into the aria-label (pattern already used in `medlist.js:1399-1406`).
3. **GHIS abnormal labs are red-only + sub-AA.** `ghis-ward.js:378` - no "H/L/abnormal" text/aria; the red
   `#ef4444` on white = **3.76:1** (fails AA 4.5:1). **Fix:** add a textual flag + aria-label; darken to
   `#b91c1c` (matches ICU `--danger`, ~6:1).
4. **Code Blue is buried 4+ taps deep** (`icu.js:3193-3196`) inside a specific patient's "More" tab; no
   home/global entry (verified: no `codeblue` in `home.js`). Unsafe friction during an arrest. **Fix:** a
   persistent one-tap Code Blue affordance reachable from anywhere in ICU / a Home quick-action.

### High
5. **Header icon buttons regressed to 34x36** (`redesign-system.css:545`), below the app's own 44pt rule -
   the four most-used controls (Menu/Search/Theme/Notifications). Same for ICU close (38x38). **Fix:** drop
   the override / restore 44x44.
6. **GHIS icon buttons use `title=` not `aria-label`** (unreliable on mobile AT) + the connection dot is
   color-only (`ghis-ward.js:19,166`). GHIS has ~1 aria-label across 3 files vs heavily-labeled ICU/Insulin/SknX.
7. **Inconsistent loading/empty/error states** - FollowCare's `fc-empty` states (many, `followcare.js`) have
   no `role="status"`/`aria-live` (ICU/FundX do it right). A shared `.rds-state` component exists in CSS but
   is **never used** by any JS. **Fix:** wire modules to `.rds-state` (with roles) or add `role=status/alert`.
8. **Insulin uses `role="tab"` + `aria-pressed`** (ARIA anti-pattern; should be `aria-selected`) - AT may not
   announce the selected dosing mode, which is safety-relevant. `insulin.js:611-618`.

### Medium/Low
- ICU muted `#64748B` on `--bg #F1F5F9` = 4.34:1 (just sub-AA on-bg); diagnosis reason ellipsis-truncated with
  no expand/title; GHIS sign-in placeholder-only labels; decorative badges at fixed 9-11px.
- **Reference implementations to copy:** SknX (`sknx-screens.js` role=alert/status, icon+text) and KardioX
  (`kardiox-screens.js` icon+text severity + haptics) already meet the bar - propagate their pattern to
  ICU vitals, GHIS, FollowCare. No positive tabindex anywhere (good).

## Code Quality (Phase 11)

- **God-class / huge-file refactor candidates (by LOC):** `interaction-rules.js` (26.9K - a data ruleset +
  `drugClasses`; consider splitting the ruleset from the class map + lazy-loading), `calculators.js` (7.6K -
  ~405 calcs; split by specialty), `icu.js` (7.6K), `reasoning.js` (5.6K), `home.js` (5.4K - router + home +
  Display&Accessibility + all click delegation). These aren't defects but are the maintainability hotspots;
  each is also a boot-parse cost (see performance H2/M2).
- **Duplication:** three near-duplicate GHIS import call sites (`ghis-ward.js:516/554/585`); empty/error markup
  hand-rolled per module (`fc-empty`/`ghis-empty`/`fundx-empty`/`icu-v2-loading`) instead of the shared
  `.rds-state`. KardioX has TWO ensemble implementations (sequential `kardiox-engines.js` vs concurrent
  `kardiox-ort.js`) - unify on the safe sequential one (perf C1).
- **Doc drift (CLAUDE.md flags this):** `index.html:1487` "~4.8MB" KB comment is actually 26 MB. Sweep
  comments/vault for similar drift.
- **Naming/consistency:** the drug-class data has real correctness bugs masquerading as classification (see
  clinical_safety.md C1/C3/M3 - `cotrimoxazole` vs `co-trimoxazole`, paracetamol tagged opioid, clozapine
  tagged benzodiazepine). These are the highest-value "code quality" fixes because they are also safety bugs.

## Process recommendations
- Add a **CI size-budget** (`www/` per-file + total) so KB growth can't silently break the Cloudflare 25 MiB limit.
- Add a **DDI ruleset unit-test matrix** for the well-known tier-1 interactions (warfarin-antibiotics, colchicine-macrolide,
  DOAC-azole, K-sparing+K, lithium-thiazide) so misses like clinical_safety.md C1/C2/H1-H6 fail the build.
- Stand up the **Firebase emulator** in CI so `firestore-rules` + the maik service tests run (3 of the 6 current failures).
