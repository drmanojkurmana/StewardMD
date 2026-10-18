/* Atrial fibrillation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/afib.mjs [--print-model]
 * Layout and model here; triggers, wavelets, ECG, clot and gauges move in afib.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pattern of atrial fibrillation", a: [0.35, 0.7, 1], names: ["paroxysmal", "persistent", "permanent"], ticks: ["paroxysmal", "persistent", "permanent"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "rate control (slows the AV node)" },
    { label: "rhythm control (antiarrhythmic drug or cardioversion)" },
    { label: "anticoagulation (stroke prevention)" },
    { label: "combination (rate or rhythm control with anticoagulation)" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "rate control", "rhythm control", "anticoagulation", "the combination"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const rate = drug === 1 || drug === 4 ? 1 : 0, rhythm = drug === 2 || drug === 4 ? 1 : 0, coag = drug === 3 || drug === 4 ? 1 : 0;
  const comboRhythm = drug === 4 ? 1 : 0;
  const af = cl(a * (rhythm ? (level === 2 ? 0.6 : 0.15) : 1));
  const sinus = af < 0.18 ? 1 : 0;
  const vRaw = sinus ? 0.5 : cl(0.45 + 0.55 * af);
  const vRate = rate && !sinus ? cl(vRaw * 0.52) : vRaw;
  const irreg = sinus ? 0.08 : cl(0.25 + 0.75 * af);
  const stasis = cl(af * (0.5 + 0.5 * a));
  const clot = cl(stasis * (0.6 + 0.4 * a));
  const stroke = cl(clot * (coag ? 0.15 : 1));
  const output = cl(0.92 - 0.28 * irreg * (vRate > 0.75 ? 1 : 0.45) - 0.12 * af);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const atrialWord = sinus ? "in sinus rhythm" : af < 0.55 ? "fibrillating in episodes" : "fibrillating";
  const ventWord = sinus ? "regular" : vRate >= 0.75 ? "fast and irregular" : vRate >= 0.55 ? "irregular" : "controlled and irregular";
  const strokeWord = w(stroke, 0.25, 0.55, ["low", "raised", "high"]);
  const words = [atrialWord, ventWord, strokeWord];
  return { a, drug, rate, rhythm, coag, comboRhythm, af, sinus, vRate, irreg, stasis, clot, stroke, output, words, readout: "atria " + words[0] + " · ventricles " + words[1] + " · stroke risk " + words[2] };
}
const TESTS = [
  [1, 0, "atria fibrillating · ventricles fast and irregular · stroke risk raised"],
  [2, 0, "atria fibrillating · ventricles fast and irregular · stroke risk high"],
  [2, 3, "atria fibrillating · ventricles fast and irregular · stroke risk low"],
  [1, 2, "atria in sinus rhythm · ventricles regular · stroke risk low"],
];

/* ---------------- static layout ---------------- */
const ECG = { x: 556, y: 92, w: 372, h: 150, base: 162 };
let grid = "";
for (let x = ECG.x; x <= ECG.x + ECG.w; x += 18) grid += `<path class="af-grid${(x - ECG.x) % 90 === 0 ? " major" : ""}" d="M${x} ${ECG.y}V${ECG.y + ECG.h}"/>`;
for (let y = ECG.y; y <= ECG.y + ECG.h; y += 18) grid += `<path class="af-grid${(y - ECG.y) % 90 === 0 ? " major" : ""}" d="M${ECG.x} ${y}H${ECG.x + ECG.w}"/>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="520" height="396" rx="18"/>
<rect class="sc-tissue" x="546" y="44" width="400" height="396" rx="18"/>
<rect class="af-ecgbg" x="546" y="82" width="400" height="170" rx="14"/>
<text class="sc-zone" x="34" y="68">THE HEART IN ATRIAL FIBRILLATION</text>
<text class="sc-zone" x="566" y="68">ECG AND BRAIN</text>
<clipPath id="ecgclip"><rect x="${ECG.x}" y="${ECG.y}" width="${ECG.w}" height="${ECG.h}"/></clipPath>
<g clip-path="url(#ecgclip)">${grid}</g>
<path class="af-base" d="M${ECG.x} ${ECG.base}H${ECG.x + ECG.w}"/>
<text class="sc-zone sc-dim" x="566" y="${ECG.y + ECG.h + 22}">ONE LEAD</text>
<g id="heart"></g><g id="parts"></g><g id="ecg"></g><g id="brain"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "atrial-fibrillation", fig: "Fig 1", title: "Atrial fibrillation: triggers, chaos and stroke risk", W, H, body,
  label: "An animated heart in atrial fibrillation. Rapid triggers from the pulmonary veins and many small re-entrant circuits make the atria quiver instead of beating in order. The AV node lets only some signals through, so the ventricles beat fast and irregularly. Blood that barely moves in the left atrial appendage can form a clot, and a piece can travel to the brain and cause a stroke. A live ECG shows no clear P waves, a wavy baseline and irregular QRS complexes. Gauges show atrial activity, ventricular rate, irregularity, stasis, clot and stroke risk. Treatment choices include rate control, rhythm control and anticoagulation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, rates in numbers or targets are shown or implied.",
  scene: { W, H, ECG }, pageJs: readFileSync(join(HERE, "afib.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How atrial fibrillation starts and is sustained.</strong> Rapid ectopic firing, most often from sleeves of atrial muscle around the pulmonary veins, can trigger atrial fibrillation. Once started, it is sustained by many wandering re-entrant wavelets and areas of fibrosis that break the wavefront into chaotic activity, so the atria quiver and do not contract in an organised way. The atrioventricular node is bombarded and conducts only some impulses, at irregular intervals, so the ventricular response is irregularly irregular and often fast. Loss of organised atrial contraction and slow, swirling flow in the left atrial appendage favour stasis and clot formation; a clot fragment can embolise to the brain and cause a stroke. Paroxysmal episodes come and go, persistent episodes last and usually need cardioversion to stop, and permanent atrial fibrillation is accepted and no longer chased. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Rate control slows conduction through the AV node so the ventricles slow, but the atria keep fibrillating. Rhythm control with an antiarrhythmic drug or cardioversion tries to restore and hold sinus rhythm. Anticoagulation lowers the chance that a clot forms and embolises, so it lowers stroke risk without changing the rhythm itself. The combination pairs rhythm or rate control with anticoagulation. These are teaching toggles only.",
  ],
  simplified: "Atrial flutter and other supraventricular rhythms, structural heart disease, triggers outside the pulmonary veins, ablation detail, left atrial appendage closure, rate versus rhythm trial evidence, anticoagulant choice, bleeding risk and risk scores, cardioversion safety steps, and all doses and targets are left out. The ECG is one schematic lead, the heart and brain are simplified, and timing and sizes are illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-ch:#6b3a4a;--c-flash:#ff9a7a}body[data-theme="light"]{--c-ch:#e9b8c2;--c-flash:#ff6a4a}
.af-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.af-grid{stroke:var(--anatomy-faint);stroke-width:.5;fill:none;stroke-opacity:.35}.af-grid.major{stroke-opacity:.7}
.af-base{stroke:var(--anatomy-mid);stroke-width:.8;stroke-dasharray:3 4;fill:none}
.af-trace{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round;stroke-linecap:round}
.af-ch{fill:color-mix(in srgb,var(--c-flash) calc(var(--act,0) * 100%),var(--c-ch));stroke:var(--anatomy-mid);stroke-width:1.3}
.af-app{fill:color-mix(in srgb,var(--c-flash) calc(var(--act,0) * 70%),var(--c-ch));stroke:var(--anatomy-mid);stroke-width:1.2}
.af-septum{stroke:var(--anatomy-mid);stroke-width:1.2;fill:none}
.af-vein{fill:none;stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round}
.af-vein2{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 35%,var(--anatomy-paper));stroke-width:2.6;stroke-linecap:round}
.af-node{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1}
.af-wave{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.6}
.af-spark{fill:none;stroke:var(--c-neut);stroke-width:1.8;stroke-linecap:round}
.af-beam{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:4 5}
.af-brain{fill:color-mix(in srgb,var(--c-mast) 28%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.3}
.af-vessel{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.af-ok{fill:none;stroke:var(--c-good);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:4 5}
.af-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.af-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.p-emb{--cc:var(--c-bad)}.p-trig{--cc:var(--c-neut)}
.dr-g-fill.g-irreg{fill:var(--c-neut)}
`,
});
