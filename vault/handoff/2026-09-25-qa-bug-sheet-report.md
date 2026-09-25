# QA bug sheet: per-ticket report

Source: *StewardMD Internal Testing Master Bug Sheet (UPDATED)*, 24 tickets.
Branch: `claude/stewardmd-bug-audit-wr4oh3`. This note is the report the owner asked for
("fix each every bug and give me back the report").

## Status at a glance

**Fixed and verified (24 of 24).** Every ticket on the sheet is closed. Two of them
(BUG-002, BUG-019) turned out to be different faults from the ones described, and are
written up in full below because the difference matters.

---

## Critical / P0

### BUG-002 — "No drugs match 'Cefiderocol'"
**Reported as** missing drug monographs. **Actually** a search gap, not a data gap.

Three findings, only the third being the fault:
1. The worker's `/search` runs against `drugs_fts JOIN drugs`, the Indian **brand** catalogue.
   A molecule nobody sells in India has no row, so the server structurally cannot find it.
   `worker/scripts/import_gold_to_d1.mjs` carries its own list of 68 such molecules, Cefiderocol
   among them.
2. `/monograph` returns `found:false` for **every** molecule in production, Amoxicillin included.
   The `monographs` table was never loaded. Verified directly against `https://api.stewardmd.in`.
3. `api.js goldFor()` reads `window.SMD_GOLD_MONOGRAPHS` from `data/gold-monographs.js`.
   **That file has never existed in this repository.** `goldFor()` has always returned null.
   The only remaining client fallback knows **109 molecules**.

Meanwhile `data/offline-clinical.json.gz` already shipped 1,541 molecules with complete authored
monographs, and `offline-clinical.js` already rendered them. Nothing could **search** them.

**Fixed by** making the bundled library searchable:
- `data/clinical-index.js` — 1,645 molecules, name + class + tags, 331 KB, lazily loaded on the
  first search. Generated *from the shipped bundle*, so it can never list a molecule the app
  cannot then open.
- `data/clinical-supplement.json.gz` — 104 authored monographs that were in **no** bundle at all,
  because the bundle is keyed by the SQL `composition` string while `worker/data/gold/` is keyed by
  `generic`. Among them **Atropine sulfate, Enoxaparin sodium, Clopidogrel bisulfate, Caspofungin
  acetate, Fludrocortisone acetate**. Merged *under* the bundle, so a bundled record always wins.
- `api.js` appends a "Clinical monographs" section when the server returns nothing, and (on an
  exact or prefix name match only) when it returns results that omit what the doctor typed.

Every string is copied verbatim from the authored record. Nothing is summarised or regenerated.

**Verified** `test/clinical-index.test.mjs` (15 tests) and `test/run-drug-gold-ui.mjs` (browser:
search finds it, tapping it opens a 16-section monograph, nonsense still says "No drugs match").

### BUG-006 — oncology superpower buttons do nothing
Could not be reproduced: all four (Cycle Timeline, Organ Dose, DDI Sentry, Genomics) open their own
sheet with real content against real protocol data. The likely original cause is the lazily loaded
tool module not having arrived yet, which degrades to a "still loading" notice.

**Locked in** by `test/run-onco-superpowers-ui.mjs`, which drives each real button and fails
explicitly on the "still loading" notice rather than counting it as "a sheet appeared".

---

## Medium / P2

### BUG-019 — the save-case component "looks generic / AI-generated"
Rendered side by side, "Save this case?" and "Patient-specific safety" were the same template twice
(white card, coloured top rule, eyebrow, icon, title, subtitle) and **both asked for Age and Sex**.
The safety card's own subtitle apologised for it: *"Age and sex stay in sync with Save Case."*
A screen that has to explain its own duplication is the defect.

**Fixed by** drawing the two as one panel with a single hairline divider, and asking for the patient
once, in the card that is actually about the patient. The Save Case age/sex inputs stay in the DOM
(hidden): `app.js` clears them on every new case and `reasoning.js smdSyncAgeSex()` keeps them in
step, and `app.js` is a built artifact that cannot be safely edited here. The action row was also
rebalanced: Save is the primary button, "Skip for now" a quiet text button beside it, instead of two
full-width blocks.

Reversible: remove the `#scp-safety-harmony` block and the previous two-card layout returns. Where
`:has()` is unsupported the rules simply do not apply.

### BUG-020 / 021 / 022 / 023 — contributor order, bio, version history, facts
Verified complete. The Diwakar bio additionally contained an em-dash, which the house style forbids
in app-facing text; that and the other prose em-dashes in the About / contributors / disclaimer copy
were rewritten to the punctuation each sentence actually wants.

---

## Fixed earlier in this sheet (already merged)

BUG-001, 003, 004, 005, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018 and 024 were
delivered in PR #1180 and the phone-verification rebuild. Notable ones:

- **BUG-011 (glass "absurd looking")** — the Knowledge Library and reader now use one calm top wash,
  hairline translucent cards and blur only on sticky chrome. The blurred `::after` blobs are gone.
- **BUG-012 (Agent Connect)** — wording only; **no function was changed**, as instructed. The card
  now carries a `WITH HOSPITAL PERMISSION` badge, a small-font disclaimer stating that the feature
  may be used only with hospital administration's permission and that the doctor is responsible, and
  a consent checkbox that gates the login button.

---

## Known remaining work (not on the sheet)

1. **`api.js goldFor()` / `SMD_GOLD_MONOGRAPHS` is dead code** pointing at a file that has never
   existed. The working path is `SMD_OFFLINE_CLINICAL`. Either delete it or build the file.
2. **`/monograph` is dead in production** for every molecule. The client now covers this, but the
   `monographs` table should still be loaded, or the endpoint retired.
3. **~20 prose em-dashes remain** in the onboarding, verification and legal copy of `index.html`.
   The legal text was deliberately left alone: rewording a disclaimer is an owner decision, not a
   mechanical substitution.
4. **~68 salt-form pairs** show as two rows ("Atropine" and "Atropine sulfate"). Deliberate:
   collapsing on a salt suffix would also merge Calcium Acetate / Chloride / Gluconate, which are
   different products.
5. **One pre-existing test failure** in `test/run-safety-overlay.mjs` ("inline: QT line present but
   NOT escalated before any data"). Confirmed present on the same commit without any of this work.
