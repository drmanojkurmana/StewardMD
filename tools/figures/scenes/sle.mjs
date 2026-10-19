/* Systemic lupus erythematosus as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/sle.mjs [--print-model]
 * Static layout here; cells, antibodies, immune complexes, complement and gauges move in sle.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease activity", a: [0.3, 0.65, 1], names: ["mild", "moderate", "flare"], ticks: ["mild", "moderate", "flare"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "hydroxychloroquine" },
    { label: "steroid" },
    { label: "immunosuppressant" },
  ],
  status: "Activity: {level} · {drug} ·",
  drugNames: ["no treatment", "hydroxychloroquine", "a steroid", "an immunosuppressant"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const eA = [0, 0.35, 0.15, 0.6][drug], eCx = [0, 0.35, 0.25, 0.6][drug], eOrg = [0, 0.3, 0.65, 0.55][drug];
  const A = cl((0.15 + 0.8 * a) * (1 - eA));
  const Cx = cl((0.12 + 0.83 * a) * (1 - eCx));
  const Comp = cl(1 - 0.85 * (0.1 + 0.8 * Cx));
  const Org = cl((0.08 + 0.82 * Cx) * (1 - eOrg));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(A, 0.35, 0.65, ["low", "moderate", "high"]), w(Cx, 0.35, 0.65, ["few", "some", "many"]), Comp > 0.6 ? "preserved" : Comp > 0.35 ? "reduced" : "low", w(Org, 0.3, 0.6, ["mild", "moderate", "high"])];
  return { a, A, Cx, Comp, Org, hcq: drug === 1 ? 1 : 0, steroid: drug === 2 ? 1 : 0, immuno: drug === 3 ? 1 : 0, words, readout: "autoantibodies " + words[0] + " · immune complexes " + words[1] + " · complement " + words[2] + " · organ inflammation " + words[3] };
}
const TESTS = [
  [2, 0, "autoantibodies high · immune complexes many · complement low · organ inflammation high"],
  [2, 1, "autoantibodies moderate · immune complexes some · complement reduced · organ inflammation moderate"],
  [2, 2, "autoantibodies high · immune complexes many · complement reduced · organ inflammation mild"],
  [2, 3, "autoantibodies moderate · immune complexes some · complement preserved · organ inflammation mild"],
  [0, 0, "autoantibodies moderate · immune complexes some · complement preserved · organ inflammation moderate"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LOSS OF TOLERANCE</text>
<text class="sc-zone sc-dim" x="34" y="240">BLOODSTREAM</text>
<rect class="sle-vessel" x="14" y="248" width="${W - 28}" height="64" rx="10"/>
<rect id="vesselHeat" class="sle-heat" x="14" y="248" width="${W - 28}" height="64" rx="10" opacity="0"/>
<g id="skinSlot"></g>
<g id="jointSlot"></g>
<g id="kidneySlot"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sle-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 40%,var(--anatomy-mid));stroke-width:1}
.sle-heat{fill:var(--c-bad);stroke:none;pointer-events:none}
.sle-glow{fill:var(--c-bad);stroke:none;pointer-events:none}
.sle-shield{fill:var(--c-no);stroke:var(--c-no);stroke-width:3;stroke-dasharray:10 7;pointer-events:none}
.sle-fluid{fill:var(--c-fl);stroke:none}
.sle-rash{fill:var(--c-bad);stroke:none}
.sle-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-ag{--cc:#ff9a3d}.p-cplx{--cc:#ff9a3d}.p-comp{--cc:#7fd3ff}
.p-help{--cc:var(--c-lymph)}.p-leak{--cc:var(--c-fl)}
.p-hcq{--cc:#e8d36a}.p-ster{--cc:#7ab8ff}.p-imm{--cc:#c084fc}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.g-ana{fill:var(--c-b)}.g-cplx{fill:#ff9a3d}.g-comp{fill:var(--c-good)}.g-org{fill:var(--c-bad)}
`;

buildScene({
  id: "systemic-lupus", fig: "Fig 1", title: "Systemic lupus erythematosus: loss of tolerance to organ damage", W, H, body, extraCss,
  label: "An animated scene in systemic lupus erythematosus. Nuclear material from damaged cells is shown to helper T cells. T cells help B cells, which make anti-nuclear antibodies. Antibodies meet nuclear antigen in the bloodstream and form immune complexes. Complement is used up as complexes deposit in skin, joints, kidney and blood vessels and blood cells, causing inflammation and low cell counts. The activity slider moves from mild to flare. Treatment choices are hydroxychloroquine, a steroid and an immunosuppressant. Gauges show autoantibodies, immune complexes, complement remaining and organ inflammation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "sle.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With immunosuppressant",
  sourcesLis: [
    "<strong>How lupus injures tissues.</strong> In systemic lupus erythematosus, tolerance to nuclear self antigens is lost. Nuclear material from damaged and dying cells is presented to helper T cells, T cells help B cells, and B cells make anti-nuclear and related autoantibodies. Antibody and nuclear antigen form immune complexes that circulate, deposit in small vessels and tissues, activate complement and recruit inflammation. Complement is consumed, so complement levels fall in active disease. Deposition and inflammation affect skin and joints, the kidney glomeruli, blood cells and other organs. This is standard teaching in immunology, rheumatology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Hydroxychloroquine dampens immune activation and autoantibody drive over time. A steroid calms tissue inflammation quickly while autoantibodies and complexes persist more. An immunosuppressant suppresses B cell and T cell activity more strongly, so autoantibodies, complexes and organ inflammation fall. These are teaching toggles only and name no individual drug beyond the classes requested or any dose.",
  ],
  simplified: "Genetics and environmental triggers, interferon pathways, neutrophil extracellular traps, individual autoantibody specificities, complement genetics, organ specific staging and biopsy classes, infection and other treatment risks, and all doses and targets are left out. Blood involvement is shown only as falling cell counts. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
