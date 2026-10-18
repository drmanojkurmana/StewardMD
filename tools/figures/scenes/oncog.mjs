/* Carcinogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/oncog.mjs [--print-model]
 * Static layout here; signals, damage, checkpoints, clone and gauges move in oncog.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of change in the cell", a: [0.1, 0.55, 1], names: ["normal", "premalignant", "malignant"], ticks: ["normal", "premalignant", "malignant"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "targeted kinase inhibitor" },
    { label: "chemotherapy" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "a targeted kinase inhibitor", "chemotherapy"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const kin = drug === 1 ? 1 : 0, chemo = drug === 2 ? 1 : 0;
  const sig0 = 0.20 + 0.72 * a;
  const sig = cl(sig0 * (kin ? 0.30 : 1));
  const chk = cl(1.02 - 0.82 * a);
  const dmg = cl(0.14 + 0.66 * a + (chemo ? 0.16 : 0));
  const rep = cl(0.18 + 0.72 * chk);
  const unrep = cl(dmg * (1.15 - rep));
  const mut = cl(0.06 + 0.55 * a + 0.45 * unrep);
  const cyc0 = cl(0.14 + 0.58 * sig + 0.42 * (1 - chk));
  const cyc = cl(cyc0 * (chemo ? 0.42 : 1));
  const apo = cl(0.25 + 0.55 * chk - 0.35 * a + (chemo ? 0.20 : 0));
  const clone0 = cl(0.08 + 0.78 * a + 0.15 * mut);
  const clone = cl(clone0 * (kin ? 0.72 : 1) * (chemo ? 0.38 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(sig, 0.35, 0.65, ["regulated", "raised", "always on"]), w(chk, 0.35, 0.65, ["lost", "weakened", "working"]), w(unrep, 0.2, 0.5, ["low", "building", "high"]), w(clone, 0.3, 0.65, ["small", "growing", "dominant"])];
  return { a, kin, chemo, sig, chk, dmg, rep, unrep, mut, cyc, apo, clone, words, readout: "growth signalling " + words[0] + " · checkpoints " + words[1] + " · unrepaired damage " + words[2] + " · abnormal clone " + words[3] };
}
const TESTS = [
  [0, 0, "growth signalling regulated · checkpoints working · unrepaired damage low · abnormal clone small"],
  [2, 0, "growth signalling always on · checkpoints lost · unrepaired damage high · abnormal clone dominant"],
  [2, 1, "growth signalling regulated · checkpoints lost · unrepaired damage high · abnormal clone dominant"],
  [2, 2, "growth signalling always on · checkpoints lost · unrepaired damage high · abnormal clone growing"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GROWTH SIGNALLING</text>
<text class="sc-zone" x="352" y="68">A SINGLE CELL</text>
<text class="sc-zone" x="700" y="68">CELL POPULATION</text>
<path class="onc-membrane" d="M42 122H228"/>
<path class="onc-arrow" d="M135 150V156"/>
<path class="onc-arrow" d="M135 196V218"/>
<path class="onc-arrow" d="M156 250C230 258 300 260 366 261"/>
<rect class="onc-receptor" x="126" y="100" width="18" height="46" rx="9"/>
<g id="mainCell">
<circle class="onc-cell" cx="485" cy="260" r="112"/>
<circle class="onc-nuc" cx="485" cy="260" r="58"/>
<path class="onc-dna" d="M445 252C462 240 478 272 495 250C508 234 520 258 532 248"/>
<path class="onc-dna onc-dna2" d="M445 268C462 256 478 288 495 266C508 250 520 274 532 264"/>
</g>
<g id="cycRing">
<circle class="onc-ring" cx="485" cy="260" r="86"/>
<circle class="onc-phase" cx="485" cy="174" r="5"/>
<circle class="onc-phase" cx="560" cy="303" r="5"/>
<circle class="onc-phase" cx="410" cy="303" r="5"/>
</g>
<rect class="onc-clonebox" x="690" y="110" width="232" height="270" rx="14"/>
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.onc-membrane{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round;opacity:.7}
.onc-receptor{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:1}
.onc-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.onc-cell{fill:color-mix(in srgb,var(--c-endo) 16%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1.4}
.onc-nuc{fill:color-mix(in srgb,var(--c-mac) 22%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1.2}
.onc-dna{fill:none;stroke:var(--c-mac);stroke-width:2.2;stroke-linecap:round}
.onc-dna2{stroke:var(--c-lymph);opacity:.8}
.onc-ring{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-dasharray:7 7;opacity:.75}
.onc-phase{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.7}
.onc-clonebox{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.onc-nodeRas{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:1}
.onc-nodeKin{fill:#e9b84a;stroke:color-mix(in srgb,#e9b84a 55%,#000);stroke-width:1}
.onc-nodeIn{fill:var(--anatomy-paper);opacity:.55}
.onc-gate{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:1}
.onc-cross{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.onc-dmg{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.cl-onc{--cc:#e07a6a}.cl-norm{--cc:#9db8c6}
.p-sig{--cc:#ff9a3d}.p-rep{--cc:var(--c-good)}.p-tki{--cc:#ffd24a}.p-div{--cc:var(--c-bad)}
.dr-g-fill.g-sig{fill:#ff9a3d}.dr-g-fill.g-chk{fill:var(--c-good)}.dr-g-fill.g-dmg{fill:var(--c-bad)}
`;

buildScene({
  id: "oncogenes-tumour-suppressors", fig: "Fig 1", title: "Oncogenes and tumour suppressors: how a cell becomes cancerous", W, H, body, extraCss,
  label: "An animated cell and cell population. Growth factors act on a receptor and switch on RAS and a kinase cascade that tells the nucleus to divide. The p53 and Rb checkpoints normally pause the cell cycle when DNA is damaged so repair can happen, or trigger cell death. When proto-oncogenes are activated and tumour suppressors are lost, damage goes unrepaired, changes accumulate over several hits, the cell cycle runs unchecked, damaged cells evade apoptosis and an abnormal clone takes over. Gauges show signalling, checkpoints, unrepaired damage, division, cell death and the clone. Treatment choices include a targeted kinase inhibitor and chemotherapy.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "oncog.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Growth signalling and proto-oncogene activation.</strong> Proto-oncogenes are normal genes that promote cell growth and division. Growth factors bind receptors that switch on RAS and a downstream kinase cascade, sending a divide signal to the nucleus. A change that locks a proto-oncogene on (for example a RAS change that leaves RAS active) turns a regulated signal into an always on signal, so the cell is told to divide even without the usual growth cue. This is standard teaching in pathology and cancer biology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Tumour suppressors, checkpoints and repair.</strong> Tumour suppressor genes normally restrain division. p53 pauses the cell cycle when DNA is damaged, allows repair, and can trigger apoptosis (programmed cell death) when damage is too great. The Rb protein holds the cell at the G1 checkpoint until it is safe to copy DNA. Loss of p53 or Rb removes those brakes: damaged DNA is copied, repair falls behind, and further changes accumulate. Cancer usually needs several such hits in the same cell line (multi-hit accumulation), not one change alone. This is standard teaching in pathology and cancer biology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>From one cell to a clone, and treatment ideas shown.</strong> A cell that divides without checkpoint control and evades apoptosis passes its changes to daughter cells, so an abnormal clone expands and can become dominant. A targeted kinase inhibitor blocks the overactive kinase cascade downstream of the growth signal, so it lowers signalling but does not restore lost p53 or Rb or repair past damage. Chemotherapy harms dividing cells, so it shrinks the dividing clone but also damages DNA and harms normal dividing cells. These are teaching toggles only.",
  ],
  simplified: "Specific oncogenes and suppressors beyond RAS, p53 and Rb, angiogenesis, invasion and metastasis, immune evasion, metabolic change, tumour heterogeneity and resistance, screening and staging, and all drug choices and doses are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
