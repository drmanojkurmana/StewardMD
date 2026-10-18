/* Salicylate poisoning as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/salicyl.mjs [--print-model]
 * Static layout here; particles and gauges move in salicyl.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Salicylate poisoning severity", a: [0.25, 0.55, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "activated charcoal" },
    { label: "urinary alkalinisation" },
    { label: "dialysis" },
  ],
  status: "Poisoning: {level} · {drug} ·",
  drugNames: ["no treatment", "activated charcoal", "urinary alkalinisation", "dialysis"],
};
function modelOf(S, level, drug) {
  const TABLE = { charCut: 0.52, alkClear: 0.3, dialClear: 0.72, alkTrap: 0.5, dialTrap: 0.1 };
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const chr = drug === 1 ? 1 : 0, alk = drug === 2 ? 1 : 0, dial = drug === 3 ? 1 : 0;
  const absorbed = cl(a * (chr ? 1 - TABLE.charCut : 1));
  const Sal = cl(absorbed * (1 - (alk ? TABLE.alkClear : 0) - (dial ? TABLE.dialClear : 0)));
  const Resp = cl(0.05 + 0.85 * Sal);
  const Unc = cl(0.04 + 0.88 * Sal);
  const Acid = cl(0.06 + 0.75 * Unc + 0.15 * Sal);
  const Heat = cl(0.04 + 0.9 * Unc);
  const Brain = cl(Sal * (0.35 + 0.75 * Acid) * (alk ? 1 - TABLE.alkTrap : 1) * (dial ? 1 - TABLE.dialTrap : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Sal, 0.28, 0.58, ["low", "raised", "high"]), w(Resp, 0.3, 0.6, ["near normal", "fast", "very fast"]), w(Acid, 0.32, 0.6, ["low", "raised", "high"]), w(Heat, 0.3, 0.6, ["normal", "warm", "overheated"]), w(Brain, 0.22, 0.5, ["low", "raised", "high"])];
  return { a, chr, alk, dial, absorbed, Sal, Resp, Unc, Acid, Heat, Brain, words, readout: "salicylate " + words[0] + " · breathing " + words[1] + " · metabolic acid " + words[2] + " · body heat " + words[3] + " · tissue entry " + words[4] };
}
const TESTS = [
  [0, 0, "salicylate low · breathing near normal · metabolic acid low · body heat normal · tissue entry low"],
  [1, 0, "salicylate raised · breathing fast · metabolic acid raised · body heat warm · tissue entry raised"],
  [2, 0, "salicylate high · breathing very fast · metabolic acid high · body heat overheated · tissue entry high"],
  [2, 3, "salicylate raised · breathing near normal · metabolic acid low · body heat normal · tissue entry low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GUT</text>
<text class="sc-zone" x="250" y="68">BLOOD</text>
<text class="sc-zone" x="250" y="270">TISSUE</text>
<text class="sc-zone" x="796" y="270">KIDNEY AND URINE</text>
<rect class="sl-blood" x="240" y="92" width="300" height="128" rx="16"/>
<path id="absArrow" class="sl-flow" d="M175 272 C200 250 215 225 240 200"/>
<path id="entryArrow" class="sl-entry" d="M560 150 C610 150 660 155 708 166"/>
<path id="diaTubeA" class="sl-tube" d="M540 126 L600 126"/>
<path id="diaTubeB" class="sl-tube" d="M600 186 L540 186"/>
<ellipse id="diaGlow" class="sl-diaglow" cx="639" cy="156" rx="52" ry="66" opacity="0"/>
<rect id="dialBox" class="sl-dial" x="600" y="102" width="78" height="108" rx="10" opacity="0.25"/>
<path class="sl-diadetail" d="M610 130 L668 130 M610 146 L668 146 M610 162 L668 162"/>
<circle id="diaLight" class="sl-dialight" cx="639" cy="192" r="7" fill="#5a6b7a"/>
<ellipse id="brainGlow" class="sl-brainglow" cx="742" cy="132" rx="80" ry="66" opacity="0"/>
<g id="gutSlot"></g>
<g id="brainSlot"></g>
<g id="lungSlot"></g>
<g id="kidneySlot"></g>
<g id="earSlot"></g>
<g id="tabGroup" class="sl-tabg"><rect class="sl-tab" x="96" y="160" width="22" height="10" rx="5" transform="rotate(-18 107 165)"/><rect class="sl-tab" x="128" y="150" width="22" height="10" rx="5" transform="rotate(12 139 155)"/><rect class="sl-tab" x="150" y="176" width="22" height="10" rx="5" transform="rotate(-8 161 181)"/><rect class="sl-tab" x="108" y="196" width="22" height="10" rx="5" transform="rotate(20 119 201)"/><rect class="sl-tab" x="140" y="212" width="22" height="10" rx="5" transform="rotate(-14 151 217)"/></g>
<rect class="sl-tissueBox" x="240" y="276" width="370" height="142" rx="16"/>
<ellipse class="sl-mito" cx="385" cy="348" rx="78" ry="34"/>
<path class="sl-mitoIn" d="M330 348q14 -16 28 0t28 0t28 0t28 0"/>
<g id="heatWaves" opacity="0"><path class="sl-heat" d="M340 306q6 -10 0 -20M385 306q6 -10 0 -20M430 306q6 -10 0 -20M475 306q6 -10 0 -20"/></g>
<path id="ureter" class="sl-ureter" d="M848 391 L848 414 L884 416"/>
<circle id="urinePool" class="sl-urine" cx="884" cy="420" r="9"/>
<g id="charGroup" opacity="0"><circle class="sl-char" cx="105" cy="170" r="7"/><circle class="sl-char" cx="128" cy="185" r="8"/><circle class="sl-char" cx="148" cy="168" r="6"/><circle class="sl-char" cx="118" cy="202" r="6"/><circle class="sl-char" cx="140" cy="196" r="5"/></g>
<g id="alkGroup" opacity="0"><circle class="sl-alk" cx="830" cy="330" r="5"/><circle class="sl-alk" cx="860" cy="360" r="5"/><circle class="sl-alk" cx="845" cy="385" r="5"/><circle class="sl-alk" cx="884" cy="410" r="4"/></g>
<circle id="ring1" class="sl-ring" cx="872" cy="148" r="8" opacity="0"/>
<circle id="ring2" class="sl-ring" cx="872" cy="148" r="8" opacity="0"/>
<circle id="ring3" class="sl-ring" cx="872" cy="148" r="8" opacity="0"/>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "salicylate-poisoning", fig: "Fig 1", title: "Salicylate poisoning: breathing, acid and heat", W, H, body,
  label: "An animated scene of salicylate poisoning. Salicylate tablets in the gut enter the blood, switch on the breathing centre so breathing speeds up and carbon dioxide is blown off, and uncouple mitochondria so heat and metabolic acid rise. Acid lets more salicylate enter the brain, and the ears ring. Charcoal traps tablets in the gut, alkaline urine traps salicylate for excretion, and dialysis cleans the blood directly. Gauges show salicylate, breathing, metabolic acid, body heat and tissue entry.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "salicyl.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With dialysis",
  sourcesLis: [
    "<strong>How salicylate poisoning works.</strong> Salicylate directly stimulates the respiratory centre, so ventilation rises and carbon dioxide is blown off, giving a respiratory alkalosis. It also uncouples oxidative phosphorylation in mitochondria, so energy is released as heat rather than stored, oxygen use rises, and metabolic acids accumulate, giving a high anion gap metabolic acidosis that can dominate later. Hyperthermia and tinnitus are classic features. This is standard teaching in medicine and toxicology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why acid makes it worse.</strong> In acid conditions more salicylate is in the non-ionised form that crosses membranes into tissues and the brain, so tissue acidosis worsens toxicity. In alkaline urine more salicylate is ionised and trapped in the urine for excretion. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Activated charcoal in the gut to reduce absorption, urinary alkalinisation to trap salicylate in alkaline urine and limit tissue entry, and dialysis to clear salicylate directly from the blood. Dialysis is the strongest of the three here. These are teaching toggles only.",
  ],
  simplified: "Mixed acid base detail over time, dehydration and electrolyte disturbance, kidney and lung injury, cerebral and pulmonary oedema, assessment and monitoring, antidote dosing, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sl-blood{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.2}
.sl-tissueBox{fill:color-mix(in srgb,var(--c-eos) 14%,var(--anatomy-card));stroke:var(--anatomy-faint);stroke-width:1}
.sl-mito{fill:#c96a3a;stroke:#8a3f1d;stroke-width:1.2}
.sl-mitoIn{fill:none;stroke:#f2c49b;stroke-width:1.4}
.sl-heat{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.sl-ureter{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.sl-urine{fill:var(--c-fl);stroke:#2f6da8;stroke-width:1}
.sl-flow{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round}
.sl-entry{fill:none;stroke:#e8d36a;stroke-width:4;stroke-linecap:round}
.sl-tube{fill:none;stroke:var(--c-rbc);stroke-width:6;stroke-linecap:round;opacity:.55}
.sl-diaglow{fill:var(--c-fl);stroke:none}
.sl-brainglow{fill:var(--c-bad);stroke:none}
.sl-dial{fill:#6aa8d8;stroke:#2f6da8;stroke-width:1.2}
.sl-diadetail{fill:none;stroke:#2f6da8;stroke-width:1.4;stroke-linecap:round}
.sl-dialight{stroke:#22303a;stroke-width:1}
.sl-char{fill:#2b2b2b;stroke:#111;stroke-width:.6}
.sl-alk{fill:#7fc4a8;stroke:#3a7a63;stroke-width:.7}
.sl-tab{fill:#e8d36a;stroke:#8a7a2a;stroke-width:.8}
.sl-ring{fill:none;stroke:var(--c-plt);stroke-width:1.6}
.sl-cap{fill:var(--anatomy-strong);font-size:12px}
.p-sal{--cc:#e8d36a}.p-co2{--cc:#7fc4e8}.p-acid{--cc:#e5484d}.p-heatp{--cc:#f08a4b}.p-dia{--cc:var(--c-rbc)}
.dr-g-fill.g-sal{fill:#e8d36a}.dr-g-fill.g-resp{fill:#7fc4e8}.dr-g-fill.g-acid{fill:var(--c-bad)}.dr-g-fill.g-heat{fill:#f08a4b}.dr-g-fill.g-brain{fill:var(--c-cyt)}
`,
});
