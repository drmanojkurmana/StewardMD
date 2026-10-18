/* Cardiac arrest and advanced life support as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/arrest.mjs [--print-model]
 * Static layout here; heart, ECG, flow and gauges move in arrest.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Heart rhythm", a: [1, 1, 1, 1], names: ["VF", "asystole", "PEA", "return of circulation"], ticks: ["VF", "asystole", "PEA", "ROSC"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "CPR only" },
    { label: "CPR with defibrillation" },
    { label: "CPR with drugs and treat reversible cause" },
  ],
  status: "Rhythm: {level} · {drug} ·",
  drugNames: ["CPR only", "CPR with defibrillation", "CPR with drugs and cause treated"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const TAB = [
    { shock: 1, rec: [0.06, 0.82, 0.92] },
    { shock: 0, rec: [0.03, 0.03, 0.55] },
    { shock: 0, rec: [0.06, 0.06, 0.72] },
    { shock: 0, rec: [1, 1, 1] },
  ];
  const RN = ["VF shockable", "asystole non-shockable", "PEA non-shockable", "ROSC organised"];
  const R = TAB[level];
  const rec = R.rec[drug];
  const spont = level === 3 ? 1 : 0;
  const shockGiven = drug >= 1 ? 1 : 0;
  const defib = shockGiven && R.shock ? 1 : 0;
  const drugs = drug === 2 ? 1 : 0;
  const out = spont ? 0.92 : cl(0.18 + 0.74 * rec);
  const brain = cl(out * 0.95 - (spont ? 0 : 0.02));
  const organ = cl(out * 0.9);
  const isch = cl(1 - out * 1.02);
  const surv = cl(rec * (0.35 + 0.65 * brain));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [RN[level], w(out, 0.35, 0.7, ["absent", "partial", "restored"]), w(isch, 0.3, 0.65, ["perfused", "at risk", "ischaemic"])];
  return { shock: R.shock, rec, spont, shockGiven, defib, drugs, out, brain, organ, isch, surv, words, readout: "rhythm " + words[0] + " · output " + words[1] + " · brain " + words[2] };
}
const TESTS = [
  [0, 0, "rhythm VF shockable · output absent · brain ischaemic"],
  [0, 1, "rhythm VF shockable · output restored · brain perfused"],
  [1, 2, "rhythm asystole non-shockable · output partial · brain at risk"],
  [2, 1, "rhythm PEA non-shockable · output absent · brain ischaemic"],
];

/* ---------------- static layout ---------------- */
const ECG = { x: 24, y: 322, w: 542, h: 110 };
let grid = "";
for (let x = ECG.x; x <= ECG.x + ECG.w; x += 18) grid += `<path class="ac-grid${(x - ECG.x) % 90 === 0 ? " major" : ""}" d="M${x} ${ECG.y}V${ECG.y + ECG.h}"/>`;
for (let y = ECG.y; y <= ECG.y + ECG.h; y += 18) grid += `<path class="ac-grid${(y - ECG.y) % 90 === 0 ? " major" : ""}" d="M${ECG.x} ${y}H${ECG.x + ECG.w}"/>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="266" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<rect class="ar-ecgbg" x="14" y="312" width="560" height="128" rx="14"/>
<g clip-path="url(#arrclip)">${grid}</g>
<clipPath id="arrclip"><rect x="${ECG.x}" y="${ECG.y}" width="${ECG.w}" height="${ECG.h}"/></clipPath>
<text class="sc-zone" x="34" y="68">HEART AND CIRCULATION</text>
<text class="sc-zone" x="604" y="68">BRAIN AND ORGANS</text>
<text class="sc-zone sc-dim" x="34" y="${ECG.y + 18}">ECG, ONE LEAD</text>
<g id="vessels"></g><g id="flow"></g><g id="heart"></g><g id="brainG"></g><g id="organG"></g><g id="chain"></g><g id="causes"></g><g id="pads"></g><g id="hands"></g><g id="syr"></g><g id="ecg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiac-arrest-als", fig: "Fig 1", title: "Cardiac arrest: rhythms, CPR and the chain of survival", W, H, body,
  label: "An animated scene of cardiac arrest. The heart shows ventricular fibrillation, asystole, pulseless electrical activity or return of circulation. Without a heartbeat there is no cardiac output, so the brain and organs become ischaemic within a short time. Hands give chest compressions, pads deliver a shock for shockable rhythms, adrenaline and treatment of reversible causes are shown, and the chain of survival links recognition, CPR, defibrillation and post-arrest care. Gauges show output, brain and organ flow, ischaemia and the chance of return of circulation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H, ECG }, pageJs: readFileSync(join(HERE, "arrest.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How cardiac arrest develops.</strong> In cardiac arrest the heart stops pumping effectively, so circulation and cardiac output are lost and the brain and other organs become ischaemic very quickly. Ventricular fibrillation and pulseless ventricular tachycardia are shockable rhythms, where a defibrillation shock may restore an organised rhythm. Asystole and pulseless electrical activity are non-shockable rhythms, where a shock does not help and the focus is on compressions, adrenaline and finding a reversible cause. This is standard teaching in resuscitation and cardiovascular texts, including the Harrison chapter on cardiovascular collapse, cardiac arrest and sudden cardiac death, and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> The chain of survival: early recognition and call for help, high quality chest compressions with minimal interruption, early defibrillation for a shockable rhythm, adrenaline, treatment of reversible causes (the Hs and Ts: hypoxia, hypovolaemia, electrolyte disturbance, hypothermia, tamponade, toxins, tension pneumothorax and thrombosis), and post-arrest care after return of spontaneous circulation. These are teaching toggles only.",
  ],
  simplified: "Airway and breathing detail, compression depth and rate targets, drug doses and timing, rhythm checks, airway devices, mechanical CPR, extracorporeal CPR, individual reversible cause treatments, targeted temperature and other post-arrest care detail, and all prognostic scoring are left out. The ECG is a single schematic lead and the heart, brain and kidney are simple symbols. The figure does not say how any patient should be treated.",
  extraCss: `
.ar-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ac-grid{stroke:var(--anatomy-faint);stroke-width:.5;opacity:.35;fill:none}.ac-grid.major{opacity:.7}
.ar-trace{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round}
.ar-art{fill:none;stroke:var(--c-rbc);stroke-width:5;stroke-linecap:round;opacity:.75}
.ar-vein{fill:none;stroke:var(--c-fl);stroke-width:4;stroke-linecap:round;opacity:.6}
.ar-heart{fill:#d94f5c;stroke:#8f2432;stroke-width:1.4}
.ar-heartHi{fill:#f0838f;opacity:.7}
.ar-dark{fill:#3d363d}
.ar-brain{fill:#e9a2b3;stroke:#a85a72;stroke-width:1.2}
.ar-gyrus{fill:none;stroke:#a85a72;stroke-width:1.1;opacity:.7}
.ar-organ{fill:#c9788a;stroke:#8f4458;stroke-width:1.2}
.ar-pad{fill:#ffd24a;stroke:#9a7a14;stroke-width:1.2}
.ar-bolt{fill:#9a7a14}
.ar-wire{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.ar-hand{fill:#f0c8a0;stroke:#a87848;stroke-width:1.1}
.ar-chain{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.ar-chainOn{fill:var(--c-good);stroke:#1f7a4d;stroke-width:1.2}
.ar-chainLine{stroke:var(--anatomy-mid);stroke-width:2;fill:none}
.ar-cap{fill:var(--anatomy-text);font:9px var(--anatomy-mono);pointer-events:none}
.ar-token{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.ar-tokenOn{fill:#ffd24a;stroke:#9a7a14;stroke-width:1.4}
.ar-tokT{fill:var(--anatomy-strong);font:700 11px var(--anatomy-mono);pointer-events:none}
.ar-syrB{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.ar-syrF{fill:var(--c-bad);opacity:.75}
.ar-needle{stroke:var(--anatomy-strong);stroke-width:1.4}
.p-spark{--cc:#ffe27a}
`,
});
