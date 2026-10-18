/* Tetanus and botulism toxins as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/tetanus.mjs [--print-model]
 * Static layout here; toxin travel, transmitters and gauges move in tetanus.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Toxin", a: [1, 1], names: ["tetanus", "botulism"], ticks: ["tetanus", "botulism"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antitoxin" },
    { label: "wound care and vaccine" },
    { label: "supportive ventilation" },
  ],
  status: "Toxin: {level} · {drug} ·",
  drugNames: ["no treatment", "antitoxin", "wound care and vaccine", "supportive ventilation"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const tet = level === 0 ? 1 : 0;
  const anti = drug === 1 ? 1 : 0, wound = drug === 2 ? 1 : 0, vent = drug === 3 ? 1 : 0;
  const Free = cl(0.9 - anti * 0.4 - wound * (tet ? 0.5 : 0.3));
  const Block = cl(Free * 0.95);
  const Effect = Block;
  const Breath = cl(0.15 + 0.75 * Effect - vent * 0.55);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const tw = w(Free, 0.3, 0.65, ["low", "present", "high"]);
  const ew = w(Effect, 0.3, 0.65, ["low", "moderate", "high"]);
  const bw = w(Breath, 0.35, 0.65, ["comfortable", "strained", "failing"]);
  const mid = tet ? "rigidity " + ew : "weakness " + ew;
  return { tet, anti, wound, vent, Free, Block, Effect, Breath, words: [tw, ew, bw], readout: "toxin " + tw + " · " + mid + " · breathing " + bw };
}
const TESTS = [
  [0, 0, "toxin high · rigidity high · breathing failing"],
  [0, 1, "toxin present · rigidity moderate · breathing strained"],
  [1, 0, "toxin high · weakness high · breathing failing"],
  [1, 3, "toxin high · weakness high · breathing comfortable"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="66">WOUND</text>
<text class="sc-zone" x="370" y="66">SPINAL CORD</text>
<text class="sc-zone" x="700" y="66">MUSCLE AND LUNGS</text>
<rect class="tn-wound" x="45" y="280" width="140" height="70" rx="12"/>
<path class="tn-cut" d="M78 280L96 316L84 350M132 280L120 312L138 350"/>
<g class="tn-spores"><ellipse cx="70" cy="300" rx="7" ry="4"/><ellipse cx="105" cy="330" rx="7" ry="4"/><ellipse cx="145" cy="305" rx="7" ry="4"/><ellipse cx="125" cy="292" rx="6" ry="3.4"/><ellipse cx="88" cy="318" rx="6" ry="3.4"/><ellipse cx="158" cy="332" rx="6" ry="3.4"/></g>
<rect id="bandage" class="tn-band" x="52" y="292" width="126" height="46" rx="10" opacity="0"/>
<path class="tn-axon" d="M185 300C260 240 340 180 428 148"/>
<path class="tn-axon" d="M512 150C580 198 630 248 664 288"/>
<rect class="tn-cord" x="360" y="98" width="200" height="92" rx="16"/>
<g id="lungsG"><ellipse class="tn-lung" cx="762" cy="150" rx="26" ry="34"/><ellipse class="tn-lung" cx="822" cy="150" rx="26" ry="34"/><path class="tn-airway" d="M792 108V138M792 138L772 150M792 138L812 150"/></g>
<g id="ventG" opacity="0"><rect class="tn-vent" x="862" y="118" width="62" height="52" rx="8"/><circle class="tn-fan" cx="893" cy="144" r="13"/><path class="tn-fan" d="M893 144L893 133M893 144L903 150M893 144L883 150"/><path class="tn-tube" d="M862 144C842 144 830 146 824 148"/></g>
<g id="muscleG"><rect class="tn-muscle" x="690" y="250" width="230" height="110" rx="16"/><path class="tn-fibre" d="M706 278H904M706 305H904M706 332H904"/></g>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "tetanus-botulism-toxins", fig: "Fig 1", title: "Tetanus and botulism: two toxins, opposite paralysis", W, H, body,
  label: "An animated wound, motor neuron, spinal cord, neuromuscular junction, muscle and lungs. In tetanus, spores in a wound release tetanospasmin, which travels backwards along the motor neuron to the spinal cord and blocks release of the inhibitory transmitters glycine and GABA, so muscles lock in spasm, including the jaw. In botulism, botulinum toxin blocks acetylcholine release at the neuromuscular junction, so muscles go floppy and weak. Treatments shown are antitoxin, wound care with vaccine, and supportive ventilation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "tetanus.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Tetanus.</strong> Clostridium tetani spores enter a wound and germinate in low oxygen tissue. Tetanospasmin is taken up at the neuromuscular junction and travels retrograde inside the motor neuron to the spinal cord, where it blocks release of the inhibitory transmitters glycine and GABA from interneurons. Without that braking signal the motor neuron fires unchecked, giving spastic paralysis, rigidity and lockjaw (trismus). This is standard teaching in microbiology and neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Botulism.</strong> Botulinum toxin reaches nerve endings and blocks acetylcholine release at the neuromuscular junction by cleaving release machinery proteins. The muscle receives no signal, giving flaccid paralysis and weakness that can reach the breathing muscles. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antitoxin neutralises toxin that is still free and unbound; it cannot undo toxin already inside neurons. Wound care removes the spore source and vaccine builds protection against future toxin. Supportive ventilation breathes for the patient while the nerve endings recover. These are teaching toggles only.",
  ],
  simplified: "Toxin serotypes, the exact SNARE proteins cleaved, spore germination conditions, descending versus generalised patterns, autonomic effects, electromyography, and all drug names, doses and timing are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.tn-wound{fill:color-mix(in srgb,var(--c-rbc) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,var(--anatomy-mid));stroke-width:1.2}
.tn-cut{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.tn-spores ellipse{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.8}
.tn-band{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1}
.tn-axon{fill:none;stroke:var(--c-lymph);stroke-width:6;stroke-linecap:round}
.tn-cord{fill:color-mix(in srgb,var(--c-mac) 24%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.4}
.tn-lung{fill:color-mix(in srgb,var(--c-endo) 38%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.3}
.tn-airway{fill:none;stroke:var(--anatomy-mid);stroke-width:2.4;stroke-linecap:round}
.tn-muscle{fill:color-mix(in srgb,var(--c-rbc) 26%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.3}
.tn-fibre{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.6;opacity:.65}
.tn-vent{fill:color-mix(in srgb,var(--c-cyt2) 24%,var(--anatomy-paper));stroke:var(--c-cyt2);stroke-width:1.3}
.tn-fan{fill:var(--anatomy-paper);stroke:var(--c-cyt2);stroke-width:1.2}
.tn-tube{fill:none;stroke:var(--c-cyt2);stroke-width:2.4}
.cl-bact{--cc:var(--c-bac)}.cl-inhib{--cc:var(--c-good)}.cl-motor{--cc:var(--c-neut)}.cl-bouton{--cc:var(--c-b)}
.p-tox{--cc:var(--c-bad)}.p-inh{--cc:var(--c-good)}.p-ach{--cc:var(--c-b)}.p-ab{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round}.p-air{--cc:var(--c-cyt2)}
.dr-g-fill.g-tox{fill:var(--c-bad)}.dr-g-fill.g-blk{fill:var(--c-cyt)}.dr-g-fill.g-eff{fill:var(--c-rbc)}.dr-g-fill.g-br{fill:var(--c-fl)}
`,
});
