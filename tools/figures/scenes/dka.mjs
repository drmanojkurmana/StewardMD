/* Diabetic ketoacidosis and hyperglycaemic crisis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dka.mjs [--print-model]
 * Static layout here; cells, particles, breathing and gauges move in dka.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How severe", a: [0.45, 0.75, 1], names: ["early", "established DKA", "severe with shock"], ticks: ["early", "established", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "intravenous fluids only" },
    { label: "insulin only" },
    { label: "fluids plus insulin" },
    { label: "fluids, insulin and potassium (monitored)" },
    { label: "full protocol (also treat the cause)" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "fluids only", "insulin only", "fluids plus insulin", "fluids, insulin and potassium", "the full protocol"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const fl = drug === 1 || drug >= 3 ? 1 : 0, ins = drug === 2 || drug >= 3 ? 1 : 0, kcl = drug >= 4 ? 1 : 0, full = drug === 5 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const G0 = cl(0.35 + 0.6 * a), K0 = cl(0.2 + 0.75 * a), D0 = cl(0.2 + 0.7 * a);
  const G = cl(G0 * (ins ? 0.35 : fl ? 0.82 : 1));
  const Kt = cl(K0 * (ins ? 0.28 : fl ? 0.85 : 1) * (full ? 0.8 : 1));
  const De = cl(D0 * (fl ? 0.25 : ins ? 1.12 : 1));
  const Sh = cl(0.9 * De + (a > 0.9 ? 0.1 : 0) + (ins && !fl ? 0.1 : 0));
  const Kr = cl(ins ? (kcl ? (full ? 0.15 : 0.25) : 0.9) : (0.5 + 0.3 * a) * (fl ? 0.9 : 1));
  const Ks = cl(ins ? (kcl ? 0.45 : 0.1) : (0.5 + 0.35 * a) * (fl ? 0.9 : 1));
  const Kin = ins ? 0.9 : 0.3;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(G, 0.4, 0.7, ["controlled", "high", "very high"]), w(Kt, 0.25, 0.55, ["low", "present", "high"]), w(De, 0.3, 0.6, ["corrected", "moderate", "severe"]), w(Kr, 0.3, 0.7, ["safe", "watch", "danger"])];
  return { a, fl, ins, kcl, full, G, Kt, De, Sh, Kr, Ks, Kin, words, readout: "glucose " + words[0] + " · ketones " + words[1] + " · dehydration " + words[2] + " · potassium " + words[3] };
}
const TESTS = [
  [1, 0, "glucose very high · ketones high · dehydration severe · potassium danger"],
  [1, 2, "glucose controlled · ketones low · dehydration severe · potassium danger"],
  [1, 3, "glucose controlled · ketones low · dehydration corrected · potassium danger"],
  [1, 4, "glucose controlled · ketones low · dehydration corrected · potassium safe"],
];

/* ---------------- static layout ---------------- */
const CY = 300;                                                   // blood centre line
const tube = "M623 394L700 394L762 418L860 400L930 424";
const body = `
<rect class="sc-tissue" x="14" y="44" width="256" height="206" rx="16"/>
<rect class="sc-tissue" x="280" y="44" width="320" height="206" rx="16"/>
<rect class="sc-tissue" x="610" y="44" width="336" height="206" rx="16"/>
<rect class="sc-tissue" x="14" y="262" width="136" height="76" rx="16"/>
<rect class="sc-tissue" x="14" y="346" width="536" height="96" rx="16" opacity="0.7"/>
<rect class="sc-tissue" x="560" y="346" width="386" height="96" rx="16" opacity="0.7"/>
<text class="sc-zone" x="32" y="68">PANCREAS</text><text class="sc-zone" x="298" y="68">FAT AND LIVER</text><text class="sc-zone" x="628" y="68">MUSCLE</text>
<text class="sc-zone" x="30" y="282">LUNGS</text><text class="sc-zone" x="32" y="364">TREATMENT, WHEN GIVEN</text><text class="sc-zone" x="578" y="364">KIDNEY</text>
<rect id="lumen" class="sc-lumen" x="160" y="${CY - 34}" width="786" height="68"/>
<text class="sc-zone sc-dim" x="176" y="${CY + 4}">BLOOD</text>
<path class="dka-tube" d="${tube}"/>
<g id="pancSlot"></g><g id="liverSlot"></g><g id="kidneySlot"></g><g id="trig"></g>
<g id="lungs"></g><g id="muscle"></g><g id="cells"></g>
<g id="tr"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.dka-tube{fill:none;stroke:color-mix(in srgb,var(--c-fl) 28%,var(--anatomy-paper));stroke-width:26;stroke-linecap:round;stroke-linejoin:round}
.cl-fat{--cc:#f3e1a0}
.cl-vac .cl-b{fill:color-mix(in srgb,#fff6c8 80%,var(--c-neut)}
.p-gluc{--cc:#f2b23a}.p-ket{--cc:#ee6a4a}.p-k{--cc:#b27af0}.p-ffa{--cc:#e89a3c}.p-gcg{--cc:#f07a7a}.p-ins{--cc:#2fc2a3}.p-co2{--cc:#9aa3ad}.p-salt{--cc:#d9d4f2}.p-iv{fill:var(--c-fl)}
.dka-musc{fill:color-mix(in srgb,var(--c-mus,#d77a7a) 55%,var(--anatomy-paper));stroke:#c25a5a;stroke-width:1.4}
.dka-stri{stroke:#c25a5a;stroke-width:.8;opacity:.5}
.dka-gate{fill:#c25a5a}.dka-gate.open{fill:var(--c-good)}
.dka-icon{fill:color-mix(in srgb,var(--c-fl) 40%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.dka-ico2{fill:color-mix(in srgb,#2fc2a3 40%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.3}
.dka-ico3{fill:color-mix(in srgb,#b27af0 40%,var(--anatomy-paper));stroke:#b27af0;stroke-width:1.3}
.dka-x{fill:color-mix(in srgb,var(--anatomy-paper) 72%,transparent);stroke:var(--c-bad);stroke-width:1.8}
.dka-cap{fill:var(--anatomy-strong);font-size:13px}
.dr-g-fill.g-acid{fill:#ee6a4a}.dr-g-fill.g-gl{fill:#f2b23a}.dr-g-fill.g-dehy{fill:var(--c-fl)}.dr-g-fill.g-kr{fill:#b27af0}.dr-g-fill.g-sh{fill:var(--c-bad)}
`;

buildScene({
  id: "dka-pathophysiology", fig: "Fig 1", title: "Diabetic ketoacidosis: what goes wrong", W, H, body, extraCss,
  label: "An animated map of diabetic ketoacidosis. With almost no insulin, muscle cannot take up glucose, fat breaks down into fatty acids and the liver turns them into ketone acids and makes more glucose. Blood glucose and acid rise, the kidney loses water, sodium and potassium, the lungs breathe deeply to blow off carbon dioxide, and the patient becomes dehydrated and shocked. Treatment choices are fluids, insulin and potassium, with gauges for glucose, ketones, dehydration, potassium risk and shock.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { CY, W, H, tube: [[623, 394], [700, 394], [762, 418], [860, 400], [930, 424]] },
  pageJs: readFileSync(join(HERE, "dka.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With full protocol",
  sourcesLis: [
    "<strong>How DKA develops.</strong> Severe insulin deficiency, with raised glucagon and stress hormones, stops muscle and fat taking up glucose and lets the liver make glucose (glycogen breakdown, gluconeogenesis). Fat breaks down into free fatty acids, and the liver turns them into ketone bodies (beta-hydroxybutyrate, acetoacetate), which are acids and lower blood pH with a raised anion gap. Glucose above the kidney threshold causes an osmotic diuresis that loses water, sodium and potassium. The lungs compensate with deep, fast breathing (Kussmaul). Insulin deficiency and acidosis shift potassium out of cells, so the blood level can look normal or high while total body potassium is low. This is standard teaching in medicine and endocrine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Fluids restore circulating volume; insulin switches off ketone production and drives glucose and potassium into cells; potassium replacement (with monitoring) prevents a dangerous fall once insulin starts; the cause (infection, missed insulin, new diabetes) is treated. The figure shows the direction of each effect, not how much to give or when.",
  ],
  simplified: "The hyperosmolar hyperglycaemic state is only suggested by the severe stop; cerebral oedema, phosphate and magnesium, bicarbonate use, the switch to subcutaneous insulin, euglycaemic DKA with SGLT2 inhibitors, and all doses, rates and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
