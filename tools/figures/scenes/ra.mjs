/* Rheumatoid arthritis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ra.mjs [--print-model]
 * Static layout here; lymph node, vessel, knee joint, pannus and gauges move in ra.page.js. Qualitative: no doses, no numbers. */
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
    { label: "steroid (quick relief)" },
    { label: "TNF blocker (biologic)" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "a DMARD", "a steroid", "a TNF blocker"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const eA = [0, 0.55, 0.4, 0.35][drug], eT = [0, 0.5, 0.5, 0.82][drug], eI6 = [0, 0.5, 0.5, 0.3][drug];
  const eP = [0, 0.6, 0.22, 0.68][drug], eE = [0, 0.35, 0.08, 0.42][drug];
  const A = cl((0.18 + 0.77 * a) * (1 - eA));
  const Craw = 0.15 + 0.8 * a;
  const Tnf = cl(Craw * (1 - eT)), Il6 = cl(Craw * (1 - eI6));
  const C = cl(0.55 * Tnf + 0.45 * Il6);
  const I = cl(0.12 + 0.8 * C + 0.1 * A);
  const P = cl((0.1 + 0.85 * a) * (1 - eP) + 0.15 * C);
  const E = cl((0.05 + 0.9 * a * a) * (1 - eE) + 0.1 * P);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(A, 0.3, 0.6, ["low", "moderate", "high"]), w(C, 0.3, 0.6, ["low", "moderate", "high"]), w(P, 0.45, 0.7, ["small", "growing", "extensive"]), w(E, 0.3, 0.7, ["little", "moderate", "severe"])];
  return { a, A, C, Tnf, Il6, I, P, E, dmard: drug === 1 ? 1 : 0, steroid: drug === 2 ? 1 : 0, tnfBlock: drug === 3 ? 1 : 0, words, readout: "immune activity " + words[0] + " · cytokines " + words[1] + " · pannus " + words[2] + " · joint damage " + words[3] };
}
const TESTS = [
  [2, 0, "immune activity high · cytokines high · pannus extensive · joint damage severe"],
  [2, 1, "immune activity moderate · cytokines moderate · pannus growing · joint damage moderate"],
  [2, 2, "immune activity moderate · cytokines moderate · pannus extensive · joint damage severe"],
  [2, 3, "immune activity high · cytokines moderate · pannus small · joint damage moderate"],
  [0, 0, "immune activity moderate · cytokines moderate · pannus small · joint damage little"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">IMMUNE ATTACK</text>
<text class="sc-zone" x="600" y="68">SYNOVIAL JOINT</text>
<path id="cytoVessel" class="ra-vessel" d="M183 316 C293 312 405 296 515 280"/>
<g id="nodeSlot"></g>
<g id="jointSlot"></g>
<ellipse id="jointGlow" class="ra-glow" cx="657" cy="262" rx="110" ry="95" opacity="0"/>
<rect id="synL" class="ra-syn" x="549" y="180" width="12" height="150" rx="6"/>
<rect id="synR" class="ra-syn" x="749" y="180" width="12" height="150" rx="6"/>
<rect id="cartBar" class="ra-cart" x="600" y="258" width="110" height="8" rx="4"/>
<g id="pannus"></g>
<g id="notches"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.ra-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:15;stroke-linecap:round;opacity:.8}
.ra-glow{fill:var(--c-bad);stroke:none}
.ra-syn{fill:var(--c-bad);stroke:none;opacity:.5}
.ra-cart{fill:#6fb7de;stroke:#3d7fa8;stroke-width:1}
.ra-pan{fill:#d96a6a;stroke:#a83a3a;stroke-width:.8}
.ra-notch{fill:var(--anatomy-paper);stroke:#a83a3a;stroke-width:1}
.ra-cap{fill:var(--anatomy-strong);font-size:12px}
.p-tnf{--cc:var(--c-cyt)}.p-il6{--cc:var(--c-cyt2)}.p-enz{--cc:#ffd24a}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ab-bl{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.rx-cap{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.rx-cap2{fill:var(--c-good);stroke:none;opacity:.85}
.g-imm{fill:var(--c-lymph)}.g-pan{fill:#d96a6a}
`;

buildScene({
  id: "rheumatoid-arthritis", fig: "Fig 1", title: "Rheumatoid arthritis: synovitis to joint erosion", W, H, body, extraCss,
  label: "An animated immune attack on a knee joint in rheumatoid arthritis. Immune cells in a lymph node switch on T cells and B cells. B cells release autoantibodies. TNF and IL-6 travel in the blood to the joint. The synovial lining thickens and forms pannus, which grows over cartilage. Osteoclasts and enzymes erode cartilage and bone. The stage slider moves from early to advanced disease. Treatment choices are a DMARD, a steroid and a TNF blocker, and the TNF blocker visibly traps TNF in the blood. Gauges show immune activity, cytokines, pannus and joint damage.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ra.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With TNF blocker",
  sourcesLis: [
    "<strong>How rheumatoid arthritis damages a joint.</strong> In a genetically susceptible person, immune tolerance to self antigens (including citrullinated proteins) is lost. Presenting cells activate T cells, T cells help B cells, and B cells make autoantibodies such as rheumatoid factor and anti-CCP. T cells, B cells, macrophages and fibroblast-like synoviocytes release cytokines, chiefly TNF and IL-6. The synovial lining thickens (synovitis), forms invasive pannus, and releases enzymes. Pannus and osteoclasts erode cartilage and the bone beneath it, which is the permanent joint damage. This is standard teaching in rheumatology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A DMARD slows the immune attack itself and protects the joint, but works slowly. A steroid calms inflammation and symptoms quickly, but pannus and erosion are much less well controlled, so damage can continue behind the relief. A TNF blocker neutralises TNF, so TNF-driven inflammation, pannus and erosion fall while some IL-6 activity remains. These are teaching toggles only and name no individual drug or dose.",
  ],
  simplified: "Genetics and environmental triggers, citrullination in detail, complement, angiogenesis, individual DMARDs and biologics, infection and other treatment risks, extra-articular disease, and all doses and targets are left out. Existing erosion is shown as largely irreversible. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
