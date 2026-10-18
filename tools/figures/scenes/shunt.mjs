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
  const cl = (v) => Math.max(0, Math.min(1, v));
  const defect = ["ASD", "VSD", "PDA", "VSD", "VSD"][level];
  let shunt = [0.45, 0.65, 0.7, -0.7, -0.75][level];
  let Qp = [0.66, 0.8, 0.84, 0.36, 0.3][level];
  let Qs = [0.82, 0.8, 0.78, 0.62, 0.6][level];
  let PAP = [0.3, 0.5, 0.55, 0.95, 0.3][level];
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
  [0, 0, "shunt left to right · pulmonary flow normal · saturation normal"],
  [1, 0, "shunt left to right · pulmonary flow high · saturation normal"],
  [3, 0, "shunt right to left · pulmonary flow low · saturation low"],
  [4, 2, "shunt right to left · pulmonary flow normal · saturation reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CIRCULATION</text>
<g id="vessels"></g>
<g id="lungs">
  <g class="hot" tabindex="0" data-info="Lungs: blood picks up oxygen here. Extra left to right shunt flow overloads the lungs; too little flow leaves blood poorly oxygenated.">
    <ellipse class="sh-lung" cx="390" cy="108" rx="64" ry="34"/><ellipse class="sh-lung" cx="570" cy="108" rx="64" ry="34"/>
    <text class="sc-lab" x="390" y="112" text-anchor="middle">LUNG</text><text class="sc-lab" x="570" y="112" text-anchor="middle">LUNG</text>
  </g>
</g>
<g id="heart">
  <rect class="sh-outer" x="340" y="190" width="280" height="200" rx="22"/>
  <rect class="sh-septum" x="468" y="202" width="24" height="184"/>
  <rect class="sh-septum" x="352" y="290" width="256" height="8"/>
  <g class="hot" tabindex="0" data-info="Left atrium: receives oxygen rich blood from the lungs. In a right to left shunt its blood mixes with oxygen poor blood and saturation falls."><rect id="chLA" class="sh-ch" x="352" y="202" width="116" height="88" rx="12"/><text class="sh-chlab" x="415" y="222" text-anchor="middle">Left atrium</text><text id="satLA" class="sh-sat" x="415" y="238" text-anchor="middle">oxygen rich</text></g>
  <g class="hot" tabindex="0" data-info="Right atrium: receives oxygen poor blood from the body. An atrial septal defect lets oxygen rich blood cross into it from the left."><rect id="chRA" class="sh-ch" x="492" y="202" width="116" height="88" rx="12"/><text class="sh-chlab" x="540" y="222" text-anchor="middle">Right atrium</text><text id="satRA" class="sh-sat" x="540" y="238" text-anchor="middle">oxygen poor</text></g>
  <g class="hot" tabindex="0" data-info="Left ventricle: pumps oxygen rich blood into the aorta to the body. A ventricular septal defect connects it to the right ventricle."><rect id="chLV" class="sh-ch" x="352" y="298" width="116" height="88" rx="12"/><text class="sh-chlab" x="415" y="318" text-anchor="middle">Left ventricle</text><text id="satLV" class="sh-sat" x="415" y="334" text-anchor="middle">oxygen rich</text></g>
  <g class="hot" tabindex="0" data-info="Right ventricle: pumps oxygen poor blood to the lungs. It thickens when pulmonary pressure is high or its outlet is narrowed, as in tetralogy."><rect id="chRV" class="sh-ch" x="492" y="298" width="116" height="88" rx="12"/><text class="sh-chlab" x="540" y="318" text-anchor="middle">Right ventricle</text><text id="satRV" class="sh-sat" x="540" y="334" text-anchor="middle">oxygen poor</text></g>
  <g id="defASD"><rect class="sh-hole" x="468" y="255" width="24" height="22" rx="6"/></g>
  <g id="defVSD"><rect class="sh-hole" x="468" y="351" width="24" height="22" rx="6"/></g>
</g>
<g id="bodybox">
  <g class="hot" tabindex="0" data-info="Body tissues: use oxygen and return oxygen poor blood to the right atrium. Blue colour here means cyanosis from a right to left shunt.">
    <rect id="bodyRect" class="sh-body" x="350" y="398" width="280" height="30" rx="15"/><text class="sh-chlab" x="490" y="412" text-anchor="middle">BODY</text>
  </g>
</g>
<g id="flow"></g><g id="shuntflow"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "congenital-heart-shunts", fig: "Fig 1", title: "Congenital heart shunts: holes, duct and reversed flow", W, H, body,
  label: "An animated heart with four chambers, lungs above and the body below. An atrial septal defect, ventricular septal defect or patent ductus arteriosus lets blood shunt left to right and overload the lungs. Raised pulmonary pressure can reverse the shunt in Eisenmenger physiology, and tetralogy of Fallot shunts right to left past a narrowed pulmonary outlet, causing cyanosis. Chamber colours show oxygen saturation and arrows show flow. Treatments shown are closing the defect and prostaglandin to keep the duct open.",
  caption: "Schematic, not to scale. Speeds, colours and gauge levels are qualitative and illustrative; no doses, sizes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "shunt.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Left to right shunts.</strong> In an atrial septal defect, ventricular septal defect and patent ductus arteriosus, higher pressure on the left side drives oxygen rich blood back into the right heart or pulmonary artery. Pulmonary blood flow rises, the lungs and left heart are volume loaded, and over time pulmonary vascular pressure can rise. This is standard teaching in paediatrics and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Reversal and tetralogy.</strong> In Eisenmenger physiology pulmonary vascular resistance exceeds systemic resistance, the shunt reverses to right to left, and oxygen poor blood reaches the body, causing cyanosis. Closing the defect then removes a pressure relief route and can harm. In tetralogy of Fallot a ventricular septal defect with a narrowed right ventricular outlet drives a right to left shunt and reduced pulmonary flow; a duct kept open by prostaglandin can add pulmonary flow as a temporary teaching concept. Definitive care is specialist and surgical, and this figure does not describe any patient care.",
    "<strong>Treatment ideas shown.</strong> Closing the defect for a simple left to right shunt, and prostaglandin only as the concept of keeping the ductus arteriosus open. No drug name beyond the class, dose or timing is shown.",
  ],
  simplified: "Defect size and location, pressure measurements, pulmonary vascular resistance testing, associated lesions, endocarditis, heart failure staging, surgical and catheter techniques, prostaglandin indications in detail, and all doses are left out. Colours, counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sh-outer{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.sh-septum{fill:color-mix(in srgb,var(--c-rbc) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.8}
.sh-ch{stroke:color-mix(in srgb,var(--anatomy-strong) 35%,#000);stroke-width:1}
.sh-chlab{fill:var(--anatomy-strong);font:600 10.5px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none}
.sh-sat{fill:var(--anatomy-text);font:9px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none;opacity:.85}
.dr-fig text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.sh-lung{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.sh-body{fill:#8fb8dd;stroke:var(--anatomy-mid);stroke-width:1.2}
.sh-hole{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:3 2}
.sh-vessel{fill:none;stroke-linecap:round;stroke-linejoin:round}
.sh-duct{fill:none;stroke:#e8a13a;stroke-width:7;stroke-linecap:round}
.sh-sten{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.sh-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.sh-xx{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.sh-note{fill:var(--c-bad);font:600 10px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none}
.p-blood{stroke:color-mix(in srgb,#000 25%,transparent);stroke-width:.5}
.dr-g-fill.g-pulm{fill:var(--c-fl)}.dr-g-fill.g-press{fill:var(--c-neut)}
`,
});
