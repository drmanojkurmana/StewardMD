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
  level: { label: "Stage of transition", a: [0, 0.5, 1], names: ["fetal", "first breath", "after closure"], ticks: ["fetal", "first breath", "after closure"], start: 1 },
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

/* ---------------- static layout ----------------
 * Organ art is placed by fetalcirc.page.js into the slots below; vessels are
 * redrawn there from the organ ports so blood meets real anatomy. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="vessels">
  <path id="vUmb" class="fc-vessel fc-v-oxy" d="M213 362L260 355L324 364"/>
  <path id="vDV" class="fc-vessel fc-v-oxy" d="M330 297L380 320L440 350L457 359"/>
  <path id="vPA" class="fc-vessel fc-v-pa" d="M505 186L430 140L351 119"/>
  <path id="vPAb" class="fc-vessel fc-v-pa" d="M505 186L560 160L614 114"/>
  <path id="vPV" class="fc-vessel fc-v-oxy" d="M351 119L400 150L460 172"/>
  <path id="vPVb" class="fc-vessel fc-v-oxy" d="M614 114L560 150L460 172"/>
  <path id="vAo" class="fc-vessel fc-v-oxy" d="M487 172L505 110L520 72L600 70L690 70L690 360L715 372"/>
  <path id="vDuct" class="fc-duct" d="M512 178L530 140L538 105L542 71"/>
  <path id="vFO" class="fc-fo" d="M522 260L458 260"/>
  <path id="vRet" class="fc-vessel fc-v-deoxy" d="M700 398L600 415L520 395L480 375"/>
  <path id="vUmbArt" class="fc-vessel fc-v-deoxy" d="M720 398L560 408L400 410L280 402L205 388"/>
</g>
<g class="hot" tabindex="0" data-info="Placenta: gives oxygen rich blood to the baby through the cord vein, and takes used blood back.">
  <ellipse id="plac" class="fc-plac" cx="145" cy="372" rx="68" ry="34"/>
  <path class="fc-plac-t" d="M95 368Q115 356 135 366M125 380Q145 370 165 378M150 362Q168 354 186 362"/>
</g>
<g class="hot" tabindex="0" data-info="Body: uses oxygen from aorta blood and sends used blood back to the heart and placenta.">
  <rect id="bodyRect" class="fc-body" x="665" y="360" width="190" height="38" rx="16"/>
  <path class="fc-body-t" d="M700 372Q715 366 730 372M740 380Q755 374 770 380M790 372Q802 367 814 372"/>
</g>
<g id="liverSlot"></g>
<g id="heartSlot"></g>
<g id="lungSlot"></g>
<g id="flow"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "fetal-circulation-birth-transition", fig: "Fig 1", title: "Fetal circulation and the transition at birth", W, H, body,
  label: "An animated diagram of fetal circulation and what changes at birth. Oxygen rich blood comes from the placenta in the umbilical vein, passes through the ductus venosus to the right atrium, crosses the foramen ovale to the left heart and aorta, while right ventricular blood bypasses the high resistance lungs through the ductus arteriosus. At the first breath the lungs expand, pulmonary resistance falls, the foramen ovale and ductus close and umbilical flow stops. Gauges show lung flow, the ductus, the foramen and saturation, with treatments that keep the duct open or close it.",
  caption: "Schematic, not to scale. Speeds, colours and gauge levels are qualitative and illustrative; no doses, sizes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "fetalcirc.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With indomethacin",
  sourcesLis: [
    "<strong>Fetal circulation.</strong> Oxygen rich blood from the placenta travels in the umbilical vein. Much of it passes through the ductus venosus into the inferior vena cava and right atrium, then crosses the foramen ovale to the left atrium, left ventricle and aorta. Blood reaching the right ventricle and pulmonary artery mostly passes through the ductus arteriosus into the aorta, because the unexpanded lungs have high vascular resistance and receive little flow. Oxygen poor blood returns to the placenta in the umbilical arteries. This is standard teaching in physiology, paediatrics and neonatology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Transition at birth.</strong> With the first breaths the lungs expand, pulmonary vascular resistance falls and pulmonary blood flow and pulmonary vein return rise. Rising left atrial pressure presses the foramen ovale flap shut. The ductus arteriosus and ductus venosus constrict and close, and umbilical vessels constrict as placental flow ends, leaving the usual series circulation through the lungs. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Prostaglandin as the concept of keeping the ductus arteriosus open, and indomethacin as the concept of promoting duct closure. These are teaching toggles only; no indication, dose or timing is shown, and specialist care decides any real use.",
  ],
  simplified: "Preferential streaming in detail, brain and coronary sparing, pressure values, the timing of anatomical closure, cord clamping practice, persistent pulmonary hypertension, duct dependent lesions in detail, and all doses are left out. Colours, counts and speeds are illustrative, and the figure does not say how any baby should be treated.",
  extraCss: `
.fc-vessel{fill:none;stroke-linecap:round;stroke-linejoin:round}
.fc-v-oxy{stroke:var(--c-rbc);stroke-width:8}
.fc-v-deoxy{stroke:var(--c-cyt2);stroke-width:7}
.fc-v-pa{stroke:var(--c-cyt2);stroke-width:8}
.fc-duct{fill:none;stroke:#e8a13a;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
.fc-fo{fill:none;stroke:var(--c-cyt);stroke-width:5;stroke-linecap:round;stroke-dasharray:7 5}
.fc-plac{fill:color-mix(in srgb,var(--c-rbc) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.3}
.fc-plac-t{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1;opacity:.6}
.fc-body{fill:#8fb8dd;stroke:var(--anatomy-mid);stroke-width:1.2}
.fc-body-t{fill:none;stroke:var(--anatomy-mid);stroke-width:1;opacity:.7}
.fc-cap{fill:var(--anatomy-strong);font-size:12px}
.fc-glow-i{fill:var(--c-cyt)}
.fc-glow-p{fill:#f2b84a}
.fc-lunghalo{fill:var(--c-fl)}
.fc-strain{fill:var(--c-bad)}
.fc-clamp{fill:none;stroke:var(--c-cyt);stroke-width:5;stroke-linecap:round}
.p-blood{stroke:color-mix(in srgb,#000 25%,transparent);stroke-width:.5}
.p-indo{--cc:var(--c-cyt)}
.p-pge{--cc:#f2b84a}
.dr-g-fill.g-lung{fill:var(--c-fl)}.dr-g-fill.g-duct{fill:#e8a13a}.dr-g-fill.g-foram{fill:var(--c-cyt)}.dr-g-fill.g-sat{fill:var(--c-good)}
`,
});
