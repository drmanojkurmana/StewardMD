/* Type 1 and type 2 diabetes pathogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/diabetes1.mjs [--print-model]
 * Static layout here; beta cells, immune cells, insulin and glucose move in diabetes1.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Diabetes type and stage", a: [0, 1, 2], names: ["type 1", "early type 2", "advanced type 2"], ticks: ["type 1", "early type 2", "advanced type 2"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "insulin" },
    { label: "metformin" },
    { label: "incretin-based therapy" },
  ],
  status: "Diabetes: {level} · {drug} ·",
  drugNames: ["no treatment", "insulin", "metformin", "incretin-based therapy"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const betaT = [0.07, 0.88, 0.34][t];
  const autoT = [0.95, 0.04, 0.04][t];
  const resT = [0.18, 0.78, 0.82][t];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ins = drug === 1 ? 1 : 0, met = drug === 2 ? 1 : 0, inc = drug === 3 ? 1 : 0;
  const resEff = cl(resT * (met ? 0.72 : 1));
  const sec = cl(betaT * (inc ? 1.45 : 1));
  const I = cl(sec * 0.9 + (ins ? 0.8 : 0));
  const H = cl(0.88 - 0.52 * I - 0.38 * met - 0.18 * inc);
  const U = cl(0.08 + 0.92 * I * (1 - resEff * 0.75));
  const G = cl(0.15 + 0.62 * H + 0.48 * (1 - U));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(I, 0.25, 0.6, ["low", "reduced", "high"]), w(H, 0.3, 0.6, ["low", "raised", "high"]), w(G, 0.35, 0.65, ["controlled", "raised", "high"])];
  return { t, drug, ins, met, inc, B: betaT, A: autoT, R: resEff, sec, I, H, U, G, words, readout: "insulin " + words[0] + " · liver output " + words[1] + " · blood glucose " + words[2] };
}
const TESTS = [
  [0, 0, "insulin low · liver output high · blood glucose high"],
  [1, 0, "insulin high · liver output raised · blood glucose high"],
  [2, 0, "insulin reduced · liver output high · blood glucose high"],
  [1, 2, "insulin high · liver output low · blood glucose raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="sc-lumen" x="14" y="282" width="${W - 28}" height="54"/>
<ellipse id="upGlow" class="dm-glowup" cx="745" cy="399" rx="160" ry="30" opacity="0"/>
<ellipse id="insCloud" class="dm-cloud" cx="470" cy="309" rx="220" ry="22" opacity="0"/>
<ellipse id="livAct" class="dm-livact" cx="758" cy="165" rx="100" ry="52" opacity="0"/>
<g id="pancSlot"></g>
<g id="liverSlot"></g>
<g id="muscleSlot"></g>
<path id="insBeam" class="dr-beam" d="M172 222L172 309"/>
<path id="gluBeam" class="dr-beam" d="M758 229L758 315"/>
<rect class="dm-fatbg" x="770" y="370" width="160" height="58" rx="20"/>
<circle class="dm-fat" cx="806" cy="399" r="24"/>
<circle class="dm-fat" cx="850" cy="392" r="19"/>
<circle class="dm-fat" cx="882" cy="406" r="22"/>
<g id="rbcs"></g>
<g id="cells"></g><g id="parts"></g><g id="drugG"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.p-ins{--cc:var(--c-cyt2)}.p-glu{--cc:#ff9a3d}.p-sig{--cc:var(--c-no)}
.dr-g-fill.g-beta{fill:var(--c-b)}.dr-g-fill.g-ins{fill:var(--c-cyt2)}.dr-g-fill.g-res{fill:var(--c-bad)}.dr-g-fill.g-glu{fill:#ff9a3d}
.res-x{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.dm-fatbg{fill:color-mix(in srgb,var(--c-b) 16%,var(--anatomy-card));stroke:var(--c-b);stroke-width:1}
.dm-fat{fill:color-mix(in srgb,var(--c-b) 42%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-b) 60%,#000);stroke-width:.8}
.dm-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.dm-cloud{fill:#2fa8de;stroke:none}
.dm-glowup{fill:var(--c-good);stroke:none}
.dm-livact{fill:var(--c-no);stroke:none}
.dm-halo{fill:color-mix(in srgb,var(--c-no) 22%,transparent);stroke:var(--c-no);stroke-width:2.5}
.dm-pen{fill:color-mix(in srgb,var(--c-cyt2) 55%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-cyt2) 60%,#000);stroke-width:1.2}
.dm-penfill{fill:var(--c-cyt2);stroke:none}
.dm-needle{fill:none;stroke:var(--anatomy-hi);stroke-width:2;stroke-linecap:round}
.dm-penstream{fill:none;stroke:var(--c-cyt2);stroke-width:9;stroke-linecap:round}
.dm-met{fill:color-mix(in srgb,var(--c-no) 30%,var(--anatomy-paper));stroke:var(--c-no);stroke-width:1.2}
.dm-metscore{fill:none;stroke:var(--c-no);stroke-width:1;stroke-linecap:round}
.dm-gate{fill:var(--c-no);stroke:color-mix(in srgb,var(--c-no) 60%,#000);stroke-width:1}
.dm-sigbeam{stroke:var(--c-no);stroke-width:1.6;stroke-dasharray:6 4}
.dm-door{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-linecap:round}
`;

buildScene({
  id: "type1-vs-type2-diabetes", fig: "Fig 1", title: "Type 1 and type 2 diabetes: why blood glucose rises", W, H, body, extraCss,
  label: "An animated pancreas islet, bloodstream, liver, muscle and fat. In type 1, immune cells destroy beta cells so little insulin is made. In early type 2, beta cells make extra insulin but muscle, fat and liver resist it. In advanced type 2, beta cells tire and insulin falls. The liver releases glucose and muscle and fat take up less, so blood glucose rises. Gauges show beta cells, insulin, resistance, liver output, uptake and blood glucose. Treatment choices are insulin from a pen into the blood, metformin tablets that quiet the liver, and incretin-based therapy whose gut signal wakes working beta cells.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, glucose values or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "diabetes1.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With insulin",
  sourcesLis: [
    "<strong>How diabetes develops.</strong> In type 1 diabetes, autoimmune destruction of pancreatic beta cells leaves little or no insulin, so the liver is not switched off and muscle and fat cannot take up glucose well. In type 2 diabetes, muscle, fat and liver resist insulin; beta cells at first compensate by making more insulin, keeping glucose near normal for a time, but over years beta cell function declines (exhaustion), insulin becomes relatively insufficient, hepatic glucose output rises and peripheral uptake falls, so blood glucose rises. This is standard teaching in medicine and endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Insulin replaces what is missing and acts in every type, most clearly in type 1. Metformin mainly lowers hepatic glucose output and modestly improves insulin sensitivity, so it helps most where resistance and liver output drive the problem and cannot replace missing insulin. Incretin-based therapy boosts glucose-dependent insulin release and lowers glucagon, so it needs surviving beta cells and helps most in early type 2. These are teaching toggles only.",
  ],
  simplified: "Genetics, obesity and lifestyle drivers, glucagon and kidney handling in detail, gut and brain signals, complications, monitoring, drug choice and combinations in practice, and all doses and glucose values are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
