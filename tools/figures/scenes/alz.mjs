/* Alzheimer disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/alz.mjs [--print-model]
 * Static layout here; plaques, tangles, synapses, transmitter particles, brain regions and gauges move in alz.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of disease", a: [0.2, 0.55, 1], names: ["early", "moderate", "advanced"], ticks: ["early", "moderate", "advanced"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "cholinesterase inhibitor" },
    { label: "NMDA blocker" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "a cholinesterase inhibitor", "an NMDA blocker"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], chei = drug === 1 ? 1 : 0, nmda = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const A = cl(a);
  const T = cl(0.08 + 0.85 * a);
  const Syn = cl(1 - 0.7 * T - 0.15 * A);
  const CholRem = cl(1 - 0.75 * a);
  const ACh = cl(CholRem * (0.55 + 0.45 * Syn) * (chei ? 1.5 : 1));
  const Glu = cl(0.12 + 0.65 * T - nmda * 0.5 * T);
  const Hatr = cl(0.15 + 0.85 * a);
  const Catr = cl(0.05 + 0.9 * a * a);
  const Nloss = cl(0.05 + 0.8 * a);
  const Mem = cl(0.45 * Syn + 0.35 * ACh + 0.2 * (1 - Glu));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(A, 0.35, 0.7, ["few", "some", "many"]), w(T, 0.35, 0.7, ["few", "some", "many"]), w(1 - Syn, 0.3, 0.6, ["intact", "reduced", "lost"]), w(1 - Mem, 0.3, 0.55, ["preserved", "impaired", "poor"])];
  return { a, chei, nmda, A, T, Syn, CholRem, ACh, Glu, Hatr, Catr, Nloss, Mem, words, readout: "plaques " + words[0] + " · tangles " + words[1] + " · synapses " + words[2] + " · memory " + words[3] };
}
const TESTS = [
  [0, 0, "plaques few · tangles few · synapses intact · memory preserved"],
  [1, 0, "plaques some · tangles some · synapses reduced · memory impaired"],
  [2, 0, "plaques many · tangles many · synapses lost · memory poor"],
  [2, 2, "plaques many · tangles many · synapses lost · memory poor"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="sc-sub" x="30" y="78" width="560" height="352" rx="14"/>
<rect class="sc-sub" x="610" y="78" width="320" height="352" rx="14"/>
<text class="sc-zone" x="46" y="98">NEURON NETWORK</text>
<text class="sc-zone" x="626" y="98">BRAIN REGIONS</text>
<g id="axons"></g>
<g id="plaquesG"></g>
<g id="neurons"></g>
<g id="syns"></g>
<g id="brainG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-neuron{--cc:#e8a04c}.cl-chol{--cc:#3ec6b8}
.plaque-b{fill:#c084fc;stroke:color-mix(in srgb,#c084fc 55%,#000);stroke-width:.9;opacity:.9}
.plaque-d{fill:color-mix(in srgb,#c084fc 45%,#fff)}
.tau-p{fill:none;stroke:#e5484d;stroke-width:1.6;stroke-linecap:round}
.dend{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round;opacity:.7}
.axon{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;opacity:.65}
.axon-chol{stroke:#2fd4c4;stroke-width:1.8}
.syn-b{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 50%,#000);stroke-width:.7}
.ache-b{fill:#e5484d;opacity:.85}
.p-ach{--cc:#2fd4c4}.p-glu{--cc:#ff8a3d}
.g-amy{fill:#c084fc}.g-tau{fill:#e5484d}.g-syn{fill:#ffd24a}.g-ach{fill:#2fd4c4}.g-glu{fill:#ff8a3d}.g-mem{fill:var(--c-good)}
.sc-sub{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.6}
.brain-cx{fill:#e9a2b3;stroke:color-mix(in srgb,#e9a2b3 55%,#000);stroke-width:1;opacity:.85}
.brain-vt{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.brain-hp{fill:#b7a1e6;stroke:color-mix(in srgb,#b7a1e6 55%,#000);stroke-width:1}
.mk-x{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
`;

buildScene({
  id: "alzheimer-disease", fig: "Fig 1", title: "Alzheimer disease: plaques, tangles and failing synapses", W, H, body, extraCss,
  label: "An animated neuron network and brain region inset. Amyloid plaques form outside neurons, tau tangles form inside them, synapses and cholinergic neurons are lost, and the hippocampus shrinks before the cortex thins. A cholinergic axon releases acetylcholine at a synapse. Gauges show plaques, tangles, synapses, acetylcholine signal, glutamate spill and memory. Treatment choices boost acetylcholine or block NMDA glutamate receptors.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "alz.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Plaques, tangles and cell loss.</strong> In Alzheimer disease, amyloid beta peptide collects outside neurons as plaques, and abnormally phosphorylated tau protein collects inside neurons as neurofibrillary tangles. Synapses fail and neurons die, including basal forebrain cholinergic neurons that supply acetylcholine to the cortex and hippocampus. Brain shrinkage (atrophy) tends to involve the hippocampus early, with wider cortical thinning later, and the fluid spaces (ventricles) enlarge as tissue is lost. This is standard teaching in neurology, pathology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Cholinesterase inhibitors slow the breakdown of acetylcholine by acetylcholinesterase, so more of the remaining signal reaches the synapse. NMDA blockers damp excess glutamate signalling through NMDA receptors, which may otherwise add to neuron injury. Neither treatment is shown removing plaques or tangles or restoring lost neurons. These are teaching toggles only.",
  ],
  simplified: "Genetics and risk factors, amyloid production and clearance pathways in detail, microglial and vascular contributions, other dementias, brain imaging and biomarkers, disease modifying antibody treatments, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
