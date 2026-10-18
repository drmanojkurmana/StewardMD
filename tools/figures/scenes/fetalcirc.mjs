/* Fetal circulation and the birth transition as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/fetalcirc.mjs [--print-model]
 * Static layout here; blood, shunts and gauges move in fetalcirc.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ----------------
 * level: 0 fetal, 1 first breath, 2 after closure.
 * drug: 0 none, 1 prostaglandin to keep the duct open, 2 indomethacin to close the duct. */
const MD = {
  level: { label: "Stage of transition", a: [0, 0.5, 1], names: ["fetal", "first breath", "after closure"], ticks: ["fetal", "first breath", "after closure"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "prostaglandin to keep duct open" },
    { label: "indomethacin to close duct" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "prostaglandin keeping duct open", "indomethacin closing duct"],
};
function modelOf(S, level, drug) {
  const TAB = {
    resist: [0.92, 0.48, 0.2],
    lung: [0.16, 0.62, 0.9],
    foramen: [0.9, 0.32, 0.06],
    ductBase: [0.92, 0.58, 0.08],
    umbil: [0.95, 0.3, 0.04],
    dv: [0.9, 0.35, 0.05],
    satBase: [0.66, 0.84, 0.96],
  };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  let duct = TAB.ductBase[level];
  if (drug === 1) duct = Math.max(duct, 0.86);
  if (drug === 2) duct = Math.min(duct, level === 0 ? 0.4 : level === 1 ? 0.18 : 0.03);
  const lung = cl(TAB.lung[level] + (drug === 1 && level === 2 ? 0.06 : 0));
  const resist = TAB.resist[level];
  const foramen = TAB.foramen[level];
  const umbil = TAB.umbil[level];
  const dv = TAB.dv[level];
  let satArt = TAB.satBase[level];
  if (drug === 1 && level === 2) satArt -= 0.08;
  if (drug === 1 && level === 1) satArt -= 0.04;
  if (drug === 2 && level === 0) satArt -= 0.06;
  satArt = cl(satArt);
  const satRA = cl(0.28 + 0.42 * umbil + 0.18 * (1 - resist) * 0.4 + (level === 2 ? 0.08 : 0));
  const satLA = cl(satArt + 0.04);
  const satPA = cl(0.3 + 0.12 * (1 - resist));
  const rvLoad = cl(0.3 + 0.55 * resist + (drug === 2 && level === 0 ? 0.3 : 0) - (drug === 1 && level === 0 ? 0.05 : 0));
  const lungW = w(lung, 0.35, 0.7, ["low", "rising", "high"]);
  const ductW = w(duct, 0.25, 0.65, ["closed", "closing", "open"]);
  const foramW = w(foramen, 0.25, 0.65, ["closed", "closing", "open"]);
  const satW = w(satArt, 0.75, 0.9, ["mixed", "improving", "normal"]);
  const words = [lungW, ductW, foramW, satW];
  return { lung: cl(lung), resist: cl(resist), duct: cl(duct), foramen: cl(foramen), umbil: cl(umbil), dv: cl(dv), satArt, satRA, satLA: cl(satLA), satPA, rvLoad, words, readout: "lung flow " + words[0] + " · ductus " + words[1] + " · foramen " + words[2] + " · saturation " + words[3] };
}
const TESTS = [
  [0, 0, "lung flow low · ductus open · foramen open · saturation mixed"],
  [2, 0, "lung flow high · ductus closed · foramen closed · saturation normal"],
  [2, 1, "lung flow high · ductus open · foramen closed · saturation improving"],
  [0, 2, "lung flow low · ductus closing · foramen open · saturation mixed"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="fc-zone" x="34" y="68">CIRCULATION</text>
<g id="vessels">
  <path id="vUmbArt" class="fc-vessel fc-v-deoxy" d="M665 390L450 425L230 400L195 385"/>
  <path id="vVein" class="fc-vessel fc-v-deoxy" d="M665 390L580 418L540 360L535 330"/>
  <path id="vUmb" class="fc-vessel fc-v-oxy" d="M195 350L285 335"/>
  <path id="vDV" class="fc-vessel fc-v-oxy" d="M285 335L360 325L430 300L500 275L535 248"/>
  <path id="vPA" class="fc-vessel fc-v-pa" d="M550 285L580 190L585 140L430 115"/>
  <path id="vPAb" class="fc-vessel fc-v-pa" d="M585 140L598 128"/>
  <path id="vPV" class="fc-vessel fc-v-oxy" d="M390 135L420 175L438 197M570 135L512 172L472 197"/>
  <path id="vAo" class="fc-vessel fc-v-oxy" d="M405 325L368 290L365 165L365 70L690 70L690 360"/>
  <path id="vDuct" class="fc-duct" d="M585 135L560 105L525 72"/>
</g>
<g id="nodes">
  <g class="hot" tabindex="0" data-info="Lungs: collapsed and high resistance before birth, so little blood flows through them. At the first breath they expand, resistance falls and pulmonary flow rises.">
    <ellipse id="lungL" class="fc-lung" cx="365" cy="108" rx="58" ry="32"/>
    <ellipse id="lungR" class="fc-lung" cx="595" cy="108" rx="58" ry="32"/>
    <text class="fc-cap" x="365" y="112" text-anchor="middle">LUNG</text>
    <text class="fc-cap" x="595" y="112" text-anchor="middle">LUNG</text>
  </g>
  <g class="hot" tabindex="0" data-info="Placenta: the source of oxygen rich blood before birth. Blood leaves it in the umbilical vein and returns, oxygen poor, in the umbilical arteries. After birth the cord vessels constrict and this flow stops.">
    <ellipse id="plac" class="fc-plac" cx="145" cy="372" rx="68" ry="34"/>
    <text class="fc-cap" x="145" y="376" text-anchor="middle">PLACENTA</text>
  </g>
  <g class="hot" tabindex="0" data-info="Liver and ductus venosus: much umbilical vein blood passes through the ductus venosus, a channel past the liver, straight into the inferior vena cava toward the right atrium. It closes after birth.">
    <rect class="fc-liver" x="285" y="312" width="92" height="38" rx="12"/>
    <text class="fc-cap" x="331" y="335" text-anchor="middle">LIVER</text>
  </g>
  <g class="hot" tabindex="0" data-info="Body tissues: receive blood from the aorta and return oxygen poor blood to the right atrium. Colour here follows arterial saturation.">
    <rect id="bodyRect" class="fc-body" x="665" y="360" width="190" height="38" rx="16"/>
    <text class="fc-cap" x="760" y="383" text-anchor="middle">BODY</text>
  </g>
</g>
<g id="heart">
  <rect class="fc-outer" x="385" y="185" width="200" height="175" rx="20"/>
  <rect class="fc-sept" x="480" y="197" width="12" height="152"/>
  <rect class="fc-sept" x="397" y="269" width="178" height="10"/>
  <g class="hot" tabindex="0" data-info="Left atrium: before birth it receives mainly blood that crossed the foramen ovale. After the lungs expand, pulmonary vein return rises, left atrial pressure rises and the foramen flap is pressed shut."><rect id="chLA" class="fc-ch" x="397" y="197" width="83" height="72" rx="10"/><text class="fc-chlab" x="438" y="217" text-anchor="middle">Left atrium</text><text id="satLA" class="fc-sat" x="438" y="233" text-anchor="middle">mixed</text></g>
  <g class="hot" tabindex="0" data-info="Right atrium: receives oxygen rich umbilical blood from below and oxygen poor body blood. Before birth most of its stream is directed across the foramen ovale to the left atrium."><rect id="chRA" class="fc-ch" x="492" y="197" width="83" height="72" rx="10"/><text class="fc-chlab" x="533" y="217" text-anchor="middle">Right atrium</text><text id="satRA" class="fc-sat" x="533" y="233" text-anchor="middle">mixed</text></g>
  <g class="hot" tabindex="0" data-info="Left ventricle: pumps blood into the aorta to the body and brain. Before birth this is mainly blood that crossed the foramen ovale."><rect id="chLV" class="fc-ch" x="397" y="279" width="83" height="72" rx="10"/><text class="fc-chlab" x="438" y="299" text-anchor="middle">Left ventricle</text><text id="satLV" class="fc-sat" x="438" y="315" text-anchor="middle">mixed</text></g>
  <g class="hot" tabindex="0" data-info="Right ventricle: pumps blood into the pulmonary artery. Before birth high lung resistance diverts most of it through the ductus arteriosus into the aorta, bypassing the lungs."><rect id="chRV" class="fc-ch" x="492" y="279" width="83" height="72" rx="10"/><text class="fc-chlab" x="533" y="299" text-anchor="middle">Right ventricle</text><text id="satRV" class="fc-sat" x="533" y="315" text-anchor="middle">oxygen poor</text></g>
  <g id="defFO"><rect class="fc-hole" x="480" y="220" width="12" height="22" rx="5"/></g>
</g>
<g id="flow"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "fetal-circulation-birth-transition", fig: "Fig 1", title: "Fetal circulation and the transition at birth", W, H, body,
  label: "An animated diagram of fetal circulation and what changes at birth. Oxygen rich blood comes from the placenta in the umbilical vein, passes through the ductus venosus to the right atrium, crosses the foramen ovale to the left heart and aorta, while right ventricular blood bypasses the high resistance lungs through the ductus arteriosus. At the first breath the lungs expand, pulmonary resistance falls, the foramen ovale and ductus close and umbilical flow stops. Gauges show lung flow, the ductus, the foramen and saturation, with treatments that keep the duct open or close it.",
  caption: "Schematic, not to scale. Speeds, colours and gauge levels are qualitative and illustrative; no doses, sizes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "fetalcirc.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Fetal circulation.</strong> Oxygen rich blood from the placenta travels in the umbilical vein. Much of it passes through the ductus venosus into the inferior vena cava and right atrium, then crosses the foramen ovale to the left atrium, left ventricle and aorta. Blood reaching the right ventricle and pulmonary artery mostly passes through the ductus arteriosus into the aorta, because the unexpanded lungs have high vascular resistance and receive little flow. Oxygen poor blood returns to the placenta in the umbilical arteries. This is standard teaching in physiology, paediatrics and neonatology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Transition at birth.</strong> With the first breaths the lungs expand, pulmonary vascular resistance falls and pulmonary blood flow and pulmonary vein return rise. Rising left atrial pressure presses the foramen ovale flap shut. The ductus arteriosus and ductus venosus constrict and close, and umbilical vessels constrict as placental flow ends, leaving the usual series circulation through the lungs. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Prostaglandin as the concept of keeping the ductus arteriosus open, and indomethacin as the concept of promoting duct closure. These are teaching toggles only; no indication, dose or timing is shown, and specialist care decides any real use.",
  ],
  simplified: "Preferential streaming in detail, brain and coronary sparing, pressure values, the timing of anatomical closure, cord clamping practice, persistent pulmonary hypertension, duct dependent lesions in detail, and all doses are left out. Colours, counts and speeds are illustrative, and the figure does not say how any baby should be treated.",
  extraCss: `
.fc-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.fc-cap{fill:var(--anatomy-strong);font-size:10px;font-weight:600;pointer-events:none}
.fc-chlab{fill:var(--anatomy-strong);font-size:10px;font-weight:600;pointer-events:none}
.fc-sat{fill:var(--anatomy-text);font-size:9px;pointer-events:none;opacity:.85}
.fc-lung{fill:color-mix(in srgb,var(--c-fl) 32%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.fc-plac{fill:color-mix(in srgb,var(--c-rbc) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.3}
.fc-liver{fill:color-mix(in srgb,var(--c-eos) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-eos) 60%,#000);stroke-width:1.2}
.fc-body{fill:#8fb8dd;stroke:var(--anatomy-mid);stroke-width:1.2}
.fc-outer{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.fc-sept{fill:color-mix(in srgb,var(--c-rbc) 32%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:.8}
.fc-ch{fill:color-mix(in srgb,var(--c-rbc) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--anatomy-strong) 35%,#000);stroke-width:1}
.fc-hole{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:3 2}
.fc-vessel{fill:none;stroke-linecap:round;stroke-linejoin:round}
.fc-v-oxy{stroke:var(--c-rbc);stroke-width:8}
.fc-v-deoxy{stroke:var(--c-cyt2);stroke-width:7}
.fc-v-pa{stroke:var(--c-cyt2);stroke-width:8}
.fc-duct{fill:none;stroke:#e8a13a;stroke-width:7;stroke-linecap:round}
.p-blood{stroke:color-mix(in srgb,#000 25%,transparent);stroke-width:.5}
.dr-g-fill.g-lung{fill:var(--c-fl)}.dr-g-fill.g-duct{fill:#e8a13a}.dr-g-fill.g-foram{fill:var(--c-cyt)}.dr-g-fill.g-sat{fill:var(--c-good)}
`,
});
