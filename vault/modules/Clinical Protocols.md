---
tags: [module, kb, clinical-content]
status: built 2026-09-25 (flag ON). Content ai_drafted, PENDING clinical review.
flag: smd_kb_protocols (client, def:true, ?kbproto=0 hides it)
---
# Clinical Protocols (Knowledge Library "Protocols" tab)

Bedside protocols for every specialty (sepsis, DKA, STEMI, stroke, snakebite, PPH, neonatal
resuscitation, ...), as a fifth tab in the [[Knowledge Library]] beside Syndromes, Antibiogram, AWaRe
and Guidelines. Also found by [[Universal Search]] (category "Protocols").

**Also in the OPD EMR Protocol tab (owner, 2026-09-25).** `opd-emr.js protocolTab` lists these
clinical protocols AND the oncology regimens (`kb/protocols/*.json`, flag `smd_onco_protocols`) in one
list: branch chips (All / Oncology / each subject), a cancer-type picker under Oncology, and one search
over titles, aliases, humanised cancer type and regimen drug names. A clinical protocol opens READ-ONLY
inside the tab via `SMD_KBPROTO.readerHTML(p, { idPrefix: "oeKbp" })` (the Knowledge Library sheet sits
below the EMR's z-index, so it cannot be opened on top).

**Assign, for clinical protocols too (owner, 2026-09-26: "protocols cant be assigned like oncology
protocols why? fix it").** Flag `smd_protocol_assign` (kb-protocols-flags.js, default ON,
`?protoassign=0`). An oncology regimen still assigns a server-side DRAFT PLAN (`POST /plan` + timeline);
a clinical protocol has no plan object, so it is assigned the way a [[Specialty Kits]] kit adds
findings: **the doctor ticks the instructions that apply and they are appended to the case sheet as
editable text**. Nothing is prescribed, ordered, signed or saved until the assessment is saved.
- Pure engine in `kb-protocols.js`: `assignLines(p)` (one tickable line per section item, plus each
  drug), `assignText(p, ids)` (the blocks, per field), `assignHTML(p, sel, opts)` (the tick list; the
  host supplies its own action attribute through `opts.act`). Unit-tested in `test/opd-protocol-tab.test.mjs`.
- Field per section kind: immediate / treatment / investigations / monitoring / escalate / disposition
  to `management_plan`, prevention to `diet_lifestyle_advice`. **Ticked by default** except
  `recognise`, `special`, `pitfalls` and the drug doses, which are reading matter or need a deliberate
  choice.
- Case-sheet format: `Protocol: <title> (<basis> guidelines)`, then the protocol's own section heading
  and continuously numbered instructions, then "Verify every dose and threshold against the source"
  and the first two sources.
- In the OPD: Assign beside Open on every clinical row (write mode only), and an "Assign to this
  patient" button in the reader; `opd-emr.js` owns the state (`st.protoAssign = {id, sel}`) and the
  write (`appendPlan`, so the field is marked touched and the scribe never overwrites it), adds a
  timeline note, and returns to the Assessment tab. A kit's Protocols card has the same Assign
  (`host.protocol(id, {assign:true})`).

**Guideline basis (owner, 2026-09-25: "I want international guidelines based protocols too").**
Every protocol declares `basis`: `international` (WHO, NICE, AHA, ESC, IDSA, ADA...) or `india`
(national programme / Indian society guidance as the PRIMARY source). The Knowledge Library and the OPD
tab have an All / International / India control; rows and readers carry a basis pill. When the same
topic exists under both, the files name each other in `counterpart` (validator: must exist, point
back, differ in basis) and the reader shows an "Also available" link to the other version. Oncology
regimens count as International in the OPD filter (NCCN-based).

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
- `opd-emr.js` `protocolTab` / `protoResults` / `protoReader` + `opd-emr.css` `.oe-proto-*` - the OPD tab.
- Tests: `test/kb-clinical-protocols.test.mjs` (schema, catalogue freshness, version sync, search,
  wiring), `test/run-kb-protocols-ui.mjs` (headless Chrome against the real `index.html`),
  `test/opd-protocol-tab.test.mjs` + `test/run-opd-protocol-ui.mjs` (+ `opd-protocol-ui-harness.html`) for the OPD tab.

## Adding or editing a protocol
1. Write/edit `kb/clinical-protocols/<id>.json` per the schema in the build script header.
2. `node scripts/build-clinical-protocols.mjs` (rewrites `index.json`, `CONTENT_V` in
   `kb-protocols.js` and the `kb-protocols.js?v=` token in `index.html`).
3. `node --test test/kb-clinical-protocols.test.mjs` and `node test/run-kb-protocols-ui.mjs`.
4. Native: `build-www` copies `kb/clinical-protocols/*.json` (step 5 of `scripts/build-www.sh`).

## Gotchas
- **Two-part cache token.** `index.html` loads `kb-protocols.js?v=<code>.<hash>`: bump `<code>` by hand
  when the JS changes; the build rewrites `<hash>` (and `CONTENT_V`) when content changes.
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
- **248 protocols across 19 subjects** (2026-09-25): 215 international, 33 India (18 national programme,
  15 Indian society: IAP, ICMR STW, FOGSI-ICOG, CSI, HFAI, InSH, RSSDI, INASL, ISPN, ISG, API-ICP), 28
  topics paired. The 15 society protocols pair 13 existing international ones (dehydration, SAM, PPH,
  pre-eclampsia, dyslipidaemia, HFrEF, hypertension, T2DM, MASLD, paediatric UTI, neonatal jaundice,
  febrile seizure, bronchiolitis) plus 2 India-only (antithrombotics around GI bleeding and endoscopy,
  hypertension in T2DM). The first 15 pairs
  (malaria, dengue, chikungunya, leptospirosis, enteric fever, AES/encephalitis, rabies PEP, TB, TPT,
  influenza, heat stroke, poisoning, snakebite, GDM, anaemia in pregnancy). India-only because no
  international guideline exists: scrub typhus, scorpion sting, massive haemoptysis. Review worklist, including every figure the
  authoring agents could not verify: `vault/handoff/2026-09-25-clinical-protocols-review.md`.
- All protocols are `review.status: "ai_drafted"`: compiled with AI assistance from the cited
  guidelines (researched on the web, each source URL retrieved), NOT clinically reviewed. The list and
  every reader show that status. Marking one `reviewed`/`approved` requires a named reviewer
  (validator-enforced).
- Every protocol cites 1 to 4 sources with https URLs; Indian national programme guidance
  (NCVBDC, NTEP, NACO, NCDC, ICMR, MoHFW) is used where it exists.
- No em/en dashes (validator-enforced), British spelling, glucose in mg/dL with mmol/L.

Deps: [[Knowledge Library]] · [[Universal Search]] · [[Medical Knowledge Base]].
- OPD harness gotcha: `index.html` sets `*{box-sizing:border-box}` globally; a harness without it
  makes `.oe-canvas` (width 100% + padding) overflow and every layout assertion lies.
- Long regimen names are slash-joined with no spaces ("Daratumumab/Cyclophosphamide/..."): `.oe-proto-t`
  needs `overflow-wrap:anywhere` or the row scrolls the whole canvas sideways.
