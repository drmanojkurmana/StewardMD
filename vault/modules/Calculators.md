# Calculators

Clinical calculators list and bedside calculator screen. 885 calculators, decision support only.

## Flag

- `smd_calc_v2` default ON. `localStorage smd_calc_v2 = "0"` restores the old accordion list and panel.
- Starred uses `smd_watch_calc_favs` (Apple Watch sync via `SMD_APPLE_WATCH_SYNC`). Recent uses `smd_calc_recent` (last 8 opened, device only).

## Key files

- [calculators.js](/Users/mkk/Developer/StewardMD/.claude/worktrees/pr2048/calculators.js) registry, list, calculator screen, auto-fill, score card. ES5 only.
- `calculators-ext.js` generated. Do not edit.
- CSS is injected by `injectCSS()` in calculators.js (`v2CSS()` for the new UI) over the app tokens in index.html and redesign-system.css.

## Behaviour

- List: variant A grouped rows, Starred and Recent first, then categories. Search is a flat highlighted list and hides the chip rail.
- Calculator: full-screen pushed view. Auto-fill from patient, Ask MaiK, grouped form, live result in the pinned score card.
- Auto-fill reads the open ICU or Ward patient (`ICU_STATE`), then OPD (`OPDEMR._state()`), then Ward Sync selection (`GHIS.getSelectedPatient()`). Labs use `f.lab` hints; vitals and demographics use id and label mapping. Unmatched inputs stay empty.
- Ask MaiK uses `SMD_askMaik` with calculator inputs and result only. No patient name or ID.
- Score scale bar only when the result unit gives a max and the interpretation gives an exact cut-off. Otherwise value and verdict only.
- `MEDCALC.open(id, prefill, onResult)` still fires `onResult` only from Calculate or Use this result, never from live typing or prefill.

## Gotchas

- Selects start on Select with no value in v2. Compute must guard blanks and return an error.
- Checks count as answered. Answer N more counts numbers, selects and dates only.
- Tests: `test/run-calc-*.mjs`, `test/run-maik-calc-*.mjs`, `test/shot-calculators.mjs`, `test/calc-v2.test.mjs`.

## Status

Built 2026-11-21 on branch calc-ui-v2. Needs native rebuild or OTA to reach the phone.
