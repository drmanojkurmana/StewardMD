/* Mitral stenosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ms2.mjs [--print-model]
 * Rheumatic fusion narrows the mitral opening. The left atrium works against it, enlarges and fibrillates,
 * pressure backs up into the lungs and pulmonary circuit, and the right ventricle is strained.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the stenosis", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "rate control and a diuretic" },
    { label: "anticoagulation" },
    { label: "valvotomy or valve replacement" },
  ],
  status: "Stenosis: {level} · {drug} ·",
  drugNames: ["no treatment", "rate control and a diuretic", "anticoagulation", "valvotomy or valve replacement"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const support = drug === 1 ? 1 : 0, anticoag = drug === 2 ? 1 : 0, repair = drug === 3 ? 1 : 0;
  const eff = cl(a * (repair ? 0.22 : 1));
  const lap = cl((0.06 + 0.9 * eff) * (support ? 0.8 : 1) * (repair ? 0.9 : 1));
  const laSize = cl(0.1 + 0.82 * a - repair * 0.18);
  const af = cl(0.04 + 0.88 * laSize - repair * 0.12);
  const cong = cl((0.05 + 0.88 * lap) * (support ? 0.62 : 1));
  const pht = cl(0.05 + 0.9 * lap - repair * 0.08);
  const rv = cl(0.04 + 0.88 * pht);
  const clot = cl((0.05 + 0.82 * af) * (anticoag ? 0.22 : 1));
  const fill = cl(0.92 - 0.58 * eff + support * 0.12 + repair * 0.1);
  const murmur = cl(0.08 + 0.88 * eff);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(eff, 0.32, 0.7, ["narrowed", "tight", "very tight"]), w(lap, 0.3, 0.6, ["near normal", "raised", "high"]), w(cong, 0.3, 0.6, ["clear", "congested", "wet"]), w(rv, 0.3, 0.6, ["coping", "strained", "failing"])];
  return { a, support, anticoag, repair, eff, lap, laSize, af, cong, pht, rv, clot, fill, murmur, words, readout: "valve opening " + words[0] + " · left atrial pressure " + words[1] + " · lungs " + words[2] + " · right heart " + words[3] };
}
const TESTS = [
  [1, 0, "valve opening tight · left atrial pressure high · lungs wet · right heart strained"],
  [1, 1, "valve opening tight · left atrial pressure raised · lungs congested · right heart strained"],
  [1, 3, "valve opening narrowed · left atrial pressure near normal · lungs clear · right heart coping"],
  [2, 0, "valve opening very tight · left atrial pressure high · lungs wet · right heart failing"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LEFT HEART</text>
<text class="sc-zone" x="560" y="68">LUNGS AND RIGHT HEART</text>
<g id="circ"></g><g id="heart"></g><g id="lungs"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "mitral-stenosis", fig: "Fig 1", title: "Mitral stenosis: the narrowed valve and the pressure behind it", W, H, body,
  label: "An animated left heart with a narrowed mitral valve. Rheumatic scarring fuses the leaflets, so the left atrium empties through a small opening. The atrium enlarges, its rhythm becomes irregular, and pressure backs up through the pulmonary veins into the lungs and pulmonary arteries, straining the right ventricle. A diastolic murmur crosses the tight valve. Gauges show valve opening, left atrial pressure, lung congestion, pulmonary pressure and right heart strain. Treatment choices include rate control with a diuretic, anticoagulation, and valvotomy or valve replacement.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ms2.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>The mechanism.</strong> Rheumatic scarring thickens the mitral leaflets and fuses their edges, leaving a small diastolic opening. The left atrium must generate more pressure to fill the ventricle, so it dilates and hypertrophies, and atrial fibrillation becomes common with loss of the atrial contribution to filling. Raised atrial pressure is transmitted back through the pulmonary veins to the lung capillaries, causing congestion and breathlessness, and onward to the pulmonary arteries. Pulmonary hypertension then overloads the right ventricle, which hypertrophies and may fail. A low diastolic murmur is heard as blood crosses the narrowed valve. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Slowing the heart lengthens diastole and improves filling, and a diuretic lowers congestion. Anticoagulation addresses clot risk from a dilated, fibrillating atrium with sluggish flow, without opening the valve. Valvotomy or valve replacement relieves the obstruction itself. These are teaching toggles only.",
  ],
  simplified: "Other causes of mitral stenosis, commissural and leaflet calcification detail, associated valve lesions, infective endocarditis, pregnancy, embolism detail, catheter and surgical selection, rhythm and rate drug choices, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ms-wall{fill:color-mix(in srgb,var(--c-bad) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 68%,#000);stroke-width:1.3}
.ms-ch{fill:color-mix(in srgb,var(--c-rbc) 48%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 62%,#000);stroke-width:1}
.ms-at{fill:color-mix(in srgb,var(--c-bad) 24%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 58%,#000);stroke-width:1.1}
.ms-rvwall{fill:color-mix(in srgb,var(--c-cyt2) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt2) 62%,#000);stroke-width:1.2}
.ms-rvch{fill:color-mix(in srgb,var(--c-cyt2) 20%,var(--anatomy-paper))}
.ms-leaf{fill:color-mix(in srgb,var(--c-plt) 72%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 70%,#000);stroke-width:1.1}
.ms-vess{fill:none;stroke:var(--c-cyt2);stroke-linecap:round}
.ms-vein{fill:none;stroke:var(--c-bad);stroke-linecap:round;opacity:.65}
.ms-af{fill:none;stroke:var(--c-neut);stroke-width:1.6;stroke-linecap:round}
.ms-mur{fill:none;stroke:var(--c-cyt);stroke-width:1.5;stroke-linecap:round}
.ms-lung{fill:color-mix(in srgb,var(--c-endo) 26%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.ms-fluid{fill:var(--c-fl);opacity:.78}
.ms-clot{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:.8}
.p-ms{fill:var(--c-rbc)}
.p-msb{fill:var(--c-cyt2)}
.ms-mk{fill:var(--c-bad);font:600 10.5px var(--anatomy-mono);pointer-events:none}`,
});
