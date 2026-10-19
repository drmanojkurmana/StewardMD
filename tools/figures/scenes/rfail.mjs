/* Respiratory failure types as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/rfail.mjs [--print-model]
 * Static layout here; breath, gas particles and gauges move in rfail.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pattern of respiratory failure", a: [1, 1, 1], names: ["type 1 hypoxaemic", "type 2 hypercapnic", "mixed type 1 and type 2"], ticks: ["type 1", "type 2", "mixed"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "oxygen" },
    { label: "non-invasive ventilation" },
    { label: "invasive ventilation" },
  ],
  status: "Respiratory failure: {level} · {drug} ·",
  drugNames: ["no treatment", "oxygen", "non-invasive ventilation", "invasive ventilation"],
};
function modelOf(S, level, drug) {
  const GAS = [0.88, 0.22, 0.85];
  const PUMP = [0.18, 0.88, 0.85];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const G = GAS[level], Pf = PUMP[level];
  const ox = drug === 1 ? 1 : 0, niv = drug === 2 ? 1 : 0, inv = drug === 3 ? 1 : 0;
  const vent = niv ? 0.62 : inv ? 1 : 0;
  const V0 = cl(0.78 - 0.62 * Pf + 0.18 * G);
  const V = vent ? cl(Math.max(V0, V0 + (0.66 - V0) * vent)) : V0;
  const E = cl(1 - G + vent * 0.18);
  const O = cl((1 - 0.72 * G) * (0.42 + 0.58 * V) + (ox ? 0.30 * (1 - 0.45 * G) : 0) + vent * 0.18);
  const C = cl(0.5 + 0.68 * (0.55 - V) + 0.10 * G);
  const P = cl(0.5 - 0.72 * (C - 0.45));
  const Ef = cl(0.18 + 0.48 * G + 0.5 * Pf - vent * 0.42 - (ox ? 0.06 : 0));
  const Cross = cl(E * (0.35 + 0.65 * V) + (ox ? 0.22 * (1 - 0.4 * G) : 0) + vent * 0.1);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(O, 0.38, 0.68, ["low", "reduced", "normal"]), w(C, 0.38, 0.58, ["low", "normal", "high"]), w(P, 0.4, 0.6, ["acidosis", "near normal", "alkalosis"]), w(Ef, 0.35, 0.65, ["low", "raised", "high"])];
  return { G, Pf, ox, niv, inv, vent, V0, V, E, O, C, P, Ef, Cross, words, readout: "oxygen " + words[0] + " · CO2 " + words[1] + " · pH " + words[2] + " · effort " + words[3] };
}
const TESTS = [
  [0, 0, "oxygen low · CO2 normal · pH near normal · effort high"],
  [1, 1, "oxygen normal · CO2 high · pH acidosis · effort high"],
  [2, 0, "oxygen low · CO2 high · pH acidosis · effort high"],
  [2, 3, "oxygen reduced · CO2 normal · pH near normal · effort raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<g id="brainSlot"></g>
<g id="lungSlotL"></g>
<g id="lungSlotR"></g>
<ellipse id="washL" class="rf-wash" cx="345" cy="255" rx="80" ry="105" opacity="0"/>
<ellipse id="washR" class="rf-wash" cx="535" cy="255" rx="80" ry="105" opacity="0"/>
<ellipse id="duskL" class="rf-dusk" cx="345" cy="255" rx="80" ry="105" opacity="0"/>
<ellipse id="duskR" class="rf-dusk" cx="535" cy="255" rx="80" ry="105" opacity="0"/>
<ellipse id="chestWall" class="rf-chest" cx="440" cy="258" rx="195" ry="146"/>
<rect id="trachea" class="rf-tube hot" x="428" y="76" width="24" height="94" rx="10" tabindex="0" data-info="Trachea. Air travels down it on each breath. Added oxygen and ventilator flow travel the same way."/>
<path id="airflow" class="rf-flow" d="M440 84L440 168" opacity="0"/>
<path id="bronch" class="rf-bronch" d="M440 168L418 240M440 168L462 240"/>
<path id="signal" class="rf-sig" d="M120 217L220 300L320 348L440 360"/>
<g id="alvG"></g>
<path id="diaph" class="rf-diaph" d="M268 386Q440 348 612 386"/>
<g id="apparatus"></g>
<rect class="rf-zoom" x="648" y="76" width="284" height="250" rx="14"/>
<g id="zoomG"></g>
<rect class="rf-artbox" x="648" y="336" width="284" height="88" rx="14"/>
<rect id="artRed" class="rf-artred" x="666" y="370" width="248" height="30" rx="15" opacity="0"/>
<rect id="artVessel" class="rf-vessel hot" x="666" y="370" width="248" height="30" rx="15" tabindex="0" data-info="Arterial blood. Its colour and bubbles show oxygen and acid. Oxygen rises with treatment, acid clears when CO2 is blown off."/>
<g id="artG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "respiratory-failure-types", fig: "Fig 1", title: "Respiratory failure: type 1, type 2 and mixed", W, H, body,
  label: "An animated brain, airway, lungs and blood. Type 1 failure is a gas exchange problem: flooded or thick walled air sacs let too little oxygen into the blood while the breathing pump still works. Type 2 failure is a pump problem: weak drive or weak breathing muscles move too little air, so carbon dioxide builds up and the blood turns acidic. Mixed failure combines both. Treatment choices are oxygen, mask ventilation and invasive ventilation, with gauges for ventilation, gas exchange, oxygen, carbon dioxide, pH and breathing effort.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "rfail.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With invasive ventilation",
  sourcesLis: [
    "<strong>Type 1, hypoxaemic failure.</strong> Oxygen fails to reach the blood while ventilation is preserved. The usual mechanisms are ventilation perfusion mismatch, where some alveoli get blood but too little air, shunt, where blood passes alveoli that get no air at all, and a diffusion defect, where a thickened alveolar capillary membrane slows oxygen transfer. Because carbon dioxide is far more soluble and ventilation often rises in response to low oxygen, arterial carbon dioxide is normal or low. Causes sit mainly in the lung, such as pneumonia, pulmonary oedema, collapse and lung fibrosis. This is standard respiratory teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Type 2, hypercapnic failure.</strong> The ventilatory pump fails and alveolar ventilation falls, so carbon dioxide cannot be cleared and respiratory acidosis follows. The pump can fail at the drive (brainstem and sedative effects), the nerves and respiratory muscles (weakness and fatigue), the chest wall (restriction and deformity), or the airways (severe obstruction, where airflow cannot sustain ventilation). Mixed failure combines a lung gas exchange defect with pump failure. This is standard respiratory teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Oxygen raises inspired oxygen and helps hypoxaemia from mismatch or diffusion defect, less so from true shunt, and does not by itself clear carbon dioxide. Non-invasive ventilation supports the pump through a mask, raising alveolar ventilation so carbon dioxide falls, and can also improve oxygen. Invasive ventilation takes over the pump through a tube in the airway, giving the most control of ventilation and oxygen. These are teaching toggles only.",
  ],
  simplified: "Renal compensation for chronic acidosis, the alveolar arterial gradient, oxygen targets and controlled oxygen, recruitment and positive end expiratory pressure, high flow oxygen, treating each underlying cause, blood gas sampling, and all doses, pressures and targets are left out. Chronic type 2 failure with compensated pH is not separated from acute failure. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-o2:#5fd0f5;--c-co2:#9aa3ad;--c-acid:#f0883a;--c-vent:#b27af0;--c-drive:#b7a1e6}
body[data-theme="light"]{--c-o2:#0a7fd1;--c-co2:#6e7885;--c-acid:#d96a1e;--c-vent:#8b4fd8;--c-drive:#8f72d0}
.rf-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.rf-chest{fill:color-mix(in srgb,var(--c-o2) 6%,transparent);stroke:var(--c-o2);stroke-width:1.4;stroke-dasharray:5 4}
.rf-tube{fill:color-mix(in srgb,var(--c-o2) 22%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.rf-flow{fill:none;stroke:var(--c-o2);stroke-width:16;stroke-linecap:round;opacity:.25}
.rf-bronch{fill:none;stroke:var(--anatomy-mid);stroke-width:9;stroke-linecap:round}
.rf-sig{fill:none;stroke:var(--c-drive);stroke-width:2.4;stroke-linecap:round;stroke-dasharray:7 6;opacity:.7}
.rf-wash{fill:var(--c-o2);stroke:none;opacity:0}
.rf-dusk{fill:color-mix(in srgb,#3a4a6b 55%,var(--c-rbc));stroke:none;opacity:0}
.rf-diaph{fill:none;stroke:var(--c-vent);stroke-width:9;stroke-linecap:round}
.rf-alv{fill:color-mix(in srgb,var(--c-o2) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-o2) 70%,#000);stroke-width:1.3}
.rf-alv-bad{fill:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 70%,#000);stroke-width:1.3}
.rf-zoom{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.rf-bigalv{fill:color-mix(in srgb,var(--c-o2) 24%,var(--anatomy-paper));stroke:var(--c-o2);stroke-width:1.6}
.rf-memb{fill:none;stroke:var(--c-fl);stroke-linecap:round}
.rf-capv{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.rf-artbox{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.rf-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.rf-artred{fill:var(--c-rbc);stroke:none}
.rf-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.rf-bel{fill:color-mix(in srgb,var(--c-vent) 45%,var(--anatomy-paper));stroke:var(--c-vent);stroke-width:1.4}
.rf-hose{fill:none;stroke:var(--c-vent);stroke-width:7;stroke-linecap:round;opacity:.8}
.rf-cyl{fill:color-mix(in srgb,var(--c-o2) 38%,var(--anatomy-paper));stroke:#2e9cc4;stroke-width:1.3}
.rf-mask{fill:color-mix(in srgb,var(--c-vent) 38%,var(--anatomy-paper));stroke:var(--c-vent);stroke-width:1.4}
.rf-vtube{fill:color-mix(in srgb,var(--c-vent) 30%,var(--anatomy-paper));stroke:var(--c-vent);stroke-width:1.2}
.rf-sigp{fill:var(--c-drive);stroke:none}
.p-o2{--cc:var(--c-o2)}.p-co2{--cc:var(--c-co2)}.p-acid{--cc:var(--c-acid)}.p-air{--cc:#ffd76a}.p-sig{--cc:var(--c-drive)}
.dr-g-fill.g-vent{fill:var(--c-vent)}.dr-g-fill.g-exch{fill:var(--c-fl)}.dr-g-fill.g-o2{fill:var(--c-o2)}.dr-g-fill.g-co2g{fill:var(--c-co2)}.dr-g-fill.g-ph{fill:var(--c-acid)}.dr-g-fill.g-eff{fill:var(--c-drive)}
`,
});
