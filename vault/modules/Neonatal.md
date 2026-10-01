---
tags: [module, clinical, neonatal]
---
# Neonatal layer

One NICU workspace: a baby record pinned on every screen and ten tools that read it. Built 2026-09-30
from the owner's plan ("StewardMD Neonatal Layer: Build and Polish Plan", Claude Docs) on branch
`feat/neo-layer`, recovery tag `pre-neo`. **Nothing here is clinically approved** (it ships ON as Beta by owner decision): every data file is
`review.status: "ai_drafted"` and every screen shows a Draft badge.

## Flags + default
- `smd_neo` master, **DEFAULT ON under a Beta label** (owner 2026-10-01: "Make it default on for everyone
  under beta label"; built default OFF on 2026-09-30). BETA on the Home tile and the hub header, Draft
  badges on every data screen. Off per device: Settings > Experimental Features > "Neonatal layer (Beta)",
  `?neo=0`, or `localStorage.smd_neo = "0"`. Registry: `neo-flags.js` (`SMD_NEO_FLAGS`).
- Per-feature (default ON, effective only with the master on; `?neo_<name>=0` or
  `localStorage.smd_neo_<name> = "0"`): `dose`, `prep`, `inf`, `fluids`, `growth`, `bili`, `scores`, `ref`,
  `proc`, `tdm`.
- Off: `neo-flags.js` is the only file that loads (it injects the rest when the flag is on). No Home tile,
  no search hit, no neonatal calculators, dose-calc.js behaves exactly as before.
- On (the default): a neonate in dose-calc.js sees neonatal rows only ("No neonatal dose on file. Do not
  extrapolate." when none), for every user.

## Key files
| File | Global | What |
|---|---|---|
| `neo-flags.js` | `SMD_NEO_FLAGS` | flags + loader for the other neo files (`VER` = the `?v=` token) |
| `neo-patient.js` | `SMD_NEO`, `SMD_NEO_ENGINE` | baby record (memory only) + the ONE band matcher (`context`, `matches`, `condText`) |
| `neo-hub.js` | `SMD_NEO_HUB` | overlay `#neoHub` (z 10040, under `#doseCalc` 10050), tool registry, data loader, Draft badge, source line, second check, Copy/Print |
| `neo-dose.js` | `SMD_NEO_DOSE` | Phase 1 bands, tenfold guard; also renders the block dose-calc.js embeds |
| `neo-prep.js` | `SMD_NEO_PREP` | Phase 2 vial choice, reconstitution, draw-up, vial count |
| `neo-infusions.js` | `SMD_NEO_INF` | Phase 3 mcg/kg/min <-> mL/h (app.js `INFUSION_DRUGS` untouched) |
| `neo-fluids.js` | `SMD_NEO_FLUIDS` | Phase 4 GIR, day-of-life volumes, bag builder; registers `neo_gir`, `neo_fluid_dol` in calculators.js |
| `neo-growth.js` | `SMD_NEO_GROWTH` | Phase 5 INTERGROWTH-21st, WHO (reuses `SMD_KITS._growth`), velocity, CDC milestones, reflexes |
| `neo-bili.js` | `SMD_NEO_BILI` | Phase 6 bilirubin plotter (AAP 2022 >= 35 wk, NICE CG98 all gestations) |
| `neo-scores.js` | `SMD_NEO_SCORES` | Phase 7 scores registered into calculators.js (category Neonatology) from `scores.json` |
| `neo-ref.js` | `SMD_NEO_REF` | Phase 8 reference values by age band |
| `neo-proc.js` | `SMD_NEO_PROC` | Phase 9 UVC/UAC, ETT, PICC, LP, exchange; step guides in `kb/clinical-protocols/neonatal-*.json` |
| `neo-tdm.js` | `SMD_NEO_TDM` | Phase 10 vancomycin two-level AUC, neonatal gentamicin levels, Hartford (reference only) |
| `data/neo/*.json` | | the clinical data; `data/neo/README.md` is the schema |
| `data/neo/sources.json.gz` | | provenance snapshots, ONE packed file (`{name.txt: text}`); loose `data/neo/sources/*.txt` from snap.py are gitignored and folded in with `validate.mjs --pack`. Not shipped by build-www, 404 on the web |
| `scripts/neo/snap.py`, `scripts/neo/validate.mjs` | | fetch a source snapshot; enforce "every number is in its quote" |

Touch points outside the neo files: `dose-calc.js` (neonate path), `workspaces.js` ("per paediatric formulary"
opens neonatal dosing), `calculators.js` (`MEDCALC.register`, `draft`, `srcHtml`), `infusion-actions.js`
(`SMD_PRINT` for Copy/Print), `home.js` (tile + `ACT.neo`), `search.js` (per-tool items),
`sidebar-redesign.js` (Experimental toggle), `index.html`, `sw.js`, `scripts/build-www.sh`.

## The provenance rule (owner, 2026-09-30)
No dose, threshold, score item or reference value from model memory. Each clinical object carries `src` +
`quote`; the quote is a verbatim substring of the `<src>.txt` snapshot in `data/neo/sources.json.gz`, and every number in the object
appears in the quote. `node scripts/neo/validate.mjs` (and `test/neo-data.test.mjs`) fail otherwise.
Unsourced means absent and the screen says "No data on file". Units are stored as the source writes them;
the engines convert (g/kg, mcg/mg, mg/kg/min <-> g/kg/day).

## Behaviour
- **Band matching** (`SMD_NEO_ENGINE.matches`): GA and PMA in completed weeks (never rounded up); PNA as
  elapsed time in days/weeks/months; `life_week` "first" = PNA < 7 d; a key the engine does not know is
  "unknown", never a match. A row that needs a value the record lacks is listed as "needs ...".
- **Dose-calc** with `smd_neo`+`dose` on: a neonate (age < 28 d) sees only neonatal rows. With a band on
  file the band block replaces the monograph rows; with no neonatal row anywhere:
  "No neonatal dose on file. Do not extrapolate." Flag off: unchanged (child rows with a warning).
- **Tenfold guard**: planned dose > 2 x band maximum = hard stop (Prepare disabled); above = warning;
  planned-dose field shows the band's unit only. High-alert drugs: Copy/Print blocked until the
  independent-second-check box is ticked (nothing stored).
- **Growth**: INTERGROWTH tables give values at z -3..+3; z between columns and PMA between whole weeks are
  linear interpolation (our method, stated on screen). Exponential velocity is shown, not calculated
  (Rush University: research use only without a licence); the two-point model is used.

## Tests
- `test/neo-patient.test.mjs` PNA/PMA/corrected age (source worked examples), month ends, leap day, guards.
- `test/neo-data.test.mjs` validator over the shipped files + that it catches tampering.
- `test/neo-engines.test.mjs` dose bands, guard, dose-calc strict path, prep, infusions, fluids, growth,
  procedures, TDM.
- `test/run-neo-ui.mjs` headless: flag off, every tool at 360 px, Draft badge, no dashes, tenfold stop,
  second check, dose -> prepare carry-over, dose-calc neonate path, dark mode, `[hidden]` trap.

## Gotchas
- **Cloudflare Pages caps a deploy at 20,000 files** and the repo sits just under it. The 225 snapshots were
  loose files at first and broke the Pages deploy on PR #1327; they are now one packed file. Add no loose
  per-source files under a served path.
- `neo-patient.js` must load before the others (it defines `SMD_NEO_ENGINE`); `neo-flags.js` inserts the
  files with `async=false` in `FILES` order. Node tests load `neo-patient.js` first for the same reason.
- `#neoHub` sets `display:flex`: the stylesheet carries `#neoHub[hidden]{display:none!important}` (same
  trap as `#doseCalc`, SMD-MSCQX9).
- Opening a Knowledge Library guide closes the hub (the protocol overlay sits lower).
- Bump `VER` in `neo-flags.js` AND `neo-hub.js` when data or code changes (the data fetch uses the hub's).
- Licences are NOT cleared: see [[Decisions]] 2026-09-30 and the PR description. INTERGROWTH-21st, WHO
  2024 SBI (CC BY-NC-SA IGO), NICE (international reuse needs a licence), ASHP S4S, VON, StatPearls
  (CC BY-NC-ND), BAPM and several CC BY-NC papers are non-commercial or unclear.
