/* Cardiac output and the Frank Starling relationship as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/starling.mjs [--print-model]
 * Left: a real heart organ that fills from venous return and ejects into the aorta, plus a small kidney that passes urine. Right: stroke volume against end diastolic filling, with a family of curves.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;
const GX0 = 420, GY0 = 375, GX1 = 900, GY1 = 115;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Preload (end diastolic filling)", a: [0.3, 0.6, 1], names: ["low filling", "normal filling", "high filling"], ticks: ["low", "normal", "high"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "positive inotrope (raises contractility)" },
    { label: "diuretic (reduces preload)" },
    { label: "vasodilator (reduces afterload)" },
  ],
  status: "Preload: {level} · {drug} ·",
  drugNames: ["no treatment", "positive inotrope", "diuretic", "vasodilator"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const pre = S.level.a[level];
  const ino = drug === 1 ? 1 : 0, diu = drug === 2 ? 1 : 0, vaso = drug === 3 ? 1 : 0;
  const effPre = cl(diu ? pre * 0.5 : pre);
  const contr = ino ? 0.95 : 0.5;
  const after = vaso ? 0.28 : 0.58;
  const sv = cl((1 - Math.exp(-2.2 * effPre)) * (0.45 + 0.75 * contr) * (1.15 - 0.55 * after));
  const hr = cl(0.45 + 0.55 * (1 - sv) + (ino ? 0.08 : 0));
  const co = cl(sv * (0.65 + 0.65 * hr));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(sv, 0.4, 0.68, ["low", "moderate", "high"]), w(co, 0.4, 0.6, ["low", "moderate", "high"]), w(effPre, 0.4, 0.7, ["low", "normal", "high"])];
  return { pre, effPre, contr, after, sv, hr, co, ino, diu, vaso, words, readout: "stroke volume " + words[0] + " · cardiac output " + words[1] + " · filling " + words[2] };
}
const TESTS = [
  [1, 0, "stroke volume moderate · cardiac output moderate · filling normal"],
  [1, 1, "stroke volume high · cardiac output high · filling normal"],
  [2, 0, "stroke volume moderate · cardiac output high · filling high"],
  [2, 1, "stroke volume high · cardiac output high · filling high"],
  [2, 2, "stroke volume moderate · cardiac output moderate · filling normal"],
  [0, 3, "stroke volume low · cardiac output moderate · filling low"],
];

/* ---------------- static layout ---------------- */
function svAt(pre, contr, after) {
  const v = (1 - Math.exp(-2.2 * pre)) * (0.45 + 0.75 * contr) * (1.15 - 0.55 * after);
  return Math.max(0, Math.min(1, v));
}
function curvePath(contr) {
  let d = "";
  for (let i = 0; i <= 20; i++) {
    const p = i / 20, x = GX0 + p * (GX1 - GX0), y = GY0 - svAt(p, contr, 0.58) * (GY0 - GY1);
    d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  return d;
}
const body = `
<rect class="sc-tissue" x="14" y="44" width="322" height="396" rx="18"/>
<rect class="sc-tissue st-graphbg" x="344" y="44" width="602" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEART AND CIRCULATION</text>
<text class="sc-zone" x="364" y="68">STROKE VOLUME AND FILLING</text>
<line class="st-axis" x1="${GX0}" y1="${GY1 - 14}" x2="${GX0}" y2="${GY0}"/>
<line class="st-axis" x1="${GX0}" y1="${GY0}" x2="${GX1 + 14}" y2="${GY0}"/>
<path class="st-head" d="M${GX0} ${GY1 - 22}l-5 10l10 0Z"/>
<path class="st-head" d="M${GX1 + 22} ${GY0}l-10 -5l0 10Z"/>
<path class="st-curve st-curve-boost" d="${curvePath(0.95)}"/>
<path class="st-curve st-curve-norm" d="${curvePath(0.5)}"/>
<path class="st-curve st-curve-fail" d="${curvePath(0.22)}"/>
<g id="vessels"></g><g id="heartSlot"></g><g id="kidneySlot"></g><g id="cells"></g><g id="sparks"></g><g id="marks"></g><g id="point"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiac-output-frank-starling", fig: "Fig 1", title: "Cardiac output and the Frank Starling curve", W, H, body,
  label: "An animated heart and a Frank Starling graph. Blood returns through the veins, fills the ventricle, and is ejected into the aorta, so cardiac output is stroke volume times heart rate. More filling stretches the ventricle and raises stroke volume along a curve, until the curve flattens. A small capsule docks where each treatment acts: an inotrope sends sparks that strengthen each squeeze and lift the curve, a water pill makes the kidney pass urine so filling falls, and a vasodilator widens the aorta so ejection is easier. Gauges show filling, contractility, afterload, stroke volume and cardiac output.",
  caption: "Schematic, not to scale. Curve positions, sizes, speeds and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H, GX0, GY0, GX1, GY1, HC: [170, 252], KC: [288, 360] }, pageJs: readFileSync(join(HERE, "starling.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With positive inotrope",
  sourcesLis: [
    "<strong>Cardiac output.</strong> Cardiac output is stroke volume times heart rate. Stroke volume depends on preload, afterload and contractility. This is standard teaching in physiology and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Frank Starling relationship.</strong> Within limits, a ventricle that is filled and stretched more before it contracts ejects more blood. Plotting stroke volume against end diastolic filling gives a rising curve that flattens at high filling. Stronger contractility shifts the whole curve upward, while a failing ventricle follows a lower and flatter curve for the same filling.",
    "<strong>Preload, afterload and the treatments shown.</strong> Preload is how full and stretched the ventricle is before contraction, set largely by venous return. Afterload is the load the ventricle ejects against, set largely by arterial resistance. A positive inotrope raises contractility, a diuretic reduces circulating volume and preload, and a vasodilator reduces afterload. These are teaching toggles for the mechanism only.",
  ],
  simplified: "Heart rate control, valve function, ventricular interaction, pericardial constraint, the falling limb sometimes drawn at extreme filling, pulmonary circulation detail, and every dose, target and monitoring step are left out. Sizes, speeds and levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.st-graphbg{opacity:.75}
.st-axis{stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.st-head{fill:var(--anatomy-mid)}
.st-curve{fill:none;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.st-curve-boost{stroke:var(--c-good)}
.st-curve-norm{stroke:var(--c-fl)}
.st-curve-fail{stroke:var(--c-bad)}
.st-vein{fill:color-mix(in srgb,var(--c-cyt2) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt2) 70%,#000);stroke-width:1.2}
.st-aorta{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper));stroke-linecap:round}
.st-band{stroke:var(--c-bad);stroke-width:6;stroke-linecap:round}
.st-sqz{fill:var(--c-good);stroke:none}
.st-kgl{fill:var(--c-fl);stroke:none}
.st-flow{fill:var(--c-fl);stroke:none}
.st-pud{fill:var(--c-fl);stroke:none}
.st-drug{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.st-drug2{fill:var(--c-bad);stroke:none}
.st-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.st-dash{stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:5 5;opacity:.85}
.st-point{fill:var(--c-good);stroke:var(--anatomy-paper);stroke-width:2}
.st-halo{fill:color-mix(in srgb,var(--c-good) 35%,transparent);stroke:none}
.p-spark{--cc:var(--c-good)}
.p-drop{fill:var(--c-fl)}
.p-spurt{--cc:var(--c-fl)}`,
});
