/* Motor neuron disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/mnd.mjs [--print-model]
 * Static layout here; neurons, signals, aggregates and gauges move in mnd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of the disease", a: [0.3, 0.65, 1], names: ["early", "established", "advanced"], ticks: ["early", "established", "advanced"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "riluzole concept (calm excitotoxic drive)" },
    { label: "multidisciplinary support" },
    { label: "ventilatory support" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "riluzole concept", "multidisciplinary support", "ventilatory support"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const ril = drug === 1 ? 1 : 0, sup = drug === 2 ? 1 : 0, vent = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const D = cl(a * (ril ? 0.82 : 1));                                   // motor neuron death, slowed a little by the riluzole concept
  const Agg = cl(0.12 + 0.82 * a * (ril ? 0.78 : 1));                   // TDP-43 protein aggregate burden
  const UMN = cl(0.08 + 0.88 * D);                                      // upper motor neuron loss
  const LMN = cl(0.05 + 0.85 * D);                                      // lower motor neuron loss
  const Wast = cl(0.04 + 0.82 * LMN);                                   // wasting (atrophy) from lost lower motor neurons
  const Spast = cl(0.06 + 0.88 * UMN);                                  // spasticity from lost upper motor neuron control
  const Fasc = cl((0.15 + 0.85 * LMN) * (1 - 0.45 * LMN));              // fasciculations: lively while sick neurons still fire, fading as they die
  const Bulb = cl(0.05 + 0.85 * a * a + 0.2 * a * D);                   // bulbar involvement: speech and swallowing
  const Resp = cl(0.04 + 0.9 * Math.pow(a, 2.2) * (vent ? 0.35 : 1));  // respiratory failure risk from a weak diaphragm
  const Breath = cl(1 - Resp + vent * 0.45);                            // breathing, lifted by ventilatory support
  const Func = cl(1 - 0.55 * Wast - 0.35 * Bulb - 0.25 * (1 - Breath) + sup * 0.38 + vent * 0.12);
  const Neur = cl(1 - D);                                               // surviving motor neurons
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Neur, 0.35, 0.7, ["few left", "reduced", "many left"]), w(Wast, 0.3, 0.62, ["preserved", "wasting", "severe wasting"]), w(Breath, 0.4, 0.68, ["failing", "strained", "supported"])];
  return { a, ril, sup, vent, D, Agg, UMN, LMN, Wast, Spast, Fasc, Bulb, Resp, Breath, Func, Neur, words, readout: "motor neurons " + words[0] + " · muscle " + words[1] + " · breathing " + words[2] };
}
const TESTS = [
  [0, 0, "motor neurons many left · muscle preserved · breathing supported"],
  [1, 0, "motor neurons reduced · muscle wasting · breathing strained"],
  [2, 0, "motor neurons few left · muscle severe wasting · breathing failing"],
  [2, 3, "motor neurons few left · muscle severe wasting · breathing supported"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="mn-box" x="560" y="55" width="370" height="80" rx="14"/>
<text class="sc-zone" x="34" y="68">MOTOR CORTEX</text>
<text class="sc-zone" x="580" y="74">WHY NEURONS DIE</text>
<g id="tracts"></g>
<g id="organs"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "motor-neuron-disease", fig: "Fig 1", title: "Motor neuron disease: upper and lower motor neurons lost", W, H, body,
  label: "An animated motor pathway. An upper motor neuron in the motor cortex sends its axon down the corticospinal tract to a lower motor neuron in the spinal cord, which drives limb muscle. A bulbar motor neuron drives the tongue for speech and swallowing, and a further lower motor neuron drives the diaphragm. As the disease advances both upper and lower motor neurons die, so muscle wastes and fasciculates while movement becomes spastic and stiff. Sensation and eye movements are spared. Gauges show surviving motor neurons, wasting, fasciculations, spasticity, bulbar signs and breathing. Treatment choices show the riluzole concept, multidisciplinary support and ventilatory support.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "mnd.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With ventilatory support",
  sourcesLis: [
    "<strong>How motor neuron disease develops.</strong> In amyotrophic lateral sclerosis, the commonest adult form, upper motor neurons in the motor cortex and lower motor neurons in the brainstem and spinal cord die together, so brisk reflexes and spasticity sit beside wasting, weakness and fasciculations. Most cases are sporadic, with no family history. A minority are inherited: mutant genes include an expanded intronic repeat in C9orf72, where short repeats are expanded many times over, and changes in genes for proteins such as the survival and RNA handling proteins. Inside dying neurons, TDP-43, a protein that normally lives in the nucleus, clumps in the cytoplasm as aggregates, and this protein pathology is a hallmark of the disease group. Excitotoxic drive, faulty RNA handling, and failure of protein clearing are among the mechanisms proposed, because no single cause explains every case. Other patterns in the group include primary lateral sclerosis, where upper motor neurons dominate, and childhood spinal muscular atrophy, where loss of the survival motor neuron protein weakens lower motor neurons early in onset. This is standard teaching in neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What the disease spares and what it threatens.</strong> Sensation and eye movements are characteristically spared, because sensory pathways and the eye movement nuclei are largely untouched, which helps separate this disease from multiple other causes of weakness. Bulbar involvement weakens speech and swallowing, and death most often follows respiratory failure when the diaphragm and breathing muscles fail over the course of the illness. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Riluzole is an approved drug thought to calm excitotoxic glutamate drive; the concept is shown here as slower neuron loss, without any claim about size of benefit. Multidisciplinary support (physiotherapy, speech and swallowing help, nutrition, aids and planning) supports function without changing neuron death. Ventilatory support rests and assists the breathing muscles and supports breathing without changing the underlying course. These are teaching toggles only.",
  ],
  simplified: "The separate named patterns and genes beyond the examples named, the debate about where the disease begins, spread from cell to cell, cognitive and behavioural change in part of the group, investigations, eligibility rules for support, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
  extraCss: `
.mn-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.mn-cortex{fill:color-mix(in srgb,var(--c-mac) 22%,var(--c-tis));stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:1}
.mn-cord{fill:color-mix(in srgb,var(--c-endo) 20%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}
.mn-stem{fill:color-mix(in srgb,var(--c-endo) 32%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}
.mn-tract{fill:none;stroke:var(--c-mac);stroke-width:3;stroke-linecap:round;opacity:.75}
.mn-axon{fill:none;stroke:var(--c-lymph);stroke-width:2.4;stroke-linecap:round;opacity:.8}
.mn-sens{fill:none;stroke:var(--c-good);stroke-width:2;stroke-dasharray:5 4;stroke-linecap:round;opacity:.8}
.mn-muscle{fill:color-mix(in srgb,var(--c-rbc) 38%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.mn-fibre{stroke:color-mix(in srgb,var(--c-rbc) 65%,#fff);stroke-width:2;opacity:.55;fill:none}
.mn-tongue{fill:color-mix(in srgb,var(--c-rbc) 45%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.mn-diaph{fill:color-mix(in srgb,var(--c-fl) 30%,var(--c-tis));stroke:var(--c-fl);stroke-width:1.4}
.mn-spared{fill:var(--anatomy-card);stroke:var(--c-good);stroke-width:1.2}
.mn-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.mn-iris{fill:var(--c-lymph)}
.mn-check{fill:none;stroke:var(--c-good);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mn-dna{fill:none;stroke:var(--c-cyt);stroke-width:2;stroke-linecap:round}
.mn-dna2{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.mn-rung{stroke:var(--anatomy-mid);stroke-width:1}
.mn-mask{fill:none;stroke:var(--c-fl);stroke-width:2;stroke-linecap:round}
.cl-umn{--cc:var(--c-mac)}.cl-lmn{--cc:var(--c-lymph)}.cl-bulb{--cc:var(--c-eos)}.cl-sens{--cc:var(--c-good)}
.p-sig{--cc:#ffd24a}.p-agg{--cc:var(--c-cyt)}.p-glu{--cc:#ff9a3d}.p-air{--cc:var(--c-fl)}
.mn-spark{stroke:#ffd24a;stroke-width:1.6;stroke-linecap:round;fill:none}
.mn-help{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 50%,#000);stroke-width:.6}
.dr-g-fill.g-neur{fill:var(--c-good)}.dr-g-fill.g-wast{fill:var(--c-bad)}.dr-g-fill.g-fasc{fill:var(--c-neut)}.dr-g-fill.g-spast{fill:var(--c-mac)}.dr-g-fill.g-bulb{fill:var(--c-eos)}
`,
});
