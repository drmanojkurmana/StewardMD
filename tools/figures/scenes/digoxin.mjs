/* Digoxin action and toxicity as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/digoxin.mjs [--print-model]
 * Static layout here; ions, conduction pulses, ECG and gauges move in digoxin.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Digoxin level", a: [0.25, 0.65, 1], names: ["therapeutic", "toxic", "severe"], ticks: ["therapeutic", "toxic", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "stop the drug" },
    { label: "correct potassium" },
    { label: "digoxin antibody fragments" },
    { label: "all measures: stop, correct potassium, antibody fragments" },
  ],
  status: "Digoxin level: {level} · {drug} ·",
  drugNames: ["no treatment", "stopping the drug", "correcting potassium", "digoxin antibody fragments", "all measures"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const haltF = drug === 1 || drug === 4 ? 1 : 0;
  const corrF = drug === 2 || drug === 4 ? 1 : 0;
  const fabF = drug === 3 || drug === 4 ? 1 : 0;
  let factor = 1;
  if (haltF) factor *= 0.55;
  if (corrF) factor *= 0.85;
  if (fabF) factor *= 0.15;
  const E = cl(a * factor);
  const Na = cl(0.08 + 0.88 * E);
  const Ca = cl(0.06 + 0.9 * Na);
  const Ino = cl(0.12 + 0.82 * Ca);
  const AV = cl(0.08 + 0.86 * E);
  const Kx = cl(0.1 + 0.8 * E * E - 0.18 * corrF * E);
  const Arr = cl(0.04 + 0.88 * E * E + (E > 0.6 ? 0.08 : 0));
  const Tox = cl(0.05 + 0.9 * E * E);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Ino, 0.35, 0.6, ["gentle", "stronger", "forceful"]), w(AV, 0.3, 0.6, ["near normal", "slowed", "markedly slowed"]), w(Arr, 0.25, 0.55, ["low", "raised", "high"])];
  return { a, haltF, corrF, fabF, E, Na, Ca, Ino, AV, Kx, Arr, Tox, words, readout: "contraction " + words[0] + " · AV node " + words[1] + " · arrhythmia risk " + words[2] };
}
const TESTS = [
  [0, 0, "contraction stronger · AV node near normal · arrhythmia risk low"],
  [1, 0, "contraction forceful · AV node markedly slowed · arrhythmia risk raised"],
  [2, 0, "contraction forceful · AV node markedly slowed · arrhythmia risk high"],
  [2, 3, "contraction gentle · AV node near normal · arrhythmia risk low"],
];

/* ---------------- static layout ---------------- */
let grid = "";
for (let x = 506; x <= 920; x += 18) grid += `<path class="dg-grid${(x - 506) % 90 === 0 ? " major" : ""}" d="M${x} 356V432"/>`;
for (let y = 356; y <= 432; y += 18) grid += `<path class="dg-grid${(y - 356) % 90 === 0 ? " major" : ""}" d="M506 ${y}H920"/>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEART MUSCLE CELL</text>
<text class="sc-zone" x="510" y="68">CONDUCTION AND TOXICITY SIGNS</text>
<rect class="dg-cell" x="30" y="80" width="430" height="270" rx="16"/>
<rect class="dg-extra" x="30" y="80" width="430" height="48" rx="16"/>
<path class="dg-memb" d="M30 128H460"/>
<text class="sc-zone sc-dim" x="44" y="100">OUTSIDE</text>
<text class="sc-zone sc-dim" x="44" y="152">INSIDE</text>
<rect class="dg-ecgbg" x="496" y="348" width="434" height="92" rx="14"/>
<g clip-path="url(#dgclip)">${grid}</g>
<clipPath id="dgclip"><rect x="506" y="356" width="414" height="76"/></clipPath>
<text class="sc-zone sc-dim" x="510" y="368">ECG</text>
<g id="cellg"></g><g id="cond"></g><g id="signs"></g><g id="ecg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "digoxin-toxicity", fig: "Fig 1", title: "Digoxin: action and toxicity", W, H, body,
  label: "An animated heart muscle cell, conduction pathway, ECG and toxicity signs. Digoxin blocks the sodium potassium pump, sodium and then calcium build up inside the cell and contraction strengthens. Vagal action slows the AV node. In toxicity, potassium builds up outside cells, the gut and eyes are affected and dangerous rhythms appear. Treatments are stopping the drug, correcting potassium and digoxin antibody fragments.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, levels or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "digoxin.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How digoxin works.</strong> Digoxin inhibits the membrane sodium potassium ATPase pump. Sodium then accumulates inside the heart muscle cell, the sodium calcium exchanger removes less calcium, intracellular calcium rises and contraction becomes stronger (positive inotropy). Digoxin also increases vagal tone, slowing conduction through the AV node and slowing the pulse. This is standard teaching in pharmacology and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Toxicity.</strong> Excess pump blockade gives nausea and vomiting, visual disturbance often described as yellow tinged vision or halos, confusion, and cardiac arrhythmias with AV block; acute severe poisoning raises extracellular potassium (hyperkalaemia) because the pump can no longer move potassium into cells. Low potassium (hypokalaemia) lets digoxin bind the pump more strongly and worsens toxicity, which is why correcting potassium matters. Teaching toggles only.",
    "<strong>Treatment ideas shown.</strong> Stopping the drug, correcting potassium, and digoxin specific antibody fragments (Fab) that bind free digoxin in the blood so it can no longer block the pump. Severe cases need urgent hospital and specialist care.",
  ],
  simplified: "Renal clearance and drug interactions, digoxin blood level testing and its timing, electrolyte correction details, pacing and other rhythm treatments, chronic versus acute poisoning differences, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-dig:#f59e0b;--c-ca:#38bdf8;--c-kx:#a3e635;--c-na:#ffd24a}
body[data-theme="light"]{--c-dig:#b45309;--c-ca:#0284c7;--c-kx:#65a30d;--c-na:#b45309}
.dg-cell{fill:color-mix(in srgb,var(--c-endo) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.dg-extra{fill:color-mix(in srgb,var(--c-fl) 14%,var(--anatomy-paper))}
.dg-memb{stroke:var(--c-endo);stroke-width:5;stroke-linecap:round}
.dg-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.dg-grid{stroke:var(--anatomy-faint);stroke-width:.5;opacity:.35;fill:none}.dg-grid.major{opacity:.7}
.dg-trace{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round}
.dg-pump{fill:var(--c-dig);stroke:color-mix(in srgb,var(--c-dig) 55%,#000);stroke-width:1}
.dg-ncx{fill:var(--c-ca);stroke:color-mix(in srgb,var(--c-ca) 55%,#000);stroke-width:1}
.dg-node{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:1.1}
.dg-node-av{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:1.1}
.dg-heart{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.1}
.dg-wire{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.dg-vagus{fill:none;stroke:var(--c-lymph);stroke-width:2.2;stroke-dasharray:5 4;stroke-linecap:round}
.dg-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.dg-iris{fill:var(--c-ca);stroke:color-mix(in srgb,var(--c-ca) 55%,#000);stroke-width:.8}
.dg-pupil{fill:var(--anatomy-strong)}
.dg-halo{fill:none;stroke:var(--c-na);stroke-width:4}
.dg-gut{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1.1}
.dg-sarc{stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.dg-sarc2{stroke:var(--c-rbc);stroke-width:3;stroke-linecap:round}
.p-dig{--cc:var(--c-dig)}.p-na{--cc:var(--c-na)}.p-ca{--cc:var(--c-ca)}.p-kx{--cc:var(--c-kx)}.p-fab{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}
.dr-g-fill.g-dig{fill:var(--c-dig)}.dr-g-fill.g-ca{fill:var(--c-ca)}.dr-g-fill.g-kx{fill:var(--c-kx)}
`,
});
