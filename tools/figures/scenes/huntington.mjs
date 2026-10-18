/* Huntington disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/huntington.mjs [--print-model]
 * Static layout here; gene, striatal neurons, brake circuit and clinical signs move in huntington.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease stage", a: [0.12, 0.55, 1], names: ["premanifest", "early", "advanced"], ticks: ["premanifest", "early", "advanced"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "VMAT2 blocker" },
    { label: "dopamine blocker" },
    { label: "supportive care" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "VMAT2 blocker", "dopamine blocker", "supportive care"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const eff = [
    { chor: 0, psy: 0, func: 0 },
    { chor: 0.62, psy: 0.1, func: 0.1 },
    { chor: 0.42, psy: 0.28, func: 0.06 },
    { chor: 0.16, psy: 0.22, func: 0.24 },
  ][drug];
  const a = S.level.a[level];
  const Mut = cl(0.3 + 0.6 * a);
  const Loss = cl(a * 0.92);
  const Ind = cl(Loss * 1.05);
  const Chor = cl((0.06 + 0.9 * Ind) * (1 - eff.chor));
  const CogD = cl(a * 0.84);
  const Cog = cl(1 - CogD);
  const Psy = cl((0.12 + 0.68 * a) * (1 - eff.psy));
  const Func = cl(1 - 0.32 * Chor - 0.34 * CogD - 0.18 * Psy + eff.func);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Loss, 0.25, 0.65, ["intact", "thinning", "severely lost"]), w(Chor, 0.25, 0.6, ["controlled", "unsteady", "marked"]), w(CogD, 0.25, 0.6, ["preserved", "impaired", "severely impaired"]), w(Func, 0.35, 0.65, ["poor", "reduced", "good"])];
  return { a, drug, Mut, Loss, Ind, Chor, CogD, Cog, Psy, Func, d1: drug === 1 ? 1 : 0, d2: drug === 2 ? 1 : 0, d3: drug === 3 ? 1 : 0, words, readout: "neurons " + words[0] + " · movement " + words[1] + " · thinking " + words[2] + " · daily life " + words[3] };
}
const TESTS = [
  [0, 0, "neurons intact · movement controlled · thinking preserved · daily life good"],
  [1, 0, "neurons thinning · movement unsteady · thinking impaired · daily life reduced"],
  [2, 0, "neurons severely lost · movement marked · thinking severely impaired · daily life poor"],
  [2, 1, "neurons severely lost · movement unsteady · thinking severely impaired · daily life reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GENE</text>
<text class="sc-zone" x="350" y="68">BRAIN</text>
<text class="sc-zone" x="700" y="68">SIGNS</text>
<g id="brainSlot"></g>
<ellipse id="stri" class="hd-stri" cx="487" cy="201" rx="62" ry="40"/>
<path id="mutPath" class="hd-track" d="M250 190 L487 201"/>
<ellipse id="blockShade" class="hd-block" cx="487" cy="201" rx="62" ry="40" opacity="0"/>
<g id="gene"></g>
<g id="neurons"></g>
<ellipse id="moveGlow" class="hd-glow" cx="740" cy="368" rx="72" ry="36" opacity="0"/>
<g id="circuit"></g>
<g id="clinic"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-msn:#7fc4e8;--c-mut:#c084fc;--c-gpe:#f2d27a;--c-gpi:#e9a2b3;--c-thal:#3ddc97;--c-ctx:#b7a1e6}
body[data-theme="light"]{--c-msn:#2f86b8;--c-mut:#7c3aed;--c-gpe:#c49a1f;--c-gpi:#c45f7d;--c-thal:#0f9f76;--c-ctx:#7a5fc0}
.cl-msn{--cc:var(--c-msn)}
.hd-stri{fill:color-mix(in srgb,var(--c-msn) 16%,var(--anatomy-paper));stroke:var(--c-msn);stroke-width:1.2}
.hd-block{fill:var(--c-fl);stroke:none}
.hd-glow{fill:var(--c-cyt2);stroke:none}
.hd-track{fill:none;stroke:var(--c-mut);stroke-width:1.6;stroke-dasharray:5 4;opacity:.6}
.hd-dna{fill:none;stroke:var(--c-mut);stroke-width:2;stroke-linecap:round}
.hd-rung{stroke:var(--anatomy-mid);stroke-width:1}
.hd-bead{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.hd-bead2{fill:var(--anatomy-mid);stroke:color-mix(in srgb,var(--anatomy-mid) 50%,#000);stroke-width:.5}
.hd-link{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.hd-node{stroke:color-mix(in srgb,var(--anatomy-strong) 45%,#000);stroke-width:1}
.hd-n-msn{fill:var(--c-msn)}.hd-n-gpe{fill:var(--c-gpe)}.hd-n-gpi{fill:var(--c-gpi)}.hd-n-ctx{fill:var(--c-ctx)}
.hd-arrow{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}
.hd-inhib{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.hd-ab{fill:var(--anatomy-text);text-anchor:middle;pointer-events:none}
.hd-fig{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.hd-head{fill:color-mix(in srgb,var(--c-gpe) 55%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.4}
.hd-face{fill:color-mix(in srgb,var(--c-gpe) 45%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.4}
.hd-eye{fill:var(--anatomy-strong)}
.hd-mouth{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.hd-bub{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.2}
.hd-aid{fill:none;stroke:var(--c-good);stroke-width:3;stroke-linecap:round}
.hd-wheel{fill:var(--c-good);stroke:none}
.hd-capmain{fill:var(--anatomy-text);font-size:12.5px}
.p-mut{--cc:var(--c-mut)}.p-sig{--cc:var(--c-thal)}.p-block{--cc:var(--c-fl)}
.dr-g-fill.g-mut{fill:var(--c-mut)}.dr-g-fill.g-loss{fill:var(--c-bad)}.dr-g-fill.g-chor{fill:var(--c-neut)}
`;

buildScene({
  id: "huntington-disease", fig: "Fig 1", title: "Huntington disease: gene to chorea", W, H, body, extraCss,
  label: "An animated scene for Huntington disease. An expanded CAG repeat in the huntingtin gene is passed on and often grows, so signs can start earlier in the next generation. Faulty huntingtin protein harms striatal neurons inside the brain. Losing those neurons weakens the braking circuit of the basal ganglia, so extra movement leaks out as chorea, while thinking and mood also decline. A slider sets the stage, and choices are a VMAT2 blocker, a dopamine blocker and supportive care.",
  caption: "Schematic, not to scale. Counts, speeds and gauge levels are qualitative and illustrative; no doses, repeat counts or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "huntington.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With VMAT2 blocker",
  sourcesLis: [
    "<strong>Gene and inheritance.</strong> Huntington disease is caused by an expanded CAG repeat in the huntingtin gene. It is autosomal dominant, so each child of an affected parent can inherit the expansion. The repeat often grows when passed on, so later generations may develop signs earlier, a pattern called anticipation. This is standard teaching in neurology and genetics texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Brain mechanism and signs.</strong> Faulty huntingtin gradually harms medium spiny neurons of the striatum. Losing those neurons weakens the indirect pathway, the braking circuit of the basal ganglia, so the movement output is released and chorea appears. Thinking, planning and mood are also affected, often before the movement disorder, and the condition progresses over years.",
    "<strong>Treatment ideas shown.</strong> No treatment shown here restores lost neurons. A VMAT2 blocker traps dopamine in presynaptic stores so less signal gets through, a dopamine blocker sits on D2 receptors and damps the overdrive signal, and both ease chorea without repairing the brain. Supportive care steadies mood and daily function. These are teaching toggles only.",
  ],
  simplified: "Direct pathway changes, cortical involvement, repeat length cutoffs and exact risks, testing protocols, psychiatric detail, drug names and doses, and disease modifying trials are left out. The subthalamic step of the circuit is folded into one output step. Counts and speeds are illustrative, and the figure does not say how any person should be tested or treated.",
});
