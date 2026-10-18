/* Cardiac action potential and ion channels as an animated, working scene. Original drawing.
 *   node tools/figures/scenes/apot.mjs [--print-model]
 * Layout and model here; traces, channels, particles and gauges move in apot.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Potassium and QT setting", a: [0, 1, 2, 3], names: ["normal", "hyperkalaemia", "hypokalaemia", "long QT"], ticks: ["normal", "high K", "low K", "long QT"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "sodium channel blocker" },
    { label: "potassium channel blocker" },
    { label: "calcium channel blocker" },
  ],
  status: "Setting: {level} · {drug} ·",
  drugNames: ["none", "a sodium channel blocker", "a potassium channel blocker", "a calcium channel blocker"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const base = [
    { up: 0.95, plat: 0.55, repol: 0.60, dur: 0.48, rest: 0.12, pace: 0.55 },
    { up: 0.42, plat: 0.38, repol: 0.92, dur: 0.32, rest: 0.88, pace: 0.45 },
    { up: 0.84, plat: 0.58, repol: 0.34, dur: 0.68, rest: 0.06, pace: 0.50 },
    { up: 0.90, plat: 0.86, repol: 0.26, dur: 0.95, rest: 0.14, pace: 0.52 },
  ][level];
  let up = base.up, plat = base.plat, repol = base.repol, dur = base.dur, pace = base.pace;
  if (drug === 1) { up = cl(up * 0.42); dur = cl(dur + 0.08); }
  if (drug === 2) { repol = cl(repol * 0.38); plat = cl(plat + 0.12); dur = cl(dur + 0.30); }
  if (drug === 3) { plat = cl(plat * 0.42); dur = cl(dur - 0.18); pace = cl(pace * 0.45); repol = cl(repol + 0.06); }
  const Na = cl(up), Ca = cl(plat), K = cl(repol), QT = cl(dur);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(up, 0.55, 0.82, ["slow", "reduced", "sharp"]),
    w(plat, 0.35, 0.70, ["short", "normal", "long"]),
    w(repol, 0.38, 0.75, ["slow", "normal", "fast"]),
    w(QT, 0.40, 0.75, ["short", "normal", "long"]),
  ];
  return { up: cl(up), plat: cl(plat), repol: cl(repol), dur: cl(dur), rest: base.rest, pace: cl(pace), Na, Ca, K, QT, naBlk: drug === 1 ? 1 : 0, kBlk: drug === 2 ? 1 : 0, caBlk: drug === 3 ? 1 : 0, words, readout: "upstroke " + words[0] + " · plateau " + words[1] + " · repolarisation " + words[2] + " · QT " + words[3] };
}
const TESTS = [
  [0, 0, "upstroke sharp · plateau normal · repolarisation normal · QT normal"],
  [1, 0, "upstroke slow · plateau normal · repolarisation fast · QT short"],
  [3, 0, "upstroke sharp · plateau long · repolarisation slow · QT long"],
  [0, 1, "upstroke slow · plateau normal · repolarisation normal · QT normal"],
  [0, 2, "upstroke sharp · plateau normal · repolarisation slow · QT long"],
  [0, 3, "upstroke sharp · plateau short · repolarisation normal · QT short"],
];

/* ---------------- static layout ---------------- */
const AP = { x: 62, y: 86, w: 452, h: 168, base: 236, peak: 100 };
const PM = { x: 628, y: 86, w: 296, h: 108, base: 176, peak: 102 };
const EG = { x: 628, y: 232, w: 296, h: 102, base: 302 };
let grid = "";
for (let x = AP.x; x <= AP.x + AP.w; x += 36) grid += `<path class="ap-grid" d="M${x} ${AP.y}V${AP.y + AP.h}"/>`;
for (let y = AP.y; y <= AP.y + AP.h; y += 28) grid += `<path class="ap-grid" d="M${AP.x} ${y}H${AP.x + AP.w}"/>`;
let grid2 = "";
for (let x = PM.x; x <= PM.x + PM.w; x += 30) grid2 += `<path class="ap-grid" d="M${x} ${PM.y}V${PM.y + PM.h}"/>`;
for (let y = PM.y; y <= PM.y + PM.h; y += 27) grid2 += `<path class="ap-grid" d="M${PM.x} ${y}H${PM.x + PM.w}"/>`;
let grid3 = "";
for (let x = EG.x; x <= EG.x + EG.w; x += 30) grid3 += `<path class="ap-grid" d="M${x} ${EG.y}V${EG.y + EG.h}"/>`;
for (let y = EG.y; y <= EG.y + EG.h; y += 26) grid3 += `<path class="ap-grid" d="M${EG.x} ${y}H${EG.x + EG.w}"/>`;

const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">VENTRICULAR MYOCYTE</text>
<text class="sc-zone" x="604" y="68">PACEMAKER CELL AND ECG</text>
<rect class="ap-bg" x="${AP.x - 8}" y="${AP.y - 6}" width="${AP.w + 16}" height="${AP.h + 14}" rx="10"/>
<clipPath id="apclip"><rect x="${AP.x}" y="${AP.y}" width="${AP.w}" height="${AP.h}"/></clipPath>
<g clip-path="url(#apclip)">${grid}</g>
<path class="ap-axis" d="M${AP.x} ${AP.base}H${AP.x + AP.w}M${AP.x} ${AP.y}V${AP.y + AP.h}"/>
<text class="ap-lab" x="${AP.x + 4}" y="${AP.y + 12}">potential</text>
<text class="ap-lab" x="${AP.x + AP.w - 28}" y="${AP.base + 16}">time</text>
<rect class="ap-bg" x="${PM.x - 8}" y="${PM.y - 6}" width="${PM.w + 16}" height="${PM.h + 14}" rx="10"/>
<clipPath id="pmclip"><rect x="${PM.x}" y="${PM.y}" width="${PM.w}" height="${PM.h}"/></clipPath>
<g clip-path="url(#pmclip)">${grid2}</g>
<path class="ap-axis" d="M${PM.x} ${PM.base}H${PM.x + PM.w}"/>
<rect class="ap-bg" x="${EG.x - 8}" y="${EG.y - 6}" width="${EG.w + 16}" height="${EG.h + 14}" rx="10"/>
<clipPath id="egclip"><rect x="${EG.x}" y="${EG.y}" width="${EG.w}" height="${EG.h}"/></clipPath>
<g clip-path="url(#egclip)">${grid3}</g>
<path class="ap-axis" d="M${EG.x} ${EG.base}H${EG.x + EG.w}"/>
<text class="ap-lab" x="${EG.x + 4}" y="${EG.y + 12}">ECG</text>
<text class="ap-lab" x="40" y="292">0 upstroke · 1 notch · 2 plateau · 3 repolarisation · 4 rest</text>
<text class="ap-lab" x="628" y="216">no stable rest: slow rise to threshold</text>
<g id="apg"></g><g id="pmg"></g><g id="ecg"></g><g id="mem"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiac-action-potential", fig: "Fig 1", title: "Cardiac action potential and ion channels", W, H, body,
  label: "An animated ventricular heart muscle cell action potential beside a pacemaker cell potential and an ECG. Phase 0 is a fast sodium upstroke, phase 1 an early notch, phase 2 a calcium plateau, phase 3 potassium repolarisation and phase 4 rest. The pacemaker cell has no stable rest and rises slowly through the funny current. Below, sodium, calcium and potassium channels in the membrane let particles through in time with the trace. Settings show normal, high potassium, low potassium and long QT, and blockers of sodium, potassium and calcium channels.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, voltages, intervals or numbers are shown or implied.",
  scene: { W, H, AP, PM, EG }, pageJs: readFileSync(join(HERE, "apot.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How the cardiac action potential works.</strong> In a ventricular myocyte, opening of fast voltage-gated sodium channels drives the rapid phase 0 upstroke. Brief potassium efflux gives the phase 1 notch. In phase 2, calcium entry through L-type calcium channels balances potassium efflux and holds the plateau that triggers contraction. Phase 3 follows when calcium channels close and potassium efflux repolarises the cell to the phase 4 resting potential, held by inward-rectifier potassium channels. Pacemaker cells in the sinoatrial node have no stable resting potential: the funny current, then calcium currents, give a slow phase 4 rise to threshold and a slower, calcium-driven upstroke. The surface ECG sums these events: the QRS reflects ventricular depolarisation and the T wave ventricular repolarisation, so a longer action potential gives a longer QT. High extracellular potassium makes the resting potential less negative, inactivates sodium channels and speeds repolarisation. Low potassium reduces potassium conductance, prolongs repolarisation and flattens the T wave. This is standard teaching in physiology and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A sodium channel blocker slows the phase 0 upstroke. A potassium channel blocker slows phase 3 and prolongs the action potential and QT. A calcium channel blocker shortens the plateau and slows the pacemaker rise. These are teaching toggles only.",
  ],
  simplified: "Single-cell currents, channel subunit detail, autonomic effects, conduction through the AV node and His-Purkinje system, other potassium and calcium currents, arrhythmia mechanisms in detail, drug classes and their cautions, and all doses, voltages and intervals are left out. Traces are schematic single leads and single cells. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-na:#38b6ff;--c-ca:#ffb84d;--c-k:#b78cff;--c-fun:#3ddc97;--c-mem:#8a5a6b;--c-cell:#4a2f3d}
body[data-theme="light"]{--c-na:#0a7fd1;--c-ca:#d98a1f;--c-k:#7c3aed;--c-fun:#0f9f76;--c-mem:#c98a9b;--c-cell:#f0dde2}
.ap-bg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ap-grid{stroke:var(--anatomy-faint);stroke-width:.5;fill:none;stroke-opacity:.45}
.ap-axis{stroke:var(--anatomy-mid);stroke-width:.9;fill:none}
.ap-lab{fill:var(--anatomy-text);font:10px var(--anatomy-mono);pointer-events:none}
.ap-trace{fill:none;stroke:var(--c-na);stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round}
.ap-faint{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 4;opacity:.55}
.pm-trace{fill:none;stroke:var(--c-fun);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.eg-trace{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.ap-dot{fill:#fff;stroke:var(--c-na);stroke-width:2.2}
.pm-dot{fill:#fff;stroke:var(--c-fun);stroke-width:2.2}
.ap-phase{fill:var(--anatomy-strong);stroke:var(--anatomy-paper);stroke-width:1}
.ap-phase-t{fill:var(--anatomy-paper);font:700 9px var(--anatomy-mono);pointer-events:none}
.ap-mem{fill:var(--c-mem);opacity:.85}
.ap-mem2{fill:color-mix(in srgb,var(--c-mem) 65%,#000)}
.ap-chan-na{fill:var(--c-na);stroke:color-mix(in srgb,var(--c-na) 55%,#000);stroke-width:1}
.ap-chan-ca{fill:var(--c-ca);stroke:color-mix(in srgb,var(--c-ca) 55%,#000);stroke-width:1}
.ap-chan-k{fill:var(--c-k);stroke:color-mix(in srgb,var(--c-k) 55%,#000);stroke-width:1}
.ap-chan-fun{fill:var(--c-fun);stroke:color-mix(in srgb,var(--c-fun) 55%,#000);stroke-width:1}
.ap-gate{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.8}
.p-na{--cc:var(--c-na)}.p-ca{--cc:var(--c-ca)}.p-k{--cc:var(--c-k)}.p-fun{--cc:var(--c-fun)}
.dr-g-fill.g-na{fill:var(--c-na)}.dr-g-fill.g-ca{fill:var(--c-ca)}.dr-g-fill.g-k{fill:var(--c-k)}
.ap-x{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.ap-blk{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.2}
`,
});
