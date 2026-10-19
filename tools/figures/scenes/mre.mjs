/* Mitral regurgitation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/mre.mjs [--print-model]
 * An incompetent mitral valve leaks back into the left atrium in systole. The atrium and ventricle dilate under the extra volume, pressure backs up into the pulmonary veins and lungs, forward output falls and a holosystolic murmur fills systole. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the leak", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "vasodilator and diuretic" },
    { label: "valve repair" },
    { label: "valve replacement" },
  ],
  status: "Mitral leak: {level} · {drug} ·",
  drugNames: ["no treatment", "a vasodilator and diuretic", "valve repair", "valve replacement"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const eff = [1, 0.6, 0.2, 0.06][drug];
  const surg = drug >= 2 ? 1 : 0, vaso = drug === 1 ? 1 : 0;
  const a = S.level.a[level];
  const R = cl(0.08 + 0.88 * a * eff);
  const F = cl(0.98 - 0.52 * R - 0.05 * a + (vaso ? 0.07 : 0));
  const LApres = cl(0.08 + 0.75 * R - (vaso ? 0.1 : 0));
  const Pulm = cl(0.04 + 0.8 * LApres - (vaso ? 0.06 : 0));
  const Mur = cl(0.12 + 0.8 * R * (surg && drug === 3 ? 0.55 : 1));
  const LAvol = cl(0.18 + 0.62 * a * (surg ? 0.55 : 1) - (vaso ? 0.03 : 0));
  const LVvol = cl(0.2 + 0.6 * a * (surg ? 0.6 : 1));
  const Dys = cl(0.05 + 0.6 * a * a * (surg ? 0.55 : 1));
  const BP = cl(0.94 - 0.38 * (1 - F) - 0.1 * Dys);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(R, 0.4, 0.7, ["mild", "moderate", "severe"]), w(F, 0.45, 0.72, ["reduced", "borderline", "maintained"]), w(Pulm, 0.32, 0.62, ["clear", "congested", "oedematous"])];
  return { a, eff, surg, vaso, R, F, LApres, Pulm, Mur, LAvol, LVvol, Dys, BP, words, readout: "backflow " + words[0] + " · forward output " + words[1] + " · lungs " + words[2] };
}
const TESTS = [
  [0, 0, "backflow mild · forward output maintained · lungs clear"],
  [2, 0, "backflow severe · forward output reduced · lungs oedematous"],
  [2, 1, "backflow moderate · forward output borderline · lungs congested"],
  [2, 3, "backflow mild · forward output maintained · lungs clear"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<g id="lungSlot"></g><g id="heartSlot"></g><g id="heart"></g><g id="valve"></g><g id="vessel"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "mitral-regurgitation", fig: "Fig 1", title: "Mitral regurgitation: a leaking valve and a volume-loaded heart", W, H, body,
  label: "An animated real heart and lung, read left to right. Blood enters the left atrium from the lungs, and in systole the ventricle contracts: part of its blood jets backward through the leaking mitral valve into the atrium instead of forward into the aorta. The atrium and ventricle swell with the extra blood, pressure backs up into the lungs, forward output falls and a holosystolic murmur fills systole. A vasodilator widens the aorta so more blood flows forward, repair rings the valve shut, and replacement with a new valve stops the leak. Gauges show backflow, forward output, atrial pressure, ventricle volume, lung congestion and the murmur.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "mre.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With valve replacement",
  sourcesLis: [
    "<strong>How mitral regurgitation develops.</strong> The mitral leaflets fail to meet in systole, leaving a regurgitant orifice. Causes include leaflet prolapse (a floppy leaflet billowing into the atrium), rheumatic thickening and scarring of the leaflets, ischaemic papillary muscle dysfunction that tethers otherwise normal leaflets (secondary regurgitation), and dilatation of the annulus as the ventricle enlarges so normal leaflets can no longer coapt. Each systole part of the stroke volume goes backward into the left atrium as a rapid regurgitant jet. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What the leak does.</strong> The atrium receives both pulmonary venous inflow and the regurgitant volume, so atrial pressure rises with a prominent systolic v wave, and both the atrium and the ventricle dilate to hold the extra volume (volume overload). Pressure is passed back through the pulmonary veins to the lungs, giving venous congestion and pulmonary edema. The share ejected forward into the aorta falls, so cardiac output and arterial pressure are reduced, worst in severe disease. The murmur is holosystolic: it starts with the first heart sound and fills all of systole to the second sound, because the ventricle is above atrial pressure throughout. A soft third heart sound can appear from the rapid return of the extra volume. Late, the dilated ventricle itself develops dysfunction, which is why repair or replacement is usually considered early, before dysfunction is fixed. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A vasodilator lowers the resistance the ventricle ejects against, so more blood goes forward and less leaks back, and a diuretic unloads the congested lungs; neither fixes the valve. Repair (including an annuloplasty ring that restores the annulus size) keeps the patient's own valve, and replacement with a prosthetic valve abolishes the leak. These are teaching toggles only.",
  ],
  simplified: "Acute regurgitation from a ruptured papillary muscle or endocarditis (where a small stiff atrium gives very high pressures and rapid pulmonary edema), grading by measured regurgitant volume or orifice area, atrial fibrillation from atrial dilatation, right heart failure late in the course, prosthetic valve complications and anticoagulation, and surgical timing rules are left out. The heart and lung are real anatomy art with a schematic cutaway overlay that shows the chambers, the wall and the valve. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.mre-aorta{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-linecap:round;opacity:.55}
.mre-vein{fill:none;stroke:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper));stroke-linecap:round}
.mre-chamber{fill:color-mix(in srgb,var(--c-rbc) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:1}
.mre-atrium{fill:color-mix(in srgb,var(--c-cyt) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt) 50%,#000);stroke-width:1.1}
.mre-wall{fill:none;stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-linecap:round}
.mre-leaf{fill:none;stroke:var(--anatomy-strong);stroke-width:3.4;stroke-linecap:round}
.mre-chord{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1}
.mre-pap{fill:color-mix(in srgb,var(--c-bad) 48%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1}
.mre-ring{fill:none;stroke:var(--c-good);stroke-width:3}
.mre-prost{fill:var(--anatomy-card);stroke:var(--c-good);stroke-width:2.5}
.mre-disc{stroke:var(--anatomy-strong);stroke-width:3;stroke-linecap:round}
.mre-jetF{fill:var(--c-rbc)}.mre-jetB{fill:var(--c-cyt)}.mre-jetI{fill:var(--c-fl)}
.mre-wave{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.mre-cong{fill:var(--c-fl);stroke:none}
.mre-rec{fill:var(--anatomy-paper);stroke:var(--c-lymph);stroke-width:1.4}
.mre-drug{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.6}
.mre-drop{fill:var(--c-fl);stroke:none}
.mre-cap{fill:var(--anatomy-strong);font-size:13px}`,
});
