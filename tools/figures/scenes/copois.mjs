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
<rect id="chamber" class="cop-chamber" x="22" y="56" width="916" height="374" rx="16" opacity="0"/>
<g id="chamTicks" opacity="0"></g>
<rect class="cop-curvebg" x="330" y="78" width="300" height="142" rx="12"/>
<path class="cop-axis" d="M362 202H612M362 202V92"/>
<text class="cop-ax" x="606" y="216" text-anchor="end">oxygen in blood</text>
<text class="cop-ax" x="352" y="100">bound</text>
<g id="curve"></g>
<path id="airway" class="cop-air" d="M28 62 L128 62"/>
<g id="lungSlot"></g>
<g id="maskG" opacity="0">
<path class="cop-tube" d="M120 172 V54"/>
<path class="cop-mask" d="M68 178 Q122 166 172 192 L162 236 Q116 220 76 230 Z"/>
</g>
<g id="supG" opacity="0">
<circle class="cop-sup" cx="48" cy="72" r="12"/>
<circle class="cop-sup" cx="48" cy="72" r="19"/>
<circle class="cop-sup" cx="48" cy="72" r="26"/>
<rect class="cop-badge" x="672" y="228" width="64" height="20" rx="10"/>
<circle id="supDot" class="cop-dot" cx="684" cy="238" r="4"/>
<path class="cop-sup" d="M704 248 V262"/>
</g>
<ellipse id="brainGlow" class="cop-glow" cx="810" cy="155" rx="95" ry="80" opacity="0"/>
<g id="brainSlot"></g>
<text id="brainWord" class="cop-word" x="810" y="247" text-anchor="middle">confused</text>
<rect id="lumen" class="sc-lumen" x="14" y="${VY - 36}" width="${W - 28}" height="72"/>
<g id="rbcs"></g><g id="parts"></g>
<ellipse class="cop-cell" cx="688" cy="398" rx="92" ry="38"/>
<g id="mito"></g>
<g id="blockers"></g>
<g id="pox"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "carbon-monoxide-poisoning", fig: "Fig 1", title: "Carbon monoxide poisoning: hidden tissue hypoxia", W, H, body,
  label: "An animated lung, blood vessel, oxygen haemoglobin curve, brain, tissue cell and pulse oximeter. Carbon monoxide binds haemoglobin far more strongly than oxygen, forming carboxyhaemoglobin, shifting the curve to the left, blocking tissue oxygen release and inhibiting cytochrome oxidase. The pulse oximeter still looks normal. Gauges show carboxyhaemoglobin, curve shift, tissue delivery, cell energy, brain function and the pulse oximeter reading. High flow oxygen is shown as a mask that flushes carbon monoxide out, hyperbaric oxygen as a chamber that clears it fastest, and supportive care as airway and circulation support.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, pressures, thresholds or numbers are shown or implied.",
  scene: { W, H, VY }, pageJs: readFileSync(join(HERE, "copois.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With hyperbaric oxygen",
  sourcesLis: [
    "<strong>How carbon monoxide poisons.</strong> Carbon monoxide is breathed in, crosses the lung and binds haemoglobin much more strongly than oxygen, forming carboxyhaemoglobin. Fewer sites carry oxygen and the oxygen haemoglobin curve shifts left, so the oxygen that is carried is released less readily to tissues. Carbon monoxide also binds cytochrome oxidase in mitochondria and impairs cell energy production. A standard pulse oximeter cannot tell carboxyhaemoglobin from oxyhaemoglobin, so its reading can look normal while tissue delivery is poor. Symptoms range from headache and dizziness to confusion, collapse and coma, and delayed neurological sequelae can follow apparent recovery. This is standard teaching in medicine, physiology and toxicology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Removing the source and giving high flow oxygen speeds clearance of carbon monoxide from haemoglobin. Hyperbaric oxygen, where available and selected, speeds clearance further and is shown as a teaching toggle. Supportive care supports airway, breathing and circulation without directly clearing carbon monoxide. These are teaching toggles only.",
  ],
  simplified: "Carbon monoxide from different sources, myoglobin binding, inflammation and reperfusion injury after poisoning, exact indications for hyperbaric treatment, pregnancy and fetal haemoglobin, investigation thresholds, and all doses, pressures and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cop-air{stroke:var(--anatomy-mid);stroke-width:6;stroke-linecap:round;fill:none}
.cop-curvebg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.cop-axis{stroke:var(--anatomy-mid);stroke-width:1;fill:none}
.cop-ax{fill:var(--anatomy-text);font-size:10.5px}
.cop-word{fill:var(--anatomy-strong);font-size:11px;font-weight:600}
.cop-cap{fill:var(--anatomy-strong);font-size:12px;font-weight:600}
.cop-norm{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:4 3}
.cop-shift{fill:none;stroke:var(--c-bad);stroke-width:2.2}
.cop-glow{fill:var(--c-bad);stroke:none}
.cop-cell{fill:color-mix(in srgb,var(--c-good) 16%,var(--anatomy-paper));stroke:var(--c-good);stroke-width:1.2}
.cop-mito{fill:#e8a04a;stroke:#b06f1f;stroke-width:1}
.cop-fold{fill:none;stroke:#b06f1f;stroke-width:1.1}
.cop-mask{fill:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:2}
.cop-tube{fill:none;stroke:var(--c-lymph);stroke-width:5;stroke-linecap:round}
.cop-chamber{fill:none;stroke:var(--c-cyt2);stroke-width:3;stroke-dasharray:12 8}
.cop-tick{fill:none;stroke:var(--c-cyt2);stroke-width:2.5;stroke-linecap:round}
.cop-sup{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.cop-badge{fill:var(--anatomy-card);stroke:var(--c-good);stroke-width:1.5}
.cop-dot{fill:var(--c-good);stroke:none}
.cop-poxbg{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.cop-poxt{fill:var(--anatomy-strong);font-size:11px;font-weight:700}
.cop-poxs{fill:var(--c-good);font-size:10.5px;font-weight:600}
.p-co{--cc:#4a4a52}.p-o2{--cc:#3fa0d4}.p-energy{--cc:#ffd24a}
.dr-g-fill.g-cohb{fill:var(--c-bad)}.dr-g-fill.g-shift{fill:#e88ca0}.dr-g-fill.g-del{fill:var(--c-good)}.dr-g-fill.g-energy{fill:#e8a04a}.dr-g-fill.g-brain{fill:var(--c-mac)}.dr-g-fill.g-pox{fill:var(--c-good)}
`,
});
