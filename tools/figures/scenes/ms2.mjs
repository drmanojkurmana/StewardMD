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
  const TREAT = [
    { support: 0, anticoag: 0, repair: 0 },
    { support: 1, anticoag: 0, repair: 0 },
    { support: 0, anticoag: 1, repair: 0 },
    { support: 0, anticoag: 0, repair: 1 },
  ];
  const t = TREAT[drug] || TREAT[0];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const eff = cl(a * (t.repair ? 0.22 : 1));
  const lap = cl((0.06 + 0.9 * eff) * (t.support ? 0.8 : 1) * (t.repair ? 0.9 : 1));
  const laSize = cl(0.1 + 0.82 * a - t.repair * 0.18);
  const af = cl(0.04 + 0.88 * laSize - t.repair * 0.12);
  const cong = cl((0.05 + 0.88 * lap) * (t.support ? 0.62 : 1));
  const pht = cl(0.05 + 0.9 * lap - t.repair * 0.08);
  const rv = cl(0.04 + 0.88 * pht);
  const clot = cl((0.05 + 0.82 * af) * (t.anticoag ? 0.22 : 1));
  const fill = cl(0.92 - 0.58 * eff + t.support * 0.12 + t.repair * 0.1);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(eff, 0.32, 0.7, ["narrowed", "tight", "very tight"]), w(lap, 0.3, 0.6, ["near normal", "raised", "high"]), w(cong, 0.3, 0.6, ["clear", "congested", "wet"]), w(clot, 0.3, 0.6, ["low", "raised", "high"])];
  return { a, support: t.support, anticoag: t.anticoag, repair: t.repair, eff, lap, laSize, af, cong, pht, rv, clot, fill, words, readout: "valve opening " + words[0] + " · left atrial pressure " + words[1] + " · lungs " + words[2] + " · clot risk " + words[3] };
}
const TESTS = [
  [1, 0, "valve opening tight · left atrial pressure high · lungs wet · clot risk raised"],
  [1, 1, "valve opening tight · left atrial pressure raised · lungs congested · clot risk raised"],
  [1, 2, "valve opening tight · left atrial pressure high · lungs wet · clot risk low"],
  [1, 3, "valve opening narrowed · left atrial pressure near normal · lungs clear · clot risk raised"],
  [2, 0, "valve opening very tight · left atrial pressure high · lungs wet · clot risk high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="heartSlot"></g><g id="lungSlot"></g>
<g id="circ"></g><g id="heart"></g><g id="cong"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "mitral-stenosis", fig: "Fig 1", title: "Mitral stenosis: the narrowed valve and the pressure behind it", W, H, body,
  label: "An animated heart and lungs with a narrowed mitral valve. Rheumatic scarring fuses the leaflet edges, so the left atrium empties through a small opening. The atrium stretches and often loses its rhythm, a clot can form in the slow flow, and pressure backs up through the pulmonary veins into the lungs and on to the pulmonary artery, straining the right ventricle. Rate control with a diuretic, anticoagulation, and valvotomy or valve replacement each act on the drawing, and a caption says what each treatment does.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ms2.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With valvotomy or valve replacement",
  sourcesLis: [
    "<strong>The mechanism.</strong> Rheumatic scarring thickens the mitral leaflets and fuses their edges, leaving a small diastolic opening. The left atrium must generate more pressure to fill the ventricle, so it dilates and hypertrophies, and atrial fibrillation becomes common with loss of the atrial contribution to filling. Raised atrial pressure is transmitted back through the pulmonary veins to the lung capillaries, causing congestion and breathlessness, and onward to the pulmonary arteries. Pulmonary hypertension then overloads the right ventricle, which hypertrophies and may fail. A low diastolic murmur is heard as blood crosses the narrowed valve. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Rate control parks blocker dots on the heart while it beats more slowly, and a diuretic drains lung fluid downward. Anticoagulation dissolves the atrial clot and a dashed ring marks protection, without opening the valve. Valvotomy splits the fused edges so the opening widens, pressure falls and the lungs clear. These are teaching toggles only.",
  ],
  simplified: "Other causes of mitral stenosis, commissural and leaflet calcification detail, associated valve lesions, infective endocarditis, pregnancy, embolism detail, catheter and surgical selection, rhythm and rate drug choices, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ms-vein{fill:none;stroke:var(--c-bad);stroke-linecap:round}
.ms-art{fill:none;stroke:var(--c-cyt2);stroke-linecap:round}
.ms-laves{fill:none;stroke:color-mix(in srgb,var(--c-bad) 55%,var(--anatomy-paper));stroke-linecap:round}
.ms-la{fill:color-mix(in srgb,var(--c-bad) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1.2}
.ms-laglow{fill:var(--c-bad);stroke:none}
.ms-af{fill:none;stroke:var(--c-neut);stroke-width:1.6;stroke-linecap:round}
.ms-leaf{fill:color-mix(in srgb,var(--c-plt) 72%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 70%,#000);stroke-width:1.1}
.ms-split{fill:none;stroke:var(--anatomy-hi);stroke-width:2;stroke-linecap:round}
.ms-clot{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:.8}
.ms-shield{fill:none;stroke:var(--c-fl);stroke-width:1.6;stroke-dasharray:5 4}
.ms-lvglow{fill:var(--c-rbc);stroke:none}
.ms-rvcav{fill:color-mix(in srgb,var(--c-cyt2) 30%,var(--anatomy-paper));stroke:none}
.ms-rvring{fill:none;stroke:color-mix(in srgb,var(--c-cyt2) 65%,#000)}
.ms-haze{fill:var(--c-fl);stroke:none}
.ms-fluid{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 60%,#000);stroke-width:1}
.ms-rec{fill:none;stroke:var(--anatomy-hi);stroke-width:2;stroke-linecap:round}
.ms-cap{fill:var(--anatomy-strong);font-size:13px;font-weight:600;pointer-events:none}
.p-ms{fill:var(--c-rbc)}
.p-msb{fill:var(--c-cyt2)}
.p-msfl{fill:var(--c-fl)}
.p-msblk{fill:var(--c-lymph)}
`,
});
