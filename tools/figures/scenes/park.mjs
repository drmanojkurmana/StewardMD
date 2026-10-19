/* Parkinson disease and the basal ganglia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/park.mjs [--print-model]
 * Static layout here; dopamine, pathway signals, neuron loss and limb move in park.page.js. Qualitative: no doses, no numbers. */
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
  const boost = drug === 1 ? 0.62 : drug === 2 ? 0.48 : drug === 3 ? 0.45 * raw + 0.20 : 0;
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
  [2, 2, "dopamine reduced · movement drive reduced · symptoms moderate"],
  [2, 3, "dopamine reduced · movement drive reduced · symptoms marked"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">FROM DOPAMINE TO MOVEMENT</text>
<text class="sc-lab sc-dim" x="34" y="86">dopamine from the nigra balances a go path and a stop path</text>
<defs><marker id="pk-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pk-head" d="M0 0L10 5L0 10z"/></marker></defs>
<g id="brainSlot"></g>
<g id="lanes"></g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="limb"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.pk-go{fill:none;stroke:#3ddc97;stroke-width:4;stroke-linecap:round}
.pk-stop{fill:none;stroke:#f08a4b;stroke-width:4;stroke-linecap:round}
.pk-dopa{fill:none;stroke:#e9b84a;stroke-width:2;stroke-linecap:round;stroke-dasharray:5 4}
.pk-brake{fill:none;stroke:#e5484d;stroke-width:3;stroke-linecap:round}
.pk-move{fill:none;stroke:#2fd4c4;stroke-width:3;stroke-linecap:round}
.pk-head{fill:var(--anatomy-mid);stroke:none}
.pk-jaw{fill:#e5484d;stroke:none;opacity:.85}
.pk-bar{fill:none;stroke:#e5484d;stroke-width:3;stroke-linecap:round}
.pk-halo{fill:var(--c-cyt2);stroke:none}
.pk-tab{fill:#f2c14e;stroke:#a87f1f;stroke-width:1}
.pk-ring{fill:rgba(183,138,232,.12);stroke:#b78ae8;stroke-width:1.6}
.pk-enz{fill:#9aa0a6;stroke:none}
.pk-capb{fill:#2fd4c4;stroke:none}
.pk-wp{fill:#f08a4b;stroke:none}
.pk-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-snc{--cc:#e9b84a}.cl-stri{--cc:#7fc4e8}.cl-gpi{--cc:#e5484d}.cl-thal{--cc:#3ec6b8}
.p-dopa{--cc:#e9b84a}.p-dir{--cc:#3ddc97}.p-ind{--cc:#f08a4b}.p-gpi{--cc:#e5484d}.p-thal{--cc:#2fd4c4}.p-ago{--cc:#b78ae8}
.g-dopa{fill:#e9b84a}.g-dir{fill:#3ddc97}.g-ind{fill:#f08a4b}.g-gpi{fill:#e5484d}.g-move{fill:#2fd4c4}
.pk-limb{fill:none;stroke:var(--anatomy-strong);stroke-width:5;stroke-linecap:round}
.pk-hand{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
body[data-theme="light"] .pk-dopa{stroke:#b8860b}
body[data-theme="light"] .p-dopa{--cc:#b8860b}
`;

buildScene({
  id: "parkinson-basal-ganglia", fig: "Fig 1", title: "Parkinson disease: dopamine loss slows movement", W, H, body, extraCss,
  label: "An animated basal ganglia circuit in Parkinson disease. A real brain anchors the story. Dopamine cells in the substantia nigra send dopamine up to the striatum. The striatum splits into a green go path that loosens the GPi brake and an orange stop path that tightens it. The brake holds the thalamus down, and the thalamus drives the limb. When nigra cells are lost, dopamine fades, the stop path wins, the brake clamps shut, and the limb moves slowly and shakes at rest. Levodopa falls into the brain and turns into fresh dopamine, an agonist docks on striatal receptors and wakes the go path without new dopamine, and an MAO-B or COMT inhibitor caps the breakdown enzymes so each dopamine packet lasts longer.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "park.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With levodopa",
  sourcesLis: [
    "<strong>The circuit.</strong> Dopamine from the substantia nigra pars compacta excites D1 neurons of the direct pathway and inhibits D2 neurons of the indirect pathway in the striatum. The direct pathway inhibits the GPi, which releases its inhibition of the thalamus and so promotes movement. The indirect pathway runs through the GPe and the subthalamic nucleus (drawn here as one stop lane): it ends by exciting the GPi, which increases inhibition of the thalamus and suppresses movement. This is standard teaching in neurology and basal ganglia physiology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What goes wrong in Parkinson disease.</strong> Dopamine neurons of the substantia nigra are progressively lost, so striatal dopamine falls. The direct pathway becomes underactive and the indirect pathway becomes overactive. The GPi brake therefore holds the thalamus down, thalamic drive falls, and movement becomes slow and small (bradykinesia), with rigidity and a resting tremor. Non motor features, Lewy pathology and tremor circuitry in detail are not drawn. This is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Levodopa is a dopamine precursor that is converted to dopamine in the brain. A dopamine agonist stimulates dopamine receptors directly. A MAO-B inhibitor slows dopamine breakdown in the brain, and a COMT inhibitor slows levodopa breakdown, so each prolongs dopamine action; on its own the inhibitor needs some dopamine to be present. None restores the lost neurons. These are teaching toggles only, not a guide to choosing a medicine.",
  ],
  simplified: "Alpha synuclein and Lewy bodies, the exact cause of neuron loss, tremor generation in detail, the separate GPe and STN relays (merged into one stop lane), non motor symptoms (mood, sleep, smell, cognition, autonomic features), gait freezing and falls, dyskinesia and wearing off with long term treatment, deep brain stimulation, physiotherapy and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
