/* Alzheimer disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/alz.mjs [--print-model]
 * Static layout here; plaques, tangles, synapses, transmitter particles, brain organ and gauges move in alz.page.js. Qualitative: no doses, no numeric thresholds. */
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
  const Ach = cl(CholRem * (0.55 + 0.45 * Syn) * (chei ? 2.4 : 1));
  const Glu = cl(0.12 + 0.65 * T - nmda * 0.55 * T);
  const Hatr = cl(0.15 + 0.85 * a);
  const Catr = cl(0.05 + 0.9 * a * a);
  const Nloss = cl(0.05 + 0.8 * a);
  const Mem = cl(0.4 * Syn + 0.45 * Ach + 0.15 * (1 - Glu));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(1 - Syn, 0.35, 0.65, ["intact", "reduced", "lost"]), w(Ach, 0.3, 0.6, ["low", "reduced", "ok"]), w(Glu, 0.3, 0.6, ["low", "raised", "high"]), w(1 - Mem, 0.3, 0.6, ["preserved", "impaired", "poor"])];
  return { a, chei, nmda, A, T, Syn, CholRem, Ach, Glu, Hatr, Catr, Nloss, Mem, words, readout: "synapses " + words[0] + " · ACh signal " + words[1] + " · glutamate " + words[2] + " · memory " + words[3] };
}
const TESTS = [
  [0, 0, "synapses intact · ACh signal ok · glutamate low · memory preserved"],
  [2, 0, "synapses lost · ACh signal low · glutamate high · memory poor"],
  [2, 1, "synapses lost · ACh signal reduced · glutamate high · memory poor"],
  [2, 2, "synapses lost · ACh signal low · glutamate low · memory poor"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="sc-sub" x="30" y="78" width="560" height="352" rx="14"/>
<rect class="sc-sub" x="610" y="78" width="320" height="352" rx="14"/>
<text class="sc-zone" x="46" y="98">NEURON NETWORK</text>
<text class="sc-zone" x="626" y="98">BRAIN</text>
<g id="axons"></g>
<g id="glow"></g>
<g id="plaquesG"></g>
<g id="neurons"></g>
<g id="syns"></g>
<g id="brainSlot"></g>
<g id="markers"></g>
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
.ache-block{fill:#4aa8ff;stroke:color-mix(in srgb,#4aa8ff 55%,#000);stroke-width:.8}
.nmda-cap{fill:#4aa8ff;stroke:color-mix(in srgb,#4aa8ff 55%,#000);stroke-width:.8}
.nmda-rec{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.ach-glow{fill:#2fd4c4;stroke:none}
.glu-glow{fill:#ff8a3d;stroke:none}
.syn-halo{fill:#2fd4c4;stroke:none}
.glu-ring{fill:none;stroke:#e5484d;stroke-width:1.6;stroke-dasharray:5 4}
.p-ach{--cc:#2fd4c4}.p-glu{--cc:#ff8a3d}
.g-amy{fill:#c084fc}.g-tau{fill:#e5484d}.g-syn{fill:#ffd24a}.g-ach{fill:#2fd4c4}.g-glu{fill:#ff8a3d}.g-mem{fill:var(--c-good)}
.sc-sub{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.6}
.brain-vt{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.brain-hp{fill:#b7a1e6;stroke:color-mix(in srgb,#b7a1e6 55%,#000);stroke-width:1}
.mk-x{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.alz-cap{fill:var(--anatomy-strong);font-size:12px}
`;

buildScene({
  id: "alzheimer-disease", fig: "Fig 1", title: "Alzheimer disease: plaques, tangles and failing synapses", W, H, body, extraCss,
  label: "An animated neuron network and brain inset. Amyloid plaques form outside neurons, tau tangles form inside them, synapses and cholinergic neurons are lost, and the hippocampus shrinks early with wider brain shrinkage later. A cholinergic axon releases acetylcholine at a synapse. Gauges show plaques, tangles, synapses, acetylcholine signal, glutamate spill and memory. Treatment choices boost acetylcholine or block NMDA glutamate receptors.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "alz.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With cholinesterase inhibitor",
  sourcesLis: [
    "<strong>Plaques, tangles and cell loss.</strong> In Alzheimer disease, amyloid beta peptide collects outside neurons as plaques, and abnormally phosphorylated tau protein collects inside neurons as neurofibrillary tangles. Synapses fail and neurons die, including basal forebrain cholinergic neurons that supply acetylcholine to the cortex and hippocampus. The hippocampus tends to shrink early, with wider brain shrinkage later, and the fluid spaces (ventricles) enlarge as tissue is lost. This is standard teaching in neurology, pathology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Cholinesterase inhibitors slow the breakdown of acetylcholine by acetylcholinesterase, so more of the remaining signal reaches the synapse. The blue blocker dots sit on the enzyme and the signal cloud brightens. NMDA blockers damp excess glutamate signalling through NMDA receptors, which may otherwise add to neuron injury. The blue cap sits on the receptor and the glutamate cloud fades. Neither treatment is shown removing plaques or tangles or restoring lost neurons. These are teaching toggles only.",
  ],
  simplified: "Genetics and risk factors, amyloid production and clearance pathways in detail, microglial and vascular contributions, other dementias, brain imaging and biomarkers, disease modifying antibody treatments, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
