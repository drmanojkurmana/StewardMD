/* Pneumonia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pneu.mjs [--print-model]
 * Static layout here; alveoli, lobe, pleura and gauges move in pneu.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the pneumonia", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotic only (treat the infection)" },
    { label: "oxygen only (support breathing)" },
    { label: "antibiotic with oxygen (both)" },
  ],
  status: "Pneumonia: {level} · {drug} ·",
  drugNames: ["no treatment", "an antibiotic only", "oxygen only", "an antibiotic with oxygen"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const abx = drug === 1 || drug === 3 ? 1 : 0, oxy = drug === 2 || drug === 3 ? 1 : 0;
  const B = abx ? a * 0.12 : a * (0.55 + 0.45 * a);
  const E = cl(0.08 + 0.82 * a * (abx ? 0.45 : 1));
  const C = cl(0.04 + 0.9 * E);
  const P = cl(0.02 + 0.9 * C * (a > 0.6 ? 1 : 0.35) * (abx ? 0.5 : 1));
  const Hx = cl(0.04 + 0.88 * C * (oxy ? 0.5 : 1));
  const O = cl(1 - Hx);
  const R = cl(abx ? (1 - C) * 0.95 : 0.06);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.5, ["controlled", "present", "spreading"]), w(C, 0.35, 0.65, ["clearing", "patchy", "solid"]), w(O, 0.5, 0.75, ["low", "reduced", "near normal"])];
  return { a, abx, oxy, B, E, C, P, Hx, O, R, words, readout: "infection " + words[0] + " · consolidation " + words[1] + " · oxygen " + words[2] };
}
const TESTS = [
  [1, 0, "infection spreading · consolidation patchy · oxygen low"],
  [1, 1, "infection controlled · consolidation clearing · oxygen reduced"],
  [1, 2, "infection spreading · consolidation patchy · oxygen reduced"],
  [1, 3, "infection controlled · consolidation clearing · oxygen near normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="296" height="266" rx="16"/>
<rect class="sc-tissue" x="320" y="44" width="320" height="266" rx="16"/>
<rect class="sc-tissue" x="650" y="44" width="296" height="266" rx="16"/>
<rect class="sc-tissue" x="14" y="318" width="932" height="124" rx="16" opacity="0.7"/>
<text class="sc-zone" x="34" y="68">ALVEOLI: INFECTION</text>
<text class="sc-zone" x="340" y="68">LOBE: HOW IT FILLS</text>
<text class="sc-zone" x="670" y="68">EDGE OF THE LUNG</text>
<text class="sc-zone sc-dim" x="32" y="338">BLOOD LEAVING THE LUNGS</text>
<rect id="lumen" class="sc-lumen" x="14" y="364" width="932" height="44"/>
<g id="alv"></g><g id="lobe"></g><g id="pleu"></g><g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "pneumonia", fig: "Fig 1", title: "Pneumonia: filled air sacs to low oxygen", W, H, body,
  label: "An animated view of pneumonia. Bacteria multiply in the air sacs and neutrophils flood in, filling the sacs with exudate so they become solid, which is consolidation. Patchy filling around small airways is bronchopneumonia and can merge to fill a whole lobe in lobar pneumonia, when the lobe looks red and solid like liver, called red hepatisation. Filled sacs cannot add oxygen, so blood oxygen falls. Infection can spread outward to the pleura and cause pleural fluid. An antibiotic clears the infection so the sacs can clear in resolution, and oxygen supports blood oxygen while that happens. Gauges show infection, exudate, consolidation, blood oxygen, pleura and resolution.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pneu.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How pneumonia develops.</strong> Bacteria reach the air sacs (alveoli) and multiply. Neutrophils and fluid flood into the sacs as exudate, filling air space so that part of the lung becomes solid, which is consolidation and cannot exchange gas, so blood oxygen falls (hypoxia). Filling that starts patchily around small airways is bronchopneumonia; filling of a whole lobe is lobar pneumonia, and a freshly filled lobe is red and firm like liver, called red hepatisation, before it gradually clears in resolution as the infection is treated and debris is removed. Infection reaching the lung surface inflames the pleura and can collect pleural fluid beside the lung. This is standard teaching in medicine and respiratory texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An antibiotic to treat the infection itself, and oxygen to support blood oxygen while the sacs clear. These are teaching toggles only.",
  ],
  simplified: "Viruses and other organisms, white cell and immune defects, aspiration, fever and cough signs, tests and imaging, complications such as abscess and sepsis, vaccines, other supportive care, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pneu-air{fill:color-mix(in srgb,var(--c-lymph) 26%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:2}
.pneu-sac{fill:color-mix(in srgb,var(--c-lymph) 20%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.8}
.pneu-exud{fill:color-mix(in srgb,var(--c-neut) 62%,var(--anatomy-paper));stroke:none}
.pneu-cons{fill:color-mix(in srgb,var(--c-bad) 72%,#7a1f24);stroke:none}
.pneu-lobe{fill:color-mix(in srgb,var(--c-lymph) 13%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.8}
.pneu-bronch{fill:none;stroke:var(--c-lymph);stroke-width:5;stroke-linecap:round;opacity:.75}
.pneu-patch{fill:color-mix(in srgb,var(--c-neut) 55%,var(--c-bad));stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.pneu-lung{fill:color-mix(in srgb,var(--c-lymph) 15%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.6}
.pneu-pleura{fill:none;stroke:var(--c-endo);stroke-width:3;stroke-linecap:round}
.pneu-wall{fill:color-mix(in srgb,var(--anatomy-mid) 28%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.pneu-hatch{stroke:var(--anatomy-mid);stroke-width:1.2}
.pneu-eff{fill:color-mix(in srgb,var(--c-fl) 62%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.2}
.pneu-mask{fill:color-mix(in srgb,#5fd0f5 45%,var(--anatomy-paper));stroke:#2e9cc4;stroke-width:1.4}
.p-o2{--cc:#5fd0f5}
.dr-g-fill.g-ox{fill:#5fd0f5}.dr-g-fill.g-cons{fill:var(--c-bad)}.dr-g-fill.g-exud{fill:var(--c-neut)}.dr-g-fill.g-pleu{fill:var(--c-fl)}.dr-g-fill.g-res{fill:var(--c-good)}
`,
});
