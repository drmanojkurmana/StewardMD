---
tags: [module, surgery, education, documentation]
status: RELEASED to all users 2026-09-25 (owner decision), no longer labelled Beta; MVP built; ALL OPEN 2026-09-28 (owner decision): review gate always open, no draft/pending notices
flag: smd_surgx (client, def:true for all users, ?surgx=0 hides) + smd_surgx_draft (def:true, legacy, no longer affects rendering) + smd_surgx_notes (def:true, role-gated at runtime) + smd_surgx_mentor (def:true) + smd_surgx_uncleared_media (def:false, licence gate; owner call pending) + smd_surgx_haptics (def:true) + smd_surgx_dest_drive/_emr (def:true) + smd_surgx_notes_verify (def:false, its ON state is a lock)
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

**Owner decision 2026-09-28 (explicit, final, owner takes responsibility):** "Keep everything open.
Remove every draft note and pending note. Keep everything turned on by default." Review gate always
open (only `deprecated` hidden); the "Draft, pending clinician review" pill, the "awaiting clinical
review / sign-off" empty states and the pending-steps banner are removed (genuine load failures now
say "could not be loaded"); every SURGX flag defaults ON except `smd_surgx_notes_verify` (ON = lock).
Unfinalised operative notes are still stamped DRAFT: that is the note verification gate, not review.

## The three gates (each fails CLOSED, each has a test both ways)
1. **REVIEW** - ALWAYS OPEN since 2026-09-28: every status renders, only `deprecated` is withheld,
   regardless of `smd_surgx_draft` or a missing flags module (`gateOpts().allowDraft` is hard-wired).
   Missing or garbled still reads as `draft` (and renders).
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

## Save destinations (Notes) — added 2026-08-24

`surgx-destinations.js` → `window.SMD_SURGX_DEST`. Three destinations offered in the note editor
under a "Save to" card (inline, NOT an overlay — deliberately, to avoid another stacking context).

| id | flag | state |
|----|------|-------|
| `local` | — | works. AES-256-GCM via surgx-store.js. **System of record.** |
| `drive` | `smd_surgx_dest_drive` (def **true**) | works on device. Doctor's own Drive, readable `.txt` in a "StewardMD Surgical Notes" folder. Native only (`SMD_getDriveToken` is null on web). |
| `emr` | `smd_surgx_dest_emr` (def **true**) | **LIVE** (server gate permitting). Appends the note to the Initial Assessment's **Management plan** via the same verified `saveAssessment` transport as OPD. Needs a GHIS session + a ward patient opened (for `episodeId`) + `QUEUE_EMR_WRITE=1`. |

**Local is always written first**, on every destination — the exports layer on top of a successful
local save, so a failed upload can never lose an operative note.

## Notes BACKUP + RESTORE (Drive) — added 2026-08-26

`surgx-backup.js` → `window.SMD_SURGX_BACKUP`. Distinct from the `drive` destination above: that one
writes a **readable `.txt` per note** for a human, which the app cannot read back. This is the round
trip, and it exists because **notes do not survive a reinstall** (every native install is a new
container; two notes have been lost that way).

- **END-TO-END ENCRYPTED with the surgeon's own password** (the WhatsApp model), added 2026-08-26:
  `password --PBKDF2-SHA256, 200k, fresh 16-byte salt per backup--> AES-256-GCM`, derived by
  `SMD_CLINIC_CRYPTO` — the SAME adapter personal-clinic and shared-clinic sync use, so there is
  still exactly one place that decides how StewardMD derives a key. **No new crypto was written.**
- **Google stores ciphertext.** Outside the encrypted payload there is only what a restore needs
  before it can derive a key: envelope version, KDF parameters, salt, and a timestamp for the UI.
  No note text, no label, no patient reference, no account id, **and not even the note count** (that
  would leak clinical volume). Asserted by searching the actual uploaded bytes.
- **There is no escrow and no reset.** StewardMD never sees the password and stores it nowhere; a
  lost password means an unrecoverable backup. Hence: confirmed twice before the first backup,
  minimum 8 characters, leading/trailing spaces refused (easy to lose when retyping months later) —
  all caught BEFORE anything is written.
- **Refusals that matter as much as the encryption:** a PLAINTEXT file is refused on read (there is
  no unencrypted format to fall back to, so a hand-written note dump can never be imported); a
  backup asking for WEAKER key stretching is refused (otherwise anyone who can write to the folder
  could downgrade the KDF and hand it back); a wrong password fails the AES-GCM tag, so it cannot
  yield plausible-looking notes, and nothing is half-restored.
- **One file**, `StewardMD-SURGX-notes-backup.smdbk` (not `.json` — it is ciphertext and the name
  should not invite a text editor), in the same "StewardMD Surgical Notes" folder, **updated in
  place (PATCH)** so a surgeon's Drive does not fill with dated duplicates.
- **It carries note BODIES, not the DEVICE ciphertext, and that is deliberate.** `surgx-store.js`
  encrypts with a per-device, per-account random secret in `localStorage`; a reinstall wipes that
  secret — the very event this backup exists to survive — so device ciphertext would be permanently
  unreadable. The bodies are re-encrypted under the password for transit, and restoring re-encrypts
  them under the NEW device secret.
- **The PHI posture is unchanged, and constrained the design:** `confirmed:true` at the API for both
  directions, plus the arm-then-act double press in the UI (the `armSignOff()` discipline). Nothing
  runs on a timer, on save, or in the background — **there is still no silent upload path, and no
  auto-sync.** Adding continuous sync would be a deliberate change to this posture, not a tweak.
- **Restore is additive and cannot lose work.** A device note is replaced only when the backup copy
  is *strictly* newer (`updatedAt`); equal timestamps SKIP, so a repeat restore writes nothing and a
  restore onto a working device cannot roll back newer edits.
- Drive token + folder come from `SMD_SURGX_DEST` (now exported) — one Drive integration, not two.
- A note that will not decrypt is **reported** in the result, never silently dropped from a file
  presented as complete.
- Tests: `test/surgx-backup.test.mjs` (18 — merge rules, password rules, leakage, wrong password,
  weak-KDF and plaintext refusal, plus a REAL encrypt/decrypt round trip against the actual PBKDF2 +
  AES-GCM adapter: back up → wipe the device → restore → readable again) +
  `test/run-surgx-backup-ui.mjs` (one tap opens the password form and sends nothing; the uploaded
  bytes carry no note text).
- **Gotcha for whoever writes the next leakage test:** do not assert that a SHORT string is absent
  from the uploaded bytes. Random base64 ciphertext contains a two-character note id by chance, and
  the test fails intermittently for a reason unrelated to leakage. Use a long, distinctive fixture id.

**The Notes banner was corrected**: it said notes are "never uploaded", which stops being true the
moment the surgeon taps Back up. It now says the only copy that leaves is a backup they ask for.

### How the EMR write works (2026-08-24)
GHIS has no captured operative-note form, so rather than invent an endpoint the note is **appended
to `assessment.management_plan`** on the patient's own visit, through `saveAssessment` - the exact
transport the OPD EMR connect uses. Everything that makes that safe applies unchanged: visit
activation, re-serialising the live form for the authoritative `doc_id`, the `patient_id` mismatch
abort, and the `doc_id 0` refusal.

**APPEND, never overlay.** `saveAssessment` gained `appendFields` (alongside the existing
overwriting `fields`). OPD may overwrite `management_plan` because the doctor is looking at its
current value; a note posted from SURGX is not, so replacing it would silently destroy the treating
doctor's plan. The pure `appendText(cur, add)` helper is exported and unit-tested: keeps the
existing value, separates with a blank line, and is **idempotent** so a double-tap or retry cannot
write the note twice.

**Requires `episodeId`.** An Initial Assessment attaches to a VISIT; without it the form GET returns
a blank `doc_id 0` and the server refuses (correctly) rather than creating an orphan record.
`GHIS._selectedPatient` did not store `episodeId` - `getSelectedPatient()` and the `SMD_WATCH` call
site were reading a field that was **always `undefined`**. Now stored in `openLab()` and exposed.

**Still server-gated by `QUEUE_EMR_WRITE=1`.** The client flag only controls whether the option is
OFFERED; it can never by itself write to a live record.

### PHI posture
Notes carry patient identifiers (`patientRef` is required + `phi:true`). Every non-local send needs
`confirmed:true` AND a second in-UI tap; there is no silent/background upload path. The patient
reference never appears in a Drive **filename** (filenames leak into search results, "shared with
me" lists and notification emails — a wider audience than the file itself).

## Gotcha: deep-linked calculators need a z-index lift
`.mc-overlay` is z-index **870**; the SURGX overlay is **1255**. A calculator opened from a score
chip renders *underneath* SURGX — fully working and completely invisible, which reads as "the
calculator links are broken". Fixed by `html.sgx-lock .mc-overlay { z-index: 1300 }` in surgx.css,
scoped to the class surgx.js adds on open/removes on close so it reverts itself.

## Gotcha: calculator ids are not greppable
`calcChips()` is fail-soft — an id the catalog lacks is silently skipped, no error. `asa`, `iss` and
`tbsa` shipped dead this way. `asa` looks valid to a naive grep because it is an **input field** id
*inside* another calculator; only top-level entries (`{ id:"x", cat:...`) are real calculators.
`test/surgx-calc-links.test.mjs` now resolves every id against the parsed catalog.

## Patient linking (Notes) — added 2026-08-25

`surgx-patient.js` → `window.SMD_SURGX_PATIENT`. A "Patient" card at the top of the note editor,
two routes:

- **From a hospital EMR** — one list with **GHIS (GIMSR) alongside every Connect-onboarded tenant**
  (`SMD_CONNECT.tenants()`), the same presentation `connect-patient.js`'s admit chooser uses. GHIS
  adopts the patient already open in Ward Sync (that is where the roster + visit context live);
  a Connect hospital opens an inline search (`SMD_CONNECT.searchPatients`).
- **Enter manually** — a free-text reference, for a surgeon working alone with no hospital EMR.

The link `{source, tenantId, patientId, episodeId, name}` rides on the note and is persisted
**inside the encrypted body** (`surgx-store.js`), never in the plaintext note index.

### Writability is decided in ONE place
`SMD_SURGX_PATIENT.writability(link)` — the picker, the EMR row and the error text all read it, so
they cannot disagree:

| source | writable | why |
|--------|----------|-----|
| `ghis` + `episodeId` | **yes** | the only verified write path |
| `ghis` without a visit | no | an assessment attaches to a VISIT |
| `connect` | no | Connect is **pull-only** — no note write-back endpoint exists |
| `manual` | no | there is no hospital record to write to |

`saveToEmr` checks the SOURCE before the id: a manual patient has no `patientId` by definition, and
"no patient selected" would be a wrong and confusing thing to tell that surgeon.

**The note's own linked patient wins over whoever is open in Ward Sync** — a note written this
morning must never be filed against the patient opened this afternoon. Notes predating patient
linking still fall back to the ward selection.

## EMR write gate — CONFIRMED LIVE (2026-08-25)
`QUEUE_EMR_WRITE = "1"` is set in `wrangler.toml` `[env.production.vars]` (this file IS the Pages
config for project `stewardmd`). Verified against production, not assumed: a POST to
`/api/ghis/assessment-save` with an invalid token returns **401 login_required**, not 501 — so the
write gate is open and the request only failed on auth. Probe writes nothing (no valid session).

- **Iso figure (2026-10-12):** see [[Iso Figures]] for the isometric equipment figure shown here, its flag `smd_iso` and tests.

## iPad (2026-11-04)
`ipad-care.css` lays out the hub as a grid and lists in two columns on `html.smd-tablet` at 700 px and wider. In landscape
(tablet, 1000 px and wider) `surgx-screens.js` `noteSplit()` renders an open note beside the "On this device" list
(`data-sgx="noteswap"` replaces the route, no deeper stack). It only reads `listNotes()`; no storage code changed.

## Every surgical specialty (2026-11-04)
After the 2026-11-04 audit (5.5/10, general surgery only), content covers 16 specialties: general/GI/HPB, trauma,
peri-operative care, ENT, eye emergencies, urology, neurosurgery, orthopaedics, plastics, vascular, cardiothoracic,
paediatric surgery, O&G, surgical oncology, breast, endocrine. Totals: 97 protocols (84 authored + 13 engine),
38 procedures, 19 cases, 64 evidence records, 13 step packs. Everything new is `ai_drafted`.
Round 2 (2026-11-05, operations only): 70 more procedures, so **108 procedures** and 19 step packs
(new: `hernia`, `anorectal`, `hpb`, `hand`, `thoracic`, `neck`; others appended to, never edited). Each 15 to 22 steps,
every chapter filled, a bail-out step, a note template; per-set step reuse 71 to 84%.
- **`specialty`** on every manifest entry; `manifest.specialties[]` and `manifest.categories[]` hold the titles, so a new
  specialty needs no code. `surgx-content.js` passes `specialty` through `protocolIndex()`.
- **Browsing:** `surgx-screens.js` `browseBar()` (search + specialty chips), `rowsBySpec()`. One `state.spec` /
  `state.find` shared by Protocols, Procedures and Cases. A picked specialty groups protocols by category.
- **Step packs per specialty** (`steps/ent.json`, `urology.json`, `neuro.json`, `ortho.json`, `vascular.json`,
  `paeds.json`, `obgyn.json`, `onco.json`, `bowel.json`): the 60% reuse rule still holds (each set measured 68 to 86%).
- **Operative note templates** for every procedure (generated block in `surgx-note-schema.js` between the
  "specialty templates" markers). A template must never repeat a base field key: the LSCS template once re-declared
  `ebl` and the note showed blood loss twice (`test/surgx-specialties.test.mjs` now fails on that).
- **WHO Surgical Safety Checklist** in the operative note: 11 `type:"choice"` fields, all `aiFillable:false` and on the
  server `NEVER_AI_FILLABLE` list. Identity, time out and sign out are required. "Not done" is recordable on purpose.
- **Clavien-Dindo** `clavienDindo` choice on post-op and discharge notes, never AI-filled.
- **`type:"choice"`** renders tap targets (`data-sgx="choice"`); the value is a plain string, so completeness, provenance
  and `renderNoteText()` are unchanged. A tap sets provenance `clinician`; tapping the selected option clears it.
- Tests: `test/surgx-specialties.test.mjs` (coverage per specialty, template safety, WHO/Clavien, no em-dash);
  `test/run-surgx-ui.mjs` WHO and SPEC checks. Reviewer flags per specialty are in the PR #1971 description.

## Visual pass: theatre green, anti-slop (2026-11-05)
Owner asked for "a gradient that suits the surgery department" and "remove all UI slop" using the Impeccable,
antislop and Appllama skills. Polish, not a redesign: layout, behaviour and copy are unchanged.
- **Domain hue is theatre green** (`--sgx-steel` keeps its name, now `#0F5E55`; dark `#6CC3B3`). Reason: operating
  theatres use green scrubs and drapes because it is the complement of blood red. Red still means one thing: time-critical.
- **One gradient, behind everything:** `#surgxRoot` paints a drape-green wash (`--sgx-room-top` to `--sgx-room-mid` to
  `--sgx-room-end`) that fades to neutral by 520px. The sticky header uses `--sgx-room-top` so bar and wash read as
  one surface. Cards and text never carry the gradient. The home hero is a deep theatre-green gradient
  (`--sgx-hero-a/b`); `graphite-dark.css` now uses those vars for the dark hero instead of graphite grey.
- **Removed:** section numbers 01 to 05 (mono) on home rows and as a kicker above every screen title; the category now
  sits UNDER the title (`.sgx-hsub`, first letter capitalised). Every uppercase wide-tracked label is sentence case.
  Two 4px left-stripe accents (`.sgx-headline`, `.sgx-stem`) became full hairline borders. Logo drop-shadow removed.
  The protocols info banner icon changed from a lightning bolt (which elsewhere means time-critical) to info.
- **Grouped lists:** consecutive `.sgx-row` / `.sgx-sec` join into one iOS-style grouped list via `:has()`; a WebView
  without `:has()` keeps separate cards. Press state is a background tint, not a scale bounce.
- **Browser surfaces themed:** `::selection`, `caret-color`, `accent-color`, `:focus-visible`, scrollbar.
- Fixed while here: the procedure header double-escaped its specialty ("O&G" would show as "O&amp;G"), and protocol
  headers said only "Protocol" instead of the category title.
- Check: `impeccable detect` on surgx.css and graphite-dark.css returns no findings.

### Second anti-slop pass (2026-11-05, owner: "still looks vibe coded")
Structure, not detail, was the tell. Changed:
- **Home hero card removed.** The boxed dark gradient card became a native large title on the theatre-green wash
  (`.sgx-hero` transparent, logo ink in light / white in dark, wordmark in theatre green). `--sgx-hero-a/b` deleted;
  `graphite-dark.css` now sets the SURGX hero transparent instead of painting it.
- **Protocol items grouped:** consecutive `.sgx-item` in a band join into one list with hairline separators.
- **Meta pills are plain text** (sources, review date, framing): no border, no fill, one line.
- **Explanation banners are footnotes** (`.sgx-banner.info`, `.sgx-banner.sim`: no box). Real warnings keep their box.
- **Tabs** are an underline tab bar on the header colour, not pills.
- **Segmented controls** for exclusive choices: the case level picker and every note `choice` field (WHO checklist,
  Clavien-Dindo). The lock icon is not shown on choice fields: a tap-only field can never be AI-filled.
- **Evidence "Used by"** lists real protocol and operation titles as rows (`itemTitle()`), not raw ids on pills.
- Case vitals read as label over value (tabular numbers, sans), not mono pills; phase label capitalised.
- Radii 12 / 10 (was 16 / 12).

## Home in the CliniX pattern (owner 2026-11-11)
Home has no top bar: `screenHome()` renders the hero with a round floating close button at the top right (`.sgx-hero-close`,
as CliniX `.cx-hero-close`), the monogram inline with the live-text wordmark (`.sgx-hero-logo` is a CSS mask of
`surgx-logo.png` in `--sgx-steel`, so it follows dark mode without a filter), a one-line tagline, a "Sections"
heading and one grouped card (`.sgx-secs`) of rows with icon tiles (`SECTIONS[].icon`). The educational-content
note moved to the footer disclaimer. Inner screens still use `head()` and its sticky bar. CSS block at the end
of `surgx.css`.

## YouTube videos in Procedures (2026-11-20, owner experiment)
Owner asked for YouTube surgery videos in the Steps tab while per-step 3D images (Gemini) are being made.
Appendicectomy first: three `kind:"embed"` entries in `surgx/media/manifest.json` (`med.surgx.appendix-video-*`,
ids `fpTqrJVSxpI`, `H7LyCwzaZEo`; `D1NmYz66D9w` removed 2026-11-20 as an audio podcast with no footage), listed in the procedure's `media.steps`.
- `surgx-screens.js` `mediaBlock()` plays an embed through the CliniX shim `https://stewardmd.in/_site/yt?v=`
  (YouTube rejects the `capacitor://` origin). Each id must be in `_site/yt.html` `ALLOW`, or the shim refuses it.
- Licence gate: a cleared embed must pass `isEmbeddable()` AND be in the shim allow-list
  (`test/surgx-content.test.mjs`). Embedding was confirmed allowed by the uploader via YouTube oEmbed (200, not 401).
  The Nucleus Medical Media animations refuse embedding (401), so they are not used.
- **Not clinically vetted.** The videos were chosen by title and channel; nobody has watched them for accuracy.
  Videos are whole-operation, not per step: chapter timestamps could not be read from here.
- Revert: delete the three media entries and their ids from `media.steps`.
- The shim change is live only once `main` deploys; the app change needs build-www + native rebuild.

## Step pictures (2026-11-20, owner experiment)
Appendicectomy: one AI-generated 3D teaching picture per step (19), made in Gemini from the prompt in this session,
reviewed only by eye. `surgx/media/appendicectomy/*.webp` (1200x900, 852 KB total), registry ids
`med.surgx.app-step-01..19`. Credit line reads "StewardMD original" (owner 2026-11-20); the AI origin is kept in
the entry's `generator` field, not shown. `mediaBlock()` prints the licence only when it differs from the attribution.
- Pictures attach to the PROCEDURE's step reference (`{ "ref": ..., "media": [id] }`), not the shared step, because a
  shared step serves many procedures. `compileProcedure()` concatenates `ref.media` onto the step's own `media`.
- `renderStep()` renders step media when `smd_surgx_step_images` is on (def true, `?surgxstepimg=0` hides).
- Tests: `test/surgx-content.test.mjs` (cleared image must be StewardMD-produced and the file must exist; step-ref
  media ids must exist), `test/run-surgx-ui.mjs` (19 distinct pictures, every file loads).
- Round 2 (owner, same day): 04, 14, 15, 16 regenerated and shipped as `*-v2.webp` (new names so no cached copy is
  shown). Clinician review of all 19 is still owed. 04 still has the arms out.
- **The prompt template and every lesson are in [[SURGX-image-prompt]]. Build the next procedure's prompt from it.**

## Timed step clips (2026-11-20)
Gemini watched V1/V2 and gave per-step timestamps. Steps 4, 7, 9, 10 carry a clip of V2 (`med.surgx.app-clip-NN`,
`start`/`end` seconds) after the step picture. `_site/yt.html` now honours `end=` (YouTube `end` player var).
Not used: V1 at step 8 (low confidence, 5 s), and step 13 from V1/V2 (both pull the appendix out WITHOUT a retrieval
bag, contradicting the step). Gemini's concerns: V2 advises razor shaving nipples to pubis and no retrieval bag;
V1 omits base ligation and the bag. The two whole videos still render after the steps pending the owner's call.

## A video on every step (2026-11-20, owner)
Owner: "videos cannot be the same as the book or guidelines; use video steps where available, search for more where not,
else ignore." So the step 8 (V1 1:07-1:12) and step 13 (V2 3:31-3:50, no retrieval bag, said in the caption) clips are in,
and a focused short video (`med.surgx.app-vid-NN`, found by YouTube search, embeddable per oEmbed, allow-listed in the
shim) covers steps 1, 2, 3, 5, 6, 11, 12, 15, 16, 17, 18, 19. Step 14 (haemostasis) found nothing and has none.
Picked by title and channel only; none watched.

## Batch 2 prompts (2026-11-20)
Lap cholecystectomy, Lichtenstein hernia repair, LSCS and total thyroidectomy (70 steps): [[SURGX-batch2-image-prompt]] and [[SURGX-batch2-video-prompt]].

## Batch 3 prompts (2026-11-20)
Haemorrhoidectomy, tonsillectomy, total knee replacement, laparoscopic right hemicolectomy and TURP (94 steps): [[SURGX-batch3-image-prompt]] and [[SURGX-batch3-video-prompt]].

## Batch 2 video clips (2026-11-20)
Gemini returned 12 videos; all embeddable (oEmbed 200). The best clip per step is wired as `med.surgx.{chole,hern,cs,thyr}-clip-NN` (59 clips); 11 ids added to the `_site/yt.html` ALLOW list (hM-WA6WOw1Y unused). Gaps with no clip: chole 4 and 14, hernia 10, LSCS 4, 11, 12 and 17, thyroid 2, 5, 14 and 15. The safety-step clips come from a WHO checklist video on another operation, and the hernia clips from a bench model; both caveats are in the captions. Thyroid step 11 uses the Columbia animation so it does not duplicate the step 13 clip.

## Batch 3 video clips (2026-11-20)
73 clips as `med.surgx.{hmd,tons,tkr,rhc,turp}-clip-NN`; 13 ids added to the shim ALLOW list. TVASurg 0twYSCkEnYk refuses embedding (oEmbed 401), so right hemicolectomy step 7 uses the Colorectal Disease Journal trocar clip. Changed from Gemini picks: TKR step 4 uses the body-exhaust-suit clip, not hand rub; right hemicolectomy step 14 uses the ZJU-SAH exteriorisation clip so it does not sit inside the step 18 clip. Gaps: haemorrhoidectomy 8, 9, 10, 13, 14; tonsillectomy 11; TKR 10, 11, 12, 14, 16, 18, 19; right hemicolectomy 6, 17, 21, 22; TURP 4, 5, 11, 14.

## Batch 2 step pictures (2026-11-20)
All 70 wired as `med.surgx.{chole,hern,cs,thyr}-step-NN`, WebP 1200x900 q78 in `surgx/media/<procedure>/`. Lap chole 04 and thyroid 05 (positioning) came first as a generic flat table; redrawn as side views from the Round 2 prompt in [[SURGX-batch2-image-prompt]] and wired 2026-11-20 (captions written by hand). Gemini also used near-identical scenes for the shared safety steps (time-out, counts, labelling) across operations; acceptable for generic steps.

## Batch 3 step pictures (2026-11-20)
All 94 wired as `med.surgx.{hmd,tons,tkr,rhc,turp}-step-NN` (WebP 1200x900 q78), picture first then clip on each step. Captions are the prompt's Teach lines; "Common" steps take the COMMON SAFETY STEPS Teach line, positioning steps a sentence from PRECISE FACTS. TURP 09 (lateral lobes) left out: Gemini drew the adenoma yellow and fatty, which reads as perforation fat; Tonsillectomy 04 (the hand on the arm board sits beside the feet; the needle goes into the skin, not the cannula port) and 09 (tube running over the uvula, no capsular plane, swab on the tonsil, left side instead of right) were wired, then pulled after the owner caught them: the first review was done on thumbnails only. Review every image at full size. Tonsil 04 redrawn and wired 2026-11-20. Tonsil 09 and TURP 09 redrawn from a fresh standalone prompt (2026-11-21) and checked at full size; tonsil 09 shipped as 09_capsular-dissection-v2.webp so no cached copy shows. The redo prompts are at the end of [[SURGX-batch3-image-prompt]].

## Gap clips (2026-11-20)
Steps Gemini left without a clip, searched again on YouTube (headless browser search; watch pages ask for a bot check, so no transcripts). 9 new short single-topic videos embedded whole (no start or end), each oEmbed 200 and on the shim ALLOW list: lap chole 4 and TURP 4 (table maker's positioning demos), thyroid 5, LSCS 17 (anti-D), haemorrhoid 8 (sphincter anatomy), TKR 10 (gap balancing), TKR 19 (NV check), TURP 5 (lithotomy draping), TURP 11 (TUR syndrome). 4 reused existing clips: right hemicolectomy 6 (abdominal prep), 21 (port closure), 22 and TKR 18 (subcuticular closure). Not watched; picked by title, channel and thumbnail. Still empty: generic haemostasis steps, LSCS 4 and 11, thyroid 2 and 14, haemorrhoid 9, 10 and 14, tonsil 11, TKR 11, 12 and 14, right hemicolectomy 17, TURP 14.

## Age-restricted videos (2026-11-21)
YouTube oEmbed returns 200 for AGE-RESTRICTED videos, but the embedded player refuses them ("only available on YouTube"). The owner saw this on the phone on appendicectomy step 6 (m5u1kHwGDk8); replaced with Molnlycke's Hasson trocar demo (vBj5vn41Ixs). Check every new video in the real embedded player, not just oEmbed: load https://www.youtube.com/embed/ID in headless Chromium WITH a referer (Playwright goto option referer 'https://stewardmd.in/'; without one every video shows Error 153) and look for 'age-restricted' or 'Playback on other websites has been disabled'. Run over all 47 ids on 2026-11-21: only m5u1kHwGDk8 failed.

## Bold high-yield points in step text (2026-11-21)
Owner asked for Knowledge Library-style bolding on every surgery step. `renderStep` runs `why` and each `how` line through
`rich()` (surgx-screens.js): first reasoning.js `window.SMD_MEDFORMAT` (the library's medFormat; it escapes; plain
`esc()` fallback), then `SGX_BOLD`, a SURGX-only surgical rule set applied to text outside existing spans: measurements
(mm, cm, mmHg, degrees, hours, minutes, mL), "within the hour", "under (direct) vision", "before incision/induction/
closure/...", "aloud", "never event", "stops the closure", "any discrepancy", "two-person", convert/call for help,
"critical view of safety", and a capital NOT. Library rules unchanged. CSS: `.sgx-step [class^="md-"]:not(.md-hi)` bold
ink, never colour (`md-hi` is the last opened article's terms, which would leak in). Pitfall, risk and emphasis lines keep
their own styling. Coverage estimate: 26% of 2,097 steps with library rules alone, about 70% with both; appendicectomy 17/19.

## Batch 4 prompts (2026-11-21)
[[SURGX-batch4-image-prompt]] (93 images) and [[SURGX-batch4-video-prompt]] for laparotomy (19), modified radical
mastectomy (18), total hip replacement (22), total abdominal hysterectomy (22) and chest drain insertion (12). The
image prompt carries every batch 2 and 3 lesson: a NEW side view per positioning step with the angle drawn, bodies whole
and connected, fat yellow only where real fat is, laterality per operation, a full-size quality check. The video prompt
forbids age-restricted videos and whole-video clips and asks for the first and last spoken line of every clip.

## Whole videos cut to segments (2026-11-21)
Owner: a 11-minute video played in full instead of the step. Gemini timed all 21 whole-video clips (prompt in chat, its
JSON quotes the first and last spoken line of each); every clip now has `start` and `end`. Two replaced because no part
showed the step: appendicectomy 6 -> Bhm7cCcr1Qc (TAMC OBGYN Simulation, Hasson entry), port closure (app-vid-17, also
right hemicolectomy 21) -> h5D8sU8btyI (CooperSurgical). Both pass the real embedded-player check; the old ids left the
ALLOW list. Timestamps are Gemini's; not re-verified here (transcript reading from YouTube's player is blocked in this
environment). Thyroid 5 caption now says the narration is Hindi and Urdu.

## Batch 4 wired (2026-11-21)
Clips: 91 of 93 steps (`med.surgx.{lapa,mrm,thr,tah,cd}-clip-NN`), every video checked in the real embedded player with a
referrer; TVASurg GthlK0Bv0aI refuses embedding, so mastectomy 10 and 11 use the PreOp animation and Prof Chintamani's
operative clip. Left empty: mastectomy 9 (Gemini found nothing) and chest drain 7 (the only Seldinger clip is done
bare-handed with the LA needle left in as a guide). Pictures: 88 of 93 (`med.surgx.<ab>-step-NN`), every image reviewed at
half resolution and doubtful ones at full size. Held back: mastectomy 5 (arm not at 90 degrees), hip 12 (a bare pelvis
in the wound), hip 16 (patient supine, crack barely visible), hysterectomy 5 (only the leg section raised, not a
head-down tilt), chest drain 9 (drain on the left). Redo prompt at the end of [[SURGX-batch4-image-prompt]]. The Gemini
zips had no folders inside: extract each into its own folder or same-named files overwrite each other.

## Batch 5 prompts (2026-11-21)
[[SURGX-batch5-image-prompt]] (92 images) and [[SURGX-batch5-video-prompt]] for the neurosurgery set: burr-hole CSDH (16),
trauma craniotomy for EDH (20), EVD at Kocher point (17), VP shunt (22) and lumbar discectomy for CES (17). All cranial
cases are RIGHT-sided; the prompt fixes the field orientation per operation, states CT/MRI in radiological convention
(a right-sided clot on the LEFT of the scan), and asks for a folder inside each zip. Same block format as batch 4, so
`img4.py` parses it; D05 (head fixation) has no Teach line and needs a hand-written caption like the positioning steps.

## Batch 5 clips wired (2026-11-21)
79 timed clips across the neurosurgery set (`med.surgx.{csdh,edh,evd,vps,ces}-clip-NN`): CSDH 14 of 16, EDH 17 of 20,
EVD 15 of 17, VP shunt 19 of 22, CES 14 of 17. All 19 videos pass the real embedded-player check with a referrer; 17 new
ALLOW ids. Dropped from Gemini's answer: EDH 14 (same tack-up clip as 15, not a duraplasty), EVD 15 (same one-line clip
as 12), VP shunt 11 (low-confidence patient diagram), CES 15 (low confidence, closure only mentioned); EDH 4 and VP 4 moved
to the standard checklist prophylaxis clip. Gemini found nothing for CSDH 11 (drain), EDH 8 (scalp flap), EVD 5
(positioning), VP 18 (bailout), VP 20 (closure), CES 6 (prep) and CES 13 (haemostasis), or the skin closures. Much of the
set is lectures, skull models and animation: few embeddable live cranial videos exist that are not age-restricted.

## Batch 5 pictures wired (2026-11-21)
86 of 92 (`med.surgx.{csdh,edh,evd,vps,ces}-step-NN`), every image reviewed four to a sheet at half size and the doubtful
ones at full size. Held back: CSDH 05, EDH 05 and VP 05 (head straight up, not turned), EDH 09 (a dry skull with the orbit
and facial bones inside the wound), EVD 10 (catheter tip bent into a hook), VP 13 (a different patient). Redo prompt at
the end of [[SURGX-batch5-image-prompt]]. The zips again had no folders inside; extracted per operation.

## Batch 4 complete (2026-11-21)
Round 3 redraws wired: hip 12 cropped to the wound (trial head in the cup, femur running on under the muscle; the wide
view lifted the leg straight up, which reads as abduction, not 90 degrees of flexion with internal rotation) and
hysterectomy 5 (whole table tilted head down, legs flat on the table; the tilt is only about 5 degrees, milder than the
10 to 15 asked). All 93 batch 4 steps now have a picture.

## Batch 5 complete (2026-11-21)
Round 2 redraws all passed full-size review and are wired: CSDH 05, EDH 05 and VP 05 (viewed from the foot, face turned
to the left, roll under the right shoulder), EDH 09 (flat skull bone only), EVD 10 (straight catheter to the frontal
horn), VP 13 (same patient). All 92 batch 5 steps now have a picture.

## Round 3: eye operations and the remaining gaps (2026-11-21)
Owner: "What about ophthalmology surgeries like cataract, PRK" then "build rest, ignore MDS" (oral and maxillofacial
left out on purpose). 20 new procedures, so **128 procedures**, all `ai_drafted`:
- **Ophthalmology (13):** phacoemulsification, manual SICS, trabeculectomy with MMC, PRK, LASIK, pterygium with
  conjunctival autograft, intravitreal anti-VEGF, external DCR, chalazion I and C, corneal and subtarsal foreign body,
  evisceration, strabismus recession and resection, pars plana vitrectomy (awareness level).
- **Transplant (2, under urology):** kidney transplant recipient, laparoscopic living donor nephrectomy (THOTA 1994
  authorisation in the donor check; transfixing stapler on the donor artery, never non-transfixing clips).
- **Cardiac (2):** surgical AVR (outline level, like CABG), subxiphoid pericardial window (induce only with the surgeon
  scrubbed in tamponade).
- **Plastics (3):** escharotomy, rhomboid (Limberg) flap, unilateral cleft lip repair.
- New shared pack `steps/eye.json` (14 steps: anaesthesia, povidone-iodine 5%, speculum, biometry/IOL check,
  intracameral antibiotic, wound check, PCR and suprachoroidal haemorrhage bailouts, peritomy and closure, refractive
  check, excimer ablation, laser interruption, shield and warning signs). Reuse: new 20 at 70%, overall 77%.
- Specialty `ophthalmology` retitled "Ophthalmology" (was "Eye emergencies") and added to `MUST_HAVE_PROCEDURES`.
- 20 operative note templates (eye side, implant sticker, MMC time, ABO and crossmatch, ischaemia times, prosthesis).
- UI test: the Ophthalmology chip lists 13 operations and phaco opens with its 20 steps.
- No pictures or clips yet; these are candidates for the next Gemini batches. Need ophthalmologist, transplant,
  cardiac and plastics sign-off.

## Batches 6 and 7 prompts (2026-11-21)
[[SURGX-batch6-image-prompt]] (105 images: phaco, SICS, trabeculectomy, PRK, LASIK, pterygium) and
[[SURGX-batch7-image-prompt]] (102 images: intravitreal injection, DCR, chalazion, foreign body, evisceration,
strabismus, vitrectomy), each with a video prompt. Scene lines are generated from the step's own `how`, `why` and
`pitfalls` by scratchpad `gen/prompts.py`; orientation, positioning and precise facts are hand-written. Convention: the
RIGHT eye, microscope views with the forehead at the top and the nose on the viewer's RIGHT. Operations use letters A to
G, so the wiring regex needs `[A-G]` (batch 4 script used `[A-E]`). Still without prompts: kidney transplant, donor
nephrectomy, AVR, pericardial window, escharotomy, rhomboid flap, cleft lip (128 steps).

## Batch 7 clips wired (2026-11-21)
83 timed clips (`med.surgx.{ivi,dcr,chal,fb,evis,strab,ppv}-clip-NN`): intravitreal 11 of 11, DCR 12 of 16, chalazion
10 of 11, foreign body 10 of 10, evisceration 13 of 19, strabismus 14 of 19, vitrectomy 13 of 16. All 24 videos pass the
real-player check; 21 new ALLOW ids. Not used: the chalazion consent and aftercare talking-head clip (a TikTok
re-upload), the evisceration speculum clip (same animation segment as the keratectomy). Captions flag the left-eye
footage (lid eversion, vitrectomy, DCR local), the model eye and 20G needle (foreign body), and the patient animations.
Empty: positioning, speculum and povidone in most of them, DCR bailout and haemostasis, squint lost-muscle bailout,
vitrectomy wound check.

## Batch 6 clips wired (2026-11-21)
104 timed clips (`med.surgx.{phaco,sics,trab,prk,lasik,ptg}-clip-NN`): phaco 20 of 20, SICS 20 of 20, trabeculectomy 19
of 19, PRK 14 of 14, LASIK 15 of 15, pterygium 16 of 17. Gemini's JSON was saved as a file (`in6/b6v.json` in the
scratchpad) and wired by `wire6v.py` straight from each step's best clip, with overrides. The Ochsner checklist video
(7E1ivPB_zn0) failed the real-player check, so its timeout, count and debrief clips use the Gloucestershire one; the
trabeculectomy suprachoroidal clip (choroidal drainage, later management) was replaced by the stop-and-close chalk-talk.
Captions flag the left-eye pterygium footage, the LASIK flap relift, the Hindi MMC preparation, and lectures that quote
3% or 4% povidone-iodine. A channel name from oEmbed carried an em-dash; replaced with a comma.

## Batch 6 pictures, part A (2026-11-21)
56 of 59 wired (phaco 20, SICS 17, trabeculectomy 19; `med.surgx.{phaco,sics,trab}-step-NN`) via scratchpad
`img6.py` (letters A to G, eye-specific prep-drape caption). Held back SICS 10, 14, 15; redo prompt at the end of
[[SURGX-batch6-image-prompt]]. PRK, LASIK and pterygium images not yet received.
Part B (same day): PRK 14 of 14, LASIK 13 of 15, pterygium 16 of 17 wired via `img6b.py`; batch 6 now 99 of 105.
Held back LASIK 09, LASIK 12, pterygium 12 (second redo prompt in [[SURGX-batch6-image-prompt]]).
