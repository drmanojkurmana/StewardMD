/* Ventilation-perfusion mismatch and the blood gas / acid-base picture as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/vq.mjs [--print-model]
 * Static layout here; units, particles, breathing and gauges move in vq.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How severe, and for how long", a: [0.35, 0.65, 1], k: [0.3, 0.6, 1], names: ["mild, recent", "moderate, subacute", "severe, long-standing"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "oxygen only" },
    { label: "bronchodilator only (open the airways)" },
    { label: "ventilation support only" },
    { label: "bronchodilator plus oxygen" },
    { label: "ventilation support plus oxygen" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "oxygen only", "a bronchodilator only", "ventilation support only", "a bronchodilator plus oxygen", "ventilation support plus oxygen"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], kc = S.level.k[level];
  const ox = drug === 1 || drug === 4 || drug === 5 ? 1 : 0, bd = drug === 2 || drug === 4 ? 1 : 0, vt = drug === 3 || drug === 5 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Sh = a * 0.6 * (bd ? 0.55 : 1) * (vt ? 0.75 : 1);
  const Ds = a * 0.55;
  const hx = (o) => cl(0.04 + 1.1 * (Sh * 0.6 * (o ? 0.12 : 1) + Sh * 0.4 * (o ? 0.75 : 1)) + 0.25 * Ds * (o ? 0.5 : 1));
  const Hx = hx(ox), Hd = 0.7 * hx(0) + 0.3 * Hx;
  const O = 1 - Hx;
  const E = vt ? 0.7 : cl((0.35 + 0.8 * Hd) * (a > 0.9 ? 0.5 : 1));
  const C = cl(0.4 + 0.7 * Ds - 1.5 * (E - 0.45) - 0.2 * bd);
  const E0 = cl((0.35 + 0.8 * hx(0)) * (a > 0.9 ? 0.5 : 1)), C0 = cl(0.4 + 0.7 * Ds - 1.5 * (E0 - 0.45));
  const B = cl(0.5 + 0.55 * (C0 - 0.4) * kc);          // the kidney follows the long-standing carbon dioxide, so it lags behind treatment
  const P = cl(0.5 - 0.9 * (C - 0.4) + 0.9 * (B - 0.5));
  const Ac = cl((0.5 - P) * 2.2);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(O, 0.35, 0.7, ["very low", "low", "normal"]), w(C, 0.3, 0.55, ["low", "normal", "high"]), w(P, 0.4, 0.6, ["acidosis", "near normal", "alkalosis"]), w(B, 0.4, 0.62, ["low", "normal", "raised"])];
  return { a, kc, ox, bd, vt, Sh, Ds, Hx, O, E, C, B, P, Ac, words, readout: "oxygen " + words[0] + " · CO2 " + words[1] + " · pH " + words[2] + " · bicarbonate " + words[3] };
}
const TESTS = [
  [1, 0, "oxygen low · CO2 low · pH alkalosis · bicarbonate normal"],
  [2, 0, "oxygen very low · CO2 high · pH acidosis · bicarbonate raised"],
  [2, 1, "oxygen low · CO2 high · pH acidosis · bicarbonate raised"],
  [2, 5, "oxygen normal · CO2 normal · pH alkalosis · bicarbonate raised"],
];

/* ---------------- static layout ---------------- */
const CY = 300;
const CX = [164, 480, 796];
const ttl = ["SHUNT: BLOOD, NO AIR", "NORMAL MATCH", "DEAD SPACE: AIR, NO BLOOD"];
const units = CX.map((cx, i) => `
<rect class="sc-tissue" x="${cx - 150}" y="44" width="300" height="206" rx="16"/>
<text class="sc-zone" x="${cx - 132}" y="66">${ttl[i]}</text>
<path class="vq-air" d="M${cx} 76L${cx} 112"/>
<path class="vq-cap" d="M${cx - 134} 205L${cx + 134} 205"/>`).join("");
const tube = "M40 394L220 394L290 410L520 402";
const body = `${units}
<rect class="sc-tissue" x="14" y="346" width="536" height="96" rx="16" opacity="0.7"/>
<rect class="sc-tissue" x="560" y="346" width="386" height="96" rx="16" opacity="0.7"/>
<text class="sc-zone" x="32" y="364">KIDNEY: BICARBONATE COMPENSATION</text><text class="sc-zone" x="578" y="364">TREATMENT, WHEN GIVEN</text>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 34}" width="932" height="68"/>
<text class="sc-zone sc-dim" x="30" y="${CY - 20}">ARTERIAL BLOOD (MIXED FROM ALL THREE)</text>
<path class="vq-tube" d="${tube}"/>
<g id="units"></g><g id="cells"></g><g id="tr"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.vq-air{fill:none;stroke:color-mix(in srgb,var(--c-lymph) 40%,var(--anatomy-paper));stroke-width:22;stroke-linecap:butt}
.vq-cap{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 22%,var(--anatomy-paper));stroke-width:26;stroke-linecap:round}
.vq-tube{fill:none;stroke:color-mix(in srgb,var(--c-fl) 28%,var(--anatomy-paper));stroke-width:24;stroke-linecap:round;stroke-linejoin:round}
.vq-alv{fill:color-mix(in srgb,var(--c-lymph) 22%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.6}
.vq-fluid{fill:var(--c-fl)}
.vq-plug{fill:#a9854a;stroke:#6e5428;stroke-width:1}
.vq-clot{fill:#8f2a3a;stroke:#5c1824;stroke-width:1}
.vq-rbc{stroke:#2a1030;stroke-width:.6}
.p-o2{--cc:#5fd0f5}.p-co2{--cc:#9aa3ad}.p-h{--cc:#f0883a}.p-hco3{--cc:#2fc2a3}
.vq-cyl{fill:color-mix(in srgb,#5fd0f5 40%,var(--anatomy-paper));stroke:#2e9cc4;stroke-width:1.3}
.vq-inh{fill:color-mix(in srgb,#2fc2a3 40%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.3}
.vq-bel{fill:color-mix(in srgb,#b27af0 40%,var(--anatomy-paper));stroke:#b27af0;stroke-width:1.3}
.dr-g-fill.g-ox{fill:#5fd0f5}.dr-g-fill.g-co2{fill:#9aa3ad}.dr-g-fill.g-ph{fill:#f0883a}.dr-g-fill.g-hc{fill:#2fc2a3}.dr-g-fill.g-ve{fill:#b27af0}
`;

buildScene({
  id: "vq-acid-base", fig: "Fig 1", title: "Ventilation-perfusion mismatch and the blood gas", W, H, body, extraCss,
  label: "An animated map of ventilation-perfusion mismatch. Three lung units are shown: a shunt, where blood passes an alveolus that gets no air; a normal unit, where air and blood match; and dead space, where air reaches an alveolus whose blood supply is blocked. Their mixed output sets oxygen and carbon dioxide in arterial blood. Breathing faster in response to low oxygen can give respiratory alkalosis, failure to clear carbon dioxide gives respiratory acidosis, and the kidney slowly retains or loses bicarbonate to compensate. Treatment choices are oxygen, a bronchodilator and ventilation support, with gauges for oxygen, carbon dioxide, pH, bicarbonate and ventilation.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { CY, W, H, CX, tube: [[40, 394], [220, 394], [290, 410], [520, 402]] },
  pageJs: readFileSync(join(HERE, "vq.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>V/Q mismatch.</strong> Ventilation (V) is air reaching the alveoli and perfusion (Q) is blood reaching their capillaries. A shunt is perfusion without ventilation (collapse, fluid, mucus plugging): the blood stays unoxygenated and adding oxygen helps little. Dead space is ventilation without perfusion (for example pulmonary embolism): air is wasted and carbon dioxide is not cleared unless total breathing rises. Units with low but not absent ventilation behave partly like a shunt and do respond to oxygen. This is standard respiratory physiology teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Blood gas and acid-base.</strong> Low oxygen drives faster breathing, which blows off carbon dioxide and can give respiratory alkalosis. When breathing fails or tires, carbon dioxide rises and pH falls (respiratory acidosis). Over days the kidney retains bicarbonate in chronic acidosis, or loses it in chronic alkalosis, which brings pH back toward normal (metabolic compensation). Oxygen can reduce hypoxic drive and worsen carbon dioxide retention in some patients, so it is titrated to a target. Ventilation support sets minute ventilation and can overshoot into alkalosis. The figure shows the direction of each effect, not how much to give.",
  ],
  simplified: "Many things are left out: the oxygen-haemoglobin curve, the Haldane effect, diffusion limitation, hypoventilation as a separate cause of hypoxaemia, the alveolar-arterial gradient, mixed disorders, metabolic acid-base causes, anion gap, lactate, PEEP and lung-protective settings, noninvasive versus invasive ventilation, and all doses, targets and numbers. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
