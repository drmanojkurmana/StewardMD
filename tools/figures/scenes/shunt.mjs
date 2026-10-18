/* Congenital heart shunts as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/shunt.mjs [--print-model]
 * Static layout here; blood, shunt flow and gauges move in shunt.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ----------------
 * level: 0 ASD, 1 VSD, 2 PDA, 3 Eisenmenger, 4 Tetralogy of Fallot.
 * drug: 0 none, 1 close the defect, 2 prostaglandin to keep the duct open.
 * Shunt sign: positive is left to right, negative is right to left. */
const MD = {
  level: { label: "Defect or physiology", a: [0.35, 0.6, 0.7, 0.9, 0.85], names: ["ASD", "VSD", "PDA", "Eisenmenger", "Tetralogy"], ticks: ["ASD", "VSD", "PDA", "Eisenmenger", "Tetralogy"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "close the defect (repair)" },
    { label: "prostaglandin to keep duct open" },
  ],
  status: "Lesion: {level} · {drug} ·",
  drugNames: ["no treatment", "defect closed", "prostaglandin keeping duct open"],
};
function modelOf(S, level, drug) {
  const TAB = {
    defect: ["ASD", "VSD", "PDA", "VSD", "VSD"],
    shunt: [0.45, 0.65, 0.7, -0.7, -0.75],
    Qp: [0.66, 0.8, 0.84, 0.36, 0.3],
    Qs: [0.82, 0.8, 0.78, 0.62, 0.6],
    PAP: [0.3, 0.5, 0.55, 0.95, 0.3],
  };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const defect = TAB.defect[level];
  let shunt = TAB.shunt[level];
  let Qp = TAB.Qp[level];
  let Qs = TAB.Qs[level];
  let PAP = TAB.PAP[level];
  let obstruct = level === 4 ? 0.85 : 0;
  let ductOpen = level === 2 ? 0.9 : 0;
  let closed = 0;
  if (drug === 1) {
    if (level <= 2) { closed = 1; shunt = 0; Qp = 0.52; Qs = 0.85; PAP = [0.22, 0.28, 0.28][level]; ductOpen = 0; }
    else if (level === 3) { closed = 1; shunt = 0; Qp = 0.3; Qs = 0.34; PAP = 0.95; }
    else { closed = 1; shunt = 0; Qp = 0.55; Qs = 0.85; PAP = 0.28; obstruct = 0.08; }
  }
  if (drug === 2) {
    ductOpen = 1;
    if (level === 2) { shunt = 0.78; Qp = 0.88; PAP = 0.6; }
    if (level === 4) { Qp = 0.56; }
    if (level === 3) { Qp = 0.4; }
  }
  const mag = Math.abs(shunt);
  const cyan = cl(level >= 3 && drug !== 1 ? 0.25 + 0.65 * mag - (drug === 2 && level === 4 ? 0.35 : 0) : level === 3 && drug === 1 ? 0.45 : 0.06);
  const satArt = cl(1 - cyan);
  let satR = 0.3, satPA = 0.3;
  if (shunt > 0 && defect !== "PDA") { satR = cl(0.3 + 0.48 * mag); satPA = satR; }
  if (shunt > 0 && defect === "PDA") { satPA = cl(0.3 + 0.52 * mag); }
  if (drug === 2 && level === 4) { satPA = 0.42; }
  const satL = satArt;
  const rvLoad = cl(0.25 + 0.55 * PAP + (level === 4 ? 0.35 : 0) + (level === 3 && drug === 1 ? 0.25 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const dirW = shunt > 0.08 ? "left to right" : shunt < -0.08 ? "right to left" : "none";
  const flowW = w(Qp, 0.42, 0.68, ["low", "normal", "high"]);
  const satW = w(satArt, 0.6, 0.85, ["low", "reduced", "normal"]);
  const words = [dirW, flowW, satW];
  return { defect, level, shunt, mag, Qp: cl(Qp), Qs: cl(Qs), PAP: cl(PAP), obstruct, ductOpen, closed, cyan: cl(cyan), satArt: cl(satArt), satR: cl(satR), satPA: cl(satPA), satL: cl(satL), rvLoad: cl(rvLoad), words, readout: "shunt " + words[0] + " · pulmonary flow " + words[1] + " · saturation " + words[2] };
}
const TESTS = [
  [1, 0, "shunt left to right · pulmonary flow high · saturation normal"],
  [1, 1, "shunt none · pulmonary flow normal · saturation normal"],
  [3, 0, "shunt right to left · pulmonary flow low · saturation low"],
  [4, 2, "shunt right to left · pulmonary flow normal · saturation reduced"],
];

/* ---------------- static layout ----------------
 * Organ art is placed by shunt.page.js into the slots below; vessels are
 * redrawn there from the organ ports so blood meets real anatomy. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="vessels">
  <path id="vPA" class="sh-vessel sh-pa" d="M490 260L430 190L340 130"/>
  <path id="vPAb" class="sh-vessel sh-pa" d="M490 260L560 190L620 130"/>
  <path id="vPV" class="sh-vessel sh-oxy" d="M340 130L400 190L470 260"/>
  <path id="vPVb" class="sh-vessel sh-oxy" d="M620 130L560 190L470 260"/>
  <path id="vAo" class="sh-vessel sh-oxy" d="M490 200L500 140L520 64L600 62L700 62L700 380L580 413"/>
  <path id="vVein" class="sh-vessel sh-deoxy" d="M380 413L300 395L300 300L480 330"/>
  <path id="vDuct" class="sh-duct" d="M520 140L520 64"/>
  <path id="vASD" class="sh-shunt" d="M445 260L515 260"/>
  <path id="vVSD" class="sh-shunt" d="M445 320L515 320"/>
</g>
<g class="hot" tabindex="0" data-info="Body: uses oxygen from aorta blood and sends used blood back to the heart. Blue means blue blood is reaching the body.">
  <rect id="bodyRect" class="sh-body" x="380" y="398" width="200" height="30" rx="15"/>
</g>
<g id="lungSlot"></g>
<g id="heartSlot"></g>
<g id="flow"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "congenital-heart-shunts", fig: "Fig 1", title: "Congenital heart shunts: holes, duct and reversed flow", W, H, body,
  label: "An animated heart with lungs above and the body below. An atrial septal defect, ventricular septal defect or patent ductus arteriosus lets blood shunt left to right and overload the lungs. Raised lung pressure can reverse the shunt in Eisenmenger physiology, and tetralogy of Fallot shunts right to left past a narrowed lung outlet, causing blue colour. Vessel colours show oxygen level and moving dots show flow. Treatments shown are closing the defect and prostaglandin to keep the duct open.",
  caption: "Schematic, not to scale. Speeds, colours and gauge levels are qualitative and illustrative; no doses, sizes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "shunt.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With defect closed",
  sourcesLis: [
    "<strong>Left to right shunts.</strong> In an atrial septal defect, ventricular septal defect and patent ductus arteriosus, higher pressure on the left side drives oxygen rich blood back into the right heart or lung artery. Lung blood flow rises, the lungs and left heart are volume loaded, and over time lung vessel pressure can rise. This is standard teaching in paediatrics and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Reversal and tetralogy.</strong> In Eisenmenger physiology lung vessel resistance exceeds body resistance, the shunt reverses to right to left, and oxygen poor blood reaches the body, causing blue colour. Closing the defect then removes a pressure relief route and can harm. In tetralogy of Fallot a ventricular septal defect with a narrowed right ventricular outlet drives a right to left shunt and reduced lung flow; a duct kept open by prostaglandin can add lung flow as a temporary teaching concept. Definitive care is specialist and surgical, and this figure does not describe any patient care.",
    "<strong>Treatment ideas shown.</strong> Closing the defect for a simple left to right shunt, and prostaglandin only as the concept of keeping the ductus arteriosus open. No drug name beyond the class, dose or timing is shown.",
  ],
  simplified: "Defect size and location, pressure measurements, lung vessel resistance testing, associated lesions, endocarditis, heart failure staging, surgical and catheter techniques, prostaglandin indications in detail, and all doses are left out. Colours, counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sh-vessel{fill:none;stroke-linecap:round;stroke-linejoin:round}
.sh-oxy{stroke:var(--c-rbc);stroke-width:8}
.sh-deoxy{stroke:var(--c-cyt2);stroke-width:7}
.sh-pa{stroke:var(--c-cyt2);stroke-width:8}
.sh-duct{fill:none;stroke:#e8a13a;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
.sh-shunt{fill:none;stroke:var(--c-cyt);stroke-width:5;stroke-linecap:round;stroke-dasharray:7 5}
.sh-body{fill:#8fb8dd;stroke:var(--anatomy-mid);stroke-width:1.2}
.sh-cap{fill:var(--anatomy-strong);font-size:12px}
.sh-glow-patch{fill:var(--c-good)}
.sh-glow-pge{fill:#f2b84a}
.sh-strain{fill:var(--c-bad)}
.sh-lunghalo{fill:var(--c-fl)}
.sh-patch{fill:none;stroke:var(--c-good);stroke-width:9;stroke-linecap:round}
.sh-clamp{fill:none;stroke:var(--c-good);stroke-width:5;stroke-linecap:round}
.sh-sten{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.p-blood{stroke:color-mix(in srgb,#000 25%,transparent);stroke-width:.5}
.p-close{--cc:var(--c-good)}
.p-pge{--cc:#f2b84a}
.dr-g-fill.g-pulm{fill:var(--c-fl)}.dr-g-fill.g-press{fill:var(--c-neut)}
`,
});
