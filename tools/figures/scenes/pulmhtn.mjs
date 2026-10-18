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
    { label: "oxygen and diuretic" },
    { label: "pulmonary vasodilator (concept)" },
    { label: "treat the cause" },
  ],
  status: "Pulmonary hypertension: {level} · {drug} ·",
  drugNames: ["no treatment", "oxygen and diuretic", "pulmonary vasodilator", "cause treated"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const oxy = drug === 1 ? 1 : 0, vaso = drug === 2 ? 1 : 0, cause = drug === 3 ? 1 : 0;
  const CUT = { oxy: 0.10, vaso: 0.30 };
  const pvr = cl(0.14 + 0.82 * a - oxy * CUT.oxy - vaso * CUT.vaso - cause * (0.36 - 0.14 * a));
  const pap = cl(0.10 + 0.88 * pvr);
  const hyp = cl(0.10 + 0.84 * a * (cause ? 0.72 : 1));
  const dil = cl(a * a * 1.05 - cause * 0.18 - vaso * 0.10);
  const strain = cl(0.5 * hyp + 0.6 * dil + 0.2 * pap - 0.1);
  const output = cl(0.94 - 0.52 * dil - 0.18 * strain + vaso * 0.08 + cause * 0.12);
  const cong = cl(0.06 + 0.95 * dil * dil + 0.35 * Math.max(0, strain - 0.5) - oxy * 0.62 - cause * 0.20 - vaso * 0.06);
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
  [2, 1, "pulmonary pressure very high · right ventricle dilated and failing · congestion some"],
  [1, 3, "pulmonary pressure raised · right ventricle thickened · congestion none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="546" height="396" rx="18"/>
<rect class="sc-tissue" x="574" y="44" width="372" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">RIGHT VENTRICLE AND PULMONARY ARTERY</text>
<text class="sc-zone" x="594" y="68">WHY IT HAPPENS, WHAT FOLLOWS</text>
<text class="sc-zone sc-dim" x="34" y="382">CAUSES THAT RAISE RESISTANCE</text>
<g id="art"></g><g id="rv"></g><g id="lung"></g><g id="causes"></g><g id="parts"></g><g id="chain"></g><g id="icons"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "pulmonary-hypertension", fig: "Fig 1", title: "Pulmonary hypertension: pressure overload of the right ventricle", W, H, body,
  label: "An animated right ventricle ejecting into a pulmonary artery whose wall has remodelled and narrowed. Endothelial dysfunction and vasoconstriction, left heart disease, lung disease with hypoxic vasoconstriction and old clot all raise vascular resistance, so pulmonary arterial systolic pressure climbs. The right ventricle hypertrophies, then dilates and fails, with raised jugular venous pressure, oedema, renal congestion, low cardiac output, dyspnea and poor exercise tolerance. Systemic pressure holds until output falls. Gauges show pulmonary pressure, vascular resistance, ventricular strain, cardiac output, congestion and dyspnea. Treatment choices are oxygen with a diuretic, a pulmonary vasodilator concept and treating the cause, as a diagnostic assessment and stage guide only.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pulmhtn.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How pulmonary hypertension develops.</strong> Pressure in the pulmonary artery rises when the small pulmonary vessels narrow and stiffen. Endothelial dysfunction tips the balance toward vasoconstriction and growth of the vascular muscle layer, so the wall remodels and resistance climbs. The same pressure rise follows left heart disease (pressure passed back from the left side), lung disease with low oxygen (hypoxic pulmonary vasoconstriction), and chronic thromboembolic disease (old clot that never cleared). This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What the pressure does, and treatment ideas shown.</strong> The right ventricle faces a pressure overload: its wall hypertrophies to cope, then the chamber dilates, cardiac output can no longer rise on exercise, and right heart failure follows with raised jugular venous pressure, oedema and renal congestion from venous back pressure and low output. Oxygen relieves hypoxic vasoconstriction and a diuretic unloads congestion; a pulmonary vasodilator concept lowers vascular resistance (with a systemic pressure cost if it is not selective); treating the cause (the left heart, the lung disease, or the clot) helps most before remodelling is fixed. These are teaching toggles only.",
  ],
  simplified: "Classification into groups, measured pressures and resistance values, right heart catheter assessment, vasoreactivity testing, specific pulmonary vasodilator drug classes, anticoagulation and surgical choices, transplant, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ph-artwall{fill:color-mix(in srgb,var(--c-sm) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-sm) 60%,#000);stroke-width:1}
.ph-lumen{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper))}
.ph-out{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:26;stroke-linecap:round;opacity:.55}
.ph-wall{fill:color-mix(in srgb,var(--c-bad) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 66%,#000);stroke-width:1.3}
.ph-shade{fill:#000;opacity:.12}
.ph-ch{fill:color-mix(in srgb,var(--c-rbc) 50%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 66%,#000);stroke-width:1}
.ph-pres{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.ph-alv{fill:color-mix(in srgb,var(--c-fl) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 62%,#000);stroke-width:1.1}
.ph-cap{fill:var(--anatomy-text);font:10.5px var(--anatomy-mono);pointer-events:none}
.ph-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.ph-node-t{fill:var(--anatomy-strong);font:600 11px var(--anatomy-mono);pointer-events:none}
.ph-cause{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.ph-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ph-head{fill:var(--anatomy-mid)}
.ph-jet{fill:var(--c-rbc)}
.ph-icon{fill:color-mix(in srgb,var(--c-bad) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 62%,#000);stroke-width:1.1}
.p-oxy{--cc:var(--c-fl)}.p-con{--cc:var(--c-cyt)}
.dr-g-fill.g-pap{fill:var(--c-bad)}.dr-g-fill.g-ren{fill:var(--c-fl)}
`,
});
