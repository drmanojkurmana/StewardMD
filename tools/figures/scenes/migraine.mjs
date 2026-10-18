/* Migraine pathophysiology as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/migraine.mjs [--print-model]
 * Static layout here; the aura wave, trigeminal firing, CGRP, vessel and gauges move in migraine.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of the attack", a: [0.3, 0.65, 1], names: ["prodrome", "aura", "headache"], ticks: ["prodrome", "aura", "headache"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "triptan (acute)" },
    { label: "NSAID (acute)" },
    { label: "CGRP-based treatment (acute)" },
    { label: "preventive treatment" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "a triptan", "an NSAID", "a CGRP-based treatment", "preventive treatment"],
};
function modelOf(S, level, drug) {
  const PH = { hypo: [0.9, 0.45, 0.3], csd: [0.06, 1, 0.32], trig: [0.16, 0.52, 1], brain: [0.8, 0.5, 0.45] };
  const EFF = { trig: [0, 0.42, 0.12, 0.3, 0.38], cgrpSig: [0, 0.38, 0.05, 0.72, 0.3], vaso: [0, 0.5, 0.08, 0.42, 0.25], infl: [0, 0.18, 0.52, 0.3, 0.28] };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const prev = drug === 4 ? 1 : 0;
  const hypo = cl(PH.hypo[level] * (1 - 0.3 * prev));
  const csd = cl(PH.csd[level] * (1 - 0.35 * prev));
  const trig = cl(PH.trig[level] * (1 - EFF.trig[drug]));
  const cgrp = cl(trig * 1.02);
  const cgrpSig = cl(cgrp * (1 - EFF.cgrpSig[drug]) + trig * 0.08 * (1 - EFF.cgrpSig[drug]));
  const vaso = cl((cgrpSig * 0.82 + trig * 0.22) * (1 - EFF.vaso[drug] * 0.55));
  const infl = cl(trig * 0.88 * (1 - EFF.infl[drug]));
  const pain = cl(trig * 0.42 + vaso * 0.22 + infl * 0.24 + cgrpSig * 0.08);
  const photo = cl(pain * 0.72 + csd * 0.3);
  const nausea = cl(hypo * 0.22 + PH.brain[level] * 0.18 + pain * 0.58);
  const trip = drug === 1 ? 1 : 0, nsaid = drug === 2 ? 1 : 0, cgrpRx = drug === 3 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(csd, 0.25, 0.6, ["quiet", "spreading", "active"]), w(trig, 0.3, 0.75, ["quiet", "active", "firing"]), w(pain, 0.28, 0.6, ["none", "mild", "severe"])];
  return { hypo, csd, trig, cgrp, cgrpSig, vaso, infl, pain, photo, nausea, trip, nsaid, cgrpRx, prev, words, readout: "aura wave " + words[0] + " · trigeminal " + words[1] + " · headache " + words[2] };
}
const TESTS = [
  [1, 0, "aura wave active · trigeminal active · headache mild"],
  [2, 0, "aura wave spreading · trigeminal firing · headache severe"],
  [2, 1, "aura wave spreading · trigeminal active · headache mild"],
  [2, 3, "aura wave spreading · trigeminal active · headache mild"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">MIGRAINE PATHWAY</text>
<path class="dr-beam" d="M154 282H250"/>
<path class="dr-beam" d="M400 144C400 195 330 255 318 312"/>
<path class="dr-beam" d="M330 332C365 318 392 306 418 296"/>
<path class="dr-beam" d="M633 272C665 258 690 254 724 258"/>
<path class="dr-beam" d="M724 292C692 312 662 312 634 300"/>
<path class="dr-beam" d="M452 246C452 205 425 165 385 146"/>
<path class="dr-beam" d="M486 262C600 185 715 158 778 150"/>
<path class="dr-beam" d="M330 348C480 402 690 398 782 388"/>
<g id="cortexG"></g>
<g id="nodes"></g>
<g id="vesselG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "migraine-pathophysiology", fig: "Fig 1", title: "Migraine: from prodrome and aura to headache", W, H, body,
  label: "An animated migraine pathway. In the prodrome the hypothalamus and brainstem change activity. In aura a slow wave of cortical spreading depression crosses the cortex. That wave and brainstem signals activate the trigeminovascular system: the trigeminal nucleus and ganglion fire, nerve endings around meningeal vessels release CGRP, the vessel widens and neurogenic inflammation develops. Pain signals relay through the thalamus back to cortex, giving throbbing headache with photophobia, nausea and vomiting. Gauges show the aura wave, trigeminal firing, CGRP signalling, vessel widening, inflammation and headache. Treatment choices include a triptan, an NSAID, a CGRP-based treatment and preventive treatment.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "migraine.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How a migraine attack unfolds.</strong> Migraine is a primary headache disorder, often episodic and sometimes familial. Many attacks have a premonitory or prodrome phase with yawning, food craving, mood change and neck stiffness, linked to the hypothalamus and to brainstem nuclei including the dorsal raphe nucleus and the locus ceruleus, with dopamine and other transmitters involved. A typical aura is thought to reflect cortical spreading depression, a slow wave of neuronal and glial depolarisation followed by suppression, which explains gradually spreading visual, sensory or speech symptoms. Familial hemiplegic migraine shows that neuronal ion-channel dysfunction can lower the threshold for this wave. This is standard neurological teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Trigeminovascular activation and headache.</strong> The wave and brainstem activity activate the trigeminovascular system. Signals pass through the trigeminal nucleus caudalis in the brainstem and the trigeminal ganglion to meningeal vessels. Nerve endings release calcitonin gene-related peptide (CGRP) and other peptides. CGRP acts at its receptor on the vessel and nerve, the meningeal vessel dilates, plasma proteins leak, and neurogenic inflammation sensitises the endings. Pain signals then relay through the thalamus to cortex. Sensitisation gives throbbing pain that worsens with movement, plus photophobia, phonophobia, nausea and vomiting. Vertigo, sensory change and brainstem symptoms can occur in some subtypes. This figure separates migraine from cluster headache, tension-type headache and paroxysmal headache disorders only by mechanism; it does not diagnose probable migraine or any other headache in a person.",
    "<strong>Treatment ideas shown.</strong> A triptan acts at serotonin receptors to constrict the meningeal vessel and reduce CGRP release. An NSAID reduces prostaglandin-driven inflammation and sensitisation. A CGRP-based treatment blocks CGRP or its receptor. Preventive treatment, used regularly, lowers neuronal excitability and how often attacks start, rather than stopping one attack at once. What is effective varies between people. These are teaching toggles only.",
  ],
  simplified: "Aura without headache, chronic migraine, hemiplegic and brainstem subtypes in detail, central sensitisation and allodynia, the full transmitter list, genetics beyond the familial point, triggers, differential diagnosis against cluster, tension-type and paroxysmal disorders, secondary headache causes, and all doses and drug choices are left out. The brain, vessel and stomach are simple schematics, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-hypo:#e8a04c;--c-brain:#8fa8d8;--c-thal:#6fbf9a;--c-gang:#e88a7a;--c-cort:#a88fd0;--c-cgrp:#ff7a9a;--c-stom:#9ab86a}
body[data-theme="light"]{--c-hypo:#c07f2a;--c-brain:#5f83c4;--c-thal:#3f9f76;--c-gang:#c85f4c;--c-cort:#7f63b8;--c-cgrp:#d94f70;--c-stom:#6f9440}
.cl-hypo{--cc:var(--c-hypo)}.cl-thal{--cc:var(--c-thal)}.cl-gang{--cc:var(--c-gang)}.cl-stom{--cc:var(--c-stom)}
.mg-cortex{fill:color-mix(in srgb,var(--c-cort) 38%,var(--c-tis));stroke:color-mix(in srgb,var(--c-cort) 60%,#000);stroke-width:1}
.mg-brain{fill:color-mix(in srgb,var(--c-brain) 42%,var(--c-tis));stroke:color-mix(in srgb,var(--c-brain) 60%,#000);stroke-width:1}
.mg-nuc{fill:var(--c-brain);stroke:color-mix(in srgb,var(--c-brain) 55%,#000);stroke-width:.8}
.mg-nuc2{fill:var(--c-hypo);stroke:color-mix(in srgb,var(--c-hypo) 55%,#000);stroke-width:.8}
.mg-csd{fill:var(--c-bad)}
.mg-wall{fill:color-mix(in srgb,var(--c-endo) 55%,var(--c-tis));stroke:var(--c-endo);stroke-width:1}
.mg-infl{fill:var(--c-bad)}
.mg-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.mg-pupil{fill:var(--anatomy-strong)}
.mg-ray{stroke:#f2c94c;stroke-width:1.6;stroke-linecap:round}
.mg-end{fill:var(--c-gang);stroke:color-mix(in srgb,var(--c-gang) 55%,#000);stroke-width:.7}
.p-trig{--cc:#ffb04a}.p-cgrp{--cc:var(--c-cgrp)}.p-pain{--cc:var(--c-bad)}.p-prod{--cc:var(--c-hypo)}
.dr-g-fill.g-cgrp{fill:var(--c-cgrp)}.dr-g-fill.g-vaso{fill:var(--c-fl)}.dr-g-fill.g-pain{fill:var(--c-bad)}.dr-g-fill.g-csd{fill:var(--c-cort)}
.mg-neuron{fill:var(--c-cort);stroke:color-mix(in srgb,var(--c-cort) 55%,#000);stroke-width:.7}
.mg-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.mg-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
`,
});
