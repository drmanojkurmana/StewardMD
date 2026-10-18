/* Vaccination and immune memory as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/vaccine.mjs [--print-model]
 * Static layout here; cells, antigen, antibody and gauges move in vaccine.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ----------------
 * Level: 0 first dose, 1 booster, 2 later exposure to the real pathogen.
 * Treatment select is the vaccine type given at the first dose and booster.
 * Tables are [first dose, booster, later exposure] for each vaccine type. */
const MD = {
  level: { label: "Stage", a: [0, 1, 2], names: ["first dose", "booster", "later exposure to pathogen"], ticks: ["first dose", "booster", "later exposure"], start: 0 },
  drugLabel: "Vaccine type",
  settings: [
    { label: "none" },
    { label: "live attenuated vaccine" },
    { label: "conjugate vaccine" },
  ],
  status: "Vaccination: {level} · {drug} ·",
  drugNames: ["no vaccine", "live attenuated vaccine", "conjugate vaccine"],
};
/* D presentation, T helper activation, G germinal centre, Ab antibody, M memory, Path pathogen burden */
function modelOf(S, level, drug) {
  const TAB = [
    { D: [0.06, 0.06, 0.55], T: [0.05, 0.05, 0.35], G: [0.04, 0.04, 0.30], Ab: [0.03, 0.03, 0.22], M: [0.02, 0.02, 0.10], Path: [0, 0, 0.88] },
    { D: [0.70, 0.75, 0.60], T: [0.72, 0.85, 0.88], G: [0.68, 0.85, 0.90], Ab: [0.38, 0.78, 0.95], M: [0.45, 0.80, 0.85], Path: [0.25, 0.15, 0.12] },
    { D: [0.62, 0.68, 0.55], T: [0.55, 0.70, 0.72], G: [0.70, 0.88, 0.92], Ab: [0.42, 0.82, 0.96], M: [0.48, 0.82, 0.86], Path: [0.08, 0.08, 0.10] },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const t = TAB[drug] || TAB[0];
  const D = t.D[level], T = t.T[level], G = t.G[level], Ab = t.Ab[level], M = t.M[level], Path = t.Path[level];
  const Resp = cl(Ab * 0.6 + M * 0.4);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Ab, 0.25, 0.55, ["low", "rising", "high"]), w(M, 0.25, 0.55, ["few", "forming", "many"]), w(Resp, 0.3, 0.6, ["slow and weak", "building", "fast and strong"])];
  return { level, drug, D, T, G, Ab, M, Path, Resp, words, readout: "antibody " + words[0] + " · memory " + words[1] + " · response " + words[2] };
}
const TESTS = [
  [0, 0, "antibody low · memory few · response slow and weak"],
  [0, 1, "antibody rising · memory forming · response building"],
  [1, 2, "antibody high · memory many · response fast and strong"],
  [2, 0, "antibody low · memory few · response slow and weak"],
  [2, 1, "antibody high · memory many · response fast and strong"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="zone-line" d="M322 52L322 432"/>
<path class="zone-line" d="M662 52L662 432"/>
<text class="sc-zone" x="34" y="68">INJECTION SITE</text>
<text class="sc-zone" x="342" y="68">LYMPH NODE</text>
<text class="sc-zone" x="682" y="68">BLOOD</text>
<path class="flow" d="M212 196C280 176 330 172 378 170"/>
<path class="flow" d="M428 186C462 208 478 220 492 232"/>
<path class="flow" d="M612 226C648 204 668 190 694 178"/>
<g id="stage"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-dc{--cc:var(--c-mac)}.cl-th{--cc:var(--c-th2)}.cl-plasma{--cc:#e88bb0}.cl-memb{--cc:var(--c-b)}.cl-memt{--cc:var(--c-lymph)}
.zone-line{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:5 6;opacity:.5}
.flow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:6 5;opacity:.65}
.foll{fill:color-mix(in srgb,var(--c-b) 16%,var(--anatomy-paper));stroke:var(--c-b);stroke-width:1.6}
.gc{fill:color-mix(in srgb,var(--c-b) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-b) 60%,#000);stroke-width:1}
.present{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.5}
.ab-y{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.p-ag{--cc:#ff9a3d}.p-sig{--cc:var(--c-cyt)}.p-path{--cc:var(--c-bac)}
.mem-ring{fill:none;stroke:var(--c-plt);stroke-width:1.4;stroke-dasharray:4 3}
.dr-g-fill.g-dc{fill:var(--c-mac)}.dr-g-fill.g-th{fill:var(--c-th2)}.dr-g-fill.g-gc{fill:var(--c-b)}.dr-g-fill.g-ab{fill:var(--c-ab)}.dr-g-fill.g-mem{fill:var(--c-plt)}.dr-g-fill.g-prot{fill:var(--c-good)}
`;

buildScene({
  id: "vaccination-immune-memory", fig: "Fig 1", title: "Vaccination and immune memory", W, H, body, extraCss,
  label: "An animated scene of vaccination and immune memory. At the injection site a dendritic cell takes up vaccine antigen and presents it. In the lymph node it activates helper T cells, which help B cells in a germinal centre. Plasma cells make antibody, and memory B and T cells persist. A booster or later exposure to the real pathogen gives a faster and stronger secondary response. Live attenuated and conjugate vaccines are compared with no vaccine.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, schedules or product names are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "vaccine.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without vaccine", withLabel: "With vaccine",
  sourcesLis: [
    "<strong>Primary response.</strong> Dendritic cells carry antigen to a lymph node and present it to helper T cells. Activated helper T cells help antigen-specific B cells, which enter a germinal centre, multiply and refine their antibody. Some become plasma cells that secrete antibody; others become long-lived memory B cells, alongside memory T cells. The first response is slow and relatively weak because it starts from rare naive cells. This is standard teaching in immunology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Secondary response and boosters.</strong> Memory cells are more numerous and quicker to react than naive cells, so a booster dose or later exposure to the real pathogen produces antibody faster, in larger amount and of better quality, and the pathogen is controlled sooner. That is why the stage slider shows the response building at the first dose, strengthening at the booster and peaking on later exposure only when a vaccine was given.",
    "<strong>Vaccine types shown.</strong> A live attenuated vaccine uses a weakened microbe that replicates briefly, so it drives strong helper T cell, germinal centre and memory responses. A conjugate vaccine links a sugar coat antigen to a carrier protein, which recruits helper T cells to what would otherwise be a T-independent sugar antigen, giving germinal centres, antibody and memory. An inactivated vaccine, not offered here, uses killed microbe and mainly drives antibody with booster doses. These are teaching toggles only.",
  ],
  simplified: "Inactivated and subunit vaccines as separate toggles, adjuvants, mucosal and maternal antibody, waning and variant escape, cell-mediated killing in detail, affinity maturation steps, and all doses, schedules and product names are left out. Counts and speeds are illustrative, and the figure does not say how any person should be vaccinated.",
});
