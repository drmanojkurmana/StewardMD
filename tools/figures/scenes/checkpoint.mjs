/* Immune checkpoint inhibitors (CTLA-4 and PD-1) as an animated, working scene.
 *   node tools/figures/scenes/checkpoint.mjs [--print-model]
 * Original drawing built from the mechanism (Anima styling, Anatomy page shell). Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "T cell state", a: [0.3, 0.6, 1], names: ["tumour evading", "exhausted T cell", "reinvigorated T cell"], ticks: ["evading", "exhausted", "reinvigorated"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "anti-CTLA-4 (ipilimumab)" },
    { label: "anti-PD-1 (pembrolizumab, nivolumab)" },
    { label: "both (combination)" },
  ],
  status: "T cell state: {level} · {drug} ·",
  drugNames: ["no treatment", "anti-CTLA-4", "anti-PD-1", "combination"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cB = (drug === 1 || drug === 3) ? 1 : 0;
  const pB = (drug === 2 || drug === 3) ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const CTLA = cl((0.9 - 0.45 * a) * (1 - 0.85 * cB));
  const PD = cl((0.95 - 0.4 * a) * (1 - 0.88 * pB));
  const P = cl(0.1 + 0.8 * a * (cB ? 1 : 0.5) + 0.22 * cB);
  const K = cl(P * (1 - PD) * 1.35 + 0.12 * pB * (0.4 + 0.6 * P));
  const T = cl(1 - 0.9 * K);
  const A = cl(0.04 + 0.18 * P + 0.3 * K + 0.16 * cB + 0.08 * pB);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.35, 0.65, ["low", "moderate", "high"]), w(K, 0.3, 0.6, ["low", "moderate", "high"]), w(A, 0.3, 0.55, ["few", "some", "many"])];
  return { a, cB, pB, CTLA, PD, P, K, T, A, words, readout: "priming " + words[0] + " · tumour killing " + words[1] + " · adverse effects " + words[2] };
}
const TESTS = [
  [0, 0, "priming low · tumour killing low · adverse effects few"],
  [1, 0, "priming low · tumour killing low · adverse effects few"],
  [1, 2, "priming low · tumour killing moderate · adverse effects some"],
  [1, 3, "priming high · tumour killing high · adverse effects many"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-node" x="14" y="44" width="440" height="394" rx="18"/>
<rect class="sc-tissue" x="464" y="44" width="482" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">LYMPH NODE: PRIMING</text>
<text class="sc-zone" x="484" y="68">TUMOUR: KILLING</text>
<ellipse id="primeGlow" class="ck-prime" cx="235" cy="240" rx="130" ry="72" opacity="0"/>
<ellipse id="tumGlow" class="ck-tum" cx="615" cy="200" rx="100" ry="85" opacity="0"/>
<g id="gutSlot"></g>
<g id="base"></g><g id="links"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "immune-checkpoint-inhibitors-ctla4-pd1", fig: "Fig 1", title: "Immune checkpoint inhibitors: CTLA-4 and PD-1", W, H, body,
  label: "An animated lymph node and tumour. In the lymph node a dendritic cell primes a T cell through signal 1 (antigen on MHC) and signal 2 (B7 on CD28), while CTLA-4 competes for B7 and dampens priming until anti-CTLA-4 blocks it. Primed killer T cells travel to the tumour, where PD-1 on exhausted T cells binds PD-L1 on tumour cells until anti-PD-1 blocks it and restores killing. A healthy gut patch shows self tissue under attack. Gauges show priming, killing, tumour burden, both brakes and side effects.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "checkpoint.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With both drugs",
  extraCss: `
.sc-node{fill:var(--c-lymph);opacity:.1}
body{--c-tum:#e0855a}
body[data-theme="light"]{--c-tum:#c46434}
.cl-tum{--cc:var(--c-tum)}
.cl-tum .cl-b{fill:color-mix(in srgb,var(--cc) calc((1 - var(--dm,0)) * 100%),#4a4a4a)}
.cl-gut{--cc:var(--c-ab)}
.sig{stroke:var(--c-cyt2);stroke-width:1.4;fill:none}
.sigB{stroke:var(--c-bad);stroke-width:1.4;fill:none;stroke-dasharray:4 3}
.p-ck{fill:none;stroke:var(--c-ab);stroke-width:2;stroke-linecap:round}
.p-perf{fill:var(--c-bad)}
.p-il2{--cc:var(--c-cyt2)}
.ck-prime{fill:var(--c-lymph);stroke:none}
.ck-tum{fill:var(--c-bad);stroke:none}
.ck-ginfl{fill:var(--c-bad);stroke:none}
.ck-cap{fill:var(--anatomy-strong);font-size:13px}
.r-stem{stroke:var(--anatomy-mid);stroke-width:1}
.r-b7{fill:var(--c-donor);stroke:color-mix(in srgb,var(--c-donor) 50%,#000);stroke-width:.5}
.r-cd28{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 50%,#000);stroke-width:.5}
.r-ctla{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 50%,#000);stroke-width:.5}
.r-pd1{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 50%,#000);stroke-width:.5}
.r-pdl1{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 50%,#000);stroke-width:.5}
.r-mhc{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 50%,#000);stroke-width:.5}
.r-tcr{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 50%,#000);stroke-width:.5}
`,
  sourcesLis: [
    "<strong>How checkpoint blockade works.</strong> Priming a naive T cell needs signal 1 (its receptor meeting antigen on MHC) plus signal 2 (CD28 on the T cell meeting B7 on the dendritic cell). CTLA-4, which appears after activation, binds B7 more strongly than CD28 and dampens priming early in the lymph node; blocking CTLA-4 with ipilimumab keeps priming going. In the tumour, exhausted T cells carry PD-1, and tumour PD-L1 binding it switches killing off; blocking PD-1 with pembrolizumab or nivolumab reinvigorates killing. Reinvigorated T cells can also attack self tissue, giving immune related effects such as colitis, pneumonitis, hepatitis and hormone gland failure. This is standard teaching in immunology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Anti-CTLA-4 acting early on priming, anti-PD-1 acting later on exhausted cells in tissue, and the combination giving more killing with more self tissue injury. These are teaching toggles only.",
  ],
  simplified: "Regulatory T cells, other checkpoints (LAG-3, TIM-3), memory formation, antigen loss and other resistance routes, steroid and other management of side effects, tumour types and combinations used in practice, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
