/* Guillain-Barre syndrome as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gbs.mjs [--print-model]
 * Static layout here; antibodies, complement, myelin, conduction, devices and gauges move in gbs.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of the illness", a: [0.5, 1, 0.22], names: ["onset", "plateau", "recovery"], ticks: ["onset", "plateau", "recovery"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "ventilatory support only" },
    { label: "IVIG (intravenous immunoglobulin)" },
    { label: "plasma exchange" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "ventilatory support", "IVIG", "plasma exchange"],
};
function modelOf(S, level, drug) {
  const PH = [
    { atk: 0.52, loss: 0.3, ax: 0.1, csf: 0.3 },
    { atk: 1, loss: 0.85, ax: 0.55, csf: 0.9 },
    { atk: 0.22, loss: 0.48, ax: 0.34, csf: 0.68 },
  ];
  const TF = [
    { imm: 0, vent: 0 },
    { imm: 0, vent: 1 },
    { imm: 0.55, vent: 0 },
    { imm: 0.68, vent: 0 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ph = PH[level], tf = TF[drug];
  const atk = cl(ph.atk * (1 - tf.imm * 0.72));
  const axonal = cl(ph.ax * (1 - tf.imm * 0.5));
  const myelinLoss = cl(ph.loss - tf.imm * 0.45 - (level === 2 ? tf.imm * 0.08 : 0));
  const conduction = cl(1 - myelinLoss * 0.82 - axonal * 0.32);
  const weakness = cl(0.08 + myelinLoss * 0.62 + axonal * 0.42);
  const autonomic = cl(atk * 0.45 + weakness * 0.42);
  const breathRisk = cl(weakness * 0.88 + axonal * 0.18);
  const breathing = cl(1 - breathRisk * 0.82 + tf.vent * 0.62);
  const csfProtein = cl(ph.csf - tf.imm * 0.08);
  const recovery = cl((level === 2 ? 0.72 : level === 0 ? 0.12 : 0.3) + tf.imm * 0.16 - axonal * 0.28);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(weakness, 0.34, 0.66, ["mild", "moderate", "severe"]),
    w(breathing, 0.38, 0.68, ["failing", "strained", "supported"]),
    w(conduction, 0.34, 0.66, ["blocked", "slowed", "preserved"]),
  ];
  return { atk, axonal, myelinLoss, conduction, weakness, autonomic, breathRisk, breathing, csfProtein, recovery, imm: tf.imm, vent: tf.vent, rx: drug, words, readout: "weakness " + words[0] + " · breathing " + words[1] + " · conduction " + words[2] };
}
const TESTS = [
  [1, 0, "weakness severe · breathing failing · conduction blocked"],
  [1, 2, "weakness moderate · breathing strained · conduction slowed"],
  [1, 1, "weakness severe · breathing supported · conduction blocked"],
  [2, 3, "weakness mild · breathing supported · conduction preserved"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="gbs-arr" d="M160 135C195 135 230 135 272 135"/>
<path class="gbs-arr" d="M352 160C375 195 395 225 410 252"/>
<g id="nodes"></g>
<g id="nerve"></g>
<g id="heartSlot"></g><g id="lungLSlot"></g><g id="lungRSlot"></g><g id="muscleSlot"></g>
<g id="parts"></g>
<g id="cells"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-germ{--cc:#7fcf6a}.cl-plasma{--cc:#e8d36a}.cl-macc{--cc:var(--c-mac)}
.gbs-arr{fill:none;stroke:var(--anatomy-mid);stroke-width:1.5;stroke-linecap:round;stroke-dasharray:4 5;opacity:.65}
.gbs-axon{fill:#e8a33d;stroke:color-mix(in srgb,#e8a33d 55%,#000);stroke-width:.8}
.gbs-myelin{fill:#5ec1a0;stroke:color-mix(in srgb,#5ec1a0 55%,#000);stroke-width:1}
.gbs-nuc{fill:color-mix(in srgb,#5ec1a0 45%,#1a1030);opacity:.8}
.gbs-gang{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.gbs-abpath{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.gbs-comp{fill:#ff5e8a;stroke:color-mix(in srgb,#ff5e8a 50%,#000);stroke-width:.5}
.gbs-frag{fill:#5ec1a0;stroke:color-mix(in srgb,#5ec1a0 50%,#000);stroke-width:.5}
.gbs-sig{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 50%,#000);stroke-width:.5}
.gbs-block{fill:#8fe388;stroke:color-mix(in srgb,#8fe388 50%,#000);stroke-width:.8}
.gbs-trap{fill:var(--c-ab);stroke:color-mix(in srgb,var(--c-ab) 50%,#000);stroke-width:.5}
.gbs-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round;opacity:.75}
.gbs-devbox{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.gbs-devline{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.gbs-ivliq{fill:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper));stroke:none}
.gbs-screen{fill:color-mix(in srgb,var(--c-fl) 25%,var(--anatomy-card));stroke:var(--anatomy-mid);stroke-width:1}
.gbs-filter{fill:color-mix(in srgb,var(--c-ab) 18%,var(--anatomy-card));stroke:var(--c-ab);stroke-width:1.2}
.gbs-folds{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.gbs-pump{fill:none;stroke:var(--c-ab);stroke-width:2.4;stroke-linecap:round}
.gbs-cap{fill:var(--anatomy-strong);font-size:12px}
.p-drip{--cc:var(--c-fl)}.p-air{--cc:#9fd8ff}.p-clean{--cc:#cfe6ff}
.dr-g-fill.g-atk{fill:#ff5e8a}.dr-g-fill.g-myl{fill:#5ec1a0}.dr-g-fill.g-cond{fill:var(--c-good)}.dr-g-fill.g-weak{fill:var(--c-bad)}.dr-g-fill.g-bre{fill:var(--c-fl)}
`;

buildScene({
  id: "guillain-barre-syndrome", fig: "Fig 1", title: "Guillain-Barre syndrome: mimicry, demyelination and recovery", W, H, body, extraCss,
  label: "An animated peripheral nerve in Guillain-Barre syndrome, read left to right. After a germ infection, mistaken antibodies with complement attack myelin and nodes, a macrophage strips myelin, signals block and muscles weaken toward the lungs. Treatment devices appear top right: an IVIG drip that caps antibodies, a plasma exchange filter that traps them, or a ventilator that breathes for the patient. Gauges show attack, myelin loss, conduction, weakness and breathing. The phase slider moves from onset to plateau to recovery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, laboratory values or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "gbs.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With plasma exchange",
  sourcesLis: [
    "<strong>How Guillain-Barre syndrome develops.</strong> Guillain-Barre syndrome is an acute immune polyradiculoneuropathy and one of the acute flaccid neuropathies. It usually follows an infection. Molecular mimicry is central: microbial sugars can resemble gangliosides on peripheral nerve axons and myelin, so antibodies made against the microbe cross react with nerve. Antibody binding at nodes of Ranvier, paranodal proteins such as NF155 (neurofascin 155), myelin and axolemma activates complement. Complement and antibody recruit a macrophage that strips myelin in the demyelinating form, giving a demyelinating neuropathy with slowed conduction and conduction block. In the acute motor axonal neuropathy form (AMAN) and the acute motor and sensory axonal neuropathy form (AMSAN), attack at nodes and axons causes axonal degeneration, which recovers slowly. Early disease can look mild, then weakness ascends from the legs, reflexes are lost (areflexia), and sensory symptoms, autonomic instability and, when severe, diaphragmatic weakness with respiratory failure can follow. This is standard teaching in neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Spinal fluid and nerve tests.</strong> Cerebrospinal fluid classically shows albuminocytological dissociation: raised protein with little or no pleocytosis, meaning few white cells, though protein can be normal early. Nerve conduction studies can show demyelinating slowing and block, or reduced motor and sensory amplitudes when axonal loss dominates. The level of protein and the conduction pattern help classify the neuropathy but do not by themselves set treatment.",
    "<strong>Treatment ideas shown.</strong> IVIG is pooled polyclonal immunoglobulin (not a monoclonal antibody); it can neutralise pathogenic antibodies, block Fc receptors and damp complement. Plasma exchange physically removes circulating antibodies and complement factors. Given early, either can shorten the plateau and hasten recovery; they are not usually combined in this teaching figure. Ventilatory support does not change the immune attack, myelin loss or axonal degeneration: it supports breathing and buys time while the nerve repairs, by remyelination in demyelinating disease and by slower axonal regrowth after axonal injury. Teaching toggles only.",
  ],
  simplified: "Named antecedent infections beyond the generic trigger, antibody subtypes and ganglioside targets in detail, Miller Fisher and other regional variants, pain and bladder features in detail, electrophysiology subtypes in full, rehabilitation, and every drug, dose and test threshold are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
