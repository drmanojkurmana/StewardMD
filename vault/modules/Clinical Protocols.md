---
tags: [module, kb, clinical-content]
status: built 2026-09-25 (flag ON). Content ai_drafted, PENDING clinical review.
flag: smd_kb_protocols (client, def:true, ?kbproto=0 hides it)
---
# Clinical Protocols (Knowledge Library "Protocols" tab)

Bedside protocols for every specialty (sepsis, DKA, STEMI, stroke, snakebite, PPH, neonatal
resuscitation, ...), as a fifth tab in the [[Knowledge Library]] beside Syndromes, Antibiogram, AWaRe
and Guidelines. Also found by [[Universal Search]] (category "Protocols").

**Not the OPD Protocol tab.** The OPD EMR "Protocol" tab (`opd-emr.js protocolTab`) is the ONCOLOGY
regimen library (`kb/protocols/*.json`, flag `smd_onco_protocols`), which assigns a dosed chemo plan to
a patient. This module is reference content only: it never writes to a patient record.

## Key files
- `kb/clinical-protocols/<id>.json` - one protocol per file. Content as data.
- `kb/clinical-protocols/index.json` - GENERATED catalogue (never hand-edit).
- `scripts/build-clinical-protocols.mjs` - the schema (header comment), validator and index builder.
  `--validate [ids]` checks files only; no flag = validate + write index + sync the version;
  `--check` = fail if anything is stale.
- `kb-protocols.js` - the tab: list (subject rail, search), reader, deep link `SMD_KBPROTO.open({id})`.
- `kb-protocols.css` - protocol-specific styles on top of the shared `.kblib-tool-page` system.
- `kb-protocols-flags.js` - `smd_kb_protocols`.
- `search.js` - `protoProvider` (Universal Search category `proto`).
- Tests: `test/kb-clinical-protocols.test.mjs` (schema, catalogue freshness, version sync, search,
  wiring), `test/run-kb-protocols-ui.mjs` (headless Chrome against the real `index.html`).

## Adding or editing a protocol
1. Write/edit `kb/clinical-protocols/<id>.json` per the schema in the build script header.
2. `node scripts/build-clinical-protocols.mjs` (rewrites `index.json`, `CONTENT_V` in
   `kb-protocols.js` and the `kb-protocols.js?v=` token in `index.html`).
3. `node --test test/kb-clinical-protocols.test.mjs` and `node test/run-kb-protocols-ui.mjs`.
4. Native: `build-www` copies `kb/clinical-protocols/*.json` (step 5 of `scripts/build-www.sh`).

## Gotchas
- **Cache busting is by content hash.** `sw.js` caches static files by full URL, so the index and
  every protocol are fetched with `?v=CONTENT_V`. Forgetting the build step after a content edit means
  devices keep the old text; the unit test fails if `CONTENT_V` or the `index.html` token drifts.
- **How the tab joins app.js.** `app.js` (minified, no source) renders only four tabs. This module
  wraps `SB.openRef` ("protocols" renders here) and a `MutationObserver` on `#sbrefBody` appends the
  fifth button whenever app.js re-renders the row (including `SB.abgOrg`).
- **Tab row width.** Five equal grid columns clip "Antibiogram" on phones, and a global
  `body.ui-v2 .sbref-tab { padding:8px 15px !important }` forces wide padding; `.sbref-tabs.kbp-5` is a
  content-sized flex row (scrolls sideways only below ~360px) with a scoped `!important` padding.
- **The app zooms `<html>`** (Display settings, `home.js applyD`). In browser tests compare
  `scrollWidth` to the SAME element's `clientWidth`, not to `innerWidth`.
- Drug names in the reader get the app's drug linker (`.smd-drug`, tap opens the monograph). Intended.
- Keep class names clear of `-back`/`-close`/`-cancel` unless the element IS that control:
  `swipe-back.js` matches those substrings. `.kbp-back` is the reader's Back on purpose.

## Content status
- All protocols are `review.status: "ai_drafted"`: compiled with AI assistance from the cited
  guidelines (researched on the web, each source URL retrieved), NOT clinically reviewed. The list and
  every reader show that status. Marking one `reviewed`/`approved` requires a named reviewer
  (validator-enforced).
- Every protocol cites 1 to 4 sources with https URLs; Indian national programme guidance
  (NCVBDC, NTEP, NACO, NCDC, ICMR, MoHFW) is used where it exists.
- No em/en dashes (validator-enforced), British spelling, glucose in mg/dL with mmol/L.

Deps: [[Knowledge Library]] · [[Universal Search]] · [[Medical Knowledge Base]].
