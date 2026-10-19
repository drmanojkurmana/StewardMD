/* Pulmonary hypertension as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pulmhtn.mjs [--print-model]
 * Raised pulmonary artery pressure from vascular remodelling with endothelial dysfunction and vasoconstriction,
 * left heart disease, lung disease with hypoxic vasoconstriction and chronic thromboembolic disease loads the
 * right ventricle, which hypertrophies then dilates into right heart failure. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the pulmonary hypertension", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "oxygen and water pill" },
    { label: "vessel relaxer (concept)" },
    { label: "treat the cause" },
  ],
  status: "Pulmonary hypertension: {level} · {drug} ·",
  drugNames: ["no treatment", "oxygen and water pill", "vessel relaxer", "cause treated"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const oxy = drug === 1 ? 1 : 0, vaso = drug === 2 ? 1 : 0, cause = drug === 3 ? 1 : 0;
  const CUT = { oxy: 0.10, vaso: 0.30, cause: [0.44, 0.39, 0.34] };
  const pvr = cl(0.14 + 0.82 * a - oxy * CUT.oxy - vaso * CUT.vaso - cause * CUT.cause[level]);
  const pap = cl(0.10 + 0.88 * pvr);
  const hyp = cl(0.10 + 0.84 * a * (cause ? 0.72 : 1) - oxy * 0.18);
  const dil = cl(a * a * 1.05 - cause * 0.18 - vaso * 0.10);
  const strain = cl(0.5 * hyp + 0.6 * dil + 0.2 * pap - 0.1);
  const output = cl(0.94 - 0.52 * dil - 0.18 * strain + vaso * 0.08 + cause * 0.12);
  const cong = cl(0.06 + 0.95 * dil * dil + 0.35 * Math.max(0, strain - 0.5) - oxy * 0.62 - cause * 0.34 - vaso * 0.06);
  const dys = cl(0.08 + 0.45 * pap + 0.45 * cong + 0.25 * (1 - output) - oxy * 0.08 - cause * 0.10);
  const sys = cl(0.90 - 0.28 * (1 - output) - vaso * 0.16);
  const renal = cl(cong * 0.7 + (1 - output) * 0.5);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(pap, 0.40, 0.72, ["near normal", "raised", "very high"]), w(dil, 0.30, 0.65, ["thickened", "thick and strained", "dilated and failing"]), w(cong, 0.28, 0.62, ["none", "some", "marked"])];
  return { a, oxy, vaso, cause, pvr, pap, hyp, dil, strain, output, cong, dys, sys, renal, words, readout: "pulmonary pressure " + words[0] + " · right ventricle " + words[1] + " · congestion " + words[2] };
}
const TESTS = [
  [2, 0, "pulmonary pressure very high · right ventricle dilated and failing · congestion marked"],
  [1, 0, "pulmonary pressure raised · right ventricle thick and strained · congestion some"],
  [2, 3, "pulmonary pressure raised · right ventricle dilated and failing · congestion some"],
  [1, 3, "pulmonary pressure near normal · right ventricle thickened · congestion none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<g id="glow"></g>
<g id="heartSlot"></g><g id="lungSlot"></g><g id="kidSlot"></g>
<g id="art"></g><g id="parts"></g><g id="cells"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "pulmonary-hypertension", fig: "Fig 1", title: "Pulmonary hypertension: pressure overload of the right ventricle", W, H, body,
  label: "An animated heart pumping into a pulmonary artery whose wall has remodelled and narrowed. Endothelial dysfunction and vasoconstriction, left heart disease, lung disease with hypoxic vasoconstriction and old clot all raise vascular resistance, so pulmonary arterial systolic pressure climbs. The right ventricle hypertrophies, then dilates and fails, with raised jugular venous pressure, oedema, renal congestion, low cardiac output, dyspnea and poor exercise tolerance. Systemic pressure holds until output falls. Gauges show pulmonary pressure, vascular resistance, ventricular strain, cardiac output, congestion and dyspnea. Treatment choices are oxygen with a water pill, a vessel relaxer concept and treating the cause, as a diagnostic assessment and stage guide only.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pulmhtn.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With cause treated",
  sourcesLis: [
    "<strong>How pulmonary hypertension develops.</strong> Pressure in the pulmonary artery rises when the small pulmonary vessels narrow and stiffen. Endothelial dysfunction tips the balance toward vasoconstriction and growth of the vascular muscle layer, so the wall remodels and resistance climbs. The same pressure rise follows left heart disease (pressure passed back from the left side), lung disease with low oxygen (hypoxic pulmonary vasoconstriction), and chronic thromboembolic disease (old clot that never cleared). This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What the pressure does, and treatment ideas shown.</strong> The right ventricle faces a pressure overload: its wall hypertrophies to cope, then the chamber dilates, cardiac output can no longer rise on exercise, and right heart failure follows with raised jugular venous pressure, oedema and renal congestion from venous back pressure and low output. Oxygen relieves hypoxic vasoconstriction and a water pill unloads congestion; a vessel relaxer concept lowers vascular resistance (with a systemic pressure cost if it is not selective); treating the cause (the left heart, the lung disease, or the clot) helps most before remodelling is fixed. These are teaching toggles only.",
  ],
  simplified: "Classification into groups, measured pressures and resistance values, right heart catheter assessment, vasoreactivity testing, specific vessel relaxer drug classes, anticoagulation and surgical choices, transplant, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ph-wall{fill:none;stroke:color-mix(in srgb,var(--c-bad) 55%,var(--anatomy-paper));stroke-width:36;stroke-linecap:round}
.ph-calm{fill:none;stroke:color-mix(in srgb,var(--c-good) 45%,var(--anatomy-paper));stroke-width:34;stroke-linecap:round}
.ph-flow{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper));stroke-width:16;stroke-linecap:round}
.ph-glow{fill:color-mix(in srgb,var(--c-bad) 45%,transparent);stroke:none}
.ph-halo{fill:color-mix(in srgb,var(--c-fl) 45%,transparent);stroke:none}
.ph-dim{fill:#000;stroke:none}
.ph-fluid{fill:color-mix(in srgb,var(--c-fl) 60%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 70%,#000);stroke-width:1}
.ph-jet{fill:var(--c-rbc)}
.ph-rec{fill:color-mix(in srgb,var(--c-good) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-good) 70%,#000);stroke-width:.8}
.ph-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-oxy{--cc:var(--c-fl)}.p-con{--cc:var(--c-cyt)}.p-blk{--cc:var(--c-good)}.p-drip{--cc:var(--c-fl)}
.dr-g-fill.g-pap{fill:var(--c-bad)}.dr-g-fill.g-ren{fill:var(--c-fl)}
`,
});
