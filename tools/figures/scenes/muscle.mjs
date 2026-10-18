/* Skeletal muscle contraction as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/muscle.mjs [--print-model]
 * Static layout here; action potentials, acetylcholine, calcium and the sarcomere move in muscle.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Muscle state", a: [0, 1, 0.6, 0.9], names: ["rest", "contraction", "fatigue", "rigor"], ticks: ["rest", "contraction", "fatigue", "rigor"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "neuromuscular blocker" },
    { label: "cholinesterase inhibitor" },
  ],
  status: "State: {level} · {drug} ·",
  drugNames: ["no treatment", "neuromuscular blocker", "cholinesterase inhibitor"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const rigor = level === 3 ? 1 : 0;
  const block = drug === 1 ? 1 : 0, che = drug === 2 ? 1 : 0;
  const Ap = [0, 1, 0.7, 0][level];
  const Ach = cl([0, 0.85, 0.7, 0][level] * (che ? 1.5 : 1));
  const Dep = block ? 0 : Ach;
  const Ca = rigor ? 0.72 : cl(0.06 + 0.88 * Dep * (level === 2 ? 0.55 : 1));
  const Sites = cl((Ca - 0.18) * 1.4);
  const Atp = [1, 0.8, 0.3, 0][level];
  const Cyc = rigor ? 0 : cl(Sites * (0.25 + 0.75 * Atp));
  const Short = rigor ? 0.08 : cl(Cyc * 0.9);
  const Stiff = rigor ? 0.95 : cl(Cyc * 0.55);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const sig = w(Dep, 0.15, 0.55, ["none", "weak", "strong"]);
  const cal = w(Ca, 0.25, 0.5, ["low", "raised", "high"]);
  const sho = rigor ? "locked" : w(Short, 0.08, 0.5, ["none", "weak", "strong"]);
  return { rigor, block, che, Ap, Ach, Dep, Ca, Sites, Atp, Cyc, Short, Stiff, words: [sig, cal, sho], readout: "signal " + sig + " · calcium " + cal + " · shortening " + sho };
}
const TESTS = [
  [0, 0, "signal none · calcium low · shortening none"],
  [1, 0, "signal strong · calcium high · shortening strong"],
  [1, 1, "signal none · calcium low · shortening none"],
  [2, 0, "signal strong · calcium raised · shortening weak"],
  [2, 2, "signal strong · calcium high · shortening weak"],
  [3, 0, "signal none · calcium high · shortening locked"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="mu-dend" d="M78 88L46 62M84 80L70 52M96 80L104 52"/>
<path id="axonPath" class="mu-axon" d="M112 105C200 94 318 94 392 118C412 125 424 134 430 146"/>
<rect class="mu-fibre" x="300" y="176" width="646" height="264" rx="18"/>
<path class="mu-sarc" d="M300 176H946"/>
<path class="mu-fold" d="M404 176v14M424 176v18M444 176v14M464 176v18"/>
<rect id="endplate" class="mu-end" x="398" y="170" width="76" height="12" rx="6"/>
<path id="ttube" class="mu-tt" d="M650 176V258H724"/>
<ellipse class="mu-sr" cx="806" cy="262" rx="86" ry="34"/>
<ellipse class="mu-sr" cx="724" cy="284" rx="42" ry="20"/>
<path class="mu-srln" d="M742 252C770 236 842 236 872 254M740 282C772 296 838 296 868 280"/>
<text class="sc-zone" x="420" y="202">MUSCLE FIBRE</text>
<g id="back"></g><g id="parts"></g><g id="nodes"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "muscle-contraction", fig: "Fig 1", title: "Skeletal muscle contraction: nerve signal to cross-bridges", W, H, body,
  label: "An animated motor neuron, neuromuscular junction and muscle fibre. An action potential reaches the nerve terminal, acetylcholine crosses the cleft and depolarises the sarcolemma, the signal dives down a T tubule, calcium leaves the sarcoplasmic reticulum, binds troponin and moves tropomyosin, and myosin heads cycle on actin using ATP. Calcium reuptake relaxes the fibre. A state slider shows rest, contraction, fatigue and rigor, and treatments show a neuromuscular blocker and a cholinesterase inhibitor.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "muscle.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With neuromuscular blocker",
  sourcesLis: [
    "<strong>How skeletal muscle contracts.</strong> An action potential in a motor neuron opens calcium channels in the nerve terminal, acetylcholine vesicles fuse and acetylcholine crosses the neuromuscular junction to nicotinic receptors. The end-plate potential depolarises the sarcolemma and the signal travels down T tubules, opening calcium release channels in the sarcoplasmic reticulum. Calcium binds troponin, tropomyosin shifts to expose actin binding sites, and myosin heads form cross-bridges and cycle using ATP. When the signal stops, calcium is pumped back into the sarcoplasmic reticulum and the fibre relaxes. In rigor there is no ATP, so cross-bridges cannot detach. This is standard teaching in physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A neuromuscular blocker occupies the acetylcholine receptors so the sarcolemma is not depolarised even though acetylcholine is released. A cholinesterase inhibitor slows acetylcholine breakdown in the cleft, so the signal is stronger and longer. These are teaching toggles only.",
  ],
  simplified: "Voltage-gated channel subtypes, quantal release, end-plate folding detail, calcium buffering, the full cross-bridge kinetic cycle, motor unit recruitment, fibre types, and all drug names, doses and clinical uses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.mu-axon{fill:none;stroke:var(--c-lymph);stroke-width:7;stroke-linecap:round}
.mu-dend{fill:none;stroke:var(--c-lymph);stroke-width:3;stroke-linecap:round}
.mu-fibre{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-mid));stroke-width:1.2}
.mu-sarc{fill:none;stroke:var(--c-endo);stroke-width:3.4;stroke-linecap:round}
.mu-fold{fill:none;stroke:var(--c-endo);stroke-width:2}
.mu-end{fill:var(--c-good);stroke:none}
.mu-tt{fill:none;stroke:var(--c-cyt2);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
.mu-sr{fill:color-mix(in srgb,var(--c-cyt) 26%,var(--anatomy-paper));stroke:var(--c-cyt);stroke-width:1.4}
.mu-srln{fill:none;stroke:var(--c-cyt);stroke-width:1;opacity:.65}
.cl-neuron{--cc:var(--c-lymph)}.cl-bouton{--cc:var(--c-neut)}.cl-ves{--cc:var(--c-b)}
.mu-ves{fill:var(--c-b);stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:.6}
.mu-rec{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.7}
.mu-blk{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.7}
.p-blk{--cc:var(--c-bad)}
.mu-z{fill:var(--anatomy-strong)}
.mu-actin{fill:none;stroke:var(--c-fl);stroke-width:2.6;stroke-linecap:round}
.mu-tropm{fill:none;stroke:var(--c-eos);stroke-width:1.5;stroke-linecap:round}
.mu-myosin{fill:none;stroke:var(--c-rbc);stroke-width:6;stroke-linecap:round}
.mu-head{fill:none;stroke:var(--c-rbc);stroke-width:2.4;stroke-linecap:round}
.mu-trop{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.6}
.mu-pump{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.7}
.mu-glow{fill:var(--c-cyt);stroke:none}
.mu-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.mu-enzx{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.p-ap{--cc:var(--c-lymph)}.p-ach{--cc:var(--c-b)}.p-ca{--cc:var(--c-cyt)}.p-atp{--cc:var(--c-good)}.p-dep{--cc:var(--c-good)}
.dr-g-fill.g-ca{fill:var(--c-cyt)}.dr-g-fill.g-sites{fill:var(--c-eos)}.dr-g-fill.g-cb{fill:var(--c-rbc)}
`,
});
