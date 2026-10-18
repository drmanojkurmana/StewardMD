/* Parkinson disease and the basal ganglia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/park.mjs [--print-model]
 * Static layout here; dopamine and pathway signals, neuron loss and limb move in park.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Dopamine loss in the substantia nigra", a: [0.12, 0.55, 1], names: ["mild loss", "moderate loss", "severe loss"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "levodopa (dopamine precursor)" },
    { label: "dopamine agonist" },
    { label: "MAO-B or COMT inhibitor" },
  ],
  status: "Dopamine loss: {level} · {drug} ·",
  drugNames: ["no treatment", "levodopa", "a dopamine agonist", "a MAO-B or COMT inhibitor"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const raw = cl(1 - 0.88 * a);
  const boost = drug === 1 ? 0.62 : drug === 2 ? 0.48 : drug === 3 ? 0.34 * raw + 0.05 : 0;
  const DA = cl(raw + boost);
  const D = cl(0.12 + 0.83 * DA);
  const I = cl(0.92 - 0.72 * DA);
  const G = cl(0.55 + 0.55 * I - 0.5 * D);
  const T = cl(1.02 - G);
  const Sym = cl(1.05 - 0.9 * DA);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(DA, 0.35, 0.7, ["low", "reduced", "near normal"]), w(T, 0.3, 0.6, ["low", "reduced", "strong"]), w(Sym, 0.35, 0.65, ["mild", "moderate", "marked"])];
  return { a, raw, DA, D, I, G, T, Sym, words, readout: "dopamine " + words[0] + " · movement drive " + words[1] + " · symptoms " + words[2] };
}
const TESTS = [
  [0, 0, "dopamine near normal · movement drive strong · symptoms mild"],
  [1, 0, "dopamine reduced · movement drive reduced · symptoms moderate"],
  [2, 0, "dopamine low · movement drive low · symptoms marked"],
  [2, 1, "dopamine near normal · movement drive strong · symptoms moderate"],
];

/* ---------------- static layout ---------------- */
/* Node centres: cortex 480,110 (box 390 to 570 by 88 to 132); substantia nigra 170,220 r36;
   striatum 480,220 r42; thalamus 650,220 r32; movement 830,220 r30;
   GPe 300,345 r30; STN 480,345 r26; GPi 650,345 r32. Arrows join the edges. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BASAL GANGLIA: CHOOSING AND SCALING MOVEMENT</text>
<text class="sc-lab sc-dim" x="34" y="86">dopamine from the substantia nigra tunes the direct and indirect pathways</text>
<defs><marker id="pk-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pk-head" d="M0 0L10 5L0 10z"/></marker></defs>
<g id="links">
<path class="pk-arrow pk-exc" d="M480 134L480 174" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-dopa" d="M210 220L432 220" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-inh" d="M514 250L618 314" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-inh" d="M450 250L332 316" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-inh" d="M334 345L448 345" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-exc" d="M510 345L614 345" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-inh" d="M650 309L650 256" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-exc" d="M630 194C596 152 556 126 528 116" marker-end="url(#pk-arr)"/>
<path class="pk-arrow pk-exc" d="M686 220L792 220" marker-end="url(#pk-arr)"/>
<path class="pk-bar" d="M614 306l10 14M326 308l12 12M442 337l0 16M644 262l12 0"/>
<text class="sc-lab pk-sign" x="490" y="158">+</text>
<text class="sc-lab pk-sign" x="566" y="276">-</text>
<text class="sc-lab pk-sign" x="392" y="276">-</text>
<text class="sc-lab pk-sign" x="386" y="336">-</text>
<text class="sc-lab pk-sign" x="556" y="336">+</text>
<text class="sc-lab pk-sign" x="660" y="286">-</text>
<text class="sc-lab pk-sign" x="742" y="210">+</text>
</g>
<g id="nodes"></g>
<g id="snc-cells"></g>
<g id="parts"></g>
<g id="limb"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.pk-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.8;stroke-linecap:round}
.pk-dopa{stroke:#e9b84a;stroke-width:2.2;stroke-dasharray:5 4}
.pk-head{fill:var(--anatomy-mid);stroke:none}
.pk-bar{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.pk-sign{font-weight:700}
.cl-snc{--cc:#e9b84a}.cl-stri{--cc:#7fc4e8}.cl-gpe{--cc:#f08a4b}.cl-stn{--cc:#e8a04c}.cl-gpi{--cc:#e5484d}.cl-thal{--cc:#3ec6b8}.cl-cor{--cc:#b7a1e6}
.p-dopa{--cc:#e9b84a}.p-dir{--cc:#3ddc97}.p-ind{--cc:#f08a4b}.p-gpi{--cc:#e5484d}.p-thal{--cc:#2fd4c4}
.g-dopa{fill:#e9b84a}.g-dir{fill:#3ddc97}.g-ind{fill:#f08a4b}.g-gpi{fill:#e5484d}.g-move{fill:#2fd4c4}
.pk-node-t{fill:var(--anatomy-strong);font:600 10px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none}
.pk-node-s{fill:var(--anatomy-text);font:9px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none}
.dr-fig text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.pk-limb{fill:none;stroke:var(--anatomy-strong);stroke-width:5;stroke-linecap:round}
.pk-hand{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.pk-rest{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
body[data-theme="light"] .pk-dopa{stroke:#b8860b}
body[data-theme="light"] .p-dopa{--cc:#b8860b}
`;

buildScene({
  id: "parkinson-basal-ganglia", fig: "Fig 1", title: "Parkinson disease: dopamine loss slows movement", W, H, body, extraCss,
  label: "An animated basal ganglia circuit in Parkinson disease. Dopamine neurons in the substantia nigra send dopamine to the striatum. Dopamine excites the direct pathway, which releases the thalamus and promotes movement, and it restrains the indirect pathway through the GPe and STN, which applies the brake through the GPi. When dopamine neurons are lost, the direct pathway fades, the indirect pathway and the GPi brake strengthen, the thalamus is held down, and movement drive falls, with slow, small movement, stiffness and tremor. Gauges show dopamine signal, both pathways, the GPi brake and movement drive. Treatment choices include levodopa, a dopamine agonist and a MAO-B or COMT inhibitor.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "park.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>The circuit.</strong> The cortex excites the striatum with glutamate. Dopamine from the substantia nigra pars compacta excites D1 neurons of the direct pathway and inhibits D2 neurons of the indirect pathway. The direct pathway inhibits the GPi (with the substantia nigra pars reticulata), which releases its inhibition of the thalamus and so promotes movement. The indirect pathway runs through the GPe and the subthalamic nucleus: it ends by exciting the GPi, which increases inhibition of the thalamus and suppresses movement. This is standard teaching in neurology and basal ganglia physiology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What goes wrong in Parkinson disease.</strong> Dopamine neurons of the substantia nigra are progressively lost, so striatal dopamine falls. The direct pathway becomes underactive and the indirect pathway becomes overactive. The GPi brake therefore holds the thalamus down, thalamic drive to the cortex falls, and movement becomes slow and small (bradykinesia), with rigidity and a resting tremor. Non motor features, Lewy pathology and tremor circuitry in detail are not drawn. This is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Levodopa is a dopamine precursor that is converted to dopamine in the brain. A dopamine agonist stimulates dopamine receptors directly. A MAO-B inhibitor slows dopamine breakdown in the brain, and a COMT inhibitor slows levodopa breakdown, so each prolongs dopamine action; on its own the inhibitor needs some dopamine to be present. None restores the lost neurons. These are teaching toggles only, not a guide to choosing a medicine.",
  ],
  simplified: "Alpha synuclein and Lewy bodies, the exact cause of neuron loss, tremor generation in detail, non motor symptoms (mood, sleep, smell, cognition, autonomic features), gait freezing and falls, dyskinesia and wearing off with long term treatment, deep brain stimulation, physiotherapy and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
