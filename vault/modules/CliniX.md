---
tags: [module, education, respiratory]
status: phases 1,2,3,5,6,7,8 built (2 diseases) (flag OFF, content ai_drafted pending R1 clinical sign-off)
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
- `clinix-tutor.js` — MaiK as tutor. Context envelope + **the dose guard** (see invariants).
- `clinix-diagrams.js` — self-authored inline SVG diagrams (flow-volume loop, air trapping,
  interactive percussion map). The one media kind that can always be cleared.
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
- **Every body diagram is in the EXAMINER'S view.** The patient's right renders on the VIEWER'S
  left, the radiograph convention. `test/clinix-diagrams.test.mjs` asserts it in both directions
  from the `side` field now carried by `ZONES`, `AUSC` and `ABD_REGIONS`, and cross-checks `side`
  against the word in the label so a typo in either is caught.
- **The tutor never authors a dose.** `TUTOR_SYS` says so, but a prompt is a request, not a
  mechanism. `clinix-tutor.js` `sanitize()` is the mechanism: a reply matching a drug-dose pattern is
  replaced WHOLESALE with a teaching refusal, client side, before it can render. Tested against 10
  real dose shapes and 12 legitimate lesson strings (saturation targets, FEV1 bands, PaCO2
  thresholds, pack-years, Harrison page numbers) that must NOT trip it. Mirrors SknX Phase 2.

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
- **BUMP THE `?v=` TOKEN OF EVERY EXISTING FILE YOU EDIT.** This shipped to a real device and looked
  like a total failure. CliniX lives in NEW files, so their fresh `?v=cx1` URLs were never cached and
  loaded fine. But its two entry points are EDITS to existing files: the home tile in `home.js` and
  the Settings toggle in `sidebar-redesign.js` (plus the tutor's `mode` passthrough in
  `reasoning.js`). `sw.js:6` caches static assets **keyed on the full URL including the query
  string**, so an unchanged `?v=` means the service worker serves the pre-CliniX copy forever. The
  symptom is maximally misleading: the module is present and working on the device, and there is
  simply no tile and no toggle to reach it with. Bumping `sw.js` `CACHE` does NOT save you, because
  the old worker is still the one answering. `scripts/verify-clinix-bundle.sh` now fails if any of
  those three tokens lacks a `clinix` marker.
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
- **A mirrored anatomical diagram reads as correct.** `percussionMap`, `liverPalp` and `spleenPalp`
  were drawn in the PATIENT's frame while `auscultationMap` and `abdRegions` were in the examiner's,
  so one file taught both conventions at once. Nothing failed: the diagram is internally consistent
  and only wrong once you say the sides out loud, and a student would have reached for the wrong
  side at the bedside. It was found by LOOKING at a rendered screenshot, not by any assertion, which
  is why the `side` fields and the two-way test above now exist. If you add a body diagram, add its
  side data and extend that test; if it has no side data, render it and look at it.
- The comparative connector in `percussionMap`/`auscultationMap` offsets 17px from each circle. That
  offset must follow the direction of the pair, or a right-to-left pair draws the line back out
  across both circles instead of between them.
- **The simulated patient canonicalises BOTH sides of the match.** `canon()` in `clinix-model.js`
  rewrites a synonym table (`sob`/`dyspnoea`/`winded` -> `breathless`) over the student's question
  AND over each authored cue, so content never has to spell out every register. It is a vocabulary
  map only: it never infers anything clinical, and the patient still says only what the author
  scripted. When no cue matches, `nearMiss()` offers a rephrase if the question shares **two**
  distinct content tokens with a topic - one is not enough, and that threshold is the fix for
  "what is your favourite colour" reaching the sputum topic through a bare `colour` cue.
  A clarification is deliberately NOT credited as having asked the topic, or the thin-workup check
  becomes free to pass.
- History topics may carry an optional `about` noun phrase ("the phlegm you bring up") used by
  `clarifyReply()`. Most do not, so the copy degrades to a plain request to rephrase rather than
  rendering "do you mean that?".

## Phase 2: MaiK as tutor
CliniX builds **no chatbot**; it calls `SMD_AI.explainGroundedStream` exactly as `icu.js:7231` does.
Four small, additive changes outside the module:
- `functions/_ai_usage.js` — a `clinix` entry in `AI_MODULES` (60/day). A Socratic lesson is many
  SHORT turns, so it needs its own bucket; without it a student's revision silently eats the same
  50/day `maik` allowance they need for clinical questions, and the admin console cannot tell
  student revision from a doctor's MaiK usage.
- `functions/api/ai/[[path]].js` — `body.mode === "clinix-tutor"` remaps `_mod` to `clinix` (same
  place and shape as the existing `maik_case` and `research` remaps), and selects a new `TUTOR_SYS`.
  `KNOWLEDGE_SYS` is wrong for a student in three specific ways: it opens "for qualified doctors", it
  enforces the `@@MORE@@` / `@@REFINE:@@` bedside template CliniX has no chips for, and its DOSING
  rule instructs the model to give standard doses on request.
- `reasoning.js` — `mode` added to the body whitelist of `explainGrounded` and
  `explainGroundedStream`. `undefined` for every existing caller, so their behaviour is byte-identical.
- **Intent Firewall**: `clinix-tutor.js` widens `MaiKScope` with exam vocabulary (`jvp`, `percuss`,
  `auscultat`, `clubbing`, `osce`...) **only when the CliniX flag is on**, preserving flag-off
  no-op. Verified against the real classifier: "why do I check JVP?" already passes (via the
  2026-08-20 `certain` amendment), but a bare **"JVP"** or **"percussion"** hits `home.js:3748`'s
  two-token clarify trap and the student is asked to name a condition instead of being taught.
  **Candidate improvement for the owner: this vocabulary is genuinely medical and would help doctors
  too, so it is a reasonable app-wide widening rather than a CliniX-only one.**

## Phase 3: media, and the one kind we can always clear
The licence gate means externally sourced media cannot ship until it is verified, so Phase 3 built
what needs no sourcing: **self-authored inline SVG**. Three diagrams, each a MECHANISM that prose
conveys badly - the scooped expiratory limb of a flow-volume loop, small airway collapse with gas
trapping (animated), and an interactive percussion map whose numbering teaches the ORDER (side to
side at matched levels) rather than just the sites.

Inline rather than `<img>` for three reasons: they inherit `#clinixRoot`'s `--cx-*` variables so
light/dark and every accent theme work for free; they can be interactive, which the spec asks for and
an image cannot do; and we drew them, so `cleared: true` with licence "StewardMD original" is honest.
`validateMedia` now accepts `inline: true` + `diagramId` in place of `src` for a cleared asset.

**The test that matters here asserts the gate BOTH ways**: only self-authored media may be cleared
(attribution must be `StewardMD`), and every externally sourced entry must still be refused. The
sourcing work order in `clinix/media/manifest.json` is unchanged and now attached to the skills that
need it, so an uncleared video renders its caption and note inside the real lesson.

## Phase 5: Case mode
A simulated patient (`clinix/diseases/copd.json` -> `cases[]`), run through six gated phases:
history, examination, investigations, differential, diagnosis, management. Three decisions:
- **The patient is DETERMINISTIC.** Replies are scripted and matched on cues; an unmatched question
  gets a fallback ("I am not sure what you mean, doctor"), never a generated reply. A simulated
  patient that invents a symptom teaches a wrong pattern, and that is worse than no case at all.
- **Exam findings are keyed by SKILL ID**, so percussion in a case uses the object the lesson taught
  and writes to the same competency key. The one-model rule, applied to cases.
- **The score is NOT a single percentage.** History coverage, key questions, examination,
  essential tests and the diagnosis are reported separately, and the verdict distinguishes
  `good` from **`right-answer-thin-workup`** - a student who names COPD after one question got the
  answer right and the encounter wrong, and a blended mark would hide that. Non-indicated tests are
  counted and shown back with the reason ("a panel is not a plan").

**Bug this suite caught:** cue matching was raw substring, so "what is your favourite colour" matched
the SPUTUM topic via a bare `colour` cue. Fixed twice over: cues now match whole words only and are
scored by matched-cue LENGTH (so "how much can you do" beats "how much"), and the genuinely
ambiguous cues were tightened. Regression test: `test/clinix-case.test.mjs`.

## Phase 8: the second disease, and the measured claim
Pleural effusion was added to prove the architecture rather than to double the content. It is the
strongest possible contrast to COPD because it drives every shared respiratory skill to the OPPOSITE
finding: stony dull instead of hyperresonant, asymmetrical instead of symmetrically reduced, trachea
pushed AWAY instead of central, breath sounds absent instead of symmetrically reduced. One authored
percussion skill teaches both, and the contrast is itself the best way to teach either.

**Measured:**

| Disease | Skills in pathway | Reused | Authored | Reuse |
|---|---|---|---|---|
| COPD | 34 | 23 | 11 | 68% |
| Pleural effusion | 26 | 20 | **6** | **77%** |

The shared pool is 23 skills across `core` + `respiratory`. Adding a second respiratory disease cost
six authored skills and a set of `emphasis` blocks. `test/clinix-content.test.mjs` now asserts this
rather than asserting it in prose: a disease that reused fewer skills than it authored would fail.

**Design error the validator caught:** `skill.present.copd` was namespaced to COPD, but the structure
of a case presentation is identical for every patient. Pleural effusion could not reference it, which
was the validator telling us the skill was in the wrong place. It moved to `core` as
`skill.present.case`. **This is the referential check earning its keep**: without it the second
disease would simply have rendered an empty Case chapter on a device.

The per-disease content tests now loop over every disease in the manifest, so a third one is covered
the moment it is listed.

## Status
- **Phases 1, 2, 3, 5, 6, 7 and 8 built.** 117 unit tests + 64 real-browser checks green. Full suite:
  104 failures before and after, identical set (zero regression, verified against `pre-clinix` in a
  clean worktree).
- **Content: `ai_drafted`, NOT approved.** Drafted against Harrison 22e p.2249-2259 via
  `kb/reference/chronic_obstructive_pulmonary_disease.json` (itself `review.status: ai_drafted`) plus
  GOLD and Macleod's, every skill cited with a locator. **The owner flips `review.status` to
  `approved` per skill after clinical review; nothing reaches a student until then.**
- **Media: 3 cleared, all self-authored.** The 3 inline diagrams render now. The other 10 entries in
  `clinix/media/manifest.json` are the sourcing work order (each says what is needed and where to
  look) and are still refused by the gate. Owner chose openly-licensed sources + permitted YouTube
  embeds for those.

Deps: [[Medical Knowledge Base]] (`kb/reference/*` grounding) · [[MaiK]] (Phase 2 tutor via
`SMD_AI.explainGroundedStream`) · [[AI Control Center]] (Phase 2 needs a `clinix` entry in
`AI_MODULES`) · `SMD_KU` / [[StewardMD ID]] (engagement ledger).
