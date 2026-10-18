/* Heart failure with preserved ejection fraction as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hfpef.mjs [--print-model]
 * Hypertension, diabetes, obesity and age thicken and stiffen the left ventricle. It squeezes normally but relaxes slowly,
 * so filling pressure rises, the left atrium enlarges and pressure backs up into the lungs. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How far the disease has gone", a: [0.3, 0.65, 1], names: ["compensated", "congested", "decompensated"], ticks: ["compensated", "congested", "decompensated"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "diuretic" },
    { label: "blood pressure control" },
    { label: "SGLT2 inhibitor concept" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "diuretic", "blood pressure control", "SGLT2 inhibitor concept"],
};
function modelOf(S, level, drug) {
  const TREAT = [
    { diu: 0, bp: 0, sg: 0 },
    { diu: 1, bp: 0, sg: 0 },
    { diu: 0, bp: 1, sg: 0 },
    { diu: 0, bp: 0, sg: 1 },
  ];
  const t = TREAT[drug] || TREAT[0];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const stiff = cl(0.10 + 0.88 * a - 0.08 * t.bp - 0.05 * t.sg);
  const fill = cl(0.06 + 0.82 * stiff + 0.10 * a - 0.40 * t.diu - 0.18 * t.bp - 0.10 * t.sg);
  const cong = cl(0.90 * fill + 0.08 * a - 0.16 * t.diu - 0.04 * t.sg);
  const la = cl(0.08 + 0.78 * fill + 0.10 * a - 0.06 * t.diu - 0.06 * t.bp);
  const ef = cl(0.88 - 0.06 * a + 0.02 * t.sg);
  const sx = cl(0.55 * cong + 0.45 * fill);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(fill, 0.25, 0.6, ["near normal", "raised", "high"]), w(cong, 0.25, 0.5, ["minimal", "mild", "marked"]), w(ef, 0.6, 0.75, ["reduced", "borderline", "preserved"])];
  return { a, diu: t.diu, bp: t.bp, sg: t.sg, stiff, fill, cong, la, ef, sx, words, readout: "filling pressure " + words[0] + " · congestion " + words[1] + " · ejection " + words[2] };
}
const TESTS = [
  [0, 0, "filling pressure raised · congestion mild · ejection preserved"],
  [1, 0, "filling pressure high · congestion marked · ejection preserved"],
  [1, 1, "filling pressure raised · congestion minimal · ejection preserved"],
  [2, 1, "filling pressure raised · congestion mild · ejection preserved"],
  [2, 2, "filling pressure high · congestion marked · ejection preserved"],
  [2, 3, "filling pressure high · congestion marked · ejection preserved"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="270" height="396" rx="18"/>
<rect class="sc-tissue" x="296" y="44" width="340" height="396" rx="18"/>
<rect class="sc-tissue" x="648" y="44" width="298" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">WHY THE WALL THICKENS</text>
<text class="sc-zone" x="316" y="68">STIFF LEFT VENTRICLE</text>
<text class="sc-zone" x="668" y="68">WHEN PRESSURE BACKS UP</text>
<g id="drivers"></g><g id="heart"></g><g id="cong"></g><g id="inset"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "heart-failure-preserved-ejection-fraction", fig: "Fig 1", title: "Heart failure with preserved ejection fraction", W, H, body,
  label: "An animated stiff left ventricle. Hypertension, diabetes, obesity and ageing thicken its wall. The chamber squeezes normally but relaxes slowly and fills at high pressure. The left atrium enlarges and pressure backs up into the lungs, causing breathlessness despite a preserved ejection fraction. A small inset contrasts this with reduced ejection fraction, where the ventricle is dilated and squeezes weakly. Gauges show stiffness, filling pressure, atrial size, congestion and ejection. Treatments shown are a diuretic, blood pressure control and an SGLT2 inhibitor concept.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hfpef.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How this type of heart failure develops.</strong> Long-standing hypertension, diabetes, obesity and ageing promote concentric hypertrophy: the left ventricular wall thickens inward and the chamber stays small. The thick muscle relaxes slowly and is stiff, so filling needs a higher pressure even though the squeeze, and therefore the ejection fraction, stays preserved. Raised filling pressure enlarges the left atrium and backs up into the pulmonary veins and lungs, giving breathlessness and congestion. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Where treatments act in the drawing.</strong> A diuretic removes salt and water and lowers congestion and filling pressure. Blood pressure control lowers the load the wall thickened against and slows further hypertrophy. SGLT2 inhibitors are shown as a concept: they ease congestion and are part of modern teaching for this condition. These are teaching toggles for the mechanism only.",
    "<strong>Contrast with reduced ejection fraction.</strong> In that type the ventricle is dilated with a thin wall and a weak squeeze, so the ejection fraction falls. Here the chamber is small and thick and the squeeze is preserved; the problem is filling, not emptying.",
  ],
  simplified: "Atrial fibrillation, pulmonary hypertension and right heart involvement, kidney disease, anaemia, amyloidosis and other specific causes, valve disease, natriuretic peptides, diastolic grading, exercise testing, and every dose and target are left out. Sizes, speeds and levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.hfpef-wall{fill:color-mix(in srgb,var(--c-bad) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 70%,#000);stroke-width:1.3}
.hfpef-shade{fill:#000;opacity:.12}
.hfpef-ch{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 70%,#000);stroke-width:1}
.hfpef-rv{fill:color-mix(in srgb,var(--c-cyt2) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt2) 60%,#000);stroke-width:1.1}
.hfpef-at{fill:color-mix(in srgb,var(--c-bad) 24%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:1}
.hfpef-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.hfpef-node-t{fill:var(--anatomy-strong);font-size:11px;font-weight:600;pointer-events:none}
.hfpef-cap{fill:var(--anatomy-text);font-size:10px;pointer-events:none}
.hfpef-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hfpef-back{fill:none;stroke:var(--c-fl);stroke-width:1.8;stroke-linecap:round;opacity:.65}
.hfpef-head{fill:var(--anatomy-mid)}
.hfpef-aorta{fill:none;stroke:var(--c-rbc);stroke-width:7;stroke-linecap:round;opacity:.5}
.hfpef-dot{fill:var(--c-cyt)}
.hfpef-inflow{fill:var(--c-fl)}
.hfpef-eject{fill:var(--c-rbc)}
.hfpef-lung{fill:color-mix(in srgb,var(--c-cyt2) 20%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.6}
.hfpef-fluid{fill:var(--c-fl)}
.hfpef-mini{fill:color-mix(in srgb,var(--c-cyt2) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt2) 60%,#000);stroke-width:1.1}
.hfpef-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.hfpef-xx{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.hfpef-mk{fill:var(--c-bad);font-size:10.5px;font-weight:600;pointer-events:none}
.p-hfpef-drop{fill:var(--c-fl)}`,
});
