/* Adenosine and the AV node as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/adeno.mjs [--print-model]
 * Layout and model here; impulses, circuit, ECG, AV node cell and gauges move in adeno.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Rhythm stage", a: [0, 1, 2], names: ["sinus rhythm", "SVT re-entry circuit", "after adenosine"], ticks: ["sinus", "SVT circuit", "after adenosine"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "adenosine" },
    { label: "adenosine with caffeine on board" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["none", "adenosine", "adenosine with caffeine on board"],
};
function modelOf(S, level, drug) {
  const TAB = [
    [
      { rate: 0.48, circ: 0.05, cond: 0.92, a1: 0.08, adv: 0.05, rhythm: "sinus rhythm" },
      { rate: 0.30, circ: 0.05, cond: 0.16, a1: 0.92, adv: 0.68, rhythm: "sinus, AV node paused" },
      { rate: 0.46, circ: 0.05, cond: 0.76, a1: 0.42, adv: 0.22, rhythm: "sinus rhythm" },
    ],
    [
      { rate: 0.93, circ: 0.95, cond: 0.86, a1: 0.08, adv: 0.05, rhythm: "re-entrant SVT" },
      { rate: 0.48, circ: 0.04, cond: 0.18, a1: 0.94, adv: 0.70, rhythm: "sinus rhythm restored" },
      { rate: 0.90, circ: 0.88, cond: 0.82, a1: 0.42, adv: 0.25, rhythm: "re-entrant SVT persists" },
    ],
    [
      { rate: 0.28, circ: 0.02, cond: 0.12, a1: 0.90, adv: 0.62, rhythm: "brief pause, then sinus" },
      { rate: 0.28, circ: 0.02, cond: 0.12, a1: 0.95, adv: 0.72, rhythm: "brief pause, then sinus" },
      { rate: 0.90, circ: 0.88, cond: 0.82, a1: 0.42, adv: 0.25, rhythm: "re-entrant SVT persists" },
    ],
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const r = TAB[level][drug];
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const rateW = w(r.rate, 0.38, 0.68, ["slow", "normal", "fast"]);
  const condW = w(r.cond, 0.35, 0.65, ["blocked", "reduced", "open"]);
  const a1W = w(r.a1, 0.35, 0.7, ["low", "moderate", "strong"]);
  return { rate: cl(r.rate), circ: cl(r.circ), cond: cl(r.cond), a1: cl(r.a1), adv: cl(r.adv), rhythm: r.rhythm, words: [rateW, r.rhythm, condW, a1W], readout: "rate " + rateW + " · rhythm " + r.rhythm + " · AV conduction " + condW + " · A1 effect " + a1W };
}
const TESTS = [
  [0, 0, "rate normal · rhythm sinus rhythm · AV conduction open · A1 effect low"],
  [1, 0, "rate fast · rhythm re-entrant SVT · AV conduction open · A1 effect low"],
  [1, 1, "rate normal · rhythm sinus rhythm restored · AV conduction blocked · A1 effect strong"],
  [1, 2, "rate fast · rhythm re-entrant SVT persists · AV conduction open · A1 effect moderate"],
];

/* ---------------- static layout ---------------- */
const GEO = {
  sa: [170, 115], av: [285, 215], his: [285, 252],
  saAv: [[170, 115], [205, 158], [255, 192], [285, 215]],
  hisTrack: [[285, 215], [285, 252], [285, 288]],
  lbb: [[285, 288], [242, 338], [212, 384]],
  rbb: [[285, 288], [328, 338], [358, 384]],
  loop: [[285, 215], [285, 300], [355, 356], [420, 308], [420, 188], [362, 122], [285, 148], [285, 215]],
};
const ECG = { x: 566, y: 92, w: 360, h: 140, base: 188 };
let grid = "";
for (let x = ECG.x; x <= ECG.x + ECG.w; x += 18) grid += `<path class="ad-grid${(x - ECG.x) % 90 === 0 ? " major" : ""}" d="M${x} ${ECG.y}V${ECG.y + ECG.h}"/>`;
for (let y = ECG.y; y <= ECG.y + ECG.h; y += 18) grid += `<path class="ad-grid${(y - ECG.y) % 90 === 0 ? " major" : ""}" d="M${ECG.x} ${y}H${ECG.x + ECG.w}"/>`;
const P = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<rect class="ad-ecgbg" x="546" y="82" width="400" height="170" rx="14"/>
<text class="ad-zone" x="34" y="68">HEART: SA AND AV NODES</text>
<text class="ad-zone" x="566" y="68">ECG, ONE LEAD</text>
<clipPath id="ecgclip"><rect x="${ECG.x}" y="${ECG.y}" width="${ECG.w}" height="${ECG.h}"/></clipPath>
<g clip-path="url(#ecgclip)">${grid}</g>
<path class="ad-base" d="M${ECG.x} ${ECG.base}H${ECG.x + ECG.w}"/>
<rect class="ad-inset" x="560" y="262" width="372" height="168" rx="14"/>
<text class="ad-zone" x="575" y="285">AV NODE CELL, CLOSE-UP</text>
<path id="ch-ra" class="ad-ch" d="M118 102Q118 90 140 90H228Q248 90 248 112V176Q248 198 226 198H140Q118 198 118 176Z"/>
<path id="ch-la" class="ad-ch" d="M268 102Q268 90 290 90H378Q398 90 398 112V176Q398 198 376 198H290Q268 198 268 176Z"/>
<path id="ch-rv" class="ad-ch" d="M108 238Q108 216 132 216H252V392Q192 424 144 384Q108 342 108 238Z"/>
<path id="ch-lv" class="ad-ch" d="M262 216H396Q430 216 430 256Q430 338 390 390Q332 426 262 392Z"/>
<path class="ad-septum" d="M258 216V398"/>
<path class="ad-loop" d="${P(GEO.loop)}Z"/>
<path class="ad-wire" d="${P(GEO.saAv)}"/><path class="ad-wire" d="${P(GEO.hisTrack)}"/><path class="ad-wire" d="${P(GEO.lbb)}"/><path class="ad-wire" d="${P(GEO.rbb)}"/>
<circle class="ad-node" cx="${GEO.sa[0]}" cy="${GEO.sa[1]}" r="9"/><circle class="ad-node" cx="${GEO.av[0]}" cy="${GEO.av[1]}" r="10"/><circle class="ad-node2" cx="${GEO.his[0]}" cy="${GEO.his[1]}" r="5"/>
<g id="inset"></g><g id="marks"></g><g id="imps"></g><g id="ado"></g><g id="ecg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "adenosine-av-node-block", fig: "Fig 1", title: "Adenosine and the AV node: a brief block that stops SVT", W, H, body,
  label: "An animated heart conduction diagram with a live ECG and an AV node cell close-up. In sinus rhythm impulses pass from the SA node through the AV node to the ventricles. In re-entrant supraventricular tachycardia the impulse loops round and round through the AV node. Adenosine binds A1 receptors, opens potassium channels, hyperpolarises AV nodal and sinoatrial cells and cuts calcium current, so the AV node blocks briefly and the circuit stops. Its effect is very short lived. Caffeine and theophylline oppose it, dipyridamole strengthens it, and flushing, chest tightness, bronchospasm and a brief pause can occur.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, rates in numbers or targets are shown or implied.",
  scene: { W, H, GEO, ECG }, pageJs: readFileSync(join(HERE, "adeno.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without adenosine", withLabel: "With adenosine",
  sourcesLis: [
    "<strong>How adenosine acts.</strong> Adenosine binds A1 receptors on AV nodal and sinoatrial cells. The receptor is Gi coupled: potassium channels open, the cell hyperpolarises, and calcium current falls. Conduction through the AV node slows and then blocks briefly, while the SA node also slows. Because many re-entrant supraventricular tachycardias need the AV node as part of the circuit, a brief AV block can terminate the circuit and restore sinus rhythm. Adenosine is broken down very fast, so the block and the pause are transient, sometimes with a short period of asystole before sinus rhythm returns. This is standard teaching in pharmacology and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Unwanted effects and interactions shown.</strong> Flushing, chest tightness, breathlessness from bronchospasm and a transient pause or asystole can occur. Caffeine and theophylline are adenosine receptor antagonists and can blunt the effect. Dipyridamole blocks adenosine uptake and potentiates it. These are teaching toggles only.",
  ],
  simplified: "AVNRT versus AVRT subtypes, accessory pathways, vagal manoeuvres, other rate control drugs, pacing and ablation, atrial fibrillation, dosing, contraindications in detail, and all numeric rates and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-ch:#4a3550;--c-flash:#d63a4a}
body[data-theme="light"]{--c-ch:#f3e6ec}
.ad-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.ad-cap{fill:var(--anatomy-text);font-size:10.5px;pointer-events:none}
.ad-ch{fill:color-mix(in srgb,var(--c-flash) calc(var(--act,0) * 55%),var(--c-ch));stroke:var(--anatomy-mid);stroke-width:1.3}
.ad-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ad-grid{stroke:var(--anatomy-faint);stroke-width:.5;fill:none;stroke-opacity:.35}.ad-grid.major{stroke-opacity:.7}
.ad-base{stroke:var(--anatomy-faint);stroke-width:.7}
.ad-trace{fill:none;stroke:var(--c-good);stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}
.ad-septum{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;opacity:.7}
.ad-wire{fill:none;stroke:var(--anatomy-hi);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.ad-loop{fill:none;stroke:var(--c-neut);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:7 6;opacity:.55}
.ad-node{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1}
.ad-node2{fill:#c084fc;stroke:color-mix(in srgb,#c084fc 55%,#000);stroke-width:1}
.ad-imp{fill:#fff;stroke:var(--c-neut);stroke-width:2}
.ad-ado{fill:#c084fc;stroke:color-mix(in srgb,#c084fc 50%,#000);stroke-width:.6}
.ad-inset{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ad-cell{--cc:#e9a2b3}
.ad-rec{fill:#c084fc;stroke:color-mix(in srgb,#c084fc 50%,#000);stroke-width:.8}
.ad-k{fill:#7ab8ff;stroke:color-mix(in srgb,#7ab8ff 50%,#000);stroke-width:.5}
.ad-ca{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 50%,#000);stroke-width:.5}
.ad-arrow{fill:none;stroke:var(--anatomy-hi);stroke-width:1.6;stroke-linecap:round}
.ad-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.ad-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.dr-g-fill.g-adv{fill:var(--c-eos)}
`,
});
