# StewardMD — Replace UI emoji with custom line-icons (app-wide)

**Date:** 2026-07-19
**Goal:** The home screen uses clean custom line-icons; the rest of the app is peppered with OS emoji (🔍 🏥 📷 ✍️ ❤️ 🫁 🦵 ☠️ ⚖️ 💊 🧬 🩸 …) across Calculators, Drug Interactions, My Cases, Knowledge Library, the Dx sheet, ICU/wards, etc. Replace all **user-visible UI-chrome** emoji with consistent custom SVG line-icons so the app reads professionally.

## Decisions (agreed)
- **Scope:** comprehensive, app-wide sweep of user-visible UI emoji.
- **Specialty icons:** a distinct line-icon per specialty (not 405 one-offs; each calculator inherits its category's icon).
- **Clinical-content emoji:** LEAVE emoji embedded in medical prose/data and data-grids (e.g. antibiogram ✔/✘/Partial). Chrome only.
- **Cadence:** one PR per phase; pause for review/merge between phases.

## Mechanism
Extend the existing `window.ICONS` catalog in `home.js` — an inline-SVG, `currentColor`, ~1.75-stroke, 24×24 line-icon set already declared the shared "no emojis, no dup SVG" catalog. Chosen over Material Symbols (font dependency, and mixing two systems) because inline SVG is offline-safe in the native app and is already the intended standard.

- Accessor: `window.ICONS.get(name, cls)` (exists). All callers guard for load order: `((window.ICONS && ICONS.get(name, cls)) || FALLBACK)` where FALLBACK is a neutral glyph/empty — never a crash.
- New icons added to the `ICON` map in `home.js` (single source of truth). ~25 new: 19 specialty + a few UI (cloud/sync, note, aware-tier, etc.). Many needed icons already exist (search, folder, clock, book, camera, hospital, edit, trash, check, close, plus, list, warn, share, save, heart, lungs, pulse, droplet, siren, syndromes, antibiogram, pills, flask, calc…).

## Specialty → icon map (Calculators + Knowledge Library)
cardiovascular→heart/pulse · critical-care→siren · infectious→microbe(syndromes) · renal→kidney* · hepatology→liver* · neurology→brain(reasoning) · respiratory→lungs · endocrine→gland/dna* · gastroenterology→stomach* · haematology→droplet · oncology→ribbon* · rheumatology→joint* · musculoskeletal→bone* · dermatology→skin* · psychiatry→head* · paediatrics→baby* · obstetrics→pregnant* · ophthalmology→eye* · toxicology→skull* · general→scales*/stethoscope. (* = new icon to add.)

## Triage rule (what to change)
- **Replace:** buttons, chips, tab labels, section/card headers, category markers, list/type markers, method-cards, empty-state markers.
- **Leave:** lines containing `console.`; code comments; emoji inside clinical prose/data; data-grid glyphs that carry meaning (antibiogram coverage).

## Regression guard (the backbone)
`test/no-ui-emoji.test.mjs` — for each file in a growing COVERED list, scan its source for a curated blocklist of UI emoji, **skipping** lines that (a) contain `console.`, (b) are comment lines, (c) fall inside `/* @emoji-data-ok */ … /* @end */` guards used to mark legitimate clinical-data blocks. Fail if any blocklisted emoji remains in a covered file, or if a new one is introduced. Each phase adds its files to COVERED. Also assert `ICONS.has(name)` for every icon referenced by the phase.

## Phases (each: own branch/PR, cache-token bump for changed client assets, `npm test` green)
- **P0 Foundation** — add specialty + UI icons to the `ICON` map; confirm `ICONS.get` is globally safe; ship `test/no-ui-emoji.test.mjs` (initially covering only files P0 touches / the catalog). No UI behaviour change beyond the catalog.
- **P1 Calculators** — `calculators.js` category chips + per-calc icons (by `cat`); home calculators tile. Add calculators.js to COVERED.
- **P2 Drugs & interactions** — `medlist.js` method cards, `drugs.js`, abx-*, `prescription.js`.
- **P3 Cases + Knowledge Library + Dx** — `home.js` My Cases, `reasoning.js` Knowledge Library + Dx sheet, `ghis-ward.js` import.
- **P4 ICU + Wards** — `icu.js`, `ghis-ward.js`, `ws-*.js`.
- **P5 Remainder** — nav/app.js, `engagement.js`, `onboarding.js`, settings, misc.

## Out of scope
Console/log emoji, comments, clinical-content emoji, and any change to clinical logic. Push-notification path untouched.

## Verification per phase
`npm test` (incl. the growing guard) green; a visual spot-check of the changed screens (screenshot/preview where feasible); cache-token bump so web + native pick up the change.
