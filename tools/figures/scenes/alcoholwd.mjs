/* Alcohol withdrawal as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/alcoholwd.mjs [--print-model]
 * Static layout here; particles, signs and gauges move in alcoholwd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage after the last drink", a: [0.3, 0.65, 1], names: ["early", "seizures", "delirium tremens"], ticks: ["early", "seizures", "delirium tremens"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "benzodiazepine" },
    { label: "thiamine" },
    { label: "supportive fluids" },
  ],
  status: "Withdrawal: {level} · {drug} ·",
  drugNames: ["no treatment", "a benzodiazepine", "thiamine", "supportive fluids"],
};
function modelOf(S, level, drug) {
  const K = { gBase: 0.78, gFall: 0.58, eBase: 0.22, eRise: 0.68, autBase: 0.28, autRise: 0.62, benzoGaba: 0.48, benzoCalm: 0.42, benzoAut: 0.35, fluidAut: 0.28 };
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const benzo = drug === 1 ? 1 : 0, thia = drug === 2 ? 1 : 0, fluids = drug === 3 ? 1 : 0;
  const G0 = cl(K.gBase - K.gFall * a), E0 = cl(K.eBase + K.eRise * a);
  const Aut0 = cl(K.autBase + K.autRise * a), Conf0 = cl(0.05 + 0.9 * a * a);
  const Exc0 = cl(0.55 * E0 + 0.65 * (1 - G0) - 0.08);
  const G = cl(G0 + benzo * K.benzoGaba), E = E0;
  const Exc = benzo ? cl(Exc0 * K.benzoCalm) : Exc0;
  const Aut = cl(Aut0 - benzo * K.benzoAut - fluids * K.fluidAut);
  const Conf = cl(Conf0 - benzo * 0.18);
  const Thi = thia ? 0.9 : cl(0.55 - 0.35 * a);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(G, 0.35, 0.6, ["low", "reduced", "steady"]), w(E, 0.5, 0.75, ["mild", "raised", "high"]), w(Aut, 0.4, 0.65, ["settled", "active", "racing"]), w(Thi, 0.35, 0.65, ["low", "partly filled", "replaced"])];
  return { a, tl: level, benzo, thia, fluids, G, E, Exc, Aut, Conf, Thi, words, readout: "inhibition " + words[0] + " · excitation " + words[1] + " · autonomic " + words[2] + " · thiamine " + words[3] };
}
const TESTS = [
  [0, 0, "inhibition steady · excitation mild · autonomic active · thiamine partly filled"],
  [1, 0, "inhibition reduced · excitation raised · autonomic racing · thiamine low"],
  [2, 0, "inhibition low · excitation high · autonomic racing · thiamine low"],
  [2, 1, "inhibition steady · excitation high · autonomic active · thiamine low"],
  [2, 2, "inhibition low · excitation high · autonomic racing · thiamine replaced"],
  [2, 3, "inhibition low · excitation high · autonomic active · thiamine low"],
];

/* ---------------- static layout ---------------- */
/* Timeline inset x34-926 y84-140 (line y122, dots x260/540/810). Synapse field x34-620 y158-440.
   Right inset x640-932 y158-432: heart row y~222, muscle row y~294, brain row y~384. Gauges panel below y448+. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">AFTER THE LAST DRINK: THE BRAIN REBOUNDS</text>
<rect class="sc-inset" x="34" y="84" width="892" height="56" rx="10"/>
<text class="sc-lab" x="48" y="104">TIME AFTER LAST DRINK</text>
<text class="sc-lab" x="260" y="104" text-anchor="middle">early</text>
<text class="sc-lab" x="540" y="104" text-anchor="middle">seizures</text>
<text class="sc-lab" x="810" y="104" text-anchor="middle">delirium tremens</text>
<rect class="sc-tl-track" x="70" y="120" width="820" height="4" rx="2"/>
<rect id="tl-prog" class="sc-tl-prog" x="70" y="120" width="190" height="4" rx="2"/>
<circle id="tl0" class="sc-tl" cx="260" cy="122" r="7"/>
<circle id="tl1" class="sc-tl" cx="540" cy="122" r="7"/>
<circle id="tl2" class="sc-tl" cx="810" cy="122" r="7"/>
<g id="sending"></g>
<g id="receiving"></g>
<rect id="gaba-rec" class="rec-gaba" x="382" y="228" width="12" height="28" rx="4"/>
<rect id="nmda-rec" class="rec-nmda" x="382" y="300" width="12" height="28" rx="4"/>
<rect class="sc-inset" x="640" y="158" width="292" height="274" rx="12"/>
<text class="sc-zone" x="656" y="182">BODY AND BRAIN</text>
<path id="surgeVessel" class="aw-vessel" d="M470 308 C555 318 630 358 745 408"/>
<g id="heartSlot"></g>
<g id="muscleSlot"></g>
<g id="brainSlot"></g>
<path id="pulse" class="aw-pulse" d="M745 222 L768 222 L776 200 L786 244 L794 212 L800 222 L915 222"/>
<g id="ivG"></g>
<g id="fx"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-pre{--cc:#7fc4e8}.cl-post{--cc:#e8a04c}
.p-gaba{--cc:#2fd4c4}.p-glu{--cc:#ff8a3d}.p-thia{--cc:#e8d36a}
.g-inh{fill:#2fd4c4}.g-exc{fill:#ff8a3d}.g-hyp{fill:var(--c-bad)}.g-aut{fill:#f08a4b}.g-conf{fill:#c084fc}.g-thi{fill:#e8d36a}
.sc-inset{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-tl-track{fill:var(--anatomy-faint)}
.sc-tl-prog{fill:var(--c-bad)}
.sc-tl{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.4}
.rec-gaba{fill:#2fd4c4;stroke:color-mix(in srgb,#2fd4c4 50%,#000);stroke-width:.8}
.rec-nmda{fill:#ff8a3d;stroke:color-mix(in srgb,#ff8a3d 50%,#000);stroke-width:.8}
.aw-vessel{fill:none;stroke:color-mix(in srgb,#ff8a3d 55%,var(--anatomy-paper));stroke-width:13;stroke-linecap:round;opacity:.55}
.aw-pulse{fill:none;stroke:#f08a4b;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.aw-calm{fill:#2fd4c4;stroke:none}
.aw-inj{fill:var(--c-bad);stroke:none}
.aw-shield{fill:none;stroke:#e8d36a;stroke-width:1.6;stroke-dasharray:5 4}
.aw-tick{fill:none;stroke:#e8a04c;stroke-width:2.2;stroke-linecap:round}
.aw-bag{fill:#dfe9f2;stroke:var(--anatomy-mid);stroke-width:1.2}
.aw-fluid{fill:#7ab8ff;stroke:none}
.aw-line{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.aw-dock{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.aw-cap{fill:var(--anatomy-strong);font-size:12px}
`;

buildScene({
  id: "alcohol-withdrawal", fig: "Fig 1", title: "Alcohol withdrawal: the adapted brain rebounds", W, H, body, extraCss,
  label: "An animated brain synapse and body signs after alcohol stops. Chronic alcohol enhanced GABA inhibition and blocked NMDA glutamate receptors, so the brain adapted by weakening GABA and strengthening glutamate. When alcohol stops abruptly, inhibition falls and glutamate excitation surges. A timeline runs from early withdrawal through seizures to delirium tremens, with a racing heart, shaking muscle and a confused brain on the right. A benzodiazepine docks on the GABA brake and calms firing, thiamine shields the brain, and fluids drip in to support circulation. Gauges show inhibition, excitation, brain excitability, autonomic drive, confusion and thiamine store.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "alcoholwd.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With a benzodiazepine",
  sourcesLis: [
    "<strong>Why withdrawal excites the brain.</strong> Alcohol enhances inhibition through GABA receptors and blocks excitatory NMDA glutamate receptors. With chronic use the brain adapts in the opposite direction: GABA signalling weakens and glutamate signalling strengthens. When drinking stops abruptly, the adapted brain is left with too little inhibition and too much excitation. This is standard teaching in pharmacology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>How it unfolds over time.</strong> Early withdrawal brings tremor, sweating, a racing pulse and anxiety. Seizures may follow as excitability rises. Delirium tremens is the most severe stage, with marked autonomic hyperactivity, agitation and confusion. Only this broad sequence is drawn here, without any timing numbers.",
    "<strong>Treatment ideas shown.</strong> A benzodiazepine restores GABA inhibition and calms excitability. Thiamine replaces a vitamin store that chronic alcohol use depletes and protects the brain, but it does not by itself calm withdrawal excitability. Supportive fluids support circulation. These are teaching toggles only, not a guide to treating any person.",
  ],
  simplified: "Wernicke encephalopathy and Korsakoff syndrome in detail, kindling, hallucinations, electrolyte and glucose problems, withdrawal scales and monitoring, other sedatives, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
