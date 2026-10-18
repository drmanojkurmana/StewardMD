/* Autonomic nervous system as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/auto.mjs [--print-model]
 * Static layout here; fibres, transmitters, organs and gauges move in auto.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Autonomic balance", a: [0, 0.5, 1], names: ["rest and digest", "balanced", "fight or flight"], ticks: ["rest", "balanced", "fight"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "beta blocker" },
    { label: "muscarinic antagonist" },
    { label: "alpha agonist" },
  ],
  status: "Balance: {level} · {drug} ·",
  drugNames: ["no treatment", "a beta blocker", "a muscarinic antagonist", "an alpha agonist"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], para0 = 1 - a;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const betaBlock = drug === 1 ? 1 : 0, muscBlock = drug === 2 ? 1 : 0, alphaBoost = drug === 3 ? 1 : 0;
  const symBeta = a * (1 - 0.8 * betaBlock);
  const symAlpha = cl(a + 0.7 * alphaBoost);
  const paraHeart = para0 * (1 - 0.85 * muscBlock);
  const paraPupil = para0 * (1 - 0.9 * muscBlock);
  const paraAir = para0 * (1 - 0.85 * muscBlock);
  const paraGut = para0 * (1 - 0.85 * muscBlock);
  const heart = cl(0.48 + 0.52 * symBeta - 0.38 * paraHeart);
  const pupil = cl(0.5 + 0.45 * symAlpha - 0.42 * paraPupil + 0.1 * muscBlock);
  const airway = cl(0.55 + 0.3 * symBeta - 0.25 * paraAir);
  const gut = cl(0.5 - 0.35 * a + 0.4 * paraGut - 0.15 * alphaBoost);
  const bladder = cl(0.5 - 0.35 * cl(a + 0.7 * alphaBoost) + 0.4 * paraGut);
  const vessel = cl(0.35 + 0.45 * symAlpha - 0.15 * para0);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(heart, 0.35, 0.65, ["slow", "steady", "fast"]), w(pupil, 0.35, 0.65, ["small", "midsize", "wide"]), w(gut, 0.35, 0.65, ["slow", "steady", "active"]), w(bladder, 0.35, 0.65, ["held", "partly", "ready"])];
  return { a, para: para0, drug, betaBlock, muscBlock, alphaBoost, symBeta, symAlpha, heart, pupil, airway, gut, bladder, vessel, words, readout: "heart " + words[0] + " · pupil " + words[1] + " · gut " + words[2] + " · bladder " + words[3] };
}
const TESTS = [
  [0, 0, "heart slow · pupil small · gut active · bladder ready"],
  [2, 0, "heart fast · pupil wide · gut slow · bladder held"],
  [2, 1, "heart steady · pupil wide · gut slow · bladder held"],
  [0, 2, "heart steady · pupil midsize · gut steady · bladder partly"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="fibres"></g>
<g id="nodes"></g>
<g id="organs"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-sym:#ff8a3d;--c-para:#2ec4b6}
body[data-theme="light"]{--c-sym:#d96a1e;--c-para:#0f8a7d}
.ans-cord{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.ans-brain{fill:color-mix(in srgb,var(--c-para) 32%,var(--anatomy-card));stroke:var(--anatomy-mid);stroke-width:1.2}
.ans-chain{fill:none;stroke:var(--c-sym);stroke-width:2.4;stroke-linecap:round}
.ans-vagus{fill:none;stroke:var(--c-para);stroke-width:2.4;stroke-linecap:round}
.ans-symline{fill:none;stroke:var(--c-sym);stroke-width:1.6;opacity:.75}
.ans-paraline{fill:none;stroke:var(--c-para);stroke-width:1.6;opacity:.75}
.ans-gang-sym{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1}
.ans-gang-para{fill:#5ec1a0;stroke:color-mix(in srgb,#5ec1a0 55%,#000);stroke-width:1}
.ans-rec-sym{fill:var(--c-sym);stroke:color-mix(in srgb,var(--c-sym) 50%,#000);stroke-width:.6}
.ans-rec-para{fill:var(--c-para);stroke:color-mix(in srgb,var(--c-para) 50%,#000);stroke-width:.6}
.ans-nic{fill:none;stroke:var(--anatomy-strong);stroke-width:1.1;stroke-linecap:round}
.ans-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.ans-iris{fill:#7ab8ff;stroke:color-mix(in srgb,#7ab8ff 50%,#000);stroke-width:.8}
.ans-pupil{fill:#141018}
.ans-heart{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.ans-lung{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:1;opacity:.9}
.ans-airway{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.ans-gut{fill:none;stroke:#e9a2b3;stroke-width:9;stroke-linecap:round}
.ans-gutdot{fill:#fff2f5;stroke:color-mix(in srgb,#e9a2b3 60%,#000);stroke-width:.5}
.ans-bladder{fill:#f2d27a;stroke:color-mix(in srgb,#f2d27a 55%,#000);stroke-width:1}
.ans-drop{fill:var(--c-fl)}
.p-achs{--cc:#ffd24a}.p-achp{--cc:var(--c-para)}.p-na{--cc:var(--c-sym)}.p-achm{--cc:var(--c-para)}
.mk-c{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.4}.mk-x{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.mk-g{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dr-g-fill.g-sym{fill:var(--c-sym)}.dr-g-fill.g-para{fill:var(--c-para)}
`;

buildScene({
  id: "autonomic-nervous-system", fig: "Fig 1", title: "Autonomic nervous system: two outflows, five targets", W, H, body, extraCss,
  label: "An animated autonomic outflow diagram. On the left the brainstem and spinal cord give a sympathetic thoracolumbar outflow through a chain of ganglia and a parasympathetic craniosacral outflow through the vagus nerve and sacral fibres to ganglia near each organ. Preganglionic fibres release acetylcholine onto nicotinic receptors in ganglia. Sympathetic postganglionic fibres release noradrenaline onto alpha and beta receptors, parasympathetic postganglionic fibres release acetylcholine onto muscarinic receptors. The eye, heart, airways, gut and bladder respond in opposite directions. Gauges show heart rate, pupil size, airway openness, gut activity, bladder readiness and vessel tone. A balance slider moves between rest and digest and fight or flight, and treatments are a beta blocker, a muscarinic antagonist and an alpha agonist.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "auto.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Two outflows.</strong> Sympathetic fibres leave the thoracolumbar cord, relay in the paravertebral chain or prevertebral ganglia, and travel far to targets. Parasympathetic fibres leave the craniosacral outflow, mostly in the vagus nerve, plus sacral fibres to pelvic organs, and relay in ganglia close to or inside the target organ. In both systems the preganglionic fibre releases acetylcholine onto nicotinic receptors. Sympathetic postganglionic fibres mostly release noradrenaline onto alpha and beta adrenoceptors, parasympathetic postganglionic fibres release acetylcholine onto muscarinic receptors. This is standard teaching in physiology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Opposite effects, with exceptions.</strong> Sympathetic activity speeds the heart, widens the pupil and airways, slows gut and holds urine while tightening vessels. Parasympathetic activity slows the heart, narrows the pupil and airways, moves the gut and empties the bladder. Sweat glands and most vessels have little parasympathetic supply, and sympathetic fibres to sweat glands release acetylcholine; those exceptions are noted in the text but simplified in the drawing.",
    "<strong>Treatment ideas shown.</strong> A beta blocker blunts beta receptor effects at the heart and airways, a muscarinic antagonist blunts muscarinic effects and so mimics some sympathetic signs, and an alpha agonist tightens vessels and widens the pupil. These are teaching toggles only.",
  ],
  simplified: "Prevertebral ganglia, the adrenal medulla, enteric plexuses, baroreflex feedback, sweat gland cholinergic sympathetic fibres, receptor subtypes beyond alpha, beta and muscarinic, and every drug and dose are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
