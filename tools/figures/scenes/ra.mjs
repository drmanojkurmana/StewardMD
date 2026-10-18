/* Rheumatoid arthritis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ra.mjs [--print-model]
 * Static layout here; cells, cytokines, pannus and gauges move in ra.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease stage", a: [0.3, 0.65, 1], names: ["early", "established", "advanced"], ticks: ["early", "established", "advanced"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "DMARD (disease modifying drug)" },
    { label: "TNF blocker (biologic)" },
    { label: "steroid (quick relief)" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "a DMARD", "a TNF blocker", "a steroid"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const eA = [0, 0.55, 0.35, 0.4][drug], eT = [0, 0.5, 0.82, 0.5][drug], eI6 = [0, 0.5, 0.3, 0.5][drug];
  const eP = [0, 0.6, 0.68, 0.22][drug], eE = [0, 0.35, 0.42, 0.08][drug];
  const A = cl((0.18 + 0.77 * a) * (1 - eA));
  const Craw = 0.15 + 0.8 * a;
  const Tnf = cl(Craw * (1 - eT)), Il6 = cl(Craw * (1 - eI6));
  const C = cl(0.55 * Tnf + 0.45 * Il6);
  const I = cl(0.12 + 0.8 * C + 0.1 * A);
  const P = cl((0.1 + 0.85 * a) * (1 - eP) + 0.15 * C);
  const E = cl((0.05 + 0.9 * a * a) * (1 - eE) + 0.1 * P);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(A, 0.3, 0.6, ["low", "moderate", "high"]), w(C, 0.3, 0.6, ["low", "moderate", "high"]), w(P, 0.45, 0.7, ["small", "growing", "extensive"]), w(E, 0.3, 0.7, ["little", "moderate", "severe"])];
  return { a, A, C, Tnf, Il6, I, P, E, dmard: drug === 1 ? 1 : 0, tnfBlock: drug === 2 ? 1 : 0, steroid: drug === 3 ? 1 : 0, words, readout: "immune activity " + words[0] + " · cytokines " + words[1] + " · pannus " + words[2] + " · joint damage " + words[3] };
}
const TESTS = [
  [2, 0, "immune activity high · cytokines high · pannus extensive · joint damage severe"],
  [2, 1, "immune activity moderate · cytokines moderate · pannus growing · joint damage moderate"],
  [2, 2, "immune activity high · cytokines moderate · pannus small · joint damage moderate"],
  [2, 3, "immune activity moderate · cytokines moderate · pannus extensive · joint damage severe"],
  [0, 0, "immune activity moderate · cytokines moderate · pannus small · joint damage little"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">IMMUNE ACTIVATION</text>
<text class="sc-zone" x="360" y="68">SYNOVIAL JOINT</text>
<rect class="ra-cav" x="315" y="85" width="330" height="330" rx="28"/>
<rect id="jointGlow" class="ra-glow" x="315" y="85" width="330" height="330" rx="28" opacity="0"/>
<rect id="synL" class="ra-syn" x="315" y="108" width="16" height="284" rx="8"/>
<rect id="synR" class="ra-syn" x="629" y="108" width="16" height="284" rx="8"/>
<path class="ra-bone" d="M395 85L565 85L565 175C565 205 540 220 520 212C505 206 455 206 440 212C420 220 395 205 395 175Z"/>
<path class="ra-bone" d="M395 415L565 415L565 325C565 295 540 280 520 288C505 294 455 294 440 288C420 280 395 295 395 325Z"/>
<path id="cartT" class="ra-cart" d="M402 180C402 205 422 218 442 211C458 205 502 205 518 211C538 218 558 205 558 180"/>
<path id="cartB" class="ra-cart" d="M402 320C402 295 422 282 442 289C458 295 502 295 518 289C538 282 558 295 558 320"/>
<g id="notches"></g>
<g id="pannus"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.ra-cav{fill:color-mix(in srgb,var(--c-fl) 10%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.ra-glow{fill:var(--c-bad)}
.ra-bone{fill:#e8dcc0;stroke:#a89268;stroke-width:1.2}
.ra-cart{fill:none;stroke:#6fb7de;stroke-width:9;stroke-linecap:round}
.ra-syn{fill:var(--c-bad);opacity:.5}
.ra-pan{fill:#d96a6a;stroke:#a83a3a;stroke-width:.8}
.ra-notch{fill:var(--anatomy-paper)}
.p-tnf{--cc:var(--c-cyt)}.p-il6{--cc:var(--c-cyt2)}.p-enz{--cc:#ffd24a}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.g-imm{fill:var(--c-lymph)}.g-pan{fill:#d96a6a}
`;

buildScene({
  id: "rheumatoid-arthritis", fig: "Fig 1", title: "Rheumatoid arthritis: synovitis to joint erosion", W, H, body, extraCss,
  label: "An animated synovial joint in rheumatoid arthritis. Presenting cells activate T cells and B cells. B cells make autoantibodies. T cells, macrophages and synovial cells release TNF and IL-6. The synovial lining thickens and forms pannus, which grows over cartilage. Osteoclasts and enzymes erode cartilage and bone. The stage slider moves from early to advanced disease. Treatment choices are a DMARD, a TNF blocker and a steroid. Gauges show immune activity, cytokines, pannus and joint damage.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ra.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How rheumatoid arthritis damages a joint.</strong> In a genetically susceptible person, immune tolerance to self antigens (including citrullinated proteins) is lost. Presenting cells activate T cells, T cells help B cells, and B cells make autoantibodies such as rheumatoid factor and anti-CCP. T cells, B cells, macrophages and fibroblast-like synoviocytes release cytokines, chiefly TNF and IL-6. The synovial lining thickens (synovitis), forms invasive pannus, and releases enzymes. Pannus and osteoclasts erode cartilage and the bone beneath it, which is the permanent joint damage. This is standard teaching in rheumatology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A DMARD slows the immune attack itself and protects the joint, but works slowly. A TNF blocker neutralises TNF, so TNF-driven inflammation, pannus and erosion fall while some IL-6 activity remains. A steroid calms inflammation and symptoms quickly, but pannus and erosion are much less well controlled, so damage can continue behind the relief. These are teaching toggles only and name no individual drug or dose.",
  ],
  simplified: "Genetics and environmental triggers, citrullination in detail, complement, angiogenesis, individual DMARDs and biologics, infection and other treatment risks, extra-articular disease, and all doses and targets are left out. Existing erosion is shown as largely irreversible. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
