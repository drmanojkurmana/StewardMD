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
  const Free = cl(0.9 - anti * 0.55 - wound * (tet ? 0.3 : 0.15));
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
<ellipse id="woundGlow" class="tn-woundglow" cx="120" cy="295" rx="95" ry="90" opacity="0.6"/>
<g id="skinSlot"></g>
<path id="cut1" class="tn-cut" d="M0 0" fill="none"/>
<path id="cut2" class="tn-cut" d="M0 0" fill="none"/>
<g id="spores" class="tn-spores" opacity="1"><ellipse cx="0" cy="0" rx="7" ry="4"/><ellipse cx="0" cy="0" rx="7" ry="4"/><ellipse cx="0" cy="0" rx="7" ry="4"/><ellipse cx="0" cy="0" rx="6" ry="3.4"/><ellipse cx="0" cy="0" rx="6" ry="3.4"/><ellipse cx="0" cy="0" rx="6" ry="3.4"/></g>
<rect id="bandage" class="tn-band" x="45" y="267" width="150" height="56" rx="10" opacity="0"/>
<path id="axonTet" class="tn-axon" d="M0 0" fill="none"/>
<path id="bloodBot" class="tn-blood" d="M0 0" fill="none"/>
<ellipse id="driveGlow" class="tn-drive" cx="470" cy="160" rx="105" ry="55" opacity="0"/>
<rect id="cord" class="tn-cord" x="380" y="120" width="180" height="100" rx="16"/>
<ellipse id="lungGlow" class="tn-lungglow" cx="737" cy="150" rx="115" ry="85" opacity="0"/>
<g id="lungSlotL"></g>
<g id="lungSlotR"></g>
<path id="airway" class="tn-airway" d="M0 0" fill="none"/>
<g id="muscleSlot"></g>
<ellipse id="spasmTint" class="tn-spasm" cx="790" cy="315" rx="100" ry="48" opacity="0"/>
<ellipse id="flopTint" class="tn-flop" cx="790" cy="315" rx="100" ry="48" opacity="0"/>
<g id="ventG" opacity="0"><rect class="tn-vent" x="790" y="380" width="140" height="48" rx="10"/><path class="tn-cross" d="M852 392h12v10h10v12h-10v10h-12v-10h-10v-12h10Z"/><path id="ventTube" class="tn-tube" d="M0 0" fill="none"/></g>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "tetanus-botulism-toxins", fig: "Fig 1", title: "Tetanus and botulism: two toxins, opposite paralysis", W, H, body,
  label: "An animated wound, motor nerve, spinal cord, nerve muscle junction, muscle and lungs. In tetanus, germs in a wound release toxin that travels backwards along the motor nerve to the spinal cord and stops the brake signal, so muscles lock rigid, including the jaw. In botulism, toxin carried in the blood blocks the go signal where nerve meets muscle, so muscles go weak and floppy. Antitoxin traps free toxin, wound care removes the germ source, and a ventilator breathes for the patient while nerves recover.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "tetanus.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antitoxin",
  sourcesLis: [
    "<strong>Tetanus.</strong> Clostridium tetani spores enter a wound and germinate in low oxygen tissue. Tetanospasmin is taken up at the nerve ending and travels retrograde inside the motor neuron to the spinal cord, where it blocks release of the inhibitory transmitters glycine and GABA from interneurons. Without that braking signal the motor neuron fires unchecked, giving spastic paralysis, rigidity and lockjaw (trismus). This is standard teaching in microbiology and neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Botulism.</strong> Botulinum toxin reaches nerve endings and blocks acetylcholine release at the neuromuscular junction by cleaving release machinery proteins. The muscle receives no signal, giving flaccid paralysis and weakness that can reach the breathing muscles. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antitoxin neutralises toxin that is still free and unbound; it cannot undo toxin already inside neurons. Wound care removes the spore source and vaccine builds protection against future toxin. Supportive ventilation breathes for the patient while the nerve endings recover. These are teaching toggles only.",
  ],
  simplified: "Toxin serotypes, the exact SNARE proteins cleaved, spore germination conditions, descending versus generalised patterns, autonomic effects, electromyography, and all drug names, doses and timing are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.tn-woundglow{fill:var(--c-bad);stroke:none}
.tn-cut{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.tn-spores ellipse{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.8}
.tn-band{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1}
.tn-axon{fill:none;stroke:var(--c-lymph);stroke-width:6;stroke-linecap:round}
.tn-blood{fill:none;stroke:var(--c-bad);stroke-width:5;stroke-linecap:round;stroke-dasharray:8 6}
.tn-drive{fill:var(--c-eos);stroke:none}
.tn-cord{fill:color-mix(in srgb,var(--c-mac) 24%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.4}
.tn-lungglow{fill:var(--c-bad);stroke:none}
.tn-airway{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.tn-spasm{fill:var(--c-bad);stroke:none}
.tn-flop{fill:var(--c-fl);stroke:none}
.tn-vent{fill:color-mix(in srgb,var(--c-cyt2) 24%,var(--anatomy-paper));stroke:var(--c-cyt2);stroke-width:1.3}
.tn-cross{fill:var(--c-cyt2);stroke:none}
.tn-tube{fill:none;stroke:var(--c-cyt2);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
.tn-cap{fill:var(--anatomy-strong)}
.cl-bact{--cc:var(--c-bac)}.cl-inhib{--cc:var(--c-good)}.cl-motor{--cc:var(--c-neut)}.cl-bouton{--cc:var(--c-b)}
.p-tox{--cc:var(--c-bad)}.p-toxhit{--cc:var(--c-ab)}.p-inh{--cc:var(--c-good)}.p-ach{--cc:var(--c-b)}.p-ab{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}.p-air{--cc:var(--c-cyt2)}
.dr-g-fill.g-tox{fill:var(--c-bad)}.dr-g-fill.g-blk{fill:var(--c-cyt)}.dr-g-fill.g-eff{fill:var(--c-rbc)}.dr-g-fill.g-br{fill:var(--c-fl)}
`,
});
