/* AV conduction block as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/heartblock.mjs [--print-model]
 * Static layout here; impulses, ECG, delay bar and gauges move in heartblock.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Degree of AV block", a: [0, 1, 2, 3, 4], names: ["no block", "first degree", "second degree, Mobitz I (Wenckebach)", "second degree, Mobitz II", "third degree, complete block"], ticks: ["none", "first", "Mobitz I", "Mobitz II", "third"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "observe" },
    { label: "atropine" },
    { label: "pacing" },
  ],
  status: "Block: {level} · {drug} ·",
  drugNames: ["observation", "atropine", "pacing"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const DEGREES = [
    { kind: "normal", reach: 1, reachWord: "all", prWord: "normal", prSec: 0.16, delay: 0.18, cycle: 0, vent: 0.52, reg: 1, regWord: "regular", out: 0.86 },
    { kind: "first", reach: 1, reachWord: "all", prWord: "long", prSec: 0.38, delay: 0.6, cycle: 0, vent: 0.52, reg: 1, regWord: "regular", out: 0.86 },
    { kind: "wenckebach", reach: 0.74, reachWord: "most", prWord: "lengthening then a dropped beat", prSec: 0.2, delay: 0.74, cycle: 4, vent: 0.44, reg: 0.55, regWord: "grouped", out: 0.7 },
    { kind: "mobitz2", reach: 0.62, reachWord: "some", prWord: "sudden dropped beats", prSec: 0.2, delay: 0.5, cycle: 3, vent: 0.34, reg: 0.45, regWord: "dropped beats", out: 0.42 },
    { kind: "complete", reach: 0, reachWord: "none", prWord: "no relation", prSec: 0.2, delay: 1, cycle: 0, vent: 0.24, reg: 0.8, regWord: "independent", out: 0.38 },
  ];
  const d0 = DEGREES[level];
  let reach = d0.reach, reachWord = d0.reachWord, prWord = d0.prWord, prSec = d0.prSec, delay = d0.delay, cycle = d0.cycle;
  let vent = d0.vent, reg = d0.reg, regWord = d0.regWord, out = d0.out;
  const atrop = drug === 1 ? 1 : 0, paceWanted = drug === 2 ? 1 : 0;
  let atropHelp = 0, paced = 0, paceStandby = 0;
  if (atrop && level === 1) { atropHelp = 1; prSec = 0.24; delay = 0.34; prWord = "long but shorter"; }
  else if (atrop && level === 2) { atropHelp = 1; cycle = 6; reach = 0.86; reachWord = "most"; delay = 0.55; vent = 0.49; reg = 0.72; out = 0.8; prWord = "lengthening, drops less often"; }
  else if (atrop && level >= 3) { atropHelp = -1; }
  if (paceWanted && level >= 3) { paced = 1; vent = 0.52; reg = 1; regWord = "regular"; out = 0.85; }
  else if (paceWanted && level < 3) { paceStandby = 1; }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const ventWord = paced ? "normal, paced" : w(vent, 0.35, 0.65, ["slow", "normal", "fast"]);
  const outWord = w(out, 0.45, 0.75, ["low", "reduced", "normal"]);
  const words = [reachWord, prWord, ventWord, outWord];
  return { kind: d0.kind, level, drug, atrop, paceWanted, atropHelp, paced, paceStandby, reach: cl(reach), reachWord, prWord, prSec, delay: cl(delay), cycle, vent: cl(vent), reg: cl(reg), regWord, out: cl(out), words, readout: "signals reaching ventricles " + words[0] + " · PR pattern " + words[1] + " · ventricular rate " + words[2] + " · output " + words[3] };
}
const TESTS = [
  [0, 0, "signals reaching ventricles all · PR pattern normal · ventricular rate normal · output normal"],
  [1, 0, "signals reaching ventricles all · PR pattern long · ventricular rate normal · output normal"],
  [2, 0, "signals reaching ventricles most · PR pattern lengthening then a dropped beat · ventricular rate normal · output reduced"],
  [3, 1, "signals reaching ventricles some · PR pattern sudden dropped beats · ventricular rate slow · output low"],
  [4, 2, "signals reaching ventricles none · PR pattern no relation · ventricular rate normal, paced · output normal"],
];

/* ---------------- static layout ---------------- */
const GEO = {
  sa: [150, 112], av: [260, 214], his: [260, 252],
  bach: [[150, 112], [210, 98], [300, 98], [350, 120]],
  inter: [[150, 112], [190, 160], [240, 200], [260, 214]],
  hisTrack: [[260, 214], [260, 252]],
  lbb: [[260, 252], [292, 318], [330, 388]], rbb: [[260, 252], [226, 318], [188, 388]],
  apexL: [330, 388], apexR: [188, 388], lead: [196, 384], pm: [452, 128], escape: [200, 330],
};
const ECG = { x: 556, y: 92, w: 372, h: 170, base: 190 };
let grid = "";
for (let x = ECG.x; x <= ECG.x + ECG.w; x += 18) grid += `<path class="hb-grid${(x - ECG.x) % 90 === 0 ? " major" : ""}" d="M${x} ${ECG.y}V${ECG.y + ECG.h}"/>`;
for (let y = ECG.y; y <= ECG.y + ECG.h; y += 18) grid += `<path class="hb-grid${(y - ECG.y) % 90 === 0 ? " major" : ""}" d="M${ECG.x} ${y}H${ECG.x + ECG.w}"/>`;
const P = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="526" height="396" rx="18"/>
<rect class="hb-ecgbg" x="546" y="44" width="400" height="396" rx="18"/>
<text class="hb-zone" x="34" y="68">HEART AND ITS WIRING</text>
<text class="hb-zone" x="566" y="68">ECG, ONE LEAD</text>
<clipPath id="ecgclip"><rect x="${ECG.x}" y="${ECG.y}" width="${ECG.w}" height="${ECG.h}"/></clipPath>
<g clip-path="url(#ecgclip)">${grid}</g>
<path class="hb-base" d="M${ECG.x} ${ECG.base}H${ECG.x + ECG.w}"/>
<text class="hb-leg" x="566" y="288">P: atria fire</text>
<text class="hb-leg" x="566" y="306">QRS: ventricles fire</text>
<text class="hb-leg" x="566" y="324">T: ventricles reset</text>
<text class="hb-note" id="ecgnote" x="566" y="348"></text>
<text class="hb-leg" x="566" y="382">AV delay</text>
<rect class="hb-track" x="636" y="372" width="292" height="10" rx="5"/>
<rect id="delayfill" class="hb-fill" x="636" y="372" width="40" height="10" rx="5"/>
<text class="hb-leg" x="636" y="404">short</text>
<text class="hb-leg" x="928" y="404" text-anchor="end">blocked</text>
<path id="ch-ra" class="hb-ch" d="M130 100Q130 88 150 88H232Q252 88 252 110V176Q252 200 230 200H150Q130 200 130 180Z"/>
<path id="ch-la" class="hb-ch" d="M270 110Q270 88 292 88H372Q392 88 392 110V180Q392 200 370 200H292Q270 200 270 180Z"/>
<path id="ch-rv" class="hb-ch" d="M102 238Q102 214 128 214H255V396Q190 428 140 386Q102 340 102 238Z"/>
<path id="ch-lv" class="hb-ch" d="M265 214H402Q438 214 438 256Q438 340 394 394Q330 432 265 396Z"/>
<path class="hb-septum" d="M260 214V400"/>
<path class="hb-wire" d="${P(GEO.bach)}"/><path class="hb-wire" d="${P(GEO.inter)}"/><path class="hb-wire" d="${P(GEO.hisTrack)}"/><path class="hb-wire" d="${P(GEO.lbb)}"/><path class="hb-wire" d="${P(GEO.rbb)}"/>
<path class="hb-fine" d="M292 318L346 308M330 388L380 360M330 388L318 330M226 318L172 308M188 384L142 360M188 384L204 330"/>
<circle class="hb-node" cx="${GEO.sa[0]}" cy="${GEO.sa[1]}" r="8"/>
<circle class="hb-node hb-avnode" cx="${GEO.av[0]}" cy="${GEO.av[1]}" r="9"/>
<circle class="hb-node" cx="${GEO.his[0]}" cy="${GEO.his[1]}" r="5"/>
<circle class="hb-escnode" cx="${GEO.escape[0]}" cy="${GEO.escape[1]}" r="6"/>
<g id="delaybars" opacity="0.7"><rect class="hb-delaybar" x="240" y="202" width="5" height="24" rx="2"/><rect class="hb-delaybar" x="275" y="202" width="5" height="24" rx="2"/></g>
<g id="blockx" opacity="0"><circle class="hb-x" cx="${GEO.av[0] + 20}" cy="${GEO.av[1] - 16}" r="8"/><path class="hb-xp" d="M${GEO.av[0] + 16} ${GEO.av[1] - 20}l8 8m0 -8l-8 8"/></g>
<g id="helpm" opacity="0"><circle class="hb-okc" cx="${GEO.av[0] + 20}" cy="${GEO.av[1] - 16}" r="8"/><path class="hb-okp" d="M${GEO.av[0] + 16} ${GEO.av[1] - 16}l3 3l5 -6"/></g>
<g id="pmg" opacity="0"><rect class="hb-pm" x="${GEO.pm[0] - 26}" y="${GEO.pm[1] - 16}" width="52" height="32" rx="8"/><path class="hb-lead" d="M${GEO.pm[0] - 26} ${GEO.pm[1]}Q330 150 236 160M${GEO.pm[0] - 26} ${GEO.pm[1] + 8}Q380 290 ${GEO.lead[0]} ${GEO.lead[1]}"/><circle class="hb-tip" cx="${GEO.lead[0]}" cy="${GEO.lead[1]}" r="4"/></g>
<g id="marks"></g><g id="imps"></g><g id="ecg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "av-heart-block", fig: "Fig 1", title: "AV heart block: when the signal is delayed or dropped", W, H, body,
  label: "An animated heart conduction system. The SA node fires, the signal crosses the atria, waits at the AV node, then runs through the His bundle and Purkinje fibres to the ventricles. The degree slider shows no block, first degree with a long PR interval, Mobitz I Wenckebach with lengthening then a dropped beat, Mobitz II with sudden dropped beats, and third degree complete block where atria and ventricles beat independently with a slow escape rhythm. An ECG and a delay bar show the same events. Treatment choices are observe, atropine and pacing.",
  caption: "Schematic, not to scale. Timing, counts and gauge levels are qualitative and illustrative; no doses, rates in numbers or targets are shown or implied.",
  scene: { W, H, GEO, ECG }, pageJs: readFileSync(join(HERE, "heartblock.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How AV conduction works and fails.</strong> The sinoatrial (SA) node fires first and the signal spreads across the atria, giving the P wave. The atrioventricular (AV) node is the normal gateway to the ventricles and holds the signal briefly so the ventricles can fill; that pause is most of the PR interval. The signal then runs down the bundle of His, the bundle branches and the Purkinje fibres, so the ventricles fire together in a narrow QRS. In first degree block every signal still gets through, but the PR interval is long. In Mobitz I (Wenckebach) block, usually at the AV node, the delay grows beat by beat until one signal is dropped, then the cycle repeats. In Mobitz II block, usually below the AV node in the His-Purkinje system, beats are dropped suddenly without lengthening first, and it is more likely to progress. In third degree (complete) block no atrial signal reaches the ventricles: the atria and ventricles beat independently and a slow, wide escape rhythm from lower down keeps the ventricles going. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Observation leaves the rhythm as it is. Atropine acts at the AV node, so it can shorten the delay in first degree and Mobitz I block, but it does not repair Mobitz II or complete block below the node. Pacing takes over the ventricles when dropped or blocked beats make the ventricular rate too slow, and it sits on standby when conduction is still adequate. These are teaching toggles only.",
  ],
  simplified: "Symptoms and their assessment, syncope workup, reversible causes such as drugs, electrolytes and ischaemia, other escape rhythms and their sites, bundle branch patterns, temporary versus permanent pacing detail, pacing modes, and all doses and targets are left out. The ECG is one schematic lead, and timing is illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-ch:#6b3a4a;--c-flash:#ff9a7a}body[data-theme="light"]{--c-ch:#e9b8c2;--c-flash:#ff6a4a}
.hb-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.hb-leg{fill:var(--anatomy-text);font-size:10.5px;pointer-events:none}
.hb-note{fill:var(--anatomy-strong);font-size:11px;font-weight:600;pointer-events:none}
.hb-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.hb-grid{stroke:var(--anatomy-faint);stroke-width:.5;fill:none;stroke-opacity:.4}.hb-grid.major{stroke-opacity:.8}
.hb-base{stroke:var(--anatomy-mid);stroke-width:.8;stroke-dasharray:3 4;fill:none}
.hb-trace{fill:none;stroke:var(--c-good);stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}
.hb-ch{fill:color-mix(in srgb,var(--c-flash) calc(var(--act,0) * 100%),var(--c-ch));stroke:var(--anatomy-mid);stroke-width:1.3}
.hb-septum{stroke:var(--anatomy-mid);stroke-width:1.2;fill:none}
.hb-wire{fill:none;stroke:var(--anatomy-hi);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.hb-fine{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.hb-node{fill:#f2b84a;stroke:color-mix(in srgb,#f2b84a 55%,#000);stroke-width:1}
.hb-avnode{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 55%,#000)}
.hb-escnode{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:1}
.hb-delaybar{fill:var(--anatomy-hi)}
.hb-imp{fill:#fff;stroke:var(--c-neut);stroke-width:2}
.hb-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.hb-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.hb-okc{fill:var(--anatomy-paper);stroke:var(--c-good);stroke-width:1.4}
.hb-okp{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.hb-pm{fill:var(--anatomy-mid);stroke:var(--anatomy-hi);stroke-width:1.4}
.hb-lead{fill:none;stroke:var(--anatomy-hi);stroke-width:1.6}
.hb-tip{fill:var(--c-bad);stroke:var(--anatomy-paper);stroke-width:1}
.hb-spark{fill:none;stroke:var(--c-neut);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.hb-track{fill:var(--anatomy-faint)}
.hb-fill{fill:var(--c-neut)}
.dr-g-fill.g-reach{fill:var(--c-good)}.dr-g-fill.g-vent{fill:var(--c-neut)}
`,
});
