/* Supraventricular tachycardia and WPW as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/wpw.mjs [--print-model]
 * Layout and model here; impulse, circuit, ECG and gauges move in wpw.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Rhythm shown", a: [0, 1, 2], names: ["sinus rhythm", "SVT circuit", "AF with pre-excitation"], ticks: ["sinus", "SVT", "AF + WPW"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "vagal manoeuvre" },
    { label: "adenosine" },
    { label: "catheter ablation" },
  ],
  status: "Rhythm: {level} · {drug} ·",
  drugNames: ["no treatment", "a vagal manoeuvre", "adenosine", "catheter ablation"],
};
function modelOf(S, level, drug) {
  const TAB = [
    [ { rate: 0.48, delta: 0.78, circ: 0.05, danger: 0.12, avBlock: 0.05, bypass: 1, chaos: 0, irreg: 0.05, ablated: 0, code: 0, rhythm: "pre-excited sinus" },
      { rate: 0.36, delta: 0.88, circ: 0.05, danger: 0.10, avBlock: 0.38, bypass: 1, chaos: 0, irreg: 0.05, ablated: 0, code: 0, rhythm: "pre-excited sinus" },
      { rate: 0.22, delta: 0.95, circ: 0, danger: 0.18, avBlock: 0.92, bypass: 1, chaos: 0, irreg: 0.05, ablated: 0, code: 0, rhythm: "pre-excited sinus" },
      { rate: 0.48, delta: 0.02, circ: 0, danger: 0.05, avBlock: 0, bypass: 0, chaos: 0, irreg: 0.05, ablated: 1, code: 1, rhythm: "sinus" } ],
    [ { rate: 0.92, delta: 0.05, circ: 0.95, danger: 0.55, avBlock: 0.05, bypass: 1, chaos: 0.05, irreg: 0.05, ablated: 0, code: 2, rhythm: "re-entrant SVT" },
      { rate: 0.48, delta: 0.78, circ: 0.08, danger: 0.12, avBlock: 0.38, bypass: 1, chaos: 0, irreg: 0.05, ablated: 0, code: 0, rhythm: "pre-excited sinus" },
      { rate: 0.48, delta: 0.78, circ: 0.02, danger: 0.10, avBlock: 0.92, bypass: 1, chaos: 0, irreg: 0.05, ablated: 0, code: 0, rhythm: "pre-excited sinus" },
      { rate: 0.48, delta: 0.02, circ: 0, danger: 0.05, avBlock: 0, bypass: 0, chaos: 0, irreg: 0.05, ablated: 1, code: 1, rhythm: "sinus" } ],
    [ { rate: 0.96, delta: 0.85, circ: 0.25, danger: 0.95, avBlock: 0.05, bypass: 1, chaos: 0.95, irreg: 0.95, ablated: 0, code: 3, rhythm: "AF pre-excited" },
      { rate: 0.94, delta: 0.90, circ: 0.25, danger: 0.93, avBlock: 0.38, bypass: 1, chaos: 0.95, irreg: 0.95, ablated: 0, code: 3, rhythm: "AF pre-excited" },
      { rate: 0.99, delta: 0.98, circ: 0.25, danger: 1, avBlock: 0.92, bypass: 1, chaos: 0.95, irreg: 0.95, ablated: 0, code: 3, rhythm: "AF pre-excited" },
      { rate: 0.58, delta: 0.02, circ: 0.25, danger: 0.30, avBlock: 0, bypass: 0, chaos: 0.90, irreg: 0.85, ablated: 1, code: 4, rhythm: "AF via AV node" } ],
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const kind = S.level.a[level];
  const r = TAB[kind][drug];
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const rateW = w(r.rate, 0.38, 0.68, ["slow", "normal", "fast"]);
  const deltaW = w(r.delta, 0.15, 0.55, ["absent", "faint", "clear"]);
  const dangerW = w(r.danger, 0.25, 0.6, ["low", "raised", "high"]);
  return { kind, drug, rate: cl(r.rate), delta: cl(r.delta), circ: cl(r.circ), danger: cl(r.danger), avBlock: cl(r.avBlock), bypass: r.bypass, chaos: cl(r.chaos), irreg: cl(r.irreg), ablated: r.ablated, code: r.code, rhythm: r.rhythm, words: [rateW, r.rhythm, deltaW, dangerW], readout: "rate " + rateW + " · rhythm " + r.rhythm + " · delta wave " + deltaW + " · danger " + dangerW };
}
const TESTS = [
  [0, 0, "rate normal · rhythm pre-excited sinus · delta wave clear · danger low"],
  [1, 0, "rate fast · rhythm re-entrant SVT · delta wave absent · danger raised"],
  [1, 2, "rate normal · rhythm pre-excited sinus · delta wave clear · danger low"],
  [2, 0, "rate fast · rhythm AF pre-excited · delta wave clear · danger high"],
  [2, 3, "rate normal · rhythm AF via AV node · delta wave absent · danger raised"],
];

/* ---------------- static layout ---------------- */
const ECG = { x: 566, y: 92, w: 360, h: 150, base: 178 };
let grid = "";
for (let x = ECG.x; x <= ECG.x + ECG.w; x += 18) grid += `<path class="wp-grid${(x - ECG.x) % 90 === 0 ? " major" : ""}" d="M${x} ${ECG.y}V${ECG.y + ECG.h}"/>`;
for (let y = ECG.y; y <= ECG.y + ECG.h; y += 18) grid += `<path class="wp-grid${(y - ECG.y) % 90 === 0 ? " major" : ""}" d="M${ECG.x} ${y}H${ECG.x + ECG.w}"/>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="526" height="396" rx="18"/>
<rect class="sc-tissue" x="546" y="44" width="400" height="396" rx="18"/>
<rect class="wp-ecgbg" x="546" y="82" width="400" height="170" rx="14"/>
<text class="sc-zone" x="34" y="68">HEART: NODES AND BYPASS</text>
<text class="sc-zone" x="566" y="68">ECG, ONE LEAD</text>
<clipPath id="ecgclip"><rect x="${ECG.x}" y="${ECG.y}" width="${ECG.w}" height="${ECG.h}"/></clipPath>
<g clip-path="url(#ecgclip)">${grid}</g>
<path class="wp-base" d="M${ECG.x} ${ECG.base}H${ECG.x + ECG.w}"/>
<rect class="wp-inset" x="560" y="292" width="372" height="138" rx="14"/>
<text class="sc-zone" x="575" y="315">RE-ENTRY CLOSE-UP</text>
<g id="heartSlot"></g><g id="heart"></g><g id="inset"></g><g id="marks"></g><g id="imps"></g><g id="ecg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "wpw-svt-reentry", fig: "Fig 1", title: "SVT and WPW: the bypass tract and the re-entry circuit", W, H, body,
  label: "An animated heart with an accessory pathway that bypasses the AV node. In sinus rhythm the ventricle starts early through the bypass, giving a short PR interval and a delta wave. In orthodromic SVT the impulse goes down the AV node and back up the bypass in a loop, and AVNRT is shown as dual pathways inside the compact AV node. Adenosine blocks the AV node and breaks AV node dependent SVT, but in AF with pre-excitation it can push more impulses down the bypass. A live ECG, a re-entry close-up and gauges show rate, circuit activity, delta wave and danger. Treatment choices are a vagal manoeuvre, adenosine and catheter ablation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, rates in numbers or targets are shown or implied.",
  scene: { W, H, ECG }, pageJs: readFileSync(join(HERE, "wpw.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With catheter ablation",
  sourcesLis: [
    "<strong>Pre-excitation and WPW.</strong> An accessory pathway (bypass tract) connects atrium to ventricle outside the AV node, so it bypasses the normal AV nodal delay. In sinus rhythm part of the ventricle is activated early (pre-excitation): the PR interval is short, the QRS starts with a slurred delta wave and is widened by fusion with conduction through the AV node and His-Purkinje system. Many people with a delta wave have no symptoms; WPW syndrome means pre-excitation with tachyarrhythmia symptoms. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Re-entrant SVT.</strong> In orthodromic atrioventricular re-entrant tachycardia the impulse goes antegrade down the AV node and His-Purkinje system (narrow QRS, no delta wave during the tachycardia) and retrograde up the accessory pathway, in a repeating circuit. In antidromic forms it goes down the pathway and up the AV node (wide QRS). AV nodal re-entrant tachycardia (AVNRT) instead uses dual pathways, a fast and a slow pathway, inside and around the compact AV node, with near simultaneous atrial and ventricular activation. Focal atrial tachycardia and junctional forms are other supraventricular mechanisms. Recurrent episodes, their forms and inferior and coronary sinus clues on the ECG guide catheter ablation of the pathway or the slow pathway. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Vagal manoeuvres and adenosine increase AV nodal block: adenosine administration transiently blocks the AV node, so it terminates SVT that needs the AV node (orthodromic AVRT and AVNRT) and can unmask atrial activity. In AF with pre-excitation, blocking the AV node does not stop the atria and can shunt more impulses down the accessory pathway to a very fast ventricular response, so AV nodal blockers are avoided and urgent rhythm treatment is sought. Catheter ablation destroys the accessory pathway (or the slow pathway in AVNRT), removes pre-excitation and prevents recurrence. These are teaching toggles only.",
  ],
  simplified: "Antidromic detail, multiple and septal pathways, pathway localisation from delta polarity, Mahaim and other variants, focal and junctional tachycardia detail, drug choice beyond adenosine, cardioversion and pacing detail, risk stratification and asymptomatic pre-excitation management, and all doses and targets are left out. The ECG is one schematic lead, the heart is simplified, and timing is illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-ch:#6b3a4a;--c-flash:#ff9a7a}body[data-theme="light"]{--c-ch:#e9b8c2;--c-flash:#ff6a4a}
.wp-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.wp-grid{stroke:var(--anatomy-faint);stroke-width:.5;fill:none;stroke-opacity:.35}.wp-grid.major{stroke-opacity:.7}
.wp-base{stroke:var(--anatomy-mid);stroke-width:.8;stroke-dasharray:3 4;fill:none}
.wp-trace{fill:none;stroke:var(--c-good);stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}
.wp-wire{fill:none;stroke:var(--anatomy-hi);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.wp-acc{fill:none;stroke:var(--c-neut);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.wp-node{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1}
.wp-node2{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:1}
.wp-his{fill:var(--anatomy-hi);stroke:color-mix(in srgb,var(--anatomy-hi) 55%,#000);stroke-width:1}
.wp-imp{fill:#fff;stroke:var(--c-neut);stroke-width:2}
.wp-block{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1.2}
.wp-vagal{fill:none;stroke:#f2b84a;stroke-width:2;stroke-dasharray:5 4}
.wp-inset{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.wp-inode{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:1}
.wp-inode2{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1}
.wp-mag{fill:color-mix(in srgb,var(--c-flash) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.3}
.wp-dual{fill:none;stroke:var(--anatomy-hi);stroke-width:1.6;stroke-linecap:round}
.wp-dual2{fill:none;stroke:var(--c-neut);stroke-width:1.6;stroke-linecap:round;stroke-dasharray:3 3}
.wp-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.wp-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.wp-cap{fill:var(--anatomy-strong);font-size:12px}
.wp-zA{fill:color-mix(in srgb,var(--c-flash) calc(var(--act,0) * 100%),var(--c-ch));stroke:none;fill-opacity:.42}
.wp-zV{fill:color-mix(in srgb,var(--c-flash) calc(var(--act,0) * 100%),var(--c-ch));stroke:none;fill-opacity:.5}
.dr-g-fill.g-circ{fill:var(--c-neut)}
`,
});
