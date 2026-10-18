/* Pneumothorax as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ptx.mjs [--print-model]
 * Static layout here; lung, pleural air, mediastinum and gauges move in ptx.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Size and type of pneumothorax", a: [0.3, 0.65, 1], names: ["small", "large", "tension"], ticks: ["small", "large", "tension"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "observe only" },
    { label: "needle decompression, then chest drain" },
    { label: "oxygen only (support)" },
  ],
  status: "Pneumothorax: {level} · {drug} ·",
  drugNames: ["observe only", "needle decompression and chest drain", "oxygen only"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const drain = drug === 1 ? 1 : 0, oxy = drug === 2 ? 1 : 0;
  const valve = level === 2 && !drain ? 1 : 0;
  const A = cl(a * (drain ? 0.2 : 1) * (oxy ? 0.92 : 1));
  const P = cl(0.06 + 0.55 * A + 0.5 * valve);
  const C = cl(0.04 + 0.92 * A);
  const Sh = cl(0.65 * valve + Math.max(0, A - 0.55) * 0.5);
  const VR = cl(1.02 - 0.78 * Sh - 0.35 * Math.max(0, P - 0.55));
  const BP = cl(0.12 + 0.82 * VR);
  const Ox = cl(0.98 - 0.48 * C - 0.12 * valve + (oxy ? 0.22 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(C, 0.35, 0.68, ["partly open", "partly collapsed", "collapsed"]), w(Sh, 0.2, 0.55, ["centred", "starting to shift", "shifted away"]), w(BP, 0.35, 0.62, ["low", "borderline", "maintained"])];
  return { a, drain, oxy, valve, A, P, C, Sh, VR, BP, Ox, words, readout: "lung " + words[0] + " · mediastinum " + words[1] + " · blood pressure " + words[2] };
}
const TESTS = [
  [0, 0, "lung partly open · mediastinum centred · blood pressure maintained"],
  [1, 0, "lung partly collapsed · mediastinum centred · blood pressure maintained"],
  [2, 0, "lung collapsed · mediastinum shifted away · blood pressure low"],
  [2, 1, "lung partly open · mediastinum centred · blood pressure maintained"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CHEST FROM THE FRONT: AIR IN THE PLEURAL SPACE</text>
<ellipse class="pt-chest" cx="480" cy="255" rx="410" ry="165"/>
<path class="pt-rib" d="M130 170Q480 110 830 170M115 230Q480 175 845 230M130 300Q480 250 830 300M160 360Q480 315 800 360"/>
<g id="airspace"></g><g id="lungs"></g><g id="media"></g><g id="parts"></g><g id="drainG"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "pneumothorax", fig: "Fig 1", title: "Pneumothorax: air collapsing the lung", W, H, body,
  label: "An animated chest from the front. Air enters the pleural space through the chest wall or from a ruptured bleb on the lung. The pleural pressure rises toward atmospheric pressure and the lung collapses toward the hilum. In a tension pneumothorax a one-way valve traps air, the mediastinum shifts away, venous return falls and shock follows. Gauges show pleural air, lung collapse, mediastinal shift, venous return, blood pressure and oxygen. Treatments shown are observation, needle decompression then a chest drain, and oxygen.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, sizes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ptx.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without a drain", withLabel: "With a drain",
  sourcesLis: [
    "<strong>How a pneumothorax develops.</strong> The pleural space is normally a thin sealed space that couples the lung to the chest wall. Air entering it, through a chest wall injury or from a ruptured bleb (a small air blister on the lung surface), breaks that coupling. Intrapleural pressure rises toward atmospheric pressure, the lung recoils and collapses, and breath sounds and oxygen uptake fall on that side. In a tension pneumothorax the entry acts as a one-way valve: air enters as the patient breathes in but cannot leave, pressure keeps rising, the mediastinum and trachea are pushed away from that side, the great veins are compressed, venous return and cardiac output fall, and obstructive shock follows. This is standard teaching in medicine and respiratory texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A small pneumothorax in a stable patient may be observed. Needle decompression lets trapped air out in tension, followed by a chest drain that keeps removing air so the lung can re-expand. Oxygen can support oxygen levels and may help pleural air be absorbed, but it does not remove trapped air or relieve tension. These are teaching toggles only.",
  ],
  simplified: "Causes such as trauma patterns and secondary lung disease, imaging signs, breath sound and percussion findings in detail, drain systems and suction, needle and drain technique, recurrence and surgery, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pt-chest{fill:color-mix(in srgb,var(--anatomy-paper) 55%,transparent);stroke:var(--anatomy-strong);stroke-width:2.6}
.pt-rib{fill:none;stroke:var(--anatomy-faint);stroke-width:1.2}
.pt-lungN{fill:color-mix(in srgb,var(--c-endo) 48%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 65%,#000);stroke-width:1.6}
.pt-lungA{fill:color-mix(in srgb,var(--c-cyt2) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt2) 60%,#000);stroke-width:1.6}
.pt-air{fill:var(--c-fl)}
.pt-trach{fill:none;stroke:var(--anatomy-mid);stroke-width:16;stroke-linecap:round}
.pt-trach2{fill:none;stroke:color-mix(in srgb,var(--anatomy-paper) 65%,var(--anatomy-mid));stroke-width:5;stroke-linecap:round;opacity:.7}
.pt-bronch{fill:none;stroke:var(--anatomy-mid);stroke-width:9;stroke-linecap:round}
.pt-heart{fill:color-mix(in srgb,var(--c-bad) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 65%,#000);stroke-width:1.5}
.pt-vein{fill:none;stroke:var(--c-cyt2);stroke-width:13;stroke-linecap:round}
.pt-vein2{fill:none;stroke:color-mix(in srgb,var(--c-cyt2) 55%,#fff);stroke-width:4;stroke-linecap:round;opacity:.7}
.pt-hole{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.6}
.pt-flap{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.pt-bleb{fill:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.4}
.pt-drain{fill:none;stroke:var(--anatomy-strong);stroke-width:5;stroke-linecap:round}
.pt-drainbox{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.6}
.p-air{--cc:var(--c-fl)}.p-oxy{--cc:var(--c-good)}.p-ven{--cc:var(--c-cyt2)}.p-out{--cc:var(--c-fl)}
.dr-g-fill.g-air{fill:var(--c-fl)}.dr-g-fill.g-coll{fill:var(--c-bad)}.dr-g-fill.g-shift{fill:var(--c-cyt)}
`,
});
