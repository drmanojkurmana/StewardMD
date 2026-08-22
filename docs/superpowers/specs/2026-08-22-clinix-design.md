# CliniX — Clinical Learning Module · Design Spec

**Status:** design approved-pending · Phase 1 in build
**Flag:** `smd_clinix` (client, def:false) · `clinix_tutor` (server FEATURES_ON)
**Recovery point:** tag `pre-clinix` (b2b1bdc)
**Owner decisions taken (2026-08-22):** media = openly-licensed + permitted YouTube embeds · first
vertical slice = **COPD** · audience = everyone, students foregrounded.

---

## 1. Vision

"Clinical learning. From patient to treatment." A structured bedside-skills platform for medical
students inside StewardMD, teaching the approach to a patient from first contact through history,
examination, reasoning, investigation and treatment.

The product test is not "did we ship lessons". It is: **does the phone feel like a senior clinician
teaching at the bedside, rather than a textbook on a screen.**

## 2. Why this fits StewardMD (and does not fight it)

StewardMD is clinician-only decision support. CliniX is for students. That looks like a conflict; it
is not, because the product already reserved the lane:

- `functions/_entitlements.js:17` — `student` is a first-class billing role.
- `functions/_entitlements.js:47` — trainees (`resident`/`co_resident`/`intern`/`student`) resolve to
  the `v2beta` **educational** tier; attendings get clinical `v1`.
- `verify.js:88` — students verify by **college ID card**, and the copy already states the boundary:
  *"unlocks StewardMD's learning tools - prescription and clinical-action features stay locked for
  students."*
- `pro-paywall.js:32` — the student tier already advertises *"Full MaiK AI · voice dictation · learn
  atlases."*

So CliniX ships into an existing role, an existing tier, and an existing promise. **The clinician-only
boundary is about clinical *action* (prescribing, orders, patient records), not about education.**
CliniX must never cross into action: no prescribing, no patient record, no PHI.

## 3. Core principles

1. **One clinical knowledge model, many runners.** Learn, Bedside, Cases, OSCE, Viva and Competency
   are *projections over the same Skill objects*, never parallel implementations. (Product rule §26.)
2. **Content is data, not code.** Adding a disease is adding JSON. The engine never changes.
3. **Ground in the KB; never invent.** Clinical substance derives from `kb/reference/*.json` +
   `kb/treatments/*.json`. The LLM teaches and questions; it never authors a dose, a criterion or a
   citation. Mirrors the SknX Phase-2 decision (2026-08-04) and the discharge-narrative decision
   (2026-08-22).
4. **Licence is a gate, not a footnote.** Media without a cleared licence does not render.
5. **Show before tell; ask before reveal.** A screen that only scrolls has failed.
6. **Reversible.** Flag-off is a byte-identical no-op.

## 4. Non-goals / hard safety boundaries

- **No prescribing, ever.** CliniX has no write path into `SMD_RX`. Treatment teaching is
  reference-grade content with doses drawn from the KB, clearly cited, never LLM-generated.
- **No PHI.** Simulated patients only. No patient record, no camera, no case import.
- **No unreviewed content published.** Every content object carries `review.status`; the runtime
  refuses to render anything that is not `approved`/`published` unless a dev flag is set. This matters
  concretely: `kb/reference/chronic_obstructive_pulmonary_disease.json` is currently
  `review.status: "ai_drafted"` — good teaching material, **not yet signed off**.
- **No re-hosting copyrighted media.** Embed where permitted, link where not, host only what is
  openly licensed or owner-produced.
- **CliniX never claims a student is competent to perform on a patient.** Competency scores are study
  progress, and the UI says so.

## 5. The architecture: one model, many runners

The load-bearing decision. `JVP examination` (or, for COPD, `chest expansion`) is **one object**,
consumed by every mode:

```
                    ┌─────────────────────┐
                    │   SKILL (the atom)  │
                    │  id · steps · why   │
                    │ normal · abnormal   │
                    │ significance        │
                    │ pitfalls · media    │
                    │ probes · rubric     │
                    └──────────┬──────────┘
                               │
   ┌────────┬────────┬─────────┼─────────┬─────────┬──────────┐
   ▼        ▼        ▼         ▼         ▼         ▼          ▼
 LEARN   BEDSIDE   CASE      OSCE      VIVA     MaiK      COMPETENCY
 (turns) (drill) (encounter)(timer+   (adaptive)(tutor   (per-skill
                             rubric)            context)  mastery)
```

- A **Skill** owns its teaching turns (`steps`, `why`, `normal`, `abnormal`, `significance`,
  `pitfalls`), its assessment material (`probes[]` = questions with expected answers), and its
  `rubric[]` (checklist items, each flagged `critical` or not).
- **Learn** plays the teaching turns. **OSCE** plays the same `rubric[]` against a timer. **Viva**
  draws from the same `probes[]`, escalating by level. **Case** sequences skills as an encounter.
  **Competency** is written by all of them, keyed on `skill.id`.
- Writing a new OSCE station is therefore *selecting skills and setting a time*, not authoring a
  station.

### Content hierarchy

```
Specialty → System → Disease → Chapter → Skill → Turn
```

A **Disease** does not own skills; it *references* them and adds emphasis. `skill.exam.resp.percussion`
is shared by COPD, pneumonia and effusion; COPD's disease file says "expect hyperresonance" while
effusion's says "expect stony dullness". This is what makes the fourth disease cheap.

## 6. Storage and delivery

**Follows RadioAnatome (`atlas/` + `atlas.js:308-323`), explicitly NOT KardiQ's content pack.**

The KardiQ Learn atlas is the cautionary precedent, and the reasons are measured, not stylistic:
a 1.9 MB JS file parsed on every page load for every user; `management` typed `string[]` in 100
records and `""` in 1,041; `class19` null 1,041 times; user state (`status`, `masteryPct`,
`bookmarked`) frozen inside content records so no row ever shows mastered; `tier:"atlas"` matching
none of its own UI filters, making all 1,041 pack lessons unreachable through the chips; 872 images
with no manifest and no licence record.

CliniX instead:

```
clinix/manifest.json                 catalog: systems, diseases, versions, counts
clinix/skills/<system>.json          shared skill objects for that system
clinix/diseases/<id>.json            disease pathway: chapter -> skill refs + emphasis
clinix/media/manifest.json           licence gate, keyed by media id
```

Fetched lazily over HTTP, cached by the service worker (stale-while-revalidate keyed on `?v=`).
Nothing loads until the student opens CliniX.

**Build note (load-bearing):** `scripts/build-www.sh` copies root `*.js`/`*.css` by glob but data
directories need an explicit `cp -R` (`build-www.sh:74-97`). The comment there records the exact bug
this causes: the onco catalogs "was missing -> those views rendered empty on the device because the
data never reached www/." `clinix/` must be added there.

**Media** resolves through `cxMedia()`, cloning `kardiox-screens.js:13-20`'s `kxImg()` — root-relative
in content, rewritten to `https://stewardmd.in` on native so nothing bloats the install. Every media
record must carry `{kind, licence, attribution, sourceUrl, cleared}`; **`cleared !== true` does not
render**, mirroring `atlas-pipeline/`'s `require_clear()` licence gate.

## 7. Progress and competency

**Do not create a fifth progress store.** The repo already has four unconnected ones (`streak.js`,
`ku.js`, `engagement.js`, and KardiQ's isolated `localStorage["smd_kardiox_progress_v1"]`).

- **Per-skill competency** is CliniX's own concern and needs a store: `clinix-store.js`, local-first
  (IndexedDB, cloning the `thorex-store.js` KV shape), synced to
  `users/{uid}/clinix/{docId}` (Firestore rules pattern at `firestore.rules:39`). Not encrypted: this
  is study progress, not PHI, and encryption would block the competency dashboard's aggregate reads.
- **Streaks and engagement reuse what exists.** Emit `learn` events to `SMD_KU` (`ku.js`) so CliniX
  feeds the shipped, server-authoritative `SMD_ENGAGE` dashboard, levels and badges. KardiQ Learn
  earns zero KU today; CliniX should not repeat that.
- **Mastery is not "one correct answer."** KardiQ credits mastery on first correct
  (`kardiox-providers.js:112`). CliniX requires a skill to be answered correctly across separated
  sessions before it counts, and decays. The SM-2 scheduler at `kardiox-providers.js:86` is pure and
  correct and is worth lifting.

## 8. MaiK as tutor

CliniX builds **no chatbot**. It calls the existing transport:

- `window.SMD_AI.explainGroundedStream(pkg, {depth}, onDelta)` with fallback to `explainGrounded`
  (`reasoning.js:3799`/`:3826`). Copy the call shape from `icu.js:7231-7263` — the only correct
  in-repo precedent for a module passing its own context.
- **Strip MaiK's UI markers** (`@@MORE@@`, `@@REFINE:...@@`) as `icu.js:7267` does.
- `onDelta` receives the **accumulated** text, not the delta.

Three real traps, each handled:

1. **The firewall does not block education** — verified by running the real classifier: "why do I
   check JVP?" returns `{medical:false, certain:false}` → uncertain → goes to the model, and the
   server prompt already lists "medical education" as in scope (`functions/api/ai/[[path]].js:524`).
   This works because of the 2026-08-20 `certain` amendment, not because exam vocabulary is
   recognised.
2. **Single-word lookups die before the firewall.** `home.js:3748-3752` sends any query of ≤2 tokens
   with no `.medical` signal to `kind:"clarify"`. A student typing "percussion" or "JVP" gets "Could
   you tell me the condition..." instead of a lesson. CliniX must not route through `maikRoute`, and
   should widen vocabulary via `MAIK_SCOPE_CONFIG.allow` (the documented no-rebuild extension point,
   `kb/ai/maik-scope.js:283-288`).
3. **`KNOWLEDGE_SYS` is written for attendings** ("a clinical AI assistant for qualified doctors",
   `[[path]].js:533`) and enforces a bedside-management template. A tutor needs its own system prompt.

**Quota:** a dedicated `clinix` entry in `AI_MODULES` (`functions/_ai_usage.js:18`) plus
`MODULE_FOR.clinix` (`[[path]].js:164`). Without it, student tutoring silently consumes the doctor's
50/day `maik` cap.

## 9. Files

New, at repo root (ES5 IIFE, dual-export for node tests):

| File | Role |
|---|---|
| `clinix-flags.js` | `SMD_CLINIX_FLAGS`, Dialect A (clone `thorex-flags.js`) |
| `clinix-model.js` | **pure**: schema, validators, competency keys, turn compiler |
| `clinix-content.js` | manifest + lazy pack loader, KB join, licence gate |
| `clinix-store.js` | per-skill competency, local + Firestore sync, KU emit |
| `clinix-tutor.js` | MaiK context envelope + call + marker stripping |
| `clinix-screens.js` | screens + router (`SMD_CLINIX_SCREENS`) |
| `clinix.js` | flag gate, `#clinixRoot` overlay, `window.CLINIX` |
| `clinix.css` | everything scoped to `#clinixRoot` / `.cx-*` |
| `clinix/**` | content packs (data) |

Existing files touched (5): `index.html` (CSS link + script block), `home.js` (`ACT` entry +
`HOME_TOOLS` tile), `sidebar-redesign.js` (`TOGGLES`), `scripts/build-www.sh` (`cp -R clinix`),
`sw.js` (CACHE bump on deploy). Server: `functions/api/clinix/[[path]].js`, `_ai_usage.js`,
`_features.js`.

## 10. Invariants (each gets a test)

1. **Flag off = total no-op.** No `#clinixRoot`, no fetch, no `.cx-*` custom properties in the DOM.
2. **Unreviewed content never renders.** A skill with `review.status !== "approved"` is not served to
   a student build.
3. **Uncleared media never renders.** `cleared !== true` yields the caption and source line, never the
   asset.
4. **No prescribing surface.** No CliniX code path reaches `SMD_RX`; asserted by grep-test.
5. **One skill, many runners.** The same `skill.id` object drives Learn, OSCE and Viva; asserted
   structurally rather than by duplication.
6. **The tutor never authors a dose.** Treatment values render from KB content; the LLM's free text is
   dropped if it looks like a prescription (reuse SknX's `looksLikeRx` shape).

## 11. Phases

- **Phase 1 (this build) — the engine and the spine.** Model + validators, content loader, store,
  navigation shell, home tile, COPD pathway skeleton with the approach/history/examination chapters
  authored against the KB. Flag OFF. Unit + CDP tests.
- **Phase 2 — MaiK tutor.** Context envelope, `clinix` quota, tutor system prompt, scope widening.
- **Phase 3 — media engine.** Licence-gated registry, embeds, audio, interactive diagrams.
- **Phase 4 — investigations + treatment** from `kb/treatments/*.json`.
- **Phase 5 — Case mode.** Simulated patient over the same skills.
- **Phase 6 — OSCE.** Timer + rubric, reusing `skill.rubric[]`.
- **Phase 7 — Viva.** Adaptive examiner over `skill.probes[]`.
- **Phase 8 — scale content** to the remaining systems.

## 12. Open items for the owner

- `kb/reference/*.json` COPD content is `review.status: "ai_drafted"`. CliniX Phase 1 renders it
  behind the dev flag only; publishing to students needs your clinical sign-off.
- Whether CliniX competency should ever be visible to a college/faculty account (currently: no, it is
  private to the student).
