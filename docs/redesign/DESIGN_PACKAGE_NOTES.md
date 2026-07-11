# StewardMD Redesign — Design-Package Notes (STEP 0)

Companion to `IMPLEMENTATION_PLAN.md`. Classifies every design-package recommendation against what the **existing** StewardMD app can actually do, per the safety rules (preserve all clinical/data/native behavior; extend existing tokens; no invented backend fields; graceful fallbacks).

**Design package** = `StewardMD Redesign.dc.html` (boards `1a–3f`) + `DESIGN_SYSTEM.md`, `UX_AUDIT.md`, `WALKTHROUGH.md`, `TEST_CHECKLIST.md`. `support.js` / `ios-frame.jsx` are the **canvas viewer runtime, not app code** — their hard-coded iOS system colors/metrics are simulator chrome and must **not** be copied into the app as tokens.

---

## A. Implementable exactly (drop-in onto existing architecture)

The package was explicitly authored for this codebase ("drop-in CSS custom properties for existing vanilla-JS architecture — NO new UI library"), so most of it maps cleanly:

1. **Design System v1 tokens (board 1b, `DESIGN_SYSTEM.md`).** Color (light+dark), 4-pt spacing, radius, elevation, typography (Inter + IBM Plex Mono for clinical data), motion — all as CSS custom properties layered onto `index.html:26 :root`, `ui-v3.css --v3-*`, `home.js --h*`. The doc even states existing decision-banner semantics green/yellow/orange/red map **1:1** onto Stable/Warning/High/Critical.
2. **Clinical severity tokens** (critical/high/warning/stable/info/completed with AA-checked fg/bg/border in both modes) — additive; they sit alongside (don't replace) the existing `--green/--yellow/--orange/--red` status ramps.
3. **Material Symbols Rounded replacing emoji icons** — pure presentation swap (icons are decorative; keep `aria-label`s).
4. **Reusable primitives** — buttons (48px), inputs (50px), chips, vital tiles, list rows, alert banners, skeletons, empty states — as a scoped stylesheet + small render helpers.
5. **Bottom-tab shell + "More" sheet replacing the drawer (board 1f)** — the tab bar already exists in `home.js`; "More" reuses the existing `openMore`/`openSheet`. Every drawer destination stays reachable (mapped in board 3f). This is a re-IA of existing controls, not new capability.
6. **State patterns (board 3e)** — skeletons, empty/error/offline, destructive-confirm + undo — standard presentation over existing data.
7. **Settings grouping (board 3c)** — flags map 1:1 to existing localStorage keys with unchanged defaults (the design doc explicitly says so); purely a re-grouping of `home.js reorganize()` rows.
8. **Home parity (board 3a) & onboarding restyle (board 3b)** — restyle of existing `#homeV2` controls and the existing `#introPoster/#splash/#consentOverlay/#accountGate` gate; all existing wiring retained.
9. **Safe-area / keyboard-safe / accessibility (touch targets, contrast, focus, reduced-motion)** — the app already uses `viewport-fit=cover` + `env(safe-area-inset-*)`; the redesign standardizes it. Directly implementable.

---

## B. Implementable but requires adaptation to the existing app

These are fine to build, but must bend to how the app actually works (not the canvas's idealized form):

1. **"One canonical token set."** Reality: 5 duplicated token layers + 3 dark triggers + small `--bg` islands. Adaptation → introduce the canonical layer and **alias** existing names to it incrementally (Phase 1 does base/`--v3-*`/`--h*`; `icu.js --primary/--ok/--warn/--danger` and `image-engine --ie-*` are mapped in their own phases). Do **not** hard-unify all at once (63+ consumers).
2. **ICU Overview (board 1e).** The canvas shows a clean restyle; the real `icu.js` is 4222 lines rendering via full-`innerHTML` `paint()` with ~120 `data-icu-act` handlers and safety-critical `recompute()` thresholds. Adaptation → restyle the render strings + tokens only, keep `data-icu-act` names, `ICU_STATE` shape, thresholds, and conventional-unit assumption untouched; ICU keeps its own 5-workspace bottom bar within case context (design doc agrees).
3. **Dx flow (2a) & decision result (2b).** Adaptation → the decision result is produced by **minified `app.js`** (`#outputArea`); restyle by targeting existing containers/classes and CSS, not by rewriting engine output. Preserve `recent.js`'s MutationObserver capture of `#outputArea`.
4. **Drugs "one card per generic" (2c).** Adaptation → the app has **two** catalogues (`MEDDRUGS` non-antibiotics in `drugs.js`, `MEDDB` antibiotics in `api.js`) + brand/price via `MEDAPI`/D1. The unified card must keep both wired into search + `brandCandidates`; brand/price/mfr availability depends on the live drug API.
5. **MaiK chat (2e).** Adaptation → keep the deterministic **two-block** (engine assessment ▸ AI commentary) separation and off-by-default `smd_ai`; the "grounded/sources" UI must reflect real RAG source titles from `SMD_MaiK`, not invented citations.
6. **Cases unified list (2g).** Adaptation → "synced to the account" already true via `SMD_CASES`/Firestore, **but** ICU patients (`ICU_STATE` roster, local-first) and saved assessments have different shapes/stores; unify at the **view** layer without changing storage/PHI-isolation or the 10-case limit. Swipe-to-delete must keep confirm + undo and the re-key/migration path.
7. **Navigation (1f).** Adaptation → no router exists; the tab shell must drive the existing `.on/.hidden/.open` overlay model + `data-act` dispatch + `swipe-back` z-index conventions. "Deep links" are limited to `?case=`, `?ghisPatient=`, `?home=` and push→`/`; the tab bar is not URL-routed.
8. **Account & subscription (3d).** Adaptation → subscription UI can render plan/inclusions, but **entitlement truth** is `SMD_PRO`/Firebase custom claims, and `BETA_PRO_ALL=true` currently makes everyone Pro (must be `false` at launch — see plan R7). Delete-account must keep the store-compliance wipe.

---

## C. Cannot be implemented without future backend / product work (graceful fallback + documented)

Where a board implies data or capability the app doesn't have, we build a **graceful UI fallback on current data** and record the gap — no invented backend fields:

1. **Home "resumable active-patient card with live vitals" (1c/1e).** There is no "currently-active patient" backend concept; the closest real sources are `recent.js` (last-5 device-local) and ICU roster/`ICU_STATE`. Fallback → surface the most-recent ICU patient / recent case; show live vitals **only** when `ICU_STATE` actually has them, else an empty-state prompt. No fabricated vitals.
2. **ICU vital-tile trend sparklines / deltas (1e).** Deltas need trend history depth; `ICU_STATE.vitals[]`/`labs.trends[]` exist but may be sparse. Fallback → show a delta/spark **only** when ≥2 datapoints exist, else the value alone. (`UX_AUDIT.md` itself lists sparklines as a *future* improvement.)
3. **Cases status "Completed/Stable/Unstable" as a first-class field.** ICU has a live status; saved reasoning/decision cases do **not** carry a persisted lifecycle status. Fallback → derive a badge from available data (ICU status for ICU patients; "Saved" for assessments) rather than inventing a status field.
4. **Subscription plan/renewal/billing management (3d).** No billing/payments backend is present (entitlement is a Firebase claim; `BETA_PRO_ALL` for beta). Fallback → show plan **inclusions** + current entitlement state and route "manage" to the existing account/upgrade path; no in-app purchase/renewal UI until a billing backend exists.
5. **Notifications center as a rich, categorized inbox (3a).** Backend is `/api/updates` (medical safety feed: `{ts,category,title,body,source,url,importance}`) — real but limited to that shape. Fallback → render exactly those fields + unread badge; don't invent per-user actionable/task notifications.
6. **Global long-press quick actions / unified sheet component / theme consolidation.** Listed in `UX_AUDIT.md` as **recommended future** work — explicitly out of scope for this pass.

---

## D. Conflicts between the design package and existing functionality

Points where following the canvas literally would break a real behavior — resolved in favor of preserving function:

1. **"Retire the drawer" (1f) vs. `app.js`-owned `SB` + injected settings.** The drawer (`SB` in minified `app.js`) also hosts settings/experimental toggles injected by `home.js reorganize()` into `#sbsub_set`, the account row, and Features guide (wired from `app.js`). Resolution → the "More" sheet must **re-home** those (settings, account, features, secondary tools) before the drawer is retired; `SB` globals/DOM seams stay intact (other modules + `swipe-back` depend on them). Don't delete `SB`; route to a new surface.
2. **Legal links "navigate to /privacy /terms" vs. Capacitor.** In the native WebView, navigating to a route **restarts the app** (explicit fix in `home.js:952`). Resolution → legal links must open **in-app modals** (`openModal('privacyModal'…)`), never `window.location`.
3. **Canvas iOS chrome colors/metrics vs. app tokens.** `ios-frame.jsx` uses hard-coded Apple system hex/px (`@ds-adherence-ignore`). Resolution → ignore those for theming; use only `DESIGN_SYSTEM.md` tokens.
4. **"Unify the three sheet implementations" (audit) vs. stability.** `smd-modal` / `hv-sheet` / `maik-sheet` each have body-lock + z-index lifecycles that many overlays rely on. Resolution → **defer** unification (future work); reuse existing sheet primitives this pass to avoid regressing scroll-lock/stacking.
5. **Home v4 vs. legacy v3 templates.** The canvas shows a single home; the code has two (`homeV4Markup` default + `build()` fallback) sharing `data-act`. Resolution → target the shipped v4 default; keep v3 wiring intact (or gate) so a flag flip can't resurrect a half-redesigned screen.
6. **Severity color unification vs. ICU's separate palette.** ICU uses `--ok/--warn/--danger` and `--primary` (not global `--green/--yellow/--red`/`--teal`). Resolution → **map** ICU tokens onto the new severity/accent tokens; do not repoint status colors under `[data-theme]` (would make severity theme-variant — a clinical-safety regression).
7. **sessionStorage-scoped med list (privacy) vs. any "persist my list" affordance.** `smd_medlist` is intentionally ephemeral. Resolution → keep it session-scoped; don't add localStorage persistence in the redesign without a privacy review.

---

## E. Notes on the package artifacts

- **`DESIGN_SYSTEM.md`** severity labels are Critical/High/Warning/Stable/Info/Completed; the task brief says critical/**urgent**/warning/stable/**informational**/completed → mapping: **urgent = High (#C2410C)**, **informational = Info (#1D6FA3)**. Token names will follow one convention consistently.
- **`TEST_CHECKLIST.md`** references runners `run-golden / run-main-engine / run-icu-nav / run-medlist / run-interactions / run-onboarding-gate`; these exist (or map to real `test/*.mjs`) and are the phase gates. It also assumes device screenshots — those are manual (UI can't be rendered here).
- **`WALKTHROUGH.md` / `UX_AUDIT.md`** are the authoritative before→after board mapping used to build the plan table; they confirm "nothing removed, renamed, or disconnected" as the guiding constraint — consistent with the safety rules.
