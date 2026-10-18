/* Heart failure with preserved ejection fraction as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hfpef.mjs [--print-model]
 * Long standing load thickens and stiffens the left ventricle. It squeezes normally but fills slowly,
 * so filling pressure rises, the left atrium enlarges and pressure backs up into the lungs.
 * Qualitative: no doses, no numbers. */
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
    { label: "blood pressure control" },
    { label: "SGLT2 inhibitor concept" },
    { label: "diuretic" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "blood pressure control", "SGLT2 inhibitor concept", "diuretic"],
};
function modelOf(S, level, drug) {
  const TREAT = [
    { bp: 0, sg: 0, diu: 0 },
    { bp: 1, sg: 0, diu: 0 },
    { bp: 0, sg: 1, diu: 0 },
    { bp: 0, sg: 0, diu: 1 },
  ];
  const t = TREAT[drug] || TREAT[0];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const stiff = cl(0.12 + 0.86 * a - 0.16 * t.bp - 0.10 * t.sg);
  const fill = cl(0.05 + 0.85 * stiff + 0.12 * a - 0.28 * t.bp - 0.36 * t.sg - 0.52 * t.diu);
  const cong = cl(0.92 * fill + 0.10 * a - 0.18 * t.sg - 0.34 * t.diu);
  const la = cl(0.06 + 0.80 * fill + 0.12 * a - 0.08 * t.bp - 0.08 * t.sg - 0.10 * t.diu);
  const ef = cl(0.88 - 0.05 * a + 0.02 * t.sg);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(fill, 0.25, 0.6, ["near normal", "raised", "high"]), w(cong, 0.25, 0.6, ["minimal", "mild", "marked"]), w(ef, 0.6, 0.75, ["reduced", "borderline", "preserved"])];
  return { a, bp: t.bp, sg: t.sg, diu: t.diu, stiff, fill, cong, la, ef, words, readout: "filling pressure " + words[0] + " · congestion " + words[1] + " · ejection " + words[2] };
}
const TESTS = [
  [1, 0, "filling pressure high · congestion marked · ejection preserved"],
  [1, 3, "filling pressure near normal · congestion minimal · ejection preserved"],
  [2, 2, "filling pressure raised · congestion mild · ejection preserved"],
  [0, 0, "filling pressure raised · congestion mild · ejection preserved"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<g id="heartSlot"></g><g id="lungSlot"></g><g id="kidneySlot"></g>
<g id="drivers"></g><g id="heart"></g><g id="cong"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "heart-failure-preserved-ejection-fraction", fig: "Fig 1", title: "Heart failure with preserved ejection fraction", W, H, body,
  label: "An animated stiff left ventricle. Years of load from hypertension, diabetes, obesity and ageing thicken its wall. The chamber squeezes normally but fills slowly, so filling needs a higher pressure. The left atrium enlarges and pressure backs up into the lungs, causing breathlessness despite a preserved ejection fraction. Blood pressure control parks blockers on the load vessel and eases the wall, the SGLT2 inhibitor concept moves salt and sugar out through the kidney, and a diuretic flushes water out so lung fluid drains. Gauges show stiffness, filling pressure, atrial size, congestion and ejection.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hfpef.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With diuretic",
  sourcesLis: [
    "<strong>How this type of heart failure develops.</strong> Long-standing hypertension, diabetes, obesity and ageing promote concentric hypertrophy: the left ventricular wall thickens inward and the chamber stays small. The thick muscle relaxes slowly and is stiff, so filling needs a higher pressure even though the squeeze, and therefore the ejection fraction, stays preserved. Raised filling pressure enlarges the left atrium and backs up into the pulmonary veins and lungs, giving breathlessness and congestion. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Where treatments act in the drawing.</strong> Blood pressure control lowers the load the wall thickened against, shown as blockers docking on the load vessel while the wall ring thins. The SGLT2 inhibitor concept is shown as salt and sugar particles leaving through the kidney in urine, easing fluid and filling pressure. A diuretic flushes water out through the kidney so lung fluid visibly drains; it gives the largest fall in congestion and filling pressure here. These are teaching toggles for the mechanism only.",
    "<strong>The squeeze stays preserved.</strong> Ejection down the aorta stays brisk in every setting, which is the point of the name: the problem is filling, not emptying.",
  ],
  simplified: "Atrial fibrillation, pulmonary hypertension and right heart involvement, kidney disease, anaemia, amyloidosis and other specific causes, valve disease, natriuretic peptides, diastolic grading, exercise testing, and every dose and target are left out. Sizes, speeds and levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.hfpef-drv{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1}
.hfpef-load{fill:none;stroke:var(--c-bad);stroke-width:7;stroke-linecap:round}
.hfpef-rec{fill:none;stroke:var(--anatomy-hi);stroke-width:2;stroke-linecap:round}
.hfpef-cav{fill:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 70%,#000);stroke-width:1}
.hfpef-ring{fill:none;stroke:color-mix(in srgb,var(--c-bad) 55%,var(--anatomy-paper));stroke-linecap:round}
.hfpef-la{fill:color-mix(in srgb,var(--c-bad) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1.2}
.hfpef-laves{fill:none;stroke:color-mix(in srgb,var(--c-bad) 45%,var(--anatomy-paper));stroke-linecap:round}
.hfpef-beam{fill:none;stroke:var(--c-fl);stroke-linecap:round}
.hfpef-haze{fill:var(--c-fl);stroke:none}
.hfpef-fluid{fill:var(--c-fl);stroke:none}
.hfpef-cap{fill:var(--anatomy-strong);font-size:13px;font-weight:600;pointer-events:none}
.p-hfpef-load{fill:var(--c-bad)}
.p-hfpef-in{fill:var(--c-fl)}
.p-hfpef-out{fill:var(--c-rbc)}
.p-hfpef-back{fill:var(--c-fl)}
.p-hfpef-drop{fill:var(--c-fl)}
.p-hfpef-ur{fill:var(--c-fl)}
.p-hfpef-blk{fill:var(--c-lymph)}
.p-hfpef-sg{fill:#e8a33d}
`,
});
