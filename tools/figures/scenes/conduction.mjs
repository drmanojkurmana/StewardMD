/* Cardiac conduction and the ECG as an animated, working scene. Original drawing on real heart art.
 *   node tools/figures/scenes/conduction.mjs [--print-model]
 * Layout and model here; the impulse, chambers, trace, clot and gauges move in conduction.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Rhythm problem", a: [0, 1, 2], names: ["normal sinus rhythm", "complete heart block", "atrial fibrillation"], ticks: ["sinus", "heart block", "AF"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "rate control (beta-blocker, calcium-channel blocker or digoxin)" },
    { label: "rhythm control (antiarrhythmic drug or cardioversion)" },
    { label: "pacemaker" },
    { label: "anticoagulant (stroke prevention)" },
    { label: "combination: all of the above that fit" },
  ],
  status: "Rhythm: {level} · {drug} ·",
  drugNames: ["no treatment", "rate control", "rhythm control", "a pacemaker", "an anticoagulant", "the combination"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const rate = drug === 1 || drug === 5 ? 1 : 0, rhythm = drug === 2 || drug === 5 ? 1 : 0, pace = drug === 3 || drug === 5 ? 1 : 0, coag = drug === 4 || drug === 5 ? 1 : 0;
  const af = level === 2, blk = level === 1;
  const kind = blk ? (pace ? "paced" : "block") : af ? (rhythm ? "sinus" : rate ? "afslow" : "af") : "sinus";
  const V = { sinus: 0.5, block: 0.18, paced: 0.5, af: 0.88, afslow: 0.5 }[kind] - (kind === "sinus" && rate ? 0.1 : 0);
  const reg = { sinus: 1, block: 0.8, paced: 1, af: 0.12, afslow: 0.15 }[kind];
  const CO = { sinus: 0.85, block: 0.32, paced: 0.8, af: 0.55, afslow: 0.77 }[kind];
  const th = af ? (coag ? 0.12 : rhythm ? 0.45 : 0.85) : 0;
  const S0 = af ? (coag ? 0.18 : rhythm ? 0.45 : 0.85) : 0.05;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const rhythmWord = { sinus: "sinus", block: "complete block", paced: "paced", af: "AF", afslow: "AF controlled" }[kind];
  const regWord = { sinus: "regular", block: "regular but dissociated", paced: "regular", af: "irregularly irregular", afslow: "irregularly irregular" }[kind];
  const words = [w(V, 0.35, 0.7, ["slow", "normal", "fast"]), rhythmWord, w(CO, 0.45, 0.75, ["low", "reduced", "normal"]), w(S0, 0.3, 0.6, ["low", "raised", "high"])];
  return { kind, rate, rhythm, pace, coag, V: cl(V), reg, regWord, CO, th, S0, words, readout: "rate " + words[0] + " · rhythm " + words[1] + " · output " + words[2] + " · stroke risk " + words[3] };
}
const TESTS = [
  [0, 0, "rate normal · rhythm sinus · output normal · stroke risk low"],
  [1, 0, "rate slow · rhythm complete block · output low · stroke risk low"],
  [1, 3, "rate normal · rhythm paced · output normal · stroke risk low"],
  [1, 5, "rate normal · rhythm paced · output normal · stroke risk low"],
  [2, 0, "rate fast · rhythm AF · output reduced · stroke risk high"],
  [2, 1, "rate normal · rhythm AF controlled · output normal · stroke risk high"],
  [2, 2, "rate normal · rhythm sinus · output normal · stroke risk raised"],
  [2, 4, "rate fast · rhythm AF · output reduced · stroke risk low"],
  [2, 5, "rate normal · rhythm sinus · output normal · stroke risk low"],
];

/* ---------------- static layout ----------------
 * Heart art (NIH heart-1) centred on HX,HY at HW wide; node spots are art fractions
 * (SA near the top vessels, AV central, bundle ends toward the apex, clot at the
 * left atrial appendage), so wires, dots and particles sit on real anatomy. */
const HX = 245, HY = 238, HW = 240, HH = 337;
const FX = (f) => Math.round((HX + (f - 0.5) * HW) * 10) / 10;
const FY = (f) => Math.round((HY + (f - 0.5) * HH) * 10) / 10;
const GEO = {
  sa: [FX(0.30), FY(0.33)], av: [FX(0.47), FY(0.47)], his: [FX(0.50), FY(0.56)],
  bach: [[FX(0.30), FY(0.33)], [FX(0.40), FY(0.30)], [FX(0.52), FY(0.30)], [FX(0.60), FY(0.33)]],
  inter: [[FX(0.30), FY(0.33)], [FX(0.36), FY(0.39)], [FX(0.42), FY(0.43)], [FX(0.47), FY(0.47)]],
  hisTrack: [[FX(0.47), FY(0.47)], [FX(0.50), FY(0.56)]],
  lbb: [[FX(0.50), FY(0.56)], [FX(0.56), FY(0.69)], [FX(0.62), FY(0.82)]],
  rbb: [[FX(0.50), FY(0.56)], [FX(0.43), FY(0.68)], [FX(0.36), FY(0.80)]],
  apexL: [FX(0.62), FY(0.82)], apexR: [FX(0.36), FY(0.80)], lead: [FX(0.66), FY(0.88)],
  pm: [66, 110], clot: [FX(0.63), FY(0.36)], brain: [480, 132], carotid: [439, 156],
  escape: [FX(0.36), FY(0.80)],
  quiver: [150, 330, 132, 224], atriaC: [238, 178], ventC: [245, 308],
};
const ECG = { x: 556, y: 92, w: 372, h: 220, base: 196 };
let grid = "";
for (let x = ECG.x; x <= ECG.x + ECG.w; x += 18) grid += `<path class="cd-grid${(x - ECG.x) % 90 === 0 ? " major" : ""}" d="M${x} ${ECG.y}V${ECG.y + ECG.h}"/>`;
for (let y = ECG.y; y <= ECG.y + ECG.h; y += 18) grid += `<path class="cd-grid${(y - ECG.y) % 90 === 0 ? " major" : ""}" d="M${ECG.x} ${y}H${ECG.x + ECG.w}"/>`;
const P = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="526" height="396" rx="18"/>
<rect class="cd-ecgbg" x="546" y="44" width="400" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEART AND ITS WIRING</text>
<text class="sc-zone" x="566" y="68">ECG, ONE LEAD</text>
<clipPath id="ecgclip"><rect x="${ECG.x}" y="${ECG.y}" width="${ECG.w}" height="${ECG.h}"/></clipPath>
<g clip-path="url(#ecgclip)">${grid}</g>
<path class="cd-base" d="M${ECG.x} ${ECG.base}H${ECG.x + ECG.w}"/>
<text class="cd-leg" x="566" y="${ECG.y + ECG.h + 26}">P: atria fire</text>
<text class="cd-leg" x="566" y="${ECG.y + ECG.h + 44}">QRS: ventricles fire</text>
<text class="cd-leg" x="566" y="${ECG.y + ECG.h + 62}">T: ventricles reset</text>
<text class="cd-leg2" id="ecgnote" x="926" y="${ECG.y + ECG.h + 26}" text-anchor="end"></text>
<g id="heartSlot"></g>
<ellipse id="tintA" class="cd-tintA" cx="${GEO.atriaC[0]}" cy="${GEO.atriaC[1]}" rx="105" ry="48" opacity="0"/>
<ellipse id="tintV" class="cd-tintV" cx="${GEO.ventC[0]}" cy="${GEO.ventC[1]}" rx="92" ry="78" opacity="0"/>
<ellipse id="flA" class="cd-flashA" cx="${GEO.atriaC[0]}" cy="${GEO.atriaC[1]}" rx="105" ry="48" opacity="0"/>
<ellipse id="flV" class="cd-flashV" cx="${GEO.ventC[0]}" cy="${GEO.ventC[1]}" rx="92" ry="78" opacity="0"/>
<g id="quiv"></g>
<path class="cd-wire" d="${P(GEO.bach)}"/><path class="cd-wire" d="${P(GEO.inter)}"/><path class="cd-wire" d="${P(GEO.hisTrack)}"/><path class="cd-wire" d="${P(GEO.lbb)}"/><path class="cd-wire" d="${P(GEO.rbb)}"/>
<path class="cd-fine" d="M${GEO.apexL[0]} ${GEO.apexL[1] - 28}L${GEO.apexL[0] + 26} ${GEO.apexL[1] - 38}M${GEO.apexL[0]} ${GEO.apexL[1]}L${GEO.apexL[0] + 30} ${GEO.apexL[1] - 28}M${GEO.apexR[0]} ${GEO.apexR[1] - 21}L${GEO.apexR[0] - 27} ${GEO.apexR[1] - 31}M${GEO.apexR[0]} ${GEO.apexR[1] - 5}L${GEO.apexR[0] - 29} ${GEO.apexR[1] - 24}"/>
<circle id="nd-sa" class="cd-node" cx="${GEO.sa[0]}" cy="${GEO.sa[1]}" r="8"/><circle class="cd-node cd-av" cx="${GEO.av[0]}" cy="${GEO.av[1]}" r="8"/><circle class="cd-node" cx="${GEO.his[0]}" cy="${GEO.his[1]}" r="5"/>
<g id="blockx" opacity="0"><circle class="cd-x" cx="${GEO.av[0]}" cy="${GEO.av[1]}" r="13"/><path class="cd-xp" d="M${GEO.av[0] - 6} ${GEO.av[1] - 6}l12 12m0 -12l-12 12"/></g>
<g id="cuff" opacity="0"><rect class="cd-cuff" x="${GEO.av[0] - 40}" y="${GEO.av[1] - 30}" width="80" height="62" rx="14"/></g>
<path id="embtrack" class="cd-embtrack" d="M${GEO.clot[0]} ${GEO.clot[1]} C320 182 390 170 ${GEO.carotid[0]} ${GEO.carotid[1]}" opacity="0"/>
<g id="clotg" opacity="0"><ellipse class="cd-clot" cx="${GEO.clot[0]}" cy="${GEO.clot[1]}" rx="16" ry="12"/><path class="cd-fib" d="M${GEO.clot[0] - 12} ${GEO.clot[1] - 5}L${GEO.clot[0] + 12} ${GEO.clot[1] + 5}M${GEO.clot[0] - 10} ${GEO.clot[1] + 7}L${GEO.clot[0] + 10} ${GEO.clot[1] - 5}M${GEO.clot[0] - 6} ${GEO.clot[1] - 11}L${GEO.clot[0] + 6} ${GEO.clot[1] + 13}"/></g>
<g id="shield" opacity="0"><circle class="cd-shield" cx="${GEO.clot[0]}" cy="${GEO.clot[1]}" r="28"/></g>
<g id="pmg" opacity="0"><rect class="cd-pm" x="${GEO.pm[0] - 26}" y="${GEO.pm[1] - 16}" width="52" height="32" rx="8"/><path id="pblead" class="cd-lead" d="M${GEO.pm[0] + 26} ${GEO.pm[1] - 4}C140 118 168 146 ${GEO.sa[0]} ${GEO.sa[1]} C226 232 256 300 ${GEO.lead[0]} ${GEO.lead[1]}"/><circle id="pltip" class="cd-tip" cx="${GEO.lead[0]}" cy="${GEO.lead[1]}" r="4"/></g>
<g id="blockers" opacity="0"></g><g id="diss"></g>
<g id="brainSlot"></g>
<g id="marks"></g><g id="imps"></g><g id="ecg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiac-conduction-ecg", fig: "Fig 1", title: "The heart's wiring and the ECG", W, H, body,
  label: "An animated heart with its electrical wiring: the sinoatrial node starts each beat, the signal crosses the atria, pauses at the atrioventricular node, then runs down the bundle of His and branches to fire the ventricles. A live ECG shows the P wave, QRS and T wave as the signal passes. Choices show normal rhythm, complete heart block and atrial fibrillation, and what rate control, rhythm control, a pacemaker and an anticoagulant change.",
  caption: "Schematic, not to scale. Timing and gauge levels are qualitative and illustrative; no doses, rates in numbers or schedules are shown or implied.",
  scene: { W, H, GEO, ECG }, pageJs: readFileSync(join(HERE, "conduction.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With combination",
  sourcesLis: [
    "<strong>How the heartbeat is conducted.</strong> The sinoatrial (SA) node fires first. The signal spreads across the atria (the P wave), is held briefly at the atrioventricular (AV) node so the ventricles can fill, then travels down the bundle of His, the two bundle branches and the Purkinje fibres to depolarise the ventricles together (the narrow QRS). The T wave is the ventricles resetting. In complete heart block no signal crosses the AV node, so atria and ventricles beat independently and a slow, wider escape rhythm drives the ventricles. In atrial fibrillation the atria quiver chaotically, only some signals reach the ventricles, and the QRS is irregularly irregular; blood pooling in the left atrial appendage can form a clot that embolises to the brain. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Rate control slows conduction through the AV node. Rhythm control tries to restore sinus rhythm. A pacemaker supplies the missing ventricular beat. An anticoagulant lowers the stroke risk from AF. These are teaching toggles only.",
  ],
  simplified: "Other rhythms (flutter, supraventricular and ventricular tachycardias, long QT, pre-excitation), accessory pathways, drug classes and their cautions, cardioversion details, risk scores for anticoagulation, bleeding risk, pacemaker modes and all doses and targets are left out. The ECG is one schematic lead, and rates and timing are illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-flash:#ff9a7a}body[data-theme="light"]{--c-flash:#e05a3a}
.cd-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.cd-grid{stroke:var(--anatomy-faint);stroke-width:.5;fill:none;stroke-opacity:.4}.cd-grid.major{stroke-opacity:.8}
.cd-base{stroke:var(--anatomy-mid);stroke-width:.8;stroke-dasharray:3 4;fill:none}
.cd-trace{fill:none;stroke:var(--c-good);stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}
.cd-leg{fill:var(--anatomy-text);font:12px var(--anatomy-mono);pointer-events:none}.cd-leg2{fill:var(--anatomy-strong);font:600 12px var(--anatomy-mono);pointer-events:none}
.cd-flashA{fill:var(--c-flash);stroke:none;pointer-events:none}
.cd-flashV{fill:var(--c-flash);stroke:none;pointer-events:none}
.cd-tintA{fill:var(--c-bad);stroke:none;pointer-events:none}
.cd-tintV{fill:color-mix(in srgb,var(--c-bad) 65%,var(--c-neut));stroke:none;pointer-events:none}
.cd-quiv{fill:var(--c-bad);stroke:none}
.cd-diss{fill:var(--c-good);stroke:none}
.cd-wire{fill:none;stroke:var(--anatomy-hi);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.cd-fine{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.cd-node{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1}
.cd-imp{fill:#fff;stroke:var(--c-neut);stroke-width:2}
.cd-cuff{fill:color-mix(in srgb,var(--anatomy-hi) 22%,transparent);stroke:var(--anatomy-hi);stroke-width:2;stroke-dasharray:6 4}
.cd-clot{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--c-plt));stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:.9}.cd-fib{stroke:#f6f1e0;stroke-width:1.1;fill:none}
.cd-shield{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-dasharray:7 5}
.cd-embtrack{fill:none;stroke:var(--c-bad);stroke-width:2.5;stroke-dasharray:5 5}
.cd-pm{fill:var(--anatomy-mid);stroke:var(--anatomy-hi);stroke-width:1.4}.cd-lead{fill:none;stroke:var(--anatomy-hi);stroke-width:2}.cd-tip{fill:var(--c-bad);stroke:var(--anatomy-paper);stroke-width:1}
.cd-spark{fill:none;stroke:var(--c-neut);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.cd-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.cd-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.cd-ok{fill:none;stroke:var(--c-good);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:4 5}
.cd-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-emb{--cc:var(--c-bad)}
`,
});
