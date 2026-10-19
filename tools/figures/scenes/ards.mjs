/* ARDS as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ards.mjs [--print-model]
 * Static layout here; cells, fluid and gauges move in ards.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of lung injury", a: [1, 0.65, 0.9], names: ["exudative", "proliferative", "fibrotic"], ticks: ["exudative", "proliferative", "fibrotic"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "lung-protective ventilation" },
    { label: "prone positioning" },
    { label: "treat the underlying cause" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "lung-protective ventilation", "prone positioning", "treating the underlying cause"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const cause = drug === 3 ? 1 : 0, prone = drug === 2 ? 1 : 0, lpv = drug === 1 ? 1 : 0;
  const leakB = [0.95, 0.55, 0.3][level], neutB = [0.9, 0.6, 0.35][level], fluidB = [0.92, 0.55, 0.32][level];
  const fibB = [0.08, 0.45, 0.92][level], stiffB = [0.72, 0.68, 0.95][level], shuntB = [0.9, 0.62, 0.52][level];
  const hyalB = [0.88, 0.38, 0.12][level], surfLossB = [0.85, 0.45, 0.6][level];
  const Leak = cl(leakB * (cause ? 0.45 : 1) * (lpv ? 0.85 : 1));
  const Fluid = cl(fluidB * (cause ? 0.55 : 1) * (prone ? 0.85 : 1));
  const Neut = cl(neutB * (cause ? 0.4 : 1));
  const Fib = cl(fibB * (cause ? (level === 2 ? 0.9 : 0.75) : 1) * (lpv ? 0.5 : 1));
  const Sh = cl(shuntB * (prone ? 0.45 : 1) * (lpv ? 0.75 : 1) * (cause ? 0.7 : 1));
  const Ox = cl(0.98 - 0.92 * Sh - 0.15 * Fluid);
  const Stiff = cl(stiffB * (lpv ? 0.82 : 1) * (cause && level < 2 ? 0.92 : 1));
  const Comp = cl(1 - Stiff);
  const Hyal = cl(hyalB * (cause ? 0.6 : 1));
  const Surf = cl(1 - surfLossB * (cause ? 0.7 : 1) + (level === 1 ? 0.1 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Fluid, 0.35, 0.65, ["little", "some", "marked"]), w(Ox, 0.25, 0.55, ["very low", "low", "near normal"]), w(Stiff, 0.45, 0.7, ["low", "raised", "high"]), w(Fib, 0.25, 0.6, ["low", "some", "marked"])];
  return { phase: level, cause, prone, lpv, Leak, Fluid, Neut, Fib, Sh, Ox, Stiff, Comp, Hyal, Surf, words, readout: "oedema " + words[0] + " · oxygen " + words[1] + " · stiffness " + words[2] + " · fibrosis " + words[3] };
}
const TESTS = [
  [0, 0, "oedema marked · oxygen very low · stiffness high · fibrosis low"],
  [0, 1, "oedema marked · oxygen very low · stiffness raised · fibrosis low"],
  [1, 1, "oedema some · oxygen low · stiffness raised · fibrosis low"],
  [0, 3, "oedema some · oxygen low · stiffness raised · fibrosis low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="392" rx="18"/>
<text class="sc-zone" x="34" y="68">ALVEOLAR CAPILLARY UNIT</text>
<path id="arrTop" class="ards-arrow" d="M143 145L312 182"/>
<path id="arrBot" class="ards-arrow" d="M143 285L312 292"/>
<path id="gateTop" class="ards-gate" d="M224 149L231 178"/>
<path id="gateBot" class="ards-gate" d="M227 274L228 304"/>
<circle id="nodeTop" class="ards-node" cx="105" cy="145" r="38"/>
<circle id="nodeBot" class="ards-node" cx="105" cy="285" r="38"/>
<g id="injIcon" class="ards-icon">
  <circle cx="94" cy="134" r="6"/><circle cx="112" cy="142" r="5"/><circle cx="100" cy="154" r="4"/>
  <path d="M84 292Q105 272 126 292Q105 302 84 292Z"/>
</g>
<rect class="ards-airway" x="466" y="70" width="28" height="58" rx="10"/>
<ellipse id="alvOuter" class="ards-alv-out" cx="480" cy="225" rx="165" ry="110"/>
<ellipse id="alvAir" class="ards-alv-air" cx="480" cy="225" rx="145" ry="92"/>
<ellipse id="hyal" class="ards-hyal" cx="480" cy="225" rx="136" ry="84"/>
<ellipse id="fluidEl" class="ards-fluid" cx="480" cy="278" rx="118" ry="36"/>
<rect id="capLumen" class="ards-cap" x="330" y="325" width="300" height="34" rx="17"/>
<ellipse id="lungGlow" class="ards-lglow" cx="800" cy="210" rx="74" ry="58"/>
<g id="lungSlot"></g>
<rect class="ards-airway" x="788" y="150" width="24" height="24" rx="8"/>
<rect id="shuntVessel" class="ards-shunt" x="748" y="284" width="152" height="28" rx="14"/>
<g id="surfG"></g>
<g id="collG"></g>
<g id="cellsG"></g>
<g id="rbcsG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-epi:#7fc4e8;--c-fibro:#d8b36a;--c-coll:#c9a86a;--c-prot:#ff9a3d;--c-surf:#3ddc97}
body[data-theme="light"]{--c-epi:#3fa0d4;--c-fibro:#b98f2e;--c-coll:#a9822e;--c-prot:#d96f12;--c-surf:#0f9f76}
.cl-epi{--cc:var(--c-epi)}.cl-fibro{--cc:var(--c-fibro)}.cl-type2{--cc:var(--c-surf)}
.ards-arrow{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round;marker-end:none;opacity:.75}
.ards-node{fill:color-mix(in srgb,var(--c-bad) 24%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:1.6}
.ards-icon{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.7}
.ards-airway{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.ards-alv-out{fill:color-mix(in srgb,var(--c-endo) 20%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.4}
.ards-alv-air{fill:color-mix(in srgb,var(--c-epi) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-epi) 65%,#000);stroke-width:1.2}
.ards-hyal{fill:none;stroke:#e8d36a;stroke-width:6;stroke-dasharray:10 5;opacity:0}
.ards-fluid{fill:var(--c-fl);opacity:0}
.ards-cap{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.ards-lglow{fill:var(--c-good);opacity:0}
.ards-gate{fill:none;stroke:var(--c-good);stroke-width:5;stroke-linecap:round;opacity:0}
.ards-stretch{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;opacity:0}
.ards-capline{fill:var(--anatomy-strong);font-size:13px}
.ards-shunt{fill:color-mix(in srgb,#5c426e 34%,var(--anatomy-paper));stroke:#5c426e;stroke-width:1.2}
.ards-coll{fill:none;stroke:var(--c-coll);stroke-width:2;stroke-linecap:round;opacity:0}
.ards-surf{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 55%,#000);stroke-width:.5}
.p-prot{--cc:var(--c-prot)}.p-air2{--cc:#9fd8f2}.p-inj{--cc:var(--c-bad)}
.dr-g-fill.g-oed{fill:var(--c-fl)}.dr-g-fill.g-oxy{fill:var(--c-good)}.dr-g-fill.g-shunt{fill:#8f6fc8}.dr-g-fill.g-stiff{fill:var(--c-bad)}.dr-g-fill.g-fib{fill:var(--c-coll)}.dr-g-fill.g-neut{fill:var(--c-neut)}
`;

buildScene({
  id: "acute-respiratory-distress-syndrome", fig: "Fig 1", title: "Acute respiratory distress syndrome: flooded, stiff lungs", W, H, body, extraCss,
  label: "An animated alveolar capillary unit in acute respiratory distress syndrome. Direct injury from the air side and indirect injury from the blood side damage alveolar epithelium and capillary endothelium. The barrier leaks protein rich fluid into the alveolus, hyaline membranes line the wall, surfactant is lost, neutrophils enter, and blood passing flooded alveoli stays oxygen poor, giving shunt and refractory hypoxaemia. The lung becomes stiff. Later phases show repair by type II cells and then interstitial fibrosis. Gauges show oedema, neutrophils, shunt, oxygen, stiffness and fibrosis. Treatment choices are lung-protective ventilation, prone positioning and treating the underlying cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ards.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With treating the underlying cause",
  sourcesLis: [
    "<strong>How ARDS develops.</strong> Acute respiratory distress syndrome follows direct pulmonary injury (for example pneumonia or aspiration) or indirect vascular injury from a systemic illness. In the early exudative phase the alveolar epithelial and capillary endothelial barrier is injured, vascular leak lets protein rich edema fluid flood the interstitial space and alveoli, hyaline membranes form on the alveolar wall, surfactant is lost and neutrophils enter. Flooded and collapsed alveoli still receive blood, so that blood bypasses gas exchange as a shunt and oxygen stays low despite added oxygen (refractory hypoxaemia). The chest shows widespread shadowing and the lung is stiff, so breathing or ventilation needs more pressure. A proliferative phase follows, with type II alveolar cell growth and early repair, and in some patients a fibrotic phase with interstitial fibrosis. This is standard teaching in critical care and respiratory medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Lung-protective ventilation limits further injury from overstretch while the lung is stiff and uneven. Prone positioning makes ventilation and blood flow match more evenly and reduces shunt, so oxygen often rises. Treating the underlying cause removes the driver of epithelial and endothelial injury and lets leak, oedema and neutrophil influx settle. These are teaching toggles only and show direction of effect, not how any patient should be treated.",
  ],
  simplified: "Diagnostic criteria and timing, oxygen thresholds and ratios, ventilator settings and pressures, fluid strategy, steroids and other adjuncts, extracorporeal support, the separate roles of each mediator, and right heart and vascular effects are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
