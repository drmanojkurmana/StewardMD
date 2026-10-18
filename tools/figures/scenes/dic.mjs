/* Disseminated intravascular coagulation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dic.mjs [--print-model]
 * Static layout here; particles, clots, pools and gauges move in dic.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How advanced the DIC is", a: [0.3, 0.65, 1], names: ["compensated", "overt", "severe"], ticks: ["compensated", "overt", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "treat the cause" },
    { label: "replace products" },
    { label: "treat the cause and replace products" },
  ],
  status: "DIC: {level} · {drug} ·",
  drugNames: ["no treatment", "cause treated", "products replaced", "cause treated and products replaced"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const LUT = { causeCut: 0.3, microK: 0.88, pltUse: 0.78, fgUse: 0.82, repBoost: 0.35, fibK: 0.8 };
  const a = S.level.a[level];
  const cause = drug === 1 || drug === 3 ? 1 : 0;
  const rep = drug === 2 || drug === 3 ? 1 : 0;
  const eff = a * (cause ? LUT.causeCut : 1);
  const TF = cl(0.1 + 0.85 * eff);
  const M = cl(0.06 + LUT.microK * eff);
  const Cons = cl(M * (cause ? 0.55 : 1));
  const Pl = cl(1 - LUT.pltUse * Cons + (rep ? LUT.repBoost : 0));
  const Fg = cl(1 - LUT.fgUse * Cons + (rep ? LUT.repBoost : 0));
  const Fib = cl(0.1 + LUT.fibK * M);
  const Dd = cl(0.08 + 0.85 * Fib);
  const Bl = cl(0.05 + 0.45 * (1 - Pl) + 0.45 * (1 - Fg));
  const Flow = cl(1 - 0.8 * M);
  const Isc = cl(1 - Flow);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const pool = Math.min(Pl, Fg);
  const words = [w(M, 0.3, 0.6, ["few", "some", "many"]), w(pool, 0.35, 0.7, ["low", "reduced", "normal"]), w(Dd, 0.3, 0.6, ["normal", "raised", "high"]), w(Bl, 0.3, 0.55, ["low", "raised", "high"])];
  return { a, cause, rep, eff, TF, M, Cons, Pl, Fg, Fib, Dd, Bl, Flow, Isc, words, readout: "microthrombi " + words[0] + " \u00B7 platelets and fibrinogen " + words[1] + " \u00B7 D-dimer " + words[2] + " \u00B7 bleeding " + words[3] };
}
const TESTS = [
  [2, 0, "microthrombi many \u00B7 platelets and fibrinogen low \u00B7 D-dimer high \u00B7 bleeding high"],
  [1, 1, "microthrombi few \u00B7 platelets and fibrinogen normal \u00B7 D-dimer raised \u00B7 bleeding low"],
  [2, 2, "microthrombi many \u00B7 platelets and fibrinogen reduced \u00B7 D-dimer high \u00B7 bleeding raised"],
  [2, 3, "microthrombi some \u00B7 platelets and fibrinogen normal \u00B7 D-dimer raised \u00B7 bleeding low"],
];

/* ---------------- static layout ---------------- */
const CHIPS = [["Sepsis", "Sepsis: infection releases signals that switch clotting on throughout the circulation."], ["Major trauma", "Major trauma: crushed and injured tissue releases tissue factor into the blood."], ["Malignancy", "Malignancy: some cancers release tissue factor and procoagulant material, classically mucinous adenocarcinoma and acute promyelocytic leukaemia."], ["Obstetric emergency", "Obstetric emergency: placental tissue factor enters the circulation, for example in abruption or amniotic fluid embolism."]];
const chips = CHIPS.map((c, i) => { const x = 30 + i * 225;
  return `<g class="hot" tabindex="0" data-info="${esc(c[1])}"><rect class="dic-chip" x="${x}" y="62" width="210" height="36" rx="10"/><text class="dic-chip-t" x="${x + 105}" y="84" text-anchor="middle">${esc(c[0])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
${chips}
<g id="tfnode"></g>
<rect id="lumen" class="sc-lumen" x="14" y="198" width="${W - 28}" height="84"/>
<g id="endo"></g><g id="rbcs"></g><g id="clots"></g><g id="parts"></g>
<g id="lower"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "disseminated-intravascular-coagulation", fig: "Fig 1", title: "DIC: clotting everywhere, then bleeding", W, H, body,
  label: "An animated systemic capillary in disseminated intravascular coagulation. A trigger such as sepsis, major trauma, malignancy or an obstetric emergency releases tissue factor, which switches clotting on in vessels everywhere. Widespread microthrombi block small vessels and cause organ ischaemia, while platelets, clotting factors and fibrinogen are used up. Fibrinolysis breaks clots down and raises D-dimer, and the depleted blood then bleeds. Gauges show microthrombi, platelets, fibrinogen, D-dimer, bleeding and organ flow. Treatment choices are treating the cause and replacing products.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, laboratory values or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "dic.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>What DIC is.</strong> Disseminated intravascular coagulation is not a disease in itself but a syndrome triggered by an underlying cause: sepsis, major trauma or burns, malignancy and obstetric emergencies are classic triggers. Tissue factor (with activated endothelium and monocytes) switches the clotting system on throughout the circulation instead of at one injury. Widespread microthrombi form in small vessels and impair organ perfusion, while platelets, clotting factors and fibrinogen are consumed faster than they can be replaced. Secondary fibrinolysis dissolves fibrin and raises fibrin degradation products such as D-dimer. The same patient therefore clots in small vessels and bleeds from depleted, weak clotting: oozing, purpura and organ dysfunction together. This is standard teaching in haematology and critical-care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Treating the underlying cause is the key step and is the only toggle that switches the drive off. Replacing platelets, plasma or fibrinogen concentrate refills what was used up but does not stop ongoing consumption, so on its own it only partly and temporarily helps. These are teaching toggles only.",
  ],
  simplified: "Scoring systems and laboratory thresholds, the balance with natural anticoagulant pathways, organ-specific patterns, transfusion triggers and targets, heparin debates, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.dic-chip{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.dic-chip-t{fill:var(--anatomy-strong);font-size:11px;font-weight:600;pointer-events:none}
.dic-tf{fill:color-mix(in srgb,var(--c-eos) 32%,var(--anatomy-card));stroke:var(--c-eos);stroke-width:1.2}
.dic-cap{fill:var(--anatomy-strong);font-size:11px;font-weight:600;pointer-events:none}
.dic-lab2{fill:var(--anatomy-text);font-size:10.5px;pointer-events:none}
.dic-tank{fill:color-mix(in srgb,var(--anatomy-mid) 22%,var(--anatomy-card));stroke:var(--anatomy-faint);stroke-width:1}
.dic-fill-p{fill:var(--c-plt)}.dic-fill-f{fill:var(--c-fl)}.dic-fill-c{fill:var(--c-cyt)}
.dic-organ{fill:color-mix(in srgb,var(--c-endo) 42%,var(--anatomy-card));stroke:var(--c-endo);stroke-width:1.2}
.dic-isc{fill:#241d33}
.dic-fib{fill:none;stroke:var(--c-plt);stroke-width:1.2;stroke-linecap:round}
.dic-drop{fill:var(--c-rbc)}
.p-tf{--cc:var(--c-eos)}.p-ddim{--cc:var(--c-neut)}.p-rep{--cc:var(--c-good)}
.dr-g-fill.g-mic{fill:var(--c-plt)}.dr-g-fill.g-dd{fill:var(--c-neut)}.dr-g-fill.g-pool{fill:var(--c-good)}.dr-g-fill.g-flow{fill:var(--c-fl)}
`,
});
