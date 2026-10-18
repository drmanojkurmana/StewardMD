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
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const TABLE = { charCut: 0.52, alkClear: 0.3, dialClear: 0.58, alkTrap: 0.5, dialTrap: 0.1 };
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
  [2, 3, "salicylate raised · breathing fast · metabolic acid raised · body heat warm · tissue entry raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GUT</text>
<text class="sc-zone" x="250" y="270">TISSUE AND MITOCHONDRIA</text>
<text class="sc-zone" x="650" y="270">KIDNEY AND URINE</text>
<ellipse class="sl-gut" cx="125" cy="180" rx="62" ry="58"/>
<path class="sl-link" d="M187 180 L232 180"/>
<polygon class="sl-arrow" points="240,180 226,173 226,187"/>
<rect class="sl-blood" x="240" y="92" width="370" height="128" rx="16"/>
<rect id="dialBox" class="sl-dial" x="618" y="102" width="24" height="108" rx="8" opacity="0.25"/>
<circle class="sl-brain" cx="730" cy="150" r="40"/>
<rect class="sl-stem" x="722" y="182" width="16" height="28" rx="6"/>
<ellipse class="sl-lung" cx="688" cy="222" rx="24" ry="13"/>
<ellipse class="sl-lung" cx="772" cy="222" rx="24" ry="13"/>
<circle class="sl-ear" cx="858" cy="150" r="26"/>
<path class="sl-earIn" d="M850 138a13 13 0 1 1 -6 18M850 146a7 7 0 1 1 -3 9"/>
<rect class="sl-tissueBox" x="240" y="276" width="370" height="142" rx="16"/>
<ellipse class="sl-mito" cx="385" cy="348" rx="78" ry="34"/>
<path class="sl-mitoIn" d="M330 348q14 -16 28 0t28 0t28 0t28 0"/>
<g id="heatWaves" opacity="0"><path class="sl-heat" d="M340 306q6 -10 0 -20M385 306q6 -10 0 -20M430 306q6 -10 0 -20M475 306q6 -10 0 -20"/></g>
<ellipse class="sl-kidney" cx="770" cy="340" rx="42" ry="52"/>
<path class="sl-ureter" d="M770 392 L770 428 M770 428 L842 428"/>
<circle class="sl-urine" cx="852" cy="428" r="10"/>
<g id="charGroup" opacity="0"><circle class="sl-char" cx="105" cy="165" r="7"/><circle class="sl-char" cx="128" cy="180" r="8"/><circle class="sl-char" cx="148" cy="162" r="6"/><circle class="sl-char" cx="120" cy="198" r="6"/></g>
<g id="alkGroup" opacity="0"><circle class="sl-alk" cx="748" cy="322" r="5"/><circle class="sl-alk" cx="788" cy="348" r="5"/><circle class="sl-alk" cx="762" cy="368" r="5"/><circle class="sl-alk" cx="845" cy="420" r="4"/></g>
<text class="sc-lab" x="125" y="252" text-anchor="middle">tablets in the gut</text>
<text class="sc-lab" x="425" y="238" text-anchor="middle">plasma carries salicylate</text>
<text class="sc-lab" x="730" y="248" text-anchor="middle">breathing centre and lungs</text>
<text class="sc-lab" x="520" y="398" text-anchor="middle">heat and acid made here</text>
<text class="sc-lab" x="770" y="410" text-anchor="middle">urine outflow</text>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "salicylate-poisoning", fig: "Fig 1", title: "Salicylate poisoning: breathing, acid and heat", W, H, body,
  label: "An animated scene of salicylate poisoning. Salicylate from the gut enters the blood, stimulates the respiratory centre so breathing speeds up and carbon dioxide is blown off, and uncouples mitochondria so heat and metabolic acid rise. Acid in the tissues lets more salicylate enter the brain, and ringing in the ear is shown at the ear. Treatments are activated charcoal in the gut, urinary alkalinisation at the kidney, and dialysis clearing the blood. Gauges show salicylate, breathing, metabolic acid, body heat and tissue entry.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "salicyl.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How salicylate poisoning works.</strong> Salicylate directly stimulates the respiratory centre, so ventilation rises and carbon dioxide is blown off, giving a respiratory alkalosis. It also uncouples oxidative phosphorylation in mitochondria, so energy is released as heat rather than stored, oxygen use rises, and metabolic acids accumulate, giving a high anion gap metabolic acidosis that can dominate later. Hyperthermia and tinnitus are classic features. This is standard teaching in medicine and toxicology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why acid makes it worse.</strong> In acid conditions more salicylate is in the non-ionised form that crosses membranes into tissues and the brain, so tissue acidosis worsens toxicity. In alkaline urine more salicylate is ionised and trapped in the urine for excretion. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Activated charcoal in the gut to reduce absorption, urinary alkalinisation to trap salicylate in alkaline urine and limit tissue entry, and dialysis to clear salicylate directly from the blood. These are teaching toggles only.",
  ],
  simplified: "Mixed acid base detail over time, dehydration and electrolyte disturbance, kidney and lung injury, cerebral and pulmonary oedema, assessment and monitoring, antidote dosing, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sl-gut{fill:color-mix(in srgb,var(--c-eos) 32%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-eos) 60%,#000);stroke-width:1.2}
.sl-blood{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.2}
.sl-brain{fill:color-mix(in srgb,var(--c-mac) 38%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-mac) 60%,#000);stroke-width:1.2}
.sl-stem{fill:color-mix(in srgb,var(--c-mac) 38%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-mac) 60%,#000);stroke-width:1}
.sl-lung{fill:color-mix(in srgb,var(--c-lymph) 35%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1.1}
.sl-ear{fill:color-mix(in srgb,var(--c-plt) 38%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-plt) 60%,#000);stroke-width:1.2}
.sl-earIn{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;stroke-linecap:round}
.sl-tissueBox{fill:color-mix(in srgb,var(--c-eos) 14%,var(--anatomy-card));stroke:var(--anatomy-faint);stroke-width:1}
.sl-mito{fill:#c96a3a;stroke:#8a3f1d;stroke-width:1.2}
.sl-mitoIn{fill:none;stroke:#f2c49b;stroke-width:1.4}
.sl-heat{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.sl-kidney{fill:#b85c7a;stroke:#7d3450;stroke-width:1.2}
.sl-ureter{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.sl-urine{fill:var(--c-fl);stroke:#2f6da8;stroke-width:1}
.sl-link{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.sl-arrow{fill:var(--anatomy-mid)}
.sl-dial{fill:#6aa8d8;stroke:#2f6da8;stroke-width:1.2}
.sl-char{fill:#2b2b2b;stroke:#111;stroke-width:.6}
.sl-alk{fill:#7fc4a8;stroke:#3a7a63;stroke-width:.7}
.p-sal{--cc:#e8d36a}.p-co2{--cc:#7fc4e8}.p-acid{--cc:#e5484d}.p-heatp{--cc:#f08a4b}
.dr-g-fill.g-sal{fill:#e8d36a}.dr-g-fill.g-resp{fill:#7fc4e8}.dr-g-fill.g-acid{fill:var(--c-bad)}.dr-g-fill.g-heat{fill:#f08a4b}.dr-g-fill.g-brain{fill:var(--c-cyt)}
`,
});
