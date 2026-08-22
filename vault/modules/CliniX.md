---
tags: [module, education, respiratory]
status: phase1-built (flag OFF, content ai_drafted pending R1 clinical sign-off)
flag: smd_clinix (client, def:false, ?clinix=1) + smd_clinix_draft (def:false, NEVER ship on) + smd_clinix_tutor (Phase 2, def:false) + smd_clinix_uncleared_media (def:false, NEVER ship on) + smd_clinix_haptics (def:true)
---
# CliniX

Clinical learning for medical students: patient approach → history → examination → reasoning →
investigations → diagnosis → treatment → case → OSCE → viva. Design spec:
`docs/superpowers/specs/2026-08-22-clinix-design.md`. Recovery point: tag `pre-clinix` (b2b1bdc).

## Why it does not fight the clinician-only positioning
StewardMD already reserved this lane before CliniX existed: `student` is a first-class role
(`functions/_entitlements.js:17`), trainees resolve to the **educational** `v2beta` tier (`:47`),
students verify by college ID and the copy already says *"unlocks StewardMD's learning tools -
prescription and clinical-action features stay locked for students"* (`verify.js:88`), and the
student billing tier already advertises *"learn atlases"* (`pro-paywall.js:32`).
**The clinician-only boundary is about clinical ACTION, not education.** CliniX must never cross it.

## The one architectural idea
A **Skill** is the atom. Learn / Bedside / Case / OSCE / Viva / Competency are **projections over the
same Skill objects**, never parallel content (product rule 26). `compileLesson()` teaches a skill,
`compileStation()` turns the SAME object into an OSCE checklist, `compileViva()` into an adaptive
examiner, and `competencyKey()` is what all three write against. **An OSCE station is a selection of
skills plus a clock, not authored content.**

A Disease does not own skills, it *references* them and adds `emphasis`. `skill.exam.resp.percussion`
is shared by COPD, pneumonia and effusion; COPD says "expect hyperresonance", effusion says "expect
stony dullness". That indirection is what makes the fourth disease cheap.

## Key files
- `clinix-model.js` — **PURE, the architecture**. Schema, validators, the two gates, the three
  projections, deterministic answer marking, mastery. No DOM, no fetch. 37 unit tests.
- `clinix-content.js` — catalog-first lazy loader. Applies both gates AT THE SEAM so no screen can
  forget them. `cxMedia()` clones `kardiox-screens.js:13-20` kxImg() for native asset rewriting.
- `clinix-store.js` — per-skill competency + resume position + miss log. Emits `learn` into the
  EXISTING `SMD_KU` ledger rather than being a fifth progress store.
- `clinix-screens.js` — router + **the lesson runner** (the product). `clinix.js` — flag gate +
  `#clinixRoot`. `clinix.css` — everything under `#clinixRoot` / `.cx-*`.
- `clinix/**` — content as data. `manifest.json` (catalog) · `skills/core.json` (shared approach +
  general exam) · `skills/respiratory.json` · `diseases/copd.json` · `media/manifest.json` (the
  licence gate).

## Hard invariants (each has a test)
- **Flag off = total no-op.** No `#clinixRoot`, no `cx-lock`, no `--cx-*` custom property in the
  document, and **nothing fetched**. Asserted in `test/run-clinix-ui.mjs`.
- **Unreviewed content never reaches a student.** `review.status` must be `approved`/`published`.
  Fails CLOSED: a missing or garbled status reads as `draft`. All Phase-1 content is `ai_drafted`,
  so a student currently sees an explicit "Awaiting clinical review" state, not an empty pathway.
- **Uncleared media never renders.** `cleared !== true` degrades to caption + "visual pending".
  Absence of a licence record is a REFUSAL, not a default-allow.
- **No prescribing surface.** No CliniX path reaches `SMD_RX`; asserted by DOM grep in the e2e.
- **Mastery is not one correct answer.** Requires repeated success on SEPARATE days (contrast
  `kardiox-providers.js:112`, which credits mastery on the first correct answer, which is why no row
  in the ECG atlas ever shows mastered).

## Why this is NOT built like the KardiQ Learn atlas
Measured, not stylistic. `kardiox-content-pack.js` is 1.9 MB of JS parsed on every page load for
every user; `management` is `string[]` in 100 records and `""` in 1,041; `class19` is null 1,041
times; `difficulty` is `"intermediate"` for 100% of the pack; user state (`status`, `masteryPct`,
`bookmarked`) is frozen INSIDE content records; `tier:"atlas"` matches none of its own UI filters so
**all 1,041 pack lessons are unreachable through the chips**; and `assets/kardiox-learn/` holds 872
images (177 MB) with no manifest and no licence record.
CliniX follows **RadioAnatome** instead (`atlas/` + `atlas.js:308-323` + `atlas-pipeline/`): a small
catalog, lazily fetched per-unit JSON, and a licence gate that refuses uncleared sources.

## Gotchas
- **`scripts/build-www.sh` needs the explicit `cp -R clinix`** (root `*.js`/`*.css` are globbed, data
  dirs are not). Without it the tile appears and every pathway renders empty on the device - exactly
  the `kb/onco` bug recorded in that file's own comments.
- **Load order is load-bearing**: model before content (content resolves the model for its gates),
  store before screens (screens read `window.SMD_CLINIX_PROGRESS` at mount).
- `home.js` loads at `index.html:1587`, BEFORE the CliniX block, so the `HOME_TOOLS` `eligible()`
  must fall back to reading `localStorage` directly (the ThoreX pattern), not to `SMD_CLINIX_FLAGS`.
- Back/close controls must keep the `cx-back` / `cx-close` class names, or `swipe-back.js`
  (`BACK_SEL`, `:29-44`) silently stops handling the Android hardware back button.
- `test/run-clinix-ui.mjs` uses Node 22's **built-in** WebSocket, like `run-abx-ui.mjs`. Do not
  `import "ws"`; it is not a dependency. On Linux set
  `CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- The CDP helper `ev()` wraps its argument in `return (...)`, so a multi-statement snippet must be
  written as an IIFE expression.

## Status
- **Phase 1 (engine + spine): built.** 55 unit tests + 36 real-browser checks green. Full suite:
  104 failures before and after, identical set (zero regression, verified against `pre-clinix` in a
  clean worktree).
- **Content: `ai_drafted`, NOT approved.** Drafted against Harrison 22e p.2249-2259 via
  `kb/reference/chronic_obstructive_pulmonary_disease.json` (itself `review.status: ai_drafted`) plus
  GOLD and Macleod's, every skill cited with a locator. **The owner flips `review.status` to
  `approved` per skill after clinical review; nothing reaches a student until then.**
- **Media: zero cleared.** `clinix/media/manifest.json` is the work order (12 entries, each with what
  is needed and where to look). Owner chose openly-licensed sources + permitted YouTube embeds.

Deps: [[Medical Knowledge Base]] (`kb/reference/*` grounding) · [[MaiK]] (Phase 2 tutor via
`SMD_AI.explainGroundedStream`) · [[AI Control Center]] (Phase 2 needs a `clinix` entry in
`AI_MODULES`) · `SMD_KU` / [[StewardMD ID]] (engagement ledger).
