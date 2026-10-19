/* Epilepsy and seizure mechanism as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/epil.mjs [--print-model]
 * Static layout here; brain organ, neurons, transmitter and drug particles, EEG and gauges move in epil.page.js. Qualitative: no doses, no numbers. */
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
    { label: "glutamate blocker" },
    { label: "GABA enhancer" },
    { label: "sodium channel blocker" },
  ],
  status: "Cortex: {level} · {drug} ·",
  drugNames: ["no treatment", "a glutamate blocker", "a GABA enhancer", "a sodium channel blocker"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const E = cl((0.3 + 0.6 * a) * (drug === 1 ? 0.55 : 1));
  const I = cl(0.62 - 0.28 * a + (drug === 2 ? 0.42 : 0));
  let H = cl(0.55 * E + 0.45 * a - 0.55 * I + 0.25);
  if (drug === 1) H = cl(H * 0.7);
  if (drug === 2) H = cl(H * 0.6);
  if (drug === 3) H = cl(H * 0.45);
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
  [2, 3, "neurons active · spread local · inhibition overwhelmed"],
];

/* ---------------- static layout ---------------- */
/* Brain organ left (centre 150, 235, w 190). Cortex patch box x 280 to 588, y 128 to 360.
   Channel inset x 660 to 932: rows at cy 162 (sodium), 222 (GABA), 282 (glutamate).
   EEG box x 660 to 932, y 358 to 430. Stage caption at y 428. No static text: all
   annotation is pills plus the caption, set in epil.page.js. */
function chanRow(cy, id, tip) {
  return `<g class="hot" data-info="${esc(tip)}">`
    + `<rect class="sc-hit" x="668" y="${cy - 28}" width="256" height="56"/>`
    + `<rect class="sc-memb" x="800" y="${cy - 4}" width="112" height="8" rx="4"/>`
    + `<rect id="${id}-chan" class="sc-chan" x="848" y="${cy - 15}" width="16" height="30" rx="4"/>`
    + `<circle class="sc-ion" cx="856" cy="${cy - 24}" r="3.2"/><circle class="sc-ion" cx="856" cy="${cy + 24}" r="3.2"/>`
    + `<g id="${id}-block" opacity="0"><path class="mk-x2" d="M846 ${cy - 12}l20 24M866 ${cy - 12}l-20 24"/></g></g>`;
}
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<ellipse id="brainGlow" class="ep-glow" cx="150" cy="235" rx="100" ry="86" opacity="0"/>
<g id="brainSlot"></g>
<rect id="magBox" class="ep-mag" x="280" y="128" width="308" height="232" rx="14"/>
<path id="fiber" class="ep-fiber" d="M241 235 L280 245"/>
<g id="edges"></g>
<g id="neurons"></g>
<g id="parts"></g>
<ellipse id="spreadRing" class="ep-ring" cx="310" cy="205" rx="60" ry="55" opacity="0"/>
<rect class="sc-inset" x="660" y="110" width="272" height="220" rx="12"/>
${chanRow(162, "na", "Sodium channel. It drives rapid firing. The sodium blocker plugs it so fast firing stalls.")}
${chanRow(222, "gaba", "GABA receptor. It lets calming signals into the cell. The GABA boost opens it wider.")}
${chanRow(282, "glu", "Glutamate receptor. It passes excitation on. The glutamate blocker sits on it and the signal fizzles.")}
<circle id="gaba-glow" class="sc-glow" cx="856" cy="222" r="22" opacity="0"/>
<rect class="sc-inset" x="660" y="358" width="272" height="72" rx="12"/>
<g class="hot" data-info="Brain wave trace. It sums many neurons. Calm activity is small and irregular, a seizure shows large regular spikes as neurons fire together."><rect class="sc-hit" x="668" y="362" width="256" height="60"/><path id="eeg" class="sc-eeg" d="M668 404L928 404"/></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-pyr{--cc:#e8a04c}.cl-inh{--cc:#3ec6b8}
.p-glu{--cc:#ff8a3d}.p-gaba{--cc:#2fd4c4}.p-drug{--cc:#b78cff}
.g-exc{fill:#ff8a3d}.g-inh{fill:#2fd4c4}.g-hyp{fill:var(--c-bad)}.g-spr{fill:#c084fc}.g-fir{fill:#e8a04c}
.sc-inset{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-memb{fill:var(--anatomy-mid);opacity:.55}
.sc-chan{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.2}
.sc-ion{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 50%,#000);stroke-width:.5}
.sc-glow{fill:none;stroke:#2fd4c4;stroke-width:2}
.sc-hit{fill:transparent}
.sc-eeg{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}
.mk-x2{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.edge{stroke:var(--anatomy-mid);stroke-width:1;opacity:.45}
.edge-inh{stroke:#2fd4c4;stroke-width:1.2;opacity:.6}
.ep-glow{fill:var(--c-bad);stroke:none}
.ep-ring{fill:none;stroke:var(--c-bad);stroke-width:2.5;stroke-dasharray:8 6}
.ep-mag{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:6 5;opacity:.6}
.ep-fiber{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 4;opacity:.6}
.ep-cap{fill:var(--anatomy-strong)}
`;

buildScene({
  id: "epilepsy-seizure", fig: "Fig 1", title: "Epilepsy: when excitation outruns inhibition", W, H, body, extraCss,
  label: "An animated seizure in the brain. A patch of cortex is shown magnified: excitatory neurons pass glutamate signals to each other while inhibitory cells release GABA to hold firing down. In a focal seizure a small cluster fires fast and recruits neighbours; in a generalised seizure the firing spreads across the network and the brain wave trace turns to large spikes. Treatment sends blocker particles to their ion channel, where they dock: the sodium channel plugs shut, the GABA receptor opens wider, and glutamate signals fizzle at the blocked receptor. Gauges show excitation, inhibition, hyperexcitability, spread and firing.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "epil.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With sodium channel blocker",
  sourcesLis: [
    "<strong>Balance of excitation and inhibition.</strong> Cortical pyramidal neurons excite each other mainly through glutamate acting on AMPA and NMDA receptors. Fast sodium currents drive their action potentials. Interneurons release GABA, which opens chloride channels (GABA-A receptors) and steadies the network. When excitation outruns inhibition, through altered ion channels, loss of inhibition or excess glutamate, neurons become hyperexcitable and fire together. This is standard teaching in neurology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Focal and generalised seizures.</strong> A focal seizure starts in a local cluster and may stay local or recruit neighbouring cortex. A generalised seizure engages networks on both sides from the start or by spread, with loss of awareness and a spiky brain wave trace (EEG). Only the spread idea is drawn here.",
    "<strong>Treatment ideas shown.</strong> Blocking voltage-gated sodium channels reduces rapid firing, enhancing GABA strengthens inhibition, and blocking glutamate reduces excitation. These are teaching toggles only, not a guide to choosing a medicine.",
  ],
  simplified: "Single-neuron bursting, thalamic circuits, absence and other seizure types, status epilepticus, triggers, genetics, imaging, EEG interpretation in patients, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
