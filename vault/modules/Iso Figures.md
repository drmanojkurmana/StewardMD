---
tags: [module, cross-cutting, teaching]
---
# Iso Figures (isometric equipment figures)

- **What:** seven working isometric drawings of clinical equipment, each moved by a small pure model whose numbers
  the figure shows: circle system, vaporizer, sidestream capnography line, syringe driver, BP cuff on a training arm,
  three-bottle chest drain, retinoscopy bench. Built 2026-10-12 from the owner's request to use
  [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) (MIT) "from Narke to the website".
- **Flag:** `smd_iso`, default ON, kill switch `"0"` (localStorage) or `?iso=0`. Off: `SMD_ISO.slot()` returns "" and
  every host shows what it showed before. Recovery tag: `pre-iso-figures-2026-10-12`.
- **Status:** every figure is `ai_drafted` and says so on the card ("AI draft, awaiting specialist review. A teaching
  model, not a device manual."). Each lists its sources and model under "Sources and model".

## How it is built (the key idea)
The Anatomy kit is a Node, modern-JS drawing kit; the app is ES5. So the kit runs **only at build time**:
- `tools/iso/kit/` vendored Anatomy kit (`iso-kit.mjs`, `lathe.mjs`, `tube.mjs`, `iso.css`, LICENSE; upstream commit
  `689dcf96`). Licence copy: `licenses/anatomy-mit.txt`.
- `tools/iso/lib.mjs` painter's list, `basisOf(P)` (the projection as 4 screen vectors, so ES5 can project and move
  parts), `morph()` keyframes (a changing shape, blended number by number when the path skeleton matches), `hose()`,
  `balloon()` (bags and lungs with a fixed skeleton; the kit's lathe re-meshes per radius and is huge).
- `tools/iso/figures/<id>.mjs` the drawing; `<id>.driver.js` the hand-written ES5 model + motion.
- `node tools/iso/build.mjs [id]` writes `iso-fig-<id>.js` (SVG + basis + morphs + driver) and `iso-figures.css`.
  `--check` fails if a generated file is stale (run by `test/iso-figures.test.mjs`). Generated files are committed.
- `tools/iso/preview.html?ids=a,b&dark=1` shows any figures for screenshots (not shipped by build-www).

Runtime: `iso-figures.js` (ES5, ~16 KB, loaded `defer` from index.html and the product page). Hosts write
`SMD_ISO.slot(id, { state, controls:false, hide:[keys], theme })`; a MutationObserver mounts slots (repaints
included); `SMD_ISO.set(id, state)` drives a mounted figure. Figures animate only while on screen, stop under
reduced motion. The figure files (70 to 240 KB each, ~200 KB gzipped for all) load only when a slot appears.
**Bump `V` in iso-figures.js and the `?v=` in index.html + product/index.html when any figure or the CSS changes.**

## Where each figure lives
| Figure | Host | Model it uses |
|---|---|---|
| circle-system | Narke circuit explorer (`narke-explore-ui.js`), host-driven by the explorer's sliders | `narke-models/explorer-circuit.js` (driver has a LOCAL copy for the website; test checks they agree) |
| vaporizer, capno-line | Narke circuit explorer, "Vaporizer and gas sampling" | own: splitting ratio (SVP at 20 C), line volume / sampling flow |
| syringe-pump | Neonatal infusions (`neo-infusions.js`), collapsed under the result, AFTER the range and source lines, rate fixed to the calculated mL/h (`hide: ["rateI"]`) | own: rate / barrel area, slack delay |
| bp-cuff | CliniX `diagram.bpiso` (`clinix-diagrams.js`, `iso: "bp-cuff"`), media `media.cvs.bp.iso` on `skill.exam.cvs.bp` | own: beats vs let-down rate (AHA 2019) |
| chest-drain | SURGX chest trauma protocol (`"isoFigure": "chest-drain"`, passed through `surgx-model.js compileProtocol`) | own: seal/suction pressures |
| retinoscope | Ophthalmos focus explorer (`ophthalmos-explore.js isoBench()`), set to the eye's spherical equivalent | `OPHTHALMOS_RETINO` (LOCAL copy checked against it); working distances 67 cm 1.50 D, 50 cm 2.00 D as the retinoscopy sim |
| circle-system, syringe-pump, chest-drain | Product page `product/index.html` "Equipment you can watch work." (dark) | as above |

## Tests
- `test/iso-figures.test.mjs`: build up to date, ES5 and no dashes, every driver runs every control setting with no
  NaN and touches only parts that exist, numbers against the Narke and Ophthalmos models, textbook values
  (isoflurane 1:44, sevoflurane 1:25 at 1%), wiring in every host.
- `test/run-iso-figures-ui.mjs` (headless Chrome, `PORT= CHROME_PORT= [CHROME=]`): all seven in both themes at
  390 px, the kill switch, and each host in the real app.
- CliniX tests skip `iso` diagrams in the "renders an `<svg>`" checks (they are slots, mounted in the browser).

## Gotchas
- Text in a figure must not contain `let `/`const ` + space etc.: the ES5 regex in the test reads prose too
  ("let down" tripped it). Use "deflate".
- A part that touches the driver must exist in the SVG (`data-iso-part`), or the test fails; `<text>` parts get
  the attribute on the `<text>` itself (api.text sets textContent).
- Paint order is depth of an anchor point plus a bias (`painter`); things wrapping others (the cuff on the arm) need a
  big bias. The kit's own audit (`kit/audit.mjs`) is not vendored; checks here are visual (preview + screenshots).
