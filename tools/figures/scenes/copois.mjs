/* Carbon monoxide poisoning as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/copois.mjs [--print-model]
 * Static layout here; gases, red cells, curve, brain, mitochondrion and gauges move in copois.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How much carbon monoxide was breathed in", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "high flow oxygen" },
    { label: "hyperbaric oxygen" },
    { label: "supportive care only" },
  ],
  status: "Exposure: {level} \u00B7 {drug} \u00B7",
  drugNames: ["no treatment", "high flow oxygen", "hyperbaric oxygen", "supportive care only"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const clearF = [1, 0.45, 0.15, 0.92];
  const pressF = [0, 0.25, 1, 0];
  const a = S.level.a[level];
  const COHb = cl(a * clearF[drug]);
  const Shift = cl(COHb * 0.95);
  const Delivery = cl(0.92 - 0.8 * COHb - 0.08 * Shift);
  const Mito = cl(0.9 - 0.75 * COHb);
  const Energy = cl(Mito);
  const Brain = cl(0.7 * COHb + 0.2 * (1 - Delivery));
  const Pox = cl(0.93 + 0.04 * COHb);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(COHb, 0.25, 0.55, ["low", "raised", "high"]),
    w(Delivery, 0.35, 0.65, ["low", "reduced", "preserved"]),
    w(Brain, 0.3, 0.6, ["alert", "impaired", "severely impaired"]),
  ];
  return { a, drug, clear: clearF[drug], press: pressF[drug], COHb, Shift, Delivery, Mito, Energy, Brain, Pox, words, readout: "carboxyhaemoglobin " + words[0] + " \u00B7 tissue oxygen " + words[1] + " \u00B7 brain " + words[2] };
}
const TESTS = [
  [2, 0, "carboxyhaemoglobin high \u00B7 tissue oxygen low \u00B7 brain severely impaired"],
  [1, 0, "carboxyhaemoglobin high \u00B7 tissue oxygen reduced \u00B7 brain impaired"],
  [2, 2, "carboxyhaemoglobin low \u00B7 tissue oxygen preserved \u00B7 brain alert"],
  [0, 0, "carboxyhaemoglobin raised \u00B7 tissue oxygen preserved \u00B7 brain alert"],
];

/* ---------------- static layout ---------------- */
const VY = 294;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LUNG</text>
<text class="sc-zone" x="350" y="68">OXYGEN HAEMOGLOBIN CURVE</text>
<text class="sc-zone" x="748" y="68">BRAIN</text>
<text class="sc-zone sc-dim" x="34" y="252">BLOOD VESSEL</text>
<rect class="cop-curvebg" x="330" y="78" width="300" height="142" rx="12"/>
<path class="cop-axis" d="M362 202H612M362 202V92"/>
<text class="cop-ax" x="606" y="216" text-anchor="end">oxygen in blood</text>
<text class="cop-ax" x="352" y="100">bound</text>
<g id="curve"></g>
<circle class="cop-alv" cx="118" cy="158" r="52"/>
<circle class="cop-alv2" cx="102" cy="142" r="20"/>
<path class="cop-air" d="M28 96H72"/>
<g id="brain"></g>
<text id="brainWord" class="cop-word" x="812" y="238" text-anchor="middle">impaired</text>
<rect id="lumen" class="sc-lumen" x="14" y="${VY - 36}" width="${W - 28}" height="72"/>
<g id="rbcs"></g><g id="parts"></g>
<ellipse class="cop-cell" cx="688" cy="398" rx="92" ry="38"/>
<g id="mito"></g>
<g id="pox"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "carbon-monoxide-poisoning", fig: "Fig 1", title: "Carbon monoxide poisoning: hidden tissue hypoxia", W, H, body,
  label: "An animated lung, blood vessel, oxygen haemoglobin curve, brain, tissue cell and pulse oximeter. Carbon monoxide binds haemoglobin far more strongly than oxygen, forming carboxyhaemoglobin, shifting the curve to the left, blocking tissue oxygen release and inhibiting cytochrome oxidase. The pulse oximeter still looks normal. Gauges show carboxyhaemoglobin, curve shift, tissue delivery, cell energy, brain function and the pulse oximeter reading. Treatment choices are high flow oxygen, hyperbaric oxygen and supportive care.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, pressures, thresholds or numbers are shown or implied.",
  scene: { W, H, VY }, pageJs: readFileSync(join(HERE, "copois.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How carbon monoxide poisons.</strong> Carbon monoxide is breathed in, crosses the lung and binds haemoglobin much more strongly than oxygen, forming carboxyhaemoglobin. Fewer sites carry oxygen and the oxygen haemoglobin curve shifts left, so the oxygen that is carried is released less readily to tissues. Carbon monoxide also binds cytochrome oxidase in mitochondria and impairs cell energy production. A standard pulse oximeter cannot tell carboxyhaemoglobin from oxyhaemoglobin, so its reading can look normal while tissue delivery is poor. Symptoms range from headache and dizziness to confusion, collapse and coma, and delayed neurological sequelae can follow apparent recovery. This is standard teaching in medicine, physiology and toxicology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Removing the source and giving high flow oxygen speeds clearance of carbon monoxide from haemoglobin. Hyperbaric oxygen, where available and selected, speeds clearance further and is shown as a teaching toggle. Supportive care supports airway, breathing and circulation without directly clearing carbon monoxide. These are teaching toggles only.",
  ],
  simplified: "Carbon monoxide from different sources, myoglobin binding, inflammation and reperfusion injury after poisoning, exact indications for hyperbaric treatment, pregnancy and fetal haemoglobin, investigation thresholds, and all doses, pressures and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cop-alv{fill:color-mix(in srgb,var(--c-lymph) 28%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.4}
.cop-alv2{fill:color-mix(in srgb,var(--c-lymph) 18%,#fff);opacity:.6}
.cop-air{stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round;fill:none}
.cop-curvebg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.cop-axis{stroke:var(--anatomy-mid);stroke-width:1;fill:none}
.cop-ax{fill:var(--anatomy-text);font-size:9px}
.cop-word{fill:var(--anatomy-strong);font-size:11px;font-weight:600}
.cop-norm{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:4 3}
.cop-shift{fill:none;stroke:var(--c-bad);stroke-width:2.2}
.cop-cell{fill:color-mix(in srgb,var(--c-good) 16%,var(--anatomy-paper));stroke:var(--c-good);stroke-width:1.2}
.cop-mito{fill:#e8a04a;stroke:#b06f1f;stroke-width:1}
.cop-fold{fill:none;stroke:#b06f1f;stroke-width:1.1}
.cop-brain{fill:color-mix(in srgb,var(--c-mac) 45%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.3}
.cop-poxbg{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.cop-poxt{fill:var(--anatomy-strong);font-size:10px;font-weight:700}
.cop-poxs{fill:var(--c-good);font-size:9px;font-weight:600}
.p-co{--cc:#4a4a52}.p-o2{--cc:#3fa0d4}.p-energy{--cc:#ffd24a}
.dr-g-fill.g-cohb{fill:var(--c-bad)}.dr-g-fill.g-shift{fill:#e88ca0}.dr-g-fill.g-del{fill:var(--c-good)}.dr-g-fill.g-energy{fill:#e8a04a}.dr-g-fill.g-brain{fill:var(--c-mac)}.dr-g-fill.g-pox{fill:var(--c-good)}
`,
});
