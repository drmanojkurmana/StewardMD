/* Neonatal respiratory distress syndrome as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/nrds.mjs [--print-model]
 * Static layout here; surfactant, collapse and gauges move in nrds.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Gestation at birth", a: [0.12, 0.45, 0.92], names: ["very preterm", "preterm", "near term"], ticks: ["very preterm", "preterm", "near term"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antenatal steroid (before birth)" },
    { label: "surfactant (after birth)" },
    { label: "CPAP (airway pressure support)" },
  ],
  status: "Gestation: {level} · {drug} ·",
  drugNames: ["no treatment", "antenatal steroid", "surfactant", "CPAP"],
};
function modelOf(S, level, drug) {
  const gestSurf = [0.12, 0.45, 0.92][level];
  const sterBoost = [0.34, 0.26, 0.04][level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ster = drug === 1 ? 1 : 0, surfTx = drug === 2 ? 1 : 0, cpap = drug === 3 ? 1 : 0;
  const Prod = cl(gestSurf + ster * sterBoost);
  const Surf = cl(Prod + (surfTx ? 0.78 : 0));
  const Tension = cl(1 - 0.92 * Surf);
  const Collapse = cl(0.92 * Tension - 0.42 * cpap);
  const Hyal = cl(0.62 * Collapse + 0.3 * Tension - 0.1 * ster - 0.12 * surfTx);
  const Haze = cl(0.58 * Collapse + 0.42 * Hyal);
  const Edema = cl(0.45 * Hyal + 0.3 * Collapse);
  const Ox = cl(0.97 - 0.82 * Collapse - 0.18 * Hyal + 0.03 * cpap);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Surf, 0.3, 0.68, ["low", "some", "good"]), w(Collapse, 0.3, 0.62, ["little", "some", "marked"]), w(Ox, 0.3, 0.62, ["very low", "low", "near normal"]), w(Hyal, 0.28, 0.58, ["few", "some", "many"])];
  return { gestSurf, ster, surfTx, cpap, Prod, Surf, Tension, Collapse, Hyal, Haze, Edema, Ox, words, readout: "surfactant " + words[0] + " · collapse " + words[1] + " · oxygen " + words[2] + " · hyaline membranes " + words[3] };
}
const TESTS = [
  [0, 0, "surfactant low · collapse marked · oxygen very low · hyaline membranes many"],
  [0, 2, "surfactant good · collapse little · oxygen near normal · hyaline membranes few"],
  [0, 3, "surfactant low · collapse some · oxygen low · hyaline membranes some"],
  [2, 0, "surfactant good · collapse little · oxygen near normal · hyaline membranes few"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="362" rx="18"/>
<text class="sc-zone" x="34" y="68">AIR SAC, BLOOD VESSEL AND CHEST FILM</text>
<ellipse id="surfGlow" class="nrds-surfglow" cx="460" cy="222" rx="152" ry="108" opacity="0"/>
<ellipse id="cpapGlow" class="nrds-cpapglow" cx="512" cy="150" rx="92" ry="82" opacity="0"/>
<rect id="airway" class="nrds-airway" x="552" y="66" width="26" height="76" rx="10"/>
<ellipse class="nrds-alv-out" cx="460" cy="222" rx="152" ry="108"/>
<ellipse id="alvAir" class="nrds-alv-air" cx="460" cy="222" rx="132" ry="88"/>
<ellipse id="hyal" class="nrds-hyal" cx="460" cy="222" rx="124" ry="81"/>
<ellipse id="fluidEl" class="nrds-fluid" cx="460" cy="282" rx="104" ry="30"/>
<g id="tensionArrows">
  <path class="nrds-tension" d="M368 160L396 182M552 160L524 182M368 284L396 262M552 284L524 262"/>
</g>
<circle id="sterGlow" class="nrds-sterglow" cx="565" cy="288" r="46" opacity="0"/>
<rect class="nrds-cap" x="302" y="332" width="318" height="32" rx="16"/>
<path id="sterVessel" class="nrds-stervessel" d="M138 348L302 348"/>
<circle id="sterNode" class="nrds-node" cx="110" cy="348" r="28"/>
<rect class="nrds-chest" x="702" y="76" width="218" height="178" rx="14"/>
<g id="lungSlot"></g>
<ellipse id="hazeEl" class="nrds-haze" cx="811" cy="168" rx="50" ry="60"/>
<path class="nrds-rib" d="M742 120Q811 138 880 120M742 168Q811 186 880 168M742 216Q811 234 880 216"/>
<g id="surfG"></g>
<g id="cellsG"></g>
<g id="rbcsG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-type2:#3ddc97;--c-surf:#3ddc97;--c-haze:#c9d4e8;--c-hyal:#e8d36a}
body[data-theme="light"]{--c-type2:#0f9f76;--c-surf:#0f9f76;--c-haze:#8fa3c4;--c-hyal:#bfa12e}
.cl-type2{--cc:var(--c-type2)}
.nrds-node{fill:color-mix(in srgb,#ff9a3d 30%,var(--anatomy-paper));stroke:#ff9a3d;stroke-width:1.6}
.nrds-stervessel{fill:none;stroke:var(--c-fl);stroke-width:4;stroke-linecap:round;opacity:.55}
.nrds-surfglow{fill:var(--c-surf);stroke:none}
.nrds-cpapglow{fill:var(--c-fl);stroke:none}
.nrds-sterglow{fill:#ff9a3d;stroke:none}
.nrds-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.nrds-chest{fill:color-mix(in srgb,var(--anatomy-mid) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.nrds-haze{fill:var(--c-haze);opacity:0}
.nrds-rib{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;opacity:.55}
.nrds-airway{fill:color-mix(in srgb,var(--c-fl) 22%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.nrds-alv-out{fill:color-mix(in srgb,var(--c-endo) 20%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.5}
.nrds-alv-air{fill:color-mix(in srgb,#7fc4e8 16%,var(--anatomy-paper));stroke:color-mix(in srgb,#7fc4e8 60%,#000);stroke-width:1.2}
.nrds-hyal{fill:none;stroke:var(--c-hyal);stroke-width:6;stroke-dasharray:10 5;opacity:0}
.nrds-fluid{fill:var(--c-fl);opacity:0}
.nrds-tension{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round;opacity:.8}
.nrds-cap{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.nrds-surf{fill:var(--c-surf);stroke:color-mix(in srgb,var(--c-surf) 55%,#000);stroke-width:.5}
.nrds-lam{fill:color-mix(in srgb,var(--c-surf) 65%,#fff);stroke:color-mix(in srgb,var(--c-surf) 55%,#000);stroke-width:.5}
.p-oxy{--cc:#7fc4e8}.p-surfTx{--cc:var(--c-surf)}.p-ster{--cc:#ff9a3d}.p-cpap{--cc:var(--c-fl)}
.dr-g-fill.g-surf{fill:var(--c-surf)}.dr-g-fill.g-tens{fill:var(--c-bad)}.dr-g-fill.g-coll{fill:#8f6fc8}.dr-g-fill.g-hyal{fill:var(--c-hyal)}.dr-g-fill.g-haze{fill:var(--c-haze)}.dr-g-fill.g-oxy{fill:var(--c-good)}
`;

buildScene({
  id: "neonatal-respiratory-distress-surfactant", fig: "Fig 1", title: "Neonatal respiratory distress: surfactant and collapse", W, H, body, extraCss,
  label: "An animated alveolus, capillary and chest film in neonatal respiratory distress syndrome. A preterm baby has immature type II pneumocytes that make too little surfactant. Without surfactant the alveolar surface tension stays high, alveoli collapse at the end of each breath, injured epithelium and protein rich fluid form hyaline membranes, and the chest film looks hazy with a ground glass pattern. Blood passing collapsed alveoli stays low in oxygen. Antenatal steroid matures the type II cells, surfactant replaces what is missing, and CPAP holds alveoli open. Gauges show surfactant, tension, collapse, hyaline membranes, chest haze and oxygen.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "nrds.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With surfactant",
  sourcesLis: [
    "<strong>How neonatal respiratory distress develops.</strong> In a preterm baby the pulmonary type II alveolar epithelial cells are immature, so surfactant production is low. Surfactant normally lowers surface tension at the air and fluid interface in the alveolus; without it tension stays high and the alveolus collapses into the interstitial space around it, a pattern called atelectasis. Repeated collapse injures the epithelium, protein rich edema fluid leaks in, and hyaline membranes form from that exudate and dead epithelial cells, lining the alveolar wall. Collapsed units still receive vascular blood flow, so that blood reaches the circulation low in oxygen and severe disease gives hypoxemia and hypoxia despite added oxygen. The chest film is usually bilateral and hazy with a ground glass pattern and small lung volumes. The early phase can recover as type II cells mature and proliferate in a proliferative repair phase; very preterm babies may instead go on to chronic changes. This is standard teaching in neonatal and respiratory medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antenatal steroid, given before a preterm birth, speeds type II cell maturation and surfactant production. Surfactant given after birth replaces the missing lining layer and lowers tension. CPAP, continuous positive airway pressure, holds alveoli open at the end of the breath and reduces collapse while the baby makes more surfactant; mechanical ventilation is sometimes needed in severe disease but is not drawn as a separate toggle here. These are teaching toggles only and show direction of effect, not how any baby should be treated.",
  ],
  simplified: "Grading by gestation in detail, blood gas values and oxygen targets, ventilator and CPAP settings, repeat surfactant, antibiotics for infection that can mimic this picture, patent ductus and other vascular problems, and later chronic lung disease with fibrotic change are left out. The initial assessment criteria used at the bedside are not shown. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
