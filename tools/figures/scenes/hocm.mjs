/* Hypertrophic obstructive cardiomyopathy as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hocm.mjs [--print-model]
 * Static layout here; heart, leaflet, flow, rhythm and gauges move in hocm.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How severe is the disease", a: [0.3, 0.65, 1], names: ["non-obstructive", "obstructive", "high risk"], ticks: ["non-obstructive", "obstructive", "high risk"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "beta blocker" },
    { label: "ICD (implantable defibrillator)" },
    { label: "septal reduction (myectomy or ablation)" },
  ],
  status: "Disease: {level} · {drug} ·",
  drugNames: ["no treatment", "a beta blocker", "an ICD", "septal reduction"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const beta = drug === 1 ? 1 : 0, icd = drug === 2 ? 1 : 0, sept = drug === 3 ? 1 : 0;
  const Th = cl(0.35 + 0.5 * a - 0.45 * sept);
  let Obs = cl((a * 1.05 - 0.18) * (beta ? 0.55 : 1) * (sept ? 0.22 : 1));
  const SAM = cl(Obs * 1.08);
  const Dias = cl(0.25 + 0.55 * a - 0.15 * beta - 0.15 * sept);
  const FlowOut = cl(1 - 0.72 * Obs);
  const Mur = cl(0.12 + 0.78 * Obs);
  const Syn = cl(Obs * 0.8 + a * 0.15);
  const Risk = cl(0.12 + 0.45 * a + 0.35 * Obs - 0.72 * icd - 0.06 * beta - 0.08 * sept);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Obs, 0.22, 0.55, ["none", "moderate", "severe"]), w(Dias, 0.38, 0.68, ["supple", "stiff", "very stiff"]), w(Risk, 0.25, 0.55, ["low", "raised", "high"])];
  return { a, beta, sept, icd, Th, Obs, SAM, Dias, FlowOut, Mur, Syn, Risk, words, readout: "outflow obstruction " + words[0] + " · filling " + words[1] + " · sudden death risk " + words[2] };
}
const TESTS = [
  [0, 0, "outflow obstruction none · filling stiff · sudden death risk raised"],
  [2, 0, "outflow obstruction severe · filling very stiff · sudden death risk high"],
  [2, 1, "outflow obstruction moderate · filling stiff · sudden death risk high"],
  [2, 2, "outflow obstruction severe · filling very stiff · sudden death risk low"],
  [2, 3, "outflow obstruction none · filling stiff · sudden death risk high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="hoc-box" x="28" y="84" width="170" height="250" rx="14"/>
<rect class="hoc-ecgbg" x="665" y="258" width="265" height="112" rx="12"/>
<text class="sc-zone" x="34" y="68">GENE TO MUSCLE</text>
<text class="sc-zone" x="235" y="68">HEART AND OUTFLOW</text>
<text class="sc-zone" x="680" y="68">AORTA AND RHYTHM</text>
<ellipse id="strain" class="hoc-glow" cx="450" cy="262" rx="170" ry="150" opacity="0"/>
<g id="inset"></g>
<g id="heartSlot"></g>
<g id="heart"></g>
<g id="flow"></g>
<g id="ecg"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "hypertrophic-obstructive-cardiomyopathy", fig: "Fig 1", title: "Hypertrophic cardiomyopathy: thick septum, blocked outflow", W, H, body,
  label: "An animated left ventricle in hypertrophic cardiomyopathy. A sarcomere gene mutation makes heart muscle grow thick and disordered, most in the septum. The stiff ventricle fills poorly. In systole the anterior mitral leaflet is pulled toward the thick septum, systolic anterior motion, narrowing the outflow tract so blood struggles to reach the aorta, the murmur grows, and the patient may faint. At high risk a dangerous rhythm can cause sudden death. Gauges show septum, outflow block, mitral motion, filling, murmur and sudden death risk. Treatment choices are a beta blocker, an ICD and septal reduction, the most effective option for the blockage.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or thresholds are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hocm.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With septal reduction",
  sourcesLis: [
    "<strong>How hypertrophic cardiomyopathy develops.</strong> A mutation in a sarcomere gene (the motor proteins of the heart muscle cell, such as myosin or myosin-binding protein C) makes the muscle grow thick and disordered, usually most in the interventricular septum (asymmetric septal hypertrophy), with a small stiff cavity that relaxes and fills poorly (diastolic dysfunction). In many patients the outflow tract is narrowed further in systole when flow pulls the anterior mitral leaflet toward the septum (systolic anterior motion), giving a dynamic obstruction and an ejection systolic murmur that gets louder with the Valsalva manoeuvre and standing, and softer with squatting. Obstruction can cause breathlessness, chest pain and syncope, and scarred disordered muscle can produce ventricular arrhythmias and sudden death, mainly in the young. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A beta blocker slows the heart and softens contraction so filling improves and the dynamic gradient falls. An ICD does not relieve obstruction; it watches the rhythm and shocks a lethal ventricular arrhythmia. Septal reduction (surgical myectomy or alcohol septal ablation) thins the bulging septum and widens the outflow tract, and is the most effective option here for the blockage. These are teaching toggles only.",
  ],
  simplified: "Genotype and family screening, provocation testing, exercise and preload changes beyond the Valsalva note, scar imaging, risk calculators, atrial fibrillation, drug choice within classes, surgical technique, ICD indications and all doses are left out. The heart art shows the whole organ with a schematic cutaway of the cavity and outflow, and the rhythm strip is illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
.hoc-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.75}
.hoc-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.hoc-glow{fill:var(--c-bad);stroke:none}
.hoc-cav{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:.8}
.hoc-sept{fill:color-mix(in srgb,var(--c-rbc) 58%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.2}
.hoc-tube{fill:none;stroke:color-mix(in srgb,var(--c-endo) 65%,var(--c-tis));stroke-linecap:round}
.hoc-tubein{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke-linecap:round}
.hoc-leaf{fill:none;stroke:#e8c96a;stroke-width:7;stroke-linecap:round}
.hoc-hinge{fill:#e8c96a;stroke:var(--anatomy-paper);stroke-width:1}
.hoc-chord{fill:none;stroke:#e8c96a;stroke-width:1.2;opacity:.7}
.hoc-mitral{fill:none;stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round}
.hoc-rec{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.8;opacity:.85}
.hoc-dna{fill:none;stroke:var(--c-lymph);stroke-width:2.2;stroke-linecap:round}
.hoc-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.hoc-mut{fill:var(--c-bad);stroke:var(--anatomy-paper);stroke-width:1.2}
.hoc-ecg{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round}
.hoc-flash{fill:#ffd24a;stroke:none;opacity:0}
.hoc-arrow{fill:var(--c-bad);stroke:none}
.hoc-wave{fill:none;stroke:var(--c-cyt);stroke-width:1.6;stroke-linecap:round}
.hoc-tur{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.hoc-icd{fill:var(--anatomy-card);stroke:var(--anatomy-hi);stroke-width:1.4}
.hoc-lead{fill:none;stroke:var(--anatomy-hi);stroke-width:2;stroke-linecap:round}
.hoc-shock{fill:#ffd24a;stroke:var(--anatomy-paper);stroke-width:1}
.hoc-cap{fill:var(--anatomy-text);font-size:13px}
.cl-hocmyo{--cc:#d98a7a}
.p-blood{--cc:var(--c-rbc)}
.p-beta{--cc:var(--c-lymph)}
.p-sig{--cc:var(--c-cyt)}
.dr-g-fill.g-sam{fill:var(--c-cyt)}.dr-g-fill.g-mur{fill:#e8c96a}
`,
});
