/* Huntington disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/huntington.mjs [--print-model]
 * Static layout here; gene, striatal neurons, basal ganglia circuit and clinical signs move in huntington.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease stage", a: [0.12, 0.55, 1], names: ["premanifest", "early", "advanced"], ticks: ["premanifest", "early", "advanced"], start: 1 },
  drugLabel: "Treatment and support",
  settings: [
    { label: "no treatment" },
    { label: "symptomatic drugs" },
    { label: "genetic counselling" },
    { label: "supportive care" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "symptomatic drugs", "genetic counselling", "supportive care"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const eff = [
    { chor: 0, psy: 0, func: 0, cog: 0 },
    { chor: 0.48, psy: 0.18, func: 0.08, cog: 0 },
    { chor: 0, psy: 0.1, func: 0.14, cog: 0 },
    { chor: 0.12, psy: 0.28, func: 0.34, cog: 0.1 },
  ][drug];
  const a = S.level.a[level];
  const Mut = cl(0.3 + 0.6 * a);
  const Loss = cl(a * 0.92);
  const Ind = cl(Loss * 1.05);
  const Chor = cl((0.06 + 0.9 * Ind) * (1 - eff.chor));
  const CogD = cl(a * 0.84 * (1 - eff.cog));
  const Cog = cl(1 - CogD);
  const Psy = cl((0.12 + 0.68 * a) * (1 - eff.psy));
  const Func = cl(1 - 0.32 * Chor - 0.34 * CogD - 0.18 * Psy + eff.func);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Loss, 0.25, 0.65, ["intact", "thinning", "severely lost"]), w(Chor, 0.25, 0.6, ["controlled", "unsteady", "marked chorea"]), w(CogD, 0.25, 0.6, ["preserved", "impaired", "severely impaired"])];
  return { a, drug, Mut, Loss, Ind, Chor, CogD, Cog, Psy, Func, symp: drug === 1 ? 1 : 0, couns: drug === 2 ? 1 : 0, supp: drug === 3 ? 1 : 0, words, readout: "neurons " + words[0] + " · movement " + words[1] + " · thinking " + words[2] };
}
const TESTS = [
  [0, 0, "neurons intact · movement controlled · thinking preserved"],
  [1, 0, "neurons thinning · movement unsteady · thinking impaired"],
  [2, 0, "neurons severely lost · movement marked chorea · thinking severely impaired"],
  [2, 1, "neurons severely lost · movement unsteady · thinking severely impaired"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GENE AND INHERITANCE</text>
<text class="sc-zone" x="350" y="68">BRAIN: STRIATUM</text>
<text class="sc-zone" x="680" y="68">SIGNS</text>
<ellipse id="stri" class="hd-stri" cx="490" cy="182" rx="118" ry="78"/>
<g id="gene"></g>
<g id="neurons"></g>
<g id="clinic"></g>
<g id="circuit"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-msn:#7fc4e8;--c-mut:#c084fc;--c-gpe:#f2d27a;--c-stn:#f08a4b;--c-gpi:#e9a2b3;--c-thal:#3ddc97;--c-ctx:#b7a1e6}
body[data-theme="light"]{--c-msn:#2f86b8;--c-mut:#7c3aed;--c-gpe:#c49a1f;--c-stn:#d96a25;--c-gpi:#c45f7d;--c-thal:#0f9f76;--c-ctx:#7a5fc0}
.cl-msn{--cc:var(--c-msn)}.cl-brain{--cc:#e9a2b3}
.hd-stri{fill:color-mix(in srgb,var(--c-msn) 16%,var(--anatomy-paper));stroke:var(--c-msn);stroke-width:1.2}
.hd-dna{fill:none;stroke:var(--c-mut);stroke-width:2;stroke-linecap:round}
.hd-rung{stroke:var(--anatomy-mid);stroke-width:1}
.hd-bead{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.hd-bead2{fill:var(--anatomy-mid);stroke:color-mix(in srgb,var(--anatomy-mid) 50%,#000);stroke-width:.5}
.hd-ped{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.4}
.hd-pedf{fill:var(--c-mut);stroke:color-mix(in srgb,var(--c-mut) 55%,#000);stroke-width:1}
.hd-link{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.hd-node{stroke:color-mix(in srgb,var(--anatomy-strong) 45%,#000);stroke-width:1}
.hd-n-msn{fill:var(--c-msn)}.hd-n-gpe{fill:var(--c-gpe)}.hd-n-stn{fill:var(--c-stn)}.hd-n-gpi{fill:var(--c-gpi)}.hd-n-thal{fill:var(--c-thal)}.hd-n-ctx{fill:var(--c-ctx)}
.hd-arrow{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}
.hd-inhib{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.hd-cap{fill:var(--anatomy-text);text-anchor:middle;pointer-events:none}
.hd-sign{fill:var(--anatomy-strong);text-anchor:middle;pointer-events:none}
.hd-fig{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.hd-head{fill:color-mix(in srgb,var(--c-gpe) 55%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.4}
.hd-face{fill:color-mix(in srgb,var(--c-gpe) 45%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.4}
.hd-eye{fill:var(--anatomy-strong)}
.hd-mouth{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.p-mut{--cc:var(--c-mut)}.p-sig{--cc:var(--c-thal)}
.dr-g-fill.g-mut{fill:var(--c-mut)}.dr-g-fill.g-loss{fill:var(--c-bad)}.dr-g-fill.g-ind{fill:var(--c-stn)}.dr-g-fill.g-chor{fill:var(--c-neut)}
`;

buildScene({
  id: "huntington-disease", fig: "Fig 1", title: "Huntington disease: gene to chorea", W, H, body, extraCss,
  label: "An animated scene for Huntington disease. An expanded CAG repeat in the huntingtin gene is inherited in an autosomal dominant pattern and tends to expand between generations, called anticipation. Mutant huntingtin harms medium spiny neurons of the striatum. Loss of the indirect pathway of the basal ganglia releases movement, causing chorea, while thinking and mood also decline. Gauges show mutant protein, neuron loss, indirect pathway failure, chorea, thinking and daily function. Choices are symptomatic drugs, genetic counselling and supportive care.",
  caption: "Schematic, not to scale. Counts, speeds and gauge levels are qualitative and illustrative; no doses, repeat counts or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "huntington.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Gene and inheritance.</strong> Huntington disease is caused by an expanded CAG repeat in the huntingtin gene (HTT). It is autosomal dominant: each child of an affected parent has a substantial chance of inheriting the expansion. The repeat is unstable and often grows when passed on, especially through fathers, so later generations may develop symptoms earlier, a pattern called anticipation. This is standard teaching in neurology and genetics texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Brain mechanism and signs.</strong> Mutant huntingtin gradually harms medium spiny neurons of the striatum (caudate and putamen). Loss of striatal neurons that drive the indirect pathway weakens the normal brake on movement: the globus pallidus and subthalamic nucleus signalling changes, the thalamus is released, and unwanted involuntary movements (chorea) appear. Thinking, planning and mood are also affected, often before or alongside the movement disorder, and the condition progresses over years.",
    "<strong>Treatment ideas shown.</strong> No treatment shown here slows the underlying neuron loss. Symptomatic drugs can ease chorea and some mood symptoms, genetic counselling helps the person and family understand inheritance, testing choices and planning, and supportive care (therapy, nutrition, speech and social support) helps daily function. These are teaching toggles only.",
  ],
  simplified: "Direct pathway changes, cortical and other brain region involvement, repeat length thresholds and exact risks, predictive testing protocols, psychiatric detail, drug names and doses, and disease modifying trials are left out. Neuron counts, bead counts and speeds are illustrative, and the figure does not say how any person should be tested or treated.",
});
