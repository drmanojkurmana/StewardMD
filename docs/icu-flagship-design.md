# ICU Flagship + App-wide UX — Phase 0 Design Note

Status: **brainstorm/design, agreed defaults chosen autonomously (owner asleep).**
Scope source: `~/Downloads/Stewardmd/ICU_FLAGSHIP_MASTER_PROMPT.md`.
Companion specs (NOT duplicated here): `VOICE_AND_ICU_UX_PROMPT.md` (MaiK Scribe voice), `REGIONAL_ANTIBIOGRAM_PROMPT.md`.

## Ground rules held to this run
- **No push / no PR-merge / no deploy** until the owner approves. All work is local commits only.
- `app.js` is a **hand-maintained minified bundle** (no build source) → augment via `window.*` seams (as `reasoning.js` already does for `runEngine`/`renderOutput`); **never hand-edit `app.js`**.
- Web app is **buildless**; mirror any web-asset change into `www/` via `npm run sync` (copies root `*.js/*.css/*.html`).
- Safety posture unchanged: nothing auto-applies without clinician review; deterministic engines untouched; imported values conflict-safe + source-tagged; missing → "—"; ICU stays private per-user. Golden/parity harnesses must stay green (a re-rank is a *deliberate* rebaseline only).

## Phase 0 decisions

### 1. Universal Snapshot UX (headline)
- **One Capture button** (custom camera icon) → snap or upload. A **batch tray** lets the user add multiple photos (monitor + vent + ABG + lab sheet) before one **"Read all."** Each thumbnail shows detected-type chip + confidence once read.
- **Auto-detect:** `POST /api/ai/vision {image, kind:"auto"}` → Gemini returns `{ kind, fields, confidence }` (kind ∈ monitor|ventilator|abg|labs|flowsheet|unknown). Offline/on-device path: deterministic `classifyReport(text)` keyword heuristic (PEEP/FiO2/Vt→vent; pH/pCO2/pO2/HCO3→abg; Na/K/Cl/creatinine/Hb/WBC→labs; HR/SpO2/NIBP/MAP→monitor; intake/output/balance→flowsheet) so single-capture works with no AI. This **extends** the sectioned `"all"` extractor already shipped (gold249/250): `"all"` returns every section at once; `"auto"` adds per-image classification + confidence for the batch UI.
- **Combined review sheet** grouped by detected type ("Monitor · 4 values", "ABG · 5 values"), every value **editable + abnormal-flagged + confidence-flagged**, each image has a **"wrong type? change"** control. **Confirm** → one conflict-safe `ingestFromWard({source:"Snapshot", …})`. Low-confidence/`unknown` → show recognized text + "tag manually", never silently dropped.
- Persistent **"Verify every value"** line; after confirm, offer a jump-to-tab for each filled section.

### 2. World-class ICU — the high-impact few (no gold-plating)
Chosen (inputs already collected, low risk, high bedside value):
1. **One-screen handover** view (patient banner + active problems + latest vitals/ABG + pressors + pending actions) — the "print/paper replacement."
2. **SOFA / qSOFA daily trend** (reuse `trendGraph`) — trend-first, from data already captured.
3. **Shift / severity pill** (green/amber/red) in the header, derived from existing alert severity.
4. **One-tap round summary** (already have `buildSummary`) surfaced from the banner.
Deferred as nice-to-have: predictive/ML scores (out of scope, no data pipeline).

### 3. Icon system
- **Extend the existing `ICON` map + `svg(name)`** in `home.js` (do NOT introduce a new mechanism). Expose `window.ICONS.get(name)` and `window.icon(name,cls)` thin wrappers so `icu.js`, `antibiogram.js`, sheets can call them. 24×24, `currentColor`, ~1.75 stroke, line style, `aria-hidden` decorative / `aria-label` when sole control content.
- **New names:** `heart, pulse, hemo, droplet, flask, abg, syringe, siren, lungs, trend, rounds, camera, mic, upload, hospital, snapshot, info, plus, sparkline, copy, share, refresh, close, edit, check`.
- **Replace emoji** (❤️🫀💧🧪🩸💉🚨🫁📈📋📷…) across ICU + every reworked surface.

### 4. UI refresh (owner's overnight ask: "classic · elegant · modern · minimalistic")
- **Reversible token-level refresh in `ui-v3.css`**, NOT a blind ground-up rebuild (this environment cannot render/verify UI; a full rebuild unseen would risk shipping a broken clinical app). Refine: type scale + system font stack, spacing rhythm, softened radii/shadows, restrained accent palette, calmer borders, consistent focus rings. Structure/markup unchanged → instantly revertible by reverting the CSS commit.
- **Footer everywhere:** `© <year> StewardMD · All rights reserved` — a single shared `smdFooter()` helper injected on Home, overlays/sheets, and the shipping static pages (index/privacy/terms/disclaimer/support). Small, muted, safe-area-aware.

### Rollout / PR mapping
Because we are **not pushing**, work lands on one local integration branch **`feat/icu-flagship`** with commits labelled by the master-prompt PR slice, so the owner can split/push as they like:
1. `feat/icon-system` — extend `svg()`, expose `ICONS`, swap ICU emojis. **+ UI refresh + footer** (owner add).
2. `feat/icu-universal-snapshot` — `/api/ai/vision` `auto` mode + single-capture batch + combined review.
3. `feat/icu-ux-and-clinical` — coach/empty-state/Add-data sheet/tab grouping/tooltips/sparklines/handover/SOFA/severity pill + **clinical-safety fixes**.
4. `feat/app-identity-nav-maik` — identity/trust, discoverability, MaiK persist/copy/regenerate.
5. `feat/connected-tools` — shared patient context + interaction context/coverage + cross-links.
6. `feat/calculators-ward-medlist-a11y` — new calculators, Ward Sync polish, med-list, a11y.

### Priority for the autonomous overnight run (honest)
The full master prompt is far larger than one safe overnight run. Priority (north-star ICU + owner's explicit asks first), each committed only when syntax-clean + harness-green:
**P1** design note · UI refresh + footer · icon system + ICU emoji swap · **ICU clinical-safety fixes** (highest trust) · pdf.js local.
**P2** Universal Snapshot `auto` mode + batch/combined review · ICU UX (coach/empty-state/Add-data/tabs/tooltips/sparklines) · handover/SOFA/severity pill.
**P3** app-wide bounded wins: remove "(Beta)"/"(testing mode)", identity line, MaiK persist/copy/regenerate, interaction-rule additions (bounded data), a few calculators.
**Deferred (needs owner eyes / too large to do safely blind):** full ground-up visual rebuild; the long tail of PRs 4–6 (ward-sync re-auth, med-list reconciliation, all 11 calculators, full a11y sweep). Anything deferred is called out in the morning summary — not silently skipped.
