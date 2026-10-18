/* Pulmonary oedema as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pulmoedema.mjs [--print-model]
 * Static layout here; fluid, air, oxygen and gauges move in pulmoedema.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of lung flooding", a: [0.35, 0.65, 1], names: ["interstitial", "alveolar flooding", "severe"], ticks: ["interstitial", "alveolar flooding", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "diuretic and nitrate" },
    { label: "positive pressure support" },
    { label: "treat the underlying cause" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "diuretic and nitrate", "positive pressure support", "treating the underlying cause"],
};
function modelOf(S, level, drug) {
  const T = { hydro: [0.38, 0.68, 0.95], perm: [0.3, 0.55, 0.9], base: [0.34, 0.68, 0.97] };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const diur = drug === 1 ? 1 : 0, ppv = drug === 2 ? 1 : 0, cause = drug === 3 ? 1 : 0;
  const Hydro = cl(T.hydro[level] * (diur ? 0.42 : 1) * (cause ? 0.6 : 1));
  const Perm = cl(T.perm[level] * (cause ? 0.35 : 1) * (diur ? 0.92 : 1));
  const Filt = cl(0.55 * Hydro + 0.5 * Perm - 0.1);
  const Fluid = cl(T.base[level] * (0.7 + 0.45 * Filt) * (diur ? 0.62 : 1) * (ppv ? 0.8 : 1) * (cause ? 0.5 : 1));
  const Inter = cl(Fluid * 0.9 + 0.08);
  const Alv = cl(Fluid - (level === 0 ? 0.26 : level === 1 ? 0.07 : 0.01));
  const Air = cl(1 - Alv * 0.95 + (ppv ? 0.16 : 0));
  const Oxy = cl(0.32 + 0.62 * Air - 0.12 * Perm + (ppv ? 0.1 : 0));
  const Work = cl(0.12 + 0.72 * Alv + 0.22 * (1 - Air));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Fluid, 0.4, 0.7, ["in interstitium only", "in alveoli", "widespread in alveoli"]), w(Oxy, 0.4, 0.68, ["low", "reduced", "near normal"]), w(Air, 0.38, 0.68, ["much reduced", "reduced", "open"]), w(Work, 0.38, 0.68, ["easy", "laboured", "very laboured"])];
  return { a: S.level.a[level], diur, ppv, cause, Hydro, Perm, Filt, Fluid, Inter, Alv, Air, Oxy, Work, words, readout: "lung fluid " + words[0] + " · oxygen " + words[1] + " · air space " + words[2] + " · breathing " + words[3] };
}
const TESTS = [
  [0, 0, "lung fluid in interstitium only · oxygen near normal · air space open · breathing easy"],
  [1, 0, "lung fluid in alveoli · oxygen reduced · air space reduced · breathing laboured"],
  [2, 0, "lung fluid widespread in alveoli · oxygen low · air space much reduced · breathing very laboured"],
  [2, 3, "lung fluid in alveoli · oxygen reduced · air space reduced · breathing laboured"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ALVEOLAR CAPILLARY UNIT</text>
<path class="po-arrow" d="M136 150Q250 250 352 330"/>
<path class="po-arrow" d="M136 282Q250 275 360 250"/>
<path id="hydroArrow" class="po-hydro" d="M452 322L452 282M444 292L452 280L460 292"/>
<path id="oncArrow" class="po-onc" d="M628 282L628 322M620 312L628 324L636 312"/>
<circle class="po-node" cx="96" cy="146" r="38"/>
<circle class="po-node po-node-b" cx="96" cy="286" r="38"/>
<circle class="po-node po-node-c" cx="836" cy="260" r="36"/>
<g class="po-icon">
  <path d="M96 164C78 148 72 136 80 127C87 120 96 124 96 132C96 124 105 120 112 127C120 136 114 148 96 164Z"/>
</g>
<g class="po-icon-b">
  <circle cx="84" cy="274" r="5"/><circle cx="99" cy="282" r="6"/><circle cx="88" cy="294" r="4"/><circle cx="108" cy="296" r="4"/>
</g>
<g class="po-icon-c">
  <ellipse cx="826" cy="252" rx="10" ry="6"/><ellipse cx="848" cy="268" rx="9" ry="5"/>
</g>
<rect class="po-airway" x="528" y="66" width="24" height="62" rx="10"/>
<ellipse id="interEl" class="po-inter" cx="540" cy="226" rx="166" ry="112"/>
<ellipse id="alvOuter" class="po-alv-out" cx="540" cy="226" rx="152" ry="98"/>
<ellipse id="alvAir" class="po-alv-air" cx="540" cy="226" rx="134" ry="82"/>
<ellipse id="fluidEl" class="po-fluid" cx="540" cy="282" rx="118" ry="30"/>
<rect class="po-interband" id="interBand" x="372" y="304" width="336" height="22" rx="11"/>
<rect id="capLumen" class="po-cap" x="352" y="326" width="356" height="36" rx="18"/>
<g id="cellsG"></g>
<g id="rbcsG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-epi:#7fc4e8;--c-star:#e9b84a}
body[data-theme="light"]{--c-epi:#3fa0d4;--c-star:#b8860b}
.cl-epi{--cc:var(--c-epi)}
.po-node{fill:color-mix(in srgb,var(--c-bad) 24%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:1.6}
.po-node-b{fill:color-mix(in srgb,var(--c-cyt) 24%,var(--anatomy-paper));stroke:var(--c-cyt)}
.po-node-c{fill:color-mix(in srgb,#5c426e 34%,var(--anatomy-paper));stroke:#5c426e}
.po-icon{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.7}
.po-icon-b{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.7}
.po-icon-c{fill:#4a3560;stroke:#2c1e3e;stroke-width:.7}
.po-arrow{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round;opacity:.65}
.po-arrow + .po-arrow{stroke:var(--c-cyt)}
.po-hydro{fill:none;stroke:var(--c-star);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.po-onc{fill:none;stroke:var(--c-good);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
.po-airway{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.po-inter{fill:var(--c-fl);opacity:0}
.po-alv-out{fill:color-mix(in srgb,var(--c-endo) 18%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.4}
.po-alv-air{fill:color-mix(in srgb,var(--c-epi) 15%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-epi) 60%,#000);stroke-width:1.1}
.po-fluid{fill:var(--c-fl);opacity:0}
.po-interband{fill:var(--c-fl);opacity:0}
.po-cap{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.p-oxy{--cc:var(--c-good)}.p-air2{--cc:#9fd8f2}
.dr-g-fill.g-hydro{fill:var(--c-star)}.dr-g-fill.g-perm{fill:var(--c-cyt)}.dr-g-fill.g-fluid{fill:var(--c-fl)}.dr-g-fill.g-air{fill:var(--c-epi)}.dr-g-fill.g-oxy{fill:var(--c-good)}.dr-g-fill.g-work{fill:var(--c-bad)}
`;

buildScene({
  id: "pulmonary-oedema-mechanisms", fig: "Fig 1", title: "Pulmonary oedema: Starling forces and flooded alveoli", W, H, body, extraCss,
  label: "An animated alveolar capillary unit in pulmonary oedema. Fluid movement follows Starling forces: capillary hydrostatic pressure pushes fluid out and plasma oncotic pressure pulls it back. Raised hydrostatic pressure from left heart failure or mitral disease, and increased permeability of the alveolar capillary barrier as in acute respiratory distress syndrome, both drive fluid first into the interstitium and then into the alveoli. Flooded alveoli cannot take part in gas exchange, so oxygen falls and breathing becomes laboured. Gauges show hydrostatic pressure, permeability, lung fluid, air space, oxygen and work of breathing. Treatment choices are a diuretic with a nitrate, positive pressure support, and treating the underlying cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pulmoedema.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How pulmonary oedema develops.</strong> Net fluid movement across the pulmonary capillary follows Starling forces: hydrostatic pressure in the capillary pushes fluid out, plasma oncotic pressure holds fluid in, and the leakiness of the wall and the interstitial pressures set how easily fluid crosses. In cardiogenic pulmonary oedema the usual driver is elevated left sided filling pressure from left heart failure. Standard cardiac causes stressed in textbooks include myocardial infarction and coronary artery disease with ventricular dysfunction, severe hypertension, mitral valve disease and other mechanical problems of the heart; the failing left ventricle raises pulmonary vascular pressure until fluid leaves the capillary. In non-cardiogenic pulmonary oedema the barrier itself is injured and permeability rises, as in acute respiratory distress syndrome, so protein rich fluid leaks even without a raised hydrostatic pressure. Either way fluid collects first in the interstitium, then floods alveoli, usually beginning in dependent lung. Flooded alveoli are perfused but not ventilated, so gas exchange fails, oxygen falls, the lung stiffens and breathing becomes laboured; in extremis patients are deteriorating fast with evidence of systemic hypoperfusion when cardiogenic shock complicates the cardiac cause. This is standard teaching in medicine, cardiology and critical care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A diuretic removes fluid and a nitrate, a nitric oxide donor, dilates veins and lowers preload, so capillary hydrostatic pressure falls. Positive pressure support recruits flooded alveoli, pushes fluid back toward the interstitium, and improves oxygen while the cause is treated. Treating the underlying cause means treating the cardiac cause in cardiogenic oedema or the illness driving increased permeability in non-cardiogenic oedema. These are teaching toggles only and show direction of effect, not how any patient should be treated.",
  ],
  simplified: "Cardiogenic shock and other shock states, cardiac tamponade and detailed hemodynamic monitoring, lymphatic drainage, alveolar fluid clearance pumps, oxygen and ventilator settings, fluid strategy, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
