/* Cardiac cycle and the left ventricular pressure-volume loop as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cycle.mjs [--print-model]
 * Static layout here; chambers, valves, blood, sounds and the loop move in cycle.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of the cardiac cycle", a: [0.05, 0.18, 0.4, 0.62, 0.85], names: ["atrial systole", "isovolumetric contraction", "ejection", "isovolumetric relaxation", "filling"], ticks: ["atrial systole", "iso contraction", "ejection", "iso relaxation", "filling"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment (baseline)" },
    { label: "increase preload" },
    { label: "increase afterload" },
    { label: "inotrope (increase contractility)" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "increased preload", "increased afterload", "inotrope"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const phase = level, u = S.level.a[level];
  const pre = drug === 1 ? 1 : 0, after = drug === 2 ? 1 : 0, ino = drug === 3 ? 1 : 0;
  const preload = cl(0.5 + 0.38 * pre - 0.05 * ino);
  const afterload = cl(0.5 + 0.38 * after);
  const contract = cl(0.52 + 0.4 * ino - 0.04 * after);
  const EDV = cl(0.6 + 0.24 * pre);
  const ESV = cl(0.32 + 0.18 * after - 0.15 * ino + 0.04 * pre);
  const SV = cl(EDV - ESV);
  const peak = cl(0.52 + 0.3 * after + 0.12 * ino + 0.06 * pre);
  const mitral = phase === 0 || phase === 4 ? 1 : 0;
  const aortic = phase === 2 ? 1 : 0;
  const sound = phase === 1 ? "S1" : phase === 3 ? "S2" : "none";
  const volNow = [EDV - 0.02, EDV, (EDV + ESV) / 2, ESV, (EDV + ESV) / 2][phase];
  const pressNow = [0.16, peak * 0.55, peak, peak * 0.42, 0.13][phase];
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(SV, 0.2, 0.38, ["low", "normal", "high"]), w(peak, 0.6, 0.75, ["normal", "raised", "high"])];
  const phases = ["atrial systole", "isovolumetric contraction", "ejection", "isovolumetric relaxation", "filling"];
  return { phase, u, pre, after, ino, preload, afterload, contract, EDV, ESV, SV, peak, mitral, aortic, sound, volNow, pressNow, words, readout: phases[phase] + " · stroke volume " + words[0] + " · peak pressure " + words[1] };
}
const TESTS = [
  [0, 0, "atrial systole · stroke volume normal · peak pressure normal"],
  [2, 1, "ejection · stroke volume high · peak pressure normal"],
  [2, 2, "ejection · stroke volume low · peak pressure high"],
  [2, 3, "ejection · stroke volume high · peak pressure raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="470" height="396" rx="18"/>
<rect class="sc-tissue" x="496" y="44" width="450" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LEFT HEART</text>
<text class="sc-zone" x="516" y="68">PRESSURE-VOLUME LOOP</text>
<path class="cy-axis" d="M590 350V108"/>
<path class="cy-axis" d="M590 350H892"/>
<path class="cy-axishead" d="M590 108l-4 10h8Z"/>
<path class="cy-axishead" d="M892 350l-10 -4v8Z"/>
<text class="sc-lab" x="576" y="230" text-anchor="middle" transform="rotate(-90 576 230)">Pressure</text>
<text class="sc-lab" x="892" y="372" text-anchor="end">Volume</text>
<g id="pv"></g><g id="heart"></g><g id="flow"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiac-cycle-pv-loop", fig: "Fig 1", title: "The cardiac cycle and the pressure-volume loop", W, H, body,
  label: "An animated left heart and left ventricular pressure-volume loop. The phase slider steps through atrial systole, isovolumetric contraction, ejection, isovolumetric relaxation and filling. The mitral and aortic valves open and close, the first and second heart sounds light up as the valves shut, blood flows in during filling and out during ejection, and a moving point traces the loop on the right. Treatment choices raise preload, raise afterload or add an inotrope, and the loop widens, narrows or shifts to show the change in stroke volume and pressure.",
  caption: "Schematic, not to scale. Chamber sizes, loop shape, speeds and gauge levels are qualitative and illustrative; no doses, pressures, volumes or other numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cycle.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With inotrope",
  sourcesLis: [
    "<strong>Phases and valves.</strong> During atrial systole the atria top up ventricular filling through the open mitral valve. The ventricle then contracts with both valves shut (isovolumetric contraction) until its pressure opens the aortic valve and ejection follows. When the ventricle relaxes and its pressure falls, the aortic valve shuts; pressure keeps falling with both valves shut (isovolumetric relaxation) until the mitral valve opens and filling resumes. This is standard teaching in physiology and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Heart sounds and the loop.</strong> The first heart sound follows closure of the mitral and tricuspid valves at the start of ventricular contraction; the second follows closure of the aortic and pulmonary valves at the start of relaxation. On the pressure-volume loop, filling runs along the bottom, isovolumetric contraction up the right side, ejection across the top and isovolumetric relaxation down the left side; the width of the loop is the stroke volume. Raising preload widens the loop to the right, raising afterload raises and narrows it, and an inotrope empties the ventricle further so the loop widens to the left and reaches a higher pressure. These are teaching toggles only.",
  ],
  simplified: "The right heart, the tricuspid and pulmonary valves, atrial and ventricular pressure traces over time, valve timing differences, coronary flow, conduction timing and every pressure and volume value are left out. Only the left heart is drawn, the loop is a smooth schematic, and the figure does not say how any patient should be treated.",
  extraCss: `
.cy-axis{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.cy-axishead{fill:var(--anatomy-mid)}
.cy-atrium{fill:color-mix(in srgb,var(--c-rbc) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 62%,#000);stroke-width:1.2}
.cy-wall{fill:color-mix(in srgb,var(--c-rbc) 52%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 70%,#000);stroke-width:1.4}
.cy-cavity{fill:color-mix(in srgb,var(--c-rbc) 68%,#fff);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.8}
.cy-vein{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 58%,var(--anatomy-paper));stroke-width:13;stroke-linecap:round}
.cy-aorta{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 62%,var(--anatomy-paper));stroke-width:16;stroke-linecap:round}
.cy-aorta-in{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 72%,#fff);stroke-width:8;stroke-linecap:round}
.cy-leaf{stroke:#f3e6c4;stroke-width:3.2;stroke-linecap:round}
.cy-ring{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.p-blood{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.5}
.cy-pv{fill:color-mix(in srgb,var(--c-good) 10%,transparent);stroke:var(--c-good);stroke-width:2.2;stroke-linejoin:round}
.cy-pvdot{fill:var(--c-bad);stroke:var(--anatomy-paper);stroke-width:1.4}
.cy-sv{stroke:var(--anatomy-strong);stroke-width:1.4}
.cy-svhead{fill:var(--anatomy-strong)}
.cy-badge{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.cy-badge-t{fill:var(--anatomy-strong);font:600 12px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none}
.dr-fig text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.cy-arc{fill:none;stroke:var(--c-neut);stroke-width:1.4;stroke-linecap:round}
.cy-ph{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.cy-ph-on{fill:color-mix(in srgb,var(--c-good) 42%,var(--anatomy-card));stroke:var(--c-good)}
.cy-ph-t{fill:var(--anatomy-text);font:8px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none}
.cy-ph-t-on{fill:var(--anatomy-strong);font-weight:700}
.dr-g-fill.g-pre{fill:var(--c-fl)}.dr-g-fill.g-sq{fill:var(--c-neut)}
`,
});
