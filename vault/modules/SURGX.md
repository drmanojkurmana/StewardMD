---
tags: [module, surgery, education, documentation]
status: MVP built (flag ON for testers, content ai_drafted pending R1 clinical sign-off)
flag: smd_surgx (client, def:true for testers, ?surgx=1) + smd_surgx_draft (def:true, FLIP BEFORE RELEASE) + smd_surgx_notes (def:true, role-gated at runtime) + smd_surgx_mentor (Phase 2, def:false) + smd_surgx_uncleared_media (def:false, NEVER ship on) + smd_surgx_haptics (def:true)
---
# SURGX (SURGˣ · Surgical Intelligence)

Five sections, one door: **01 Notes · 02 Protocols · 03 Procedures · 04 Evidence · 05 Cases**.
Recovery point: tag `pre-surgx` (8cf77662). Design audit that preceded it is in this session's plan.

**Brand vs identifier.** The product is "SURGˣ". Every key, flag, route, filename and variable is the
ASCII-safe `surgx` / `SURGX`. The superscript appears in user-facing strings only. Do not let it into
a storage key.

## The one architectural idea that matters
**StewardMD already had a surgical decision engine, and SURGX does not re-author it.**
`ws-surgery.js` (709 lines, 13 syndromes) registers into `window.SMD_WS_ENGINES.surgery` and has
shipped for months behind the Surgery workspace. SURGX **projects** its output onto a seven-band
protocol spine via `surgx-model.compileEngineProtocol()`. The clinical logic therefore has exactly
one home, and **parity is structural rather than something a test has to chase** - though
`test/surgx-content.test.mjs` asserts it anyway, for every syndrome, in both the no-findings and
all-findings states.

**`ws-surgery.js` was not modified at all.** Provenance, an INVESTIGATE band and calculator links
live in `surgx/protocols/engine-overlay.json`, reviewed separately, so the engine file stays the
single source of clinical truth and this module adds only what it lacked.

The second idea, inherited from [[CliniX]] deliberately: **a Step is the atom.** Procedures are
ORDERED selections of shared steps plus emphasis; a case decision point can reference one. Measured
reuse across the five procedures is asserted at >=60% in CI, so a step authored locally that belonged
in a shared pack fails the build rather than quietly costing more at procedure 200.

## Key files
- `surgx-model.js` - **PURE, the architecture.** Schemas, validators, THREE gates, the compilers,
  and the note logic (`noteCompleteness`, `numericGuard`, `applyExtraction`, `renderNoteText`).
  No DOM, no fetch, no clock. 43 unit tests.
- `surgx-content.js` - catalog-first lazy loader over `/surgx/`. Gates applied AT THE SEAM so no
  screen can forget them. Fetches with `?v=<contentVersion>` because `sw.js` caches on the full URL.
- `surgx-note-schema.js` - five note types + procedure template deltas. DATA ONLY.
- `surgx-store.js` - account-scoped prefs (plaintext) + **AES-256-GCM device-local note store**
  via `SMD_CLINIC_CRYPTO`. Fails CLOSED: no WebCrypto means no save, never a cleartext PHI write.
- `surgx-entitlement.js` - Notes gated on `SMD_RX.canPrescribe()`, the app's existing clinician gate.
- `surgx-evidence.js` - three layers: authored sources (offline) -> curated index (offline) ->
  MaiK Research Mode (network, explicit tap only).
- `surgx-diagrams.js` - five self-authored inline SVGs. The only media clearable on day one.
- `surgx-screens.js` - router + the five sections. `surgx.js` - flag gate + `#surgxRoot`.
- `surgx/**` - content as data. 24 files, 240 KB total.
- `functions/api/ai/_surgx-note.js` - the note extraction prompt + server whitelist.

## The three gates (each fails CLOSED, each has a test both ways)
1. **REVIEW** - `review.status` not approved/published does not render. Missing or garbled reads as
   `draft`. Absence is a refusal.
2. **LICENCE** - media renders only when positively cleared. `cleared + licence + attribution` is NOT
   enough for a hosted external file; it must also pass `isCommonsVerified` or `isOwnerProduced`.
   Uncleared renders caption + "visual pending", never a blank.
3. **EVIDENCE** - an item in DO NOW / RESUSCITATE / DEFINITIVE must resolve a source, or
   `validateProtocol()` fails and the content cannot reach the directory.

## Notes: the anti-fabrication stack (the reason this module needed care)
An operative note is a legal record. A fabricated blood loss or swab count in a signed note is a
patient-safety event. **Four layers, and only one is a prompt:**

1. `functions/api/ai/_surgx-note.js` prompt - "if the surgeon did not say it, OMIT THE FIELD".
2. **Server whitelist** - output keys intersected with the schema's `aiFillable:true` set, then a
   hard `NEVER_AI_FILLABLE` DENY list applied on top. Counts, specimens, implants, consent,
   discharge medications, identifiers and attribution are structurally unreachable however the
   model responds - and the deny list wins even if a future schema change allow-lists them.
3. **`numericGuard()`** - any number in an AI-filled field that is not in the transcript VOIDS the
   field and marks it missing. The numeric analogue of `clinix-tutor.js` `sanitize()`.
   **Known limitation, asserted in the test rather than assumed:** it is a set-membership test, so a
   digit spoken anywhere whitelists it everywhere. That is why the catastrophic fields are on the
   deny list rather than merely guarded.
4. **Verification gate** - export blocked until every required field is `clinician`-confirmed, and
   finalising is a DOUBLE press (the `discharge-ghis.js` `armSignOff()` discipline).

Provenance renders as colour PLUS a text label: green yours, amber generated, red missing.
A missing required field prints as `[NOT RECORDED]` in the note. **A UI that degrades by omission
lies about the data.**

## Hard invariants (each has a test)
- **Flag off = total no-op.** No `#surgxRoot`, no `sgx-lock`, no `--sgx-*` property, nothing fetched,
  no home tile. `test/run-surgx-ui.mjs`.
- **All seven bands always render, in the model's fixed order.** An absent band shows an honest empty
  state; it never reorders the page. A 3am protocol must read identically every time.
- **The engine's own strings are carried verbatim.** `result.sc` -> DEFINITIVE, `result.ref` ->
  ESCALATION, `result.mgmt[]` -> one notes block carried WHOLE. Nothing is regex-split across bands.
- **No prescribing surface.** No SURGX path reaches `SMD_RX.open`.
- **No free-text AI chat.** SURGX has no chatbot surface anywhere.
- **No gamification.** No streaks, badges or trophies (owner brief). Progress exists only to resume.
- **Case scoring is not a single percentage.** Safety misses are reported separately: a trainee who
  reaches the right answer past a missed red flag got the answer right and the encounter wrong.
- **Notes never leave the device.** There is no SURGX note endpoint, by design.

## Gotchas
- **BUMP `?v=` ON EVERY EXISTING FILE YOU EDIT.** SURGX edits `home.js`, `sidebar-redesign.js` and
  `workspaces.js`; all three tokens now carry a `surgx` marker and
  `test/surgx-content.test.mjs` FAILS if one loses it. This is the CliniX incident (module present
  and working on the device, no tile and no toggle to reach it with).
- **`scripts/build-www.sh` needs the explicit `cp -R surgx`** - root `*.js`/`*.css` are globbed, data
  dirs are not. Asserted by a test.
- **Load order is load-bearing**: flags -> model -> content -> note-schema -> store -> entitlement ->
  evidence -> diagrams -> screens -> surgx.js. Asserted by a test. `ws-surgery.js` must load first.
- **Content JSON is fetched with `?v=<contentVersion>`** from `surgx/manifest.json`, which is itself
  fetched `cache:"no-store"`. Without this a content update can never reach a cached device.
  **[[CliniX]] does NOT do this yet and has the same exposure** - worth fixing there.
- The CDP helper `ev()` wraps its argument in `return (...)`, so a multi-statement snippet must be an
  IIFE expression. Getting it wrong fails SILENTLY: the statement never runs and the assertion
  reports a product bug that does not exist. This cost a debugging cycle during the build.
- `home.js` loads BEFORE the SURGX block, so `HOME_TOOLS` `eligible()` reads `localStorage` directly
  rather than `SMD_SURGX_FLAGS` (the ThoreX/CliniX pattern).
- The tile badge is an inline SVG, not a Material ligature, so it cannot depend on a glyph being in
  the font subset.

## AI wiring (all additive, all metered separately)
- `functions/_ai_usage.js` - `surgx_note` (30/day) and `surgx_case` (40/day). Separate buckets so a
  surgeon's documentation load never eats their clinical MaiK allowance, and the admin console can
  tell them apart. Same rationale as the `clinix` bucket.
- `functions/api/ai/[[path]].js` - `extract` kind `"surgx-note"`; `mode:"surgx-mentor"` remapped to
  `surgx_case` at the same place and shape as the existing `clinix-tutor` remap.
- **MVP uses none of it.** Typed notes work with zero AI calls; cases run entirely on authored
  reasoning. The AI path is built, tested and off.

## Status
- **MVP built.** 105 unit tests + 96 real-browser checks green, against both the repo and the built
  `www/` bundle. Full suite: 11 failing files before and after, identical set (zero regression,
  verified against `pre-surgx` in a clean worktree).
- **Content: `ai_drafted`, NOT approved.** 8 authored protocols, 13 engine overlays, 5 procedures
  (37 shared steps), 3 cases, 15 evidence records. Every one cites a real, dated source.
  **The owner flips `review.status` after clinical review; until then `smd_surgx_draft` is what
  makes it visible to testers, and every screen says so.**
- **Media: 5 cleared, all self-authored inline SVG.** 3 entries are the sourcing work order.

Deps: `ws-surgery.js` / [[Home|workspaces]] (the protocol engine) · [[CliniX]] (the content
architecture this copies) · [[MaiK]] (Evidence Review, and Phase 2 mentor) · [[AI Control Center]]
(the two new buckets) · `MEDCALC` (calculator deep links) · `SMD_CLINIC_CRYPTO` (note encryption) ·
`SMD_RX.canPrescribe` (the Notes role gate).
