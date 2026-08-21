# OncoTree (oncology navigator + protocols + protocol tooling)

**Flag:** `smd_onco_navigator` (default **true**). Custom-protocol maker + sheet have no separate flag (guarded on `window.SMD_PROTOSHEET` / `window.SMD_PROTOMAKER` presence). All content is **DRAFT / experimental / not clinically activated** — a clinician verifies every dose.

## Key files
- `oncotree-engine.js` — `window.SMD_ONCOTREE_ENGINE`, pure `evaluate(graph, answers, opts)`. DAG evaluator.
- `oncotree-recommend.js` — `window.SMD_ONCOTREE_RECOMMEND`, per-protocol match rationale + phenotype narrowing.
- `oncotree.js` / `oncotree.css` — `window.SMD_ONCOTREE`, the UI (picker, pathway, map, ToC+search, breadcrumb, summary, footnote sheet, tables, protocol detail). Cache-bust `?v=op3-map`.
- `onco-dose.js` — `window.SMD_ONCODOSE`: `bsaMosteller`, `doseForDrug(drug, params)` (returns lineage incl. `final`/`dailyDose`/`dosesPerDay`), `planDoses`. Mosteller BSA + Calvert (AUC needs `params.creatinine` + `age`).
- `protocol-sheet.js` / `.css` — `window.SMD_PROTOSHEET.open(protocolOrId, patient, opts)`: printable Treatment Protocol sheet, BSA-computed doses, per-cycle day grid, dose-verify checkboxes, signature pad, print→PDF (@media print A4, native print, no lib), Assign (`smd-protocol-assign` + `smd-oncotree-select`). Cache-bust `?v=ps1`.
- `protocol-maker.js` / `.css` — `window.SMD_PROTOMAKER.open(opts)`: clinician authors a protocol (drugs/basis/dose/unit/route/days/frequency/notes + premeds/supportive/monitoring/instructions) → schema-valid object → local library (localStorage `smd_custom_protocols`) → opens in the sheet. Cache-bust `?v=pm1`. Launch entry in the OncoTree picker.
- Data: `kb/oncotree/<id>.json` (25 disease trees) + `kb/protocols/<id>.json` (266 protocols). `build-www.sh:84` copies `kb/oncotree`; all root `*.js`/`*.css` auto-copied.
- Tests: `test/validate-oncotree.cjs` (schema+DAG+reachability+engine smoke+DEPTH profile), `test/validate-protocol.cjs` (protocol schema + dose smoke).

## Data model (graph JSON)
- Top-level: `guideline, title, navigatorVersion, startNodeIds[], footnotes{}, nodes[], links[]`.
- Node: `id, nodeCategory (criteria|workup|treatment|surveillance|other), nodeType (question|end), name, title, section, description, bullets[], evidenceCategory[], footnotes[], tables[], options[{id,label,sets{},pills[]}], protocolRefs[], showsRecommendation, linkTo/linkGuideline/linkLabel`.
- Link: `{id, from, to, fromOptions[]}` — no fromOptions = always-true (chain workup→next); fromOptions MUST be option ids of `from`. **Must be a DAG**; `startNodeIds` is the entry.
- Protocol drug: `{id, name, basis (bsa|auc|flat|mgkg), dosePerUnit, unit, route, days[], caps, notes, frequency}`.

## Depth benchmark (enforced by the validator)
Breast is the 10/10 template (40 nodes, maxDepth 11, avgEndLayer 4.7, 45 protocolRefs). Targets: nodes>=40, longest path>=9, avg end depth>=4.3, >=8 outcomes >=5-deep. Deep = every treatment arm refines through more decisions (line-of-therapy 1L→progression→2L→later; response-adapted; risk/biomarker splits) before a recommendation — never leaf-terminal.

## Status
- 25 cancers, all breast-depth; every systemic-therapy leaf wired to a real protocol (472/682 end-nodes; rest correctly non-systemic). 266 protocols, all validate; **0 dangling refs**.
- Protocol Sheet + Custom Protocol Maker shipped. **All merged to `main` via PR #719 (`ee85c0ee`).**

## Gotchas
- Content is ORIGINAL functional wording from standard-of-care (NCCN/DeVita/Harrison general reference) — never reproduce guideline PDFs verbatim. Keep DRAFT/experimental.
- Non-systemic ends (surgery / RT-alone / observation / BSC / transplant referral / routers) correctly have **no** protocolRefs — do not force chemo cards onto them.
- **FLAKY test:** `test/oncotree-graph.test.mjs` asserts "every end has protocolRefs" — RED for every guideline incl untouched breast; contradicts the design. Fix it to exempt non-systemic ends; the authoritative validators are `validate-oncotree.cjs` / `validate-protocol.cjs`.
- Custom protocols: `lifecycleState:'custom'` + `experimental:true` + CUSTOM/DRAFT badge + "no auto dose caps, verify" caution — never let them look approved. Stored per-device (localStorage); cross-device sync would need server storage.
- Carboplatin/AUC dosing needs a serum-creatinine input (sheet has one); BID/TID drugs show per-administration + daily dose.
- Native app needs a rebuild (`build-www`→`cap sync`→native) to show client changes on device; web is live on push to main.

See `vault/Agent-Handoff.md` for the full session/project handoff.
