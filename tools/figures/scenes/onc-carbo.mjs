/* Carboplatin mechanism and adverse effects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-carbo.mjs [--print-model]
 * Static layout here; tumour DNA crosslinks, renal clearance, marrow, kidney, ear, gut, allergy and gauges move in onc-carbo.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.15, 0.5, 0.85], names: ["early", "middle", "late"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "carboplatin" },
    { label: "carboplatin with dose set to kidney function" },
    { label: "carboplatin with count and allergy support" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "carboplatin", "carboplatin with kidney dosing", "carboplatin with count and allergy support"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const carbo = drug >= 1 ? 1 : 0;
  const kd = (drug === 2 || drug === 3) ? 1 : 0;
  const sup = drug === 3 ? 1 : 0;
  const K = carbo ? cl(0.30 + 0.60 * a) : cl(0.04 + 0.03 * a);
  const P = carbo ? cl(0.25 + 0.65 * a - 0.08 * kd - 0.15 * sup) : cl(0.05 + 0.02 * a);
  const Kd = carbo ? cl(0.18 + 0.25 * a - 0.15 * kd) : 0.05;
  const E = carbo ? cl(0.12 + 0.30 * a - 0.05 * kd) : 0.04;
  const Sk = carbo ? cl(0.35 + 0.10 * a) : 0.05;
  const A = carbo ? cl(0.05 + 0.75 * a * a - 0.35 * sup) : 0.03;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.6, ["low", "fair", "high"]), w(P, 0.3, 0.55, ["normal", "low", "very low"]), w(Kd, 0.15, 0.3, ["normal", "mild harm", "harm"]), w(A, 0.2, 0.45, ["rare", "possible", "likely"])];
  return { a, carbo, kd, sup, K, P, Kd, E, Sk, A, words, readout: "tumour kill " + words[0] + " · platelets " + words[1] + " · kidney " + words[2] + " · allergy " + words[3] };
}
const TESTS = [
  [1, 0, "tumour kill low · platelets normal · kidney normal · allergy rare"],
  [1, 1, "tumour kill high · platelets very low · kidney harm · allergy possible"],
  [2, 1, "tumour kill high · platelets very low · kidney harm · allergy likely"],
  [2, 3, "tumour kill high · platelets very low · kidney mild harm · allergy possible"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TUMOUR CELL</text>
<text class="sc-zone" x="500" y="68">TOXIC ORGANS</text>
<path class="cb-div" d="M480 80V430"/>
<circle id="tumCell" class="cb-cell" cx="240" cy="255" r="105"/>
<circle id="tumNuc" class="cb-nuc" cx="240" cy="255" r="52"/>
<path class="cb-dna" d="M200 248C214 238 226 266 240 250C252 236 262 260 278 250"/>
<path class="cb-dna cb-dna2" d="M200 264C214 254 226 282 240 266C252 252 262 276 278 266"/>
<g id="xlinks">
<path class="cb-x" d="M228 246L238 258M238 246L228 258"/>
<path class="cb-x" d="M244 250L254 262M254 250L244 262"/>
<path class="cb-x" d="M258 242L268 254M268 242L258 254"/>
<path class="cb-x" d="M216 258L226 270M226 258L216 270"/>
<path class="cb-x" d="M236 262L246 274M246 262L236 274"/>
<path class="cb-x" d="M252 256L262 268M262 256L252 268"/>
</g>
<text class="sc-lab" x="240" y="322" text-anchor="middle">DNA</text>
<g id="nodSlot"></g>
<g id="kidSlot"></g>
<g id="earSlot"></g>
<g id="bowelSlot"></g>
<circle class="cb-bone" cx="725" cy="185" r="30"/>
<circle class="cb-bone" cx="875" cy="185" r="30"/>
<rect class="cb-bone" x="725" y="158" width="150" height="54" rx="24"/>
<ellipse id="marCav" class="cb-cav" cx="800" cy="185" rx="54" ry="15"/>
<g id="marSlot"></g>
<g id="earWaves">
<path id="ew0" class="cb-wave" d="M664 314Q682 335 664 356"/>
<path id="ew1" class="cb-wave" d="M676 306Q700 335 676 364"/>
<path id="ew2" class="cb-wave" d="M688 298Q718 335 688 372"/>
</g>
<g id="gutChurn">
<path class="cb-churn" d="M745 282Q755 270 765 282"/>
<path class="cb-churn" d="M770 276Q780 264 790 276"/>
</g>
<path id="kidArrow" class="cb-flow" d="M600 244V266M594 260L600 266L606 260"/>
<circle id="allerBlush" class="cb-blush" cx="900" cy="322" r="26" opacity="0"/>
<g id="mastSlot"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cb-div{fill:none;stroke:var(--anatomy-faint);stroke-width:1.4;stroke-dasharray:6 6}
.cb-cell{fill:color-mix(in srgb,var(--c-endo) 16%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1.4}
.cb-nuc{fill:color-mix(in srgb,var(--c-mac) 22%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1.2}
.cb-dna{fill:none;stroke:var(--c-mac);stroke-width:2.2;stroke-linecap:round}
.cb-dna2{stroke:var(--c-lymph);opacity:.8}
.cb-x{fill:none;stroke:var(--c-plt);stroke-width:2.4;stroke-linecap:round}
.cb-bone{fill:color-mix(in srgb,var(--c-graft) 30%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1.2}
.cb-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:1}
.cb-wave{fill:none;stroke:var(--c-lymph);stroke-width:2;stroke-linecap:round}
.cb-churn{fill:none;stroke:var(--c-graft);stroke-width:2;stroke-linecap:round}
.cb-blush{fill:var(--c-bad);stroke:none}
.cb-flow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.8;stroke-linecap:round}
.cb-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-tum{--cc:#e07a6a}
.p-carbo{--cc:#ffd24a}.p-hist{--cc:var(--c-mast)}.p-kid{--cc:var(--c-fl)}.p-gut{--cc:var(--c-graft)}.p-deb{--cc:var(--c-bad)}
`;

buildScene({
  id: "carboplatin-mechanism-adverse-effects", fig: "Fig 1", title: "Carboplatin: DNA crosslinks, kidney based dosing and marrow harm", W, H, body, extraCss,
  label: "An animated tumour cell and toxic organs for carboplatin. Carboplatin carries a stable leaving group, enters the tumour cell, activates and joins the two DNA strands with crosslinks so copying stalls and the cell dies. The kidney clears the drug into urine, so the dose is set to kidney function. Dividing marrow cells are harmed too, so platelets fall first with bleeding risk, then red cells and neutrophils. Hearing, balance and nerve cells and the kidney suffer milder harm than with cisplatin, sickness is milder, and histamine allergy can appear after repeated cycles. Gauges show tumour kill, platelets, kidney, hearing, sickness and allergy.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-carbo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With count and allergy support",
  sourcesLis: [
    "<strong>How carboplatin kills the tumour.</strong> Carboplatin is a platinum drug whose stable leaving group is exchanged inside the cell for water, letting platinum join the two strands of tumour DNA with crosslinks. Crosslinked DNA cannot be copied or read cleanly, so dividing tumour cells stall and die. The drug leaves the body through the kidney into urine, so the dose is set to kidney function and the drug exposure stays steady when the kidneys are weak. This is standard teaching in oncology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why the side effects happen.</strong> Marrow progenitors divide rapidly, so platinum harms them alongside the tumour and platelet making fails first, giving a low platelet count with bruising and bleeding, plus anaemia and infection risk when red cells and neutrophils fall. Kidney tubule cells, inner ear hearing and balance cells and peripheral nerves take up some platinum but are injured less than with cisplatin because the stable leaving group reacts more slowly. Gut signals to the vomiting centre give nausea and vomiting, milder than with cisplatin. After repeated cycles the immune system can learn to attack the drug, so histamine allergy with rash, breathlessness and pressure fall can appear. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Protective ideas shown.</strong> Setting the dose to kidney function keeps drug exposure steady and limits excess marrow and kidney harm. Blood count checks with transfusion support carry the patient through the low platelet spell, and slower infusion with allergy watch and readiness to stop softens the repeated cycle allergy risk. These are teaching toggles only.",
  ],
  simplified: "Specific cancers treated, combination regimens, antiemetic and growth factor choices, exact timing of the platelet low point, rare harms, resistance mechanisms and all doses, schedules and adjustments are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
