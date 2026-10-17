# Interactive figures (Anima kit)

Figures are generated pages (`prep/figures/<id>.html` dark, `<id>-light.html` light) built with the Anima drawing kit
(MIT, https://github.com/Garinmckayl/anima, licence in `prep/figures/ANIMA-LICENSE.txt`). Each is described by a spec in
`tools/figures/specs/<id>.json`; an engine turns the spec into the page. Build needs an Anima checkout:

    ANIMA_DIR=/path/to/anima node tools/figures/gpcr2.mjs tools/figures/specs/<id>.json --register

`--register` merges the spec's `registry` block (drug names -> preset query, class phrases) into `prep/figures/figures.json`,
which the app reads (`fig-viewer.js`) to show the figure on the Drugs page, in MCQ explanations, lesson steps and Knowledge
Library articles. Drug names are single lower-case words; the query `d=<n>` presets the drug selector (index in `drugs`).

Engines
- `gpcr2.mjs`: one nerve terminal, two target cells, each a GPCR -> G protein -> effector -> second messenger -> end node.
  Spec: `cols[]` (key, name, organ, gprot, eff AC|PLC, sign +|-, msg cAMP|ca, inv for Gi, end {kind pka|node,label}, out, sub, words, info{cell,rec,end}),
  `drugs[]` (label, status, cols[{b: block 0..1, g: extra drive 0..1}]), `level` (label, a[3], names, ticks), `tests` (model self-checks).
- `cascade.mjs`: a chain of molecules joined by enzyme steps that a drug can block.

Rules: qualitative only (no doses, affinities or concentrations); every claim has a source in `sources`; "simplified" lists what
is left out; all text is AI-assisted and needs clinician review in the Review Desk before it is called reviewed.

## Animated scene figures (haemodialysis, sepsis, airway, graft, and the pathophysiology set)

Drawn from the mechanism, not copied from any book image. Built with the Anatomy kit (isometric solids, tubes, lathe; MIT,
https://github.com/wheresryan22/anatomy, licence in `prep/figures/ANATOMY-LICENSE.txt`) for machines and the page shell, and the
Anima kit for cell styling.

Setup on a new machine (the kits are not vendored):

    git clone https://github.com/wheresryan22/anatomy ~/anatomy
    git clone https://github.com/Garinmckayl/anima ~/anima
    export ANATOMY_DIR=~/anatomy ANIMA_DIR=~/anima
    npm i -D playwright   # only for the dev scripts below; set CHROME=/path/to/chrome if it cannot find a browser

Files (`tools/figures/scenes/`)
- `bio-scene.mjs`: `buildScene({...})` writes `prep/figures/<id>.html` and `<id>-light.html` (page shell, controls, sources footer, model self-test).
- `bio.lib.js`: page runtime (cells, pills, gauges, particle helpers, loop, controls, URL params `?d=<treatment>&l=<level>`). `bio-scene.css`: shared colours.
- One pair per scene: `<name>.mjs` (static SVG body, `modelOf`, TESTS, sources) and `<name>.page.js` (motion). `<name>.reg.json` is its registry entry.
  Scenes: sepsis, airway, graft, acs, shock, hf, conduction, coag, hypersens, tb, hiv, malaria, dka. Haemodialysis is the older machine scene
  (`dialysis.mjs` real unit, `dialysis-bench.mjs` simple view, shared `dialysis.page.js` and `dialysis.css`).
- Generate: `node tools/figures/scenes/<name>.mjs` (add `--print-model` to list every readout without writing files).
- Registry: `figures.json` entries for scenes carry `"scene": true` and no drug names; `tools/figures/specs/<id>.json` is a stub (`kind: "scene"`).

Dev scripts (`tools/figures/dev/`)
- `shot.mjs <page-id> "?d=3&l=2" <tag>`: two screenshots (default `/tmp/figshots`), prints console errors. Use `<id>-light` for light.
- `sweep.mjs`: every registered figure in the viewer at 390 px, both themes; prints `checked N bad M`.
- `termcheck.py <name>.reg.json`: how many lessons and knowledge-library files the terms match, with samples.
- `register.sh <name> <id> "<subject>"`: add to the registry, run the registry tests, commit, push.
- `AGENT-BRIEF.md`: the brief used to build each scene (copy it into a prompt for a new topic).

Rules for scenes: pure `modelOf(S, level, drug)` with `TESTS`; Without = treatment 0, With = last non-zero (`data-without` / `data-with`);
hover text on every part; no doses or numbers; no em or en dashes; never put CSS `opacity` on a pooled particle class (it overrides the attribute);
sources footer says AI-assisted, awaiting review. Merge to `main` only when the owner says "Merge".
