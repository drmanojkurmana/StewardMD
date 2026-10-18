/* Epilepsy and seizure mechanism as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/epil.mjs [--print-model]
 * Static layout here; neurons, transmitter particles, EEG and gauges move in epil.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How much of the cortex is involved", a: [0.18, 0.62, 1], names: ["normal", "focal", "generalised"], ticks: ["normal", "focal", "generalised"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "sodium channel blocker" },
    { label: "GABA enhancer" },
    { label: "glutamate blocker" },
  ],
  status: "Cortex: {level} · {drug} ·",
  drugNames: ["no treatment", "a sodium channel blocker", "a GABA enhancer", "a glutamate blocker"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const E = cl((0.3 + 0.6 * a) * (drug === 3 ? 0.48 : 1));
  const I = cl(0.62 - 0.28 * a + (drug === 2 ? 0.42 : 0));
  let H = cl(0.55 * E + 0.45 * a - 0.55 * I + 0.25);
  if (drug === 1) H = cl(H * 0.45);
  if (drug === 2) H = cl(H * 0.6);
  if (drug === 3) H = cl(H * 0.65);
  const Sp = cl(H * (0.25 + 0.85 * a));
  const F = cl(H * 0.9 + 0.1 * a);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(F, 0.28, 0.62, ["calm", "active", "firing fast"]), w(Sp, 0.2, 0.55, ["none", "local", "widespread"]), w(I, 0.38, 0.58, ["overwhelmed", "strained", "holding"])];
  return { a, E, I, H, Sp, F, words, readout: "neurons " + words[0] + " · spread " + words[1] + " · inhibition " + words[2] };
}
const TESTS = [
  [0, 0, "neurons calm · spread none · inhibition strained"],
  [1, 0, "neurons firing fast · spread local · inhibition strained"],
  [2, 0, "neurons firing fast · spread widespread · inhibition overwhelmed"],
  [2, 2, "neurons active · spread local · inhibition holding"],
];

/* ---------------- static layout ---------------- */
/* Inset: three ion channel rows (centres 155, 215, 275) inside x 660 to 932, y 110 to 330.
   EEG box x 660 to 932, y 358 to 430. Neuron field x 60 to 640, y 128 to 332. */
function chanRow(cy, label, id) {
  return `<text class="sc-lab" x="676" y="${cy + 4}">${esc(label)}</text>`
    + `<rect class="sc-memb" x="800" y="${cy - 4}" width="112" height="8" rx="4"/>`
    + `<rect class="sc-chan" x="848" y="${cy - 15}" width="16" height="30" rx="4"/>`
    + `<circle class="sc-ion" cx="856" cy="${cy - 24}" r="3.2"/><circle class="sc-ion" cx="856" cy="${cy + 24}" r="3.2"/>`
    + `<g id="${id}" opacity="0"><path class="mk-x2" d="M846 ${cy - 12}l20 24M866 ${cy - 12}l-20 24"/></g>`;
}
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CORTEX: A NETWORK OF NEURONS</text>
<text class="sc-lab sc-dim" x="34" y="86">excitation pushes firing up, inhibition holds it down</text>
<g id="edges"></g>
<g id="neurons"></g>
<g id="parts"></g>
<rect class="sc-inset" x="660" y="110" width="272" height="220" rx="12"/>
<text class="sc-zone" x="676" y="132">ION CHANNELS</text>
${chanRow(162, "Sodium channel", "na-block")}
${chanRow(222, "GABA receptor", "gaba-x")}
${chanRow(282, "Glutamate receptor", "glu-block")}
<circle id="gaba-glow" class="sc-glow" cx="856" cy="222" r="22" opacity="0"/>
<rect class="sc-inset" x="660" y="358" width="272" height="72" rx="12"/>
<text class="sc-lab" x="676" y="376">BRAIN WAVE TRACE</text>
<path id="eeg" class="sc-eeg" d="M668 404L928 404"/>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-pyr{--cc:#e8a04c}.cl-inh{--cc:#3ec6b8}
.p-glu{--cc:#ff8a3d}.p-gaba{--cc:#2fd4c4}
.g-exc{fill:#ff8a3d}.g-inh{fill:#2fd4c4}.g-hyp{fill:var(--c-bad)}.g-spr{fill:#c084fc}.g-fir{fill:#e8a04c}
.sc-inset{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-memb{fill:var(--anatomy-mid);opacity:.55}
.sc-chan{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.2}
.sc-ion{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 50%,#000);stroke-width:.5}
.sc-glow{fill:none;stroke:#2fd4c4;stroke-width:2}
.sc-eeg{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}
.mk-x2{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.edge{stroke:var(--anatomy-mid);stroke-width:1;opacity:.45}
.edge-inh{stroke:#2fd4c4;stroke-width:1.2;opacity:.6}
`;

buildScene({
  id: "epilepsy-seizure", fig: "Fig 1", title: "Epilepsy: when excitation outruns inhibition", W, H, body, extraCss,
  label: "An animated cortical network. Excitatory neurons pass glutamate signals to each other while inhibitory cells release GABA to hold firing down. Ion channels in an inset (sodium, GABA and glutamate receptors) set how excitable each neuron is. In a focal seizure a small cluster fires fast and recruits neighbours; in a generalised seizure the firing spreads across the network and the brain wave trace turns to large spikes. Gauges show excitation, inhibition, hyperexcitability, spread and firing. Treatment choices block sodium channels, enhance GABA or block glutamate.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "epil.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Balance of excitation and inhibition.</strong> Cortical pyramidal neurons excite each other mainly through glutamate acting on AMPA and NMDA receptors. Fast sodium currents drive their action potentials. Interneurons release GABA, which opens chloride channels (GABA-A receptors) and steadies the network. When excitation outruns inhibition, through altered ion channels, loss of inhibition or excess glutamate, neurons become hyperexcitable and fire together. This is standard teaching in neurology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Focal and generalised seizures.</strong> A focal seizure starts in a local cluster and may stay local or recruit neighbouring cortex. A generalised seizure engages networks on both sides from the start or by spread, with loss of awareness and a spiky brain wave trace (EEG). Only the spread idea is drawn here.",
    "<strong>Treatment ideas shown.</strong> Blocking voltage-gated sodium channels reduces rapid firing, enhancing GABA strengthens inhibition, and blocking glutamate reduces excitation. These are teaching toggles only, not a guide to choosing a medicine.",
  ],
  simplified: "Single-neuron bursting, thalamic circuits, absence and other seizure types, status epilepticus, triggers, genetics, imaging, EEG interpretation in patients, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
