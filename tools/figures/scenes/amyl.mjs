/* Amyloidosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/amyl.mjs [--print-model]
 * Static layout here; particles, deposits and gauges move in amyl.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Extent of deposition", a: [0.3, 0.65, 1], names: ["little", "moderate", "extensive"], ticks: ["little", "moderate", "extensive"], start: 1 },
  drugLabel: "Treatment approach",
  settings: [
    { label: "no treatment" },
    { label: "treat the underlying cause" },
    { label: "chemotherapy for AL amyloidosis" },
    { label: "supportive care only" },
  ],
  status: "Deposition: {level} · {drug} ·",
  drugNames: ["no treatment", "treating the underlying cause", "chemotherapy for AL", "supportive care only"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], src = drug === 1 ? 0.3 : drug === 2 ? 0.18 : 1, sup = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const P = cl(0.1 + 0.85 * a * src);
  const F = cl(0.08 + 0.88 * P);
  const D = cl(0.18 + 0.72 * a - (drug === 1 ? 0.12 : drug === 2 ? 0.14 : 0));
  const O = cl(0.08 + 0.85 * D * (sup ? 0.55 : 1));
  const Fn = cl(1 - O);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.3, 0.6, ["low", "present", "high"]), w(F, 0.3, 0.6, ["low", "present", "high"]), w(D, 0.35, 0.65, ["little", "moderate", "extensive"]), w(Fn, 0.4, 0.65, ["poor", "reduced", "preserved"])];
  return { a, src, sup, P, F, D, O, Fn, words, readout: "precursor " + words[0] + " · new fibrils " + words[1] + " · deposition " + words[2] + " · organ function " + words[3] };
}
const TESTS = [
  [1, 0, "precursor high · new fibrils high · deposition moderate · organ function poor"],
  [1, 1, "precursor low · new fibrils present · deposition moderate · organ function reduced"],
  [1, 2, "precursor low · new fibrils low · deposition moderate · organ function reduced"],
  [1, 3, "precursor high · new fibrils high · deposition moderate · organ function reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">FROM PRECURSOR TO FIBRIL</text>
<text class="sc-zone sc-dim" x="620" y="68">DEPOSITION IN ORGANS</text>
<g id="base"></g>
<g id="deps"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "amyloidosis", fig: "Fig 1", title: "Amyloidosis: misfolded protein to organ deposits", W, H, body,
  label: "An animated pathway from a precursor protein to amyloid. A normal precursor protein misfolds, stacks into a beta-pleated sheet and forms a rigid fibril. Fibrils deposit outside cells and build up in the heart, kidney and nerve. The three precursor types are AL from immunoglobulin light chains, AA from a reactive inflammatory protein, and transthyretin. A Congo red stained deposit is marked. Gauges show precursor, new fibrils, deposition and organ function. The deposition slider sets how much has built up, and treatment choices act on the precursor or support the organs.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "amyl.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `.cl-prot{--cc:#7fc4e8}.cl-mis{--cc:#c084fc}.amy-strand{fill:none;stroke:var(--c-cyt);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.amy-link{stroke:var(--anatomy-mid);stroke-width:.8;opacity:.7}.amy-fib{fill:none;stroke:#e879a8;stroke-width:2.4;stroke-linecap:round}.amy-fib2{fill:none;stroke:#f2a6c6;stroke-width:1.4;stroke-linecap:round}.amy-dep{stroke:#e879a8;stroke-width:1.6;stroke-linecap:round}.amy-dep2{stroke:#f2a6c6;stroke-width:1.2;stroke-linecap:round}.amy-congo{fill:none;stroke:var(--c-no);stroke-width:1.6;opacity:.85}.amy-heart{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}.amy-kid{fill:#c98a5a;stroke:color-mix(in srgb,#c98a5a 55%,#000);stroke-width:1}.amy-nerve{fill:none;stroke:var(--c-neut);stroke-width:3;stroke-linecap:round}.amy-myelin{fill:none;stroke:var(--anatomy-paper);stroke-width:5;stroke-linecap:round;opacity:.65}.amy-ring{fill:none;stroke:#e879a8;stroke-width:2;stroke-dasharray:4 3}.p-amy{--cc:#e879a8}.g-amy{fill:#e879a8}.g-prot{fill:var(--c-lymph)}`,
  sourcesLis: [
    "<strong>How amyloid forms.</strong> Amyloidosis is a group of conditions where a protein that should stay soluble misfolds, stacks into a beta-pleated sheet and forms rigid fibrils that deposit outside cells. The deposit resists breakdown and stiffens and disrupts the tissue it builds up in. Congo red staining of the deposit, showing apple-green colour under polarised light, is the classic tissue test. This is standard teaching in pathology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The main types shown.</strong> AL amyloidosis comes from immunoglobulin light chains made by a plasma cell clone. AA amyloidosis comes from serum amyloid A, a protein raised by long-standing inflammation. Transthyretin amyloidosis comes from transthyretin, either an inherited variant or the normal protein with ageing. Heart, kidney and peripheral nerve are common sites, with restrictive heart changes, kidney protein loss and a painful or numb neuropathy among the effects. Typing the deposit matters because treatment differs by type.",
    "<strong>Treatment ideas shown.</strong> Treating the underlying cause lowers the precursor supply (for example controlling the inflammation behind AA, or treating the plasma cell clone behind AL with chemotherapy). Supportive care helps the affected organs but does not remove deposits. Existing deposits clear slowly if at all, so deposition in the figure falls only a little when the precursor is cut. These are teaching toggles only.",
  ],
  simplified: "How the type is proved (mass spectrometry and other typing), organ biopsy details, imaging and staging, transthyretin stabiliser and silencer treatments, transplant, dialysis and heart support details, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
