/* Aortic stenosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/as.mjs [--print-model]
 * A calcified or bicuspid aortic valve narrows, a pressure gradient builds, the left ventricle thickens, output cannot rise on effort and late heart failure follows. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the stenosis", a: [0.25, 0.6, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "valve replacement" },
    { label: "vasodilator (avoid with a fixed output)" },
  ],
  status: "Stenosis: {level} · {drug} ·",
  drugNames: ["no treatment", "valve replacement", "vasodilator"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level], repl = drug === 1 ? 1 : 0, vaso = drug === 2 ? 1 : 0;
  const sten = repl ? 0.07 : a;
  const grad = cl(0.06 + 0.92 * Math.pow(sten, 1.4));
  const hyp = cl(0.12 + 0.82 * a * (repl ? 0.5 : 1));
  const reserve = cl(0.95 - 0.62 * sten - (vaso ? 0.08 + 0.3 * a : 0));
  const sx = cl(0.08 + 0.5 * grad + 0.35 * (1 - reserve) + (vaso ? 0.2 * a : 0));
  const hf = cl(0.04 + 0.72 * a * a * (repl ? 0.35 : 1) + 0.22 * Math.max(0, sx - 0.6));
  const bp = cl(0.9 - 0.1 * grad - (vaso ? 0.16 + 0.26 * a : 0) - 0.18 * hf);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(grad, 0.28, 0.58, ["small", "moderate", "large"]), w(reserve, 0.38, 0.66, ["low", "reduced", "good"]), w(sx, 0.3, 0.6, ["few", "some", "marked"])];
  return { a, repl, vaso, sten, grad, hyp, reserve, sx, hf, bp, words, readout: "gradient " + words[0] + " · output reserve " + words[1] + " · symptoms " + words[2] };
}
const TESTS = [
  [1, 0, "gradient moderate · output reserve reduced · symptoms some"],
  [2, 0, "gradient large · output reserve low · symptoms marked"],
  [2, 1, "gradient small · output reserve good · symptoms few"],
  [2, 2, "gradient large · output reserve low · symptoms marked"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="450" height="396" rx="18"/>
<rect class="sc-tissue" x="478" y="44" width="468" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEART AND AORTIC VALVE</text>
<text class="sc-zone" x="498" y="68">WHAT IT DOES TO THE BODY</text>
<g id="aorta"></g><g id="heart"></g><g id="valve"></g><g id="parts"></g><g id="chain"></g><g id="icons"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "aortic-stenosis", fig: "Fig 1", title: "Aortic stenosis: a narrowed valve and a pressure-loaded ventricle", W, H, body,
  label: "An animated left ventricle ejecting through a narrowed aortic valve. Calcified or bicuspid leaflets open less, a pressure gradient builds across the valve, the ventricle wall thickens to cope, and cardiac output can no longer rise on effort. That gives angina, syncope and breathlessness, and late heart failure. Valve replacement widens the opening; a vasodilator can drop blood pressure because output is fixed. Gauges show the gradient, wall thickening, output reserve, blood pressure, symptoms and late heart failure.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "as.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How aortic stenosis develops.</strong> The aortic valve narrows, most often from calcific degeneration of a three-leaflet valve or from a congenital bicuspid valve that wears early. The left ventricle must generate much higher pressure to eject through the small opening, so a pressure gradient forms across the valve. The wall thickens in parallel (concentric hypertrophy), which keeps wall stress down at first but makes the chamber stiff and hungry for oxygen. Output is maintained at rest for years, but it cannot rise on effort. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Symptoms and treatment ideas shown.</strong> Angina (supply cannot meet the thick wall's demand, even with open coronary arteries), syncope on effort (output cannot rise while muscle vessels dilate), and breathlessness (a stiff ventricle raises filling pressures). Only replacing the valve (surgical or transcatheter) relieves the obstruction; no drug opens the valve. A vasodilator can be harmful here: peripheral resistance falls but the fixed valve cannot let output rise to compensate, so blood pressure and coronary perfusion fall. These are teaching toggles only.",
  ],
  simplified: "Coronary artery disease as a separate cause of angina, low-flow states, grading by measured valve area or velocity, bicuspid aortopathy, endocarditis, surgical versus transcatheter choice, anticoagulation, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.as-aorta{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:27;stroke-linecap:round;opacity:.55}
.as-wall{fill:color-mix(in srgb,var(--c-bad) 36%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 68%,#000);stroke-width:1.3}
.as-shade{fill:#000;opacity:.12}
.as-ch{fill:color-mix(in srgb,var(--c-rbc) 52%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 68%,#000);stroke-width:1}
.as-leaf{fill:none;stroke:var(--anatomy-strong);stroke-width:3.4;stroke-linecap:round}
.as-calc{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.7}
.as-ring{fill:none;stroke:var(--c-good);stroke-width:3}
.as-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.as-head{fill:var(--anatomy-mid)}
.as-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.as-node-t{fill:var(--anatomy-strong);font:600 11px var(--anatomy-mono);pointer-events:none}
.as-pres{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.as-jet{fill:var(--c-rbc)}
.as-cap{fill:var(--anatomy-text);font:10.5px var(--anatomy-mono);pointer-events:none}
.as-icon{fill:color-mix(in srgb,var(--c-bad) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 65%,#000);stroke-width:1.1}
.as-lung{fill:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 65%,#000);stroke-width:1.1}`,
});
