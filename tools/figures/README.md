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
