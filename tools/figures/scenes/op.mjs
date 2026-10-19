/* Organophosphate poisoning as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/op.mjs [--print-model]
 * Static layout here; acetylcholine, enzymes, receptors, body organs, signs and gauges move in op.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How much exposure", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "supportive care only" },
    { label: "atropine" },
    { label: "oxime" },
    { label: "atropine and oxime" },
  ],
  status: "Exposure: {level} · {drug} ·",
  drugNames: ["supportive care only", "atropine", "an oxime", "atropine and an oxime"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], atr = drug === 1 || drug === 3 ? 1 : 0, ox = drug === 2 || drug === 3 ? 1 : 0, sup = drug === 0 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const E = cl(a * (ox ? 0.28 : 1));
  const Ach = cl(0.08 + 0.92 * E);
  const Mus = cl(Ach * (atr ? 0.2 : 1));
  const Nic = Ach;
  const Weak = cl((Nic - 0.38) * 1.5);
  const Fasc = cl(Nic * (1 - Weak) * 1.4);
  const Breath = cl((0.55 * Mus + 0.65 * Weak) * (sup ? 0.7 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const sludge = w(Mus, 0.3, 0.6, ["mild", "moderate", "marked"]);
  const breath = w(Breath, 0.3, 0.6, ["steady", "strained", "failing"]);
  const muscle = Weak > 0.55 ? "paralysed" : Fasc > 0.45 ? "twitching" : "steady";
  return { a, atr, ox, sup, E, Ach, Mus, Nic, Weak, Fasc, Breath, words: [sludge, breath, muscle], readout: "SLUDGE signs " + sludge + " · breathing " + breath + " · muscle " + muscle };
}
const TESTS = [
  [2, 0, "SLUDGE signs marked · breathing failing · muscle paralysed"],
  [2, 1, "SLUDGE signs mild · breathing failing · muscle paralysed"],
  [2, 2, "SLUDGE signs moderate · breathing steady · muscle twitching"],
  [2, 3, "SLUDGE signs mild · breathing steady · muscle twitching"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">NERVE ENDING AND SYNAPSE</text>
<text class="sc-zone" x="604" y="68">WHAT THE BODY SHOWS</text>
<rect class="op-axon" x="182" y="44" width="36" height="62" rx="10"/>
<rect class="op-cleft hot" x="50" y="228" width="480" height="78" rx="12" tabindex="0" data-info="The synaptic cleft. Acetylcholine carries the signal across it. The poison blocks the enzyme that clears it, so the signal floods the body."/>
<rect id="achWash" class="op-wash" x="50" y="228" width="480" height="78" rx="12" opacity="0"/>
<rect class="op-post" x="50" y="330" width="480" height="82" rx="12"/>
<ellipse id="dangerGlow" class="op-danger" cx="765" cy="242" rx="168" ry="188" opacity="0"/>
<g id="eyeSlot"></g><g id="lungSlot"></g><g id="gutSlot"></g><g id="musSlot"></g>
<path id="spreadV" class="op-spread" d="M530 372 C556 350 572 300 600 252" opacity="0.5"/>
<g id="syn"></g><g id="parts"></g><g id="fx"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "organophosphate-poisoning", fig: "Fig 1", title: "Organophosphate poisoning: too much acetylcholine", W, H, body,
  label: "An animated synapse and body. An organophosphate blocks acetylcholinesterase, the enzyme that clears acetylcholine, so the signal builds up and keeps gland switches and muscle switches turned on. On the left the poison blocks the enzyme while atropine sits on the gland switches and oxime frees the enzyme. On the right the eye, lung, gut and muscle show what the patient feels: small pupils and tears, tight airways, cramps, twitching and weakness. A slider sets the exposure, and treatment choices are supportive care, atropine, an oxime, or both.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "op.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Supportive care only", withLabel: "With atropine and oxime",
  sourcesLis: [
    "<strong>How organophosphate poisoning works.</strong> Organophosphates (some insecticides and nerve agents) bind and inhibit acetylcholinesterase, the enzyme in synaptic clefts that splits acetylcholine. Acetylcholine then accumulates and overstimulates muscarinic receptors (salivation, lacrimation, urination, defecation, gut cramps, miosis, bronchospasm and slow heart rate, grouped as SLUDGE signs) and nicotinic receptors (muscle twitching and fasciculation, then weakness and paralysis, including the breathing muscles). This is standard teaching in pharmacology and toxicology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Atropine blocks muscarinic receptors, so it eases SLUDGE signs but does not restore the enzyme or fix paralysis. An oxime can reactivate the blocked enzyme before the bond ages, lowering acetylcholine at both receptor types. Supportive care (airway and breathing support) keeps oxygen going while the poison wears off. These are teaching toggles only.",
  ],
  simplified: "Ageing of the enzyme bond, intermediate and delayed syndromes, atropine and oxime choice, seizures and their treatment, decontamination and staff safety, and all doses and targets are left out. One generic synapse stands in for gland, gut, heart and skeletal muscle junctions. The figure does not say how any patient should be treated.",
  extraCss: `
.op-axon{fill:color-mix(in srgb,var(--c-neut) 45%,var(--c-tis));stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.9}
.op-cleft{fill:color-mix(in srgb,var(--c-fl) 10%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:.8}
.op-wash{fill:#ff9a3d;stroke:none}
.op-post{fill:color-mix(in srgb,var(--c-endo) 28%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:.9}
.op-danger{fill:var(--c-bad);stroke:none}
.op-spread{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round}
.cl-pre{--cc:var(--c-neut)}.cl-postc{--cc:var(--c-endo)}
.op-ves{fill:var(--anatomy-paper);stroke:var(--c-neut);stroke-width:1}
.op-enz{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 55%,#000);stroke-width:.7}
.op-enzx{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.op-recM{fill:none;stroke:var(--c-cyt);stroke-width:2.2;stroke-linecap:round}
.op-recN{fill:var(--anatomy-paper);stroke:var(--c-cyt2);stroke-width:1.8}
.op-cap{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.7}
.op-fire{fill:var(--c-cyt);stroke:none}
.op-air{fill:none;stroke:var(--anatomy-hi);stroke-width:2.4;stroke-linecap:round}
.op-wheeze{fill:none;stroke:var(--c-cyt);stroke-width:1.6;stroke-linecap:round}
.op-pupil{fill:#241a12;stroke:none}
.op-tear{fill:var(--c-fl);stroke:none}
.op-secr{fill:var(--c-eos);stroke:none}
.op-guttint{fill:var(--c-cyt);stroke:none}
.op-mustint{fill:var(--c-neut);stroke:none}
.op-fasc{fill:none;stroke:var(--c-cyt2);stroke-width:1.8;stroke-linecap:round}
.op-note{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.op-opdrop{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.p-ach{--cc:#ff9a3d}.p-opx{--cc:var(--c-bad)}.p-atr{--cc:var(--c-good)}.p-oxi{--cc:var(--c-cyt2)}
.dr-g-fill.g-enz{fill:#ffd24a}.dr-g-fill.g-ach{fill:#ff9a3d}.dr-g-fill.g-mus{fill:var(--c-cyt)}.dr-g-fill.g-nic{fill:var(--c-cyt2)}.dr-g-fill.g-weak{fill:var(--c-neut)}
`,
});
