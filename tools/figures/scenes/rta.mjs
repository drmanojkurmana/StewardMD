/* Renal tubular acidosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/rta.mjs [--print-model]
 * Static layout here; kidney, particles, stones, washes and gauges move in rta.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Type of tubular acidosis", a: [0.2, 0.55, 0.9], names: ["type 2 proximal", "type 1 distal", "type 4 hypoaldosteronism"], ticks: ["type 2", "type 1", "type 4"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "potassium" },
    { label: "mineralocorticoid" },
    { label: "bicarbonate" },
  ],
  status: "Renal tubular acidosis: {level} · {drug} ·",
  drugNames: ["no treatment", "potassium", "mineralocorticoid", "bicarbonate"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ktx = drug === 1 ? 1 : 0, min = drug === 2 ? 1 : 0, bic = drug === 3 ? 1 : 0;
  const reabs = level === 0 ? 0.18 : level === 1 ? 0.86 : 0.78;
  const waste = level === 0 ? 0.85 : 0.18;
  let aldo = level === 2 ? 0.14 : 0.85;
  if (min) aldo = level === 2 ? 0.82 : 0.9;
  let hsec = level === 0 ? 0.82 : level === 1 ? 0.15 : 0.38;
  if (min && level === 2) hsec = 0.76;
  let acid = level === 0 ? 0.78 : level === 1 ? 0.8 : 0.74;
  acid = cl(acid - bic * 0.46 - (min && level === 2 ? 0.3 : 0));
  let pot = level === 2 ? 0.86 : level === 1 ? 0.3 : 0.34;
  pot = cl(pot + ktx * 0.28 - (min && level === 2 ? 0.42 : 0) - bic * 0.06);
  let uph = level === 0 ? 0.48 : level === 1 ? 0.88 : 0.42;
  uph = cl(uph + bic * 0.14 - (min && level === 2 ? 0.08 : 0));
  let stone = level === 1 ? 0.86 : 0.1;
  stone = cl(stone - bic * (level === 1 ? 0.28 : 0));
  const chlor = cl(0.55 + 0.4 * acid);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(1 - acid, 0.35, 0.65, ["low", "reduced", "near normal"]), w(uph, 0.35, 0.65, ["acidic", "partly acidic", "alkaline"]), w(pot, 0.35, 0.65, ["low", "normal", "high"])];
  return { reabs, waste, aldo, hsec, acid, pot, uph, stone, chlor, bic, ktx, min, words, readout: "blood bicarbonate " + words[0] + " · urine pH " + words[1] + " · potassium " + words[2] };
}
const TESTS = [
  [0, 0, "blood bicarbonate low · urine pH partly acidic · potassium low"],
  [2, 0, "blood bicarbonate low · urine pH partly acidic · potassium high"],
  [2, 2, "blood bicarbonate reduced · urine pH acidic · potassium normal"],
  [0, 3, "blood bicarbonate near normal · urine pH partly acidic · potassium low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="44" y="68">KIDNEY</text>
<text class="sc-zone" x="246" y="68">PROXIMAL TUBULE</text>
<text class="sc-zone" x="530" y="68">DISTAL TUBULE AND COLLECTING DUCT</text>
<text class="sc-zone" x="830" y="68">BLADDER</text>
<path id="filtVessel" class="rt-ves" d="M150 208 L246 224"/>
<rect class="rt-lumen" x="246" y="190" width="252" height="68" rx="12"/>
<rect id="proxWash" class="rt-wash-bic" x="246" y="190" width="252" height="68" rx="12" opacity="0"/>
<rect class="rt-lumen" x="498" y="212" width="32" height="24" rx="6"/>
<rect class="rt-lumen" x="530" y="190" width="240" height="68" rx="12"/>
<rect id="distWash" class="rt-wash-min" x="530" y="190" width="240" height="68" rx="12" opacity="0"/>
<path id="urineVessel" class="rt-ves" d="M770 224 L814 186"/>
<g id="kidneySlot"></g>
<g id="bladderSlot"></g>
<ellipse id="kidneyWash" class="rt-wash-min" cx="128" cy="212" rx="80" ry="95" opacity="0"/>
<g id="cells"></g>
<g id="stones"></g>
<g id="parts"></g>
<rect class="rt-blood" x="50" y="344" width="860" height="40" rx="20"/>
<rect id="bloodWbic" class="rt-wash-bic" x="50" y="344" width="860" height="40" rx="20" opacity="0"/>
<rect id="bloodWktx" class="rt-wash-ktx" x="50" y="344" width="860" height="40" rx="20" opacity="0"/>
<text class="sc-zone sc-dim" x="34" y="336">BLOOD</text>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-prox:#5ec1a0;--c-alpha:#e9a2b3;--c-prin:#7fc4e8;--c-aldo:#e9b84a;--c-hco3:#3fbfae;--c-hplus:#f08a4b;--c-pot:#9a6ae0;--c-stone:#a8a29a}
body[data-theme="light"]{--c-prox:#2f9f7c;--c-alpha:#d9788f;--c-prin:#3fa0d4;--c-aldo:#b8860b;--c-hco3:#1f8f83;--c-hplus:#d96a25;--c-pot:#7c4fc4;--c-stone:#8a857c}
.cl-prox{--cc:var(--c-prox)}.cl-alpha{--cc:var(--c-alpha)}.cl-prin{--cc:var(--c-prin)}.cl-aldo{--cc:var(--c-aldo)}
.rt-lumen{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid));stroke-width:1.6}
.rt-blood{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,var(--anatomy-mid));stroke-width:1.4}
.rt-ves{fill:none;stroke:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper));stroke-width:12;stroke-linecap:round;opacity:.85}
.rt-wash-bic{fill:var(--c-hco3);stroke:none}
.rt-wash-ktx{fill:var(--c-pot);stroke:none}
.rt-wash-min{fill:var(--c-aldo);stroke:none}
.rt-cap{fill:var(--anatomy-strong);font-size:12px}
.rt-stone{fill:var(--c-stone);stroke:color-mix(in srgb,var(--c-stone) 55%,#000);stroke-width:1}
.p-hco3{--cc:var(--c-hco3)}.p-hplus{--cc:var(--c-hplus)}.p-pot{--cc:var(--c-pot)}.p-aldo{--cc:var(--c-aldo)}
.dr-g-fill.g-hco3{fill:var(--c-hco3)}.dr-g-fill.g-hplus{fill:var(--c-hplus)}.dr-g-fill.g-pot{fill:var(--c-pot)}.dr-g-fill.g-stone{fill:var(--c-stone)}.dr-g-fill.g-aldo{fill:var(--c-aldo)}.dr-g-fill.g-chlor{fill:var(--c-fl)}
`;

buildScene({
  id: "renal-tubular-acidosis", fig: "Fig 1", title: "Renal tubular acidosis: where the tubule fails", W, H, body, extraCss,
  label: "An animated kidney tubule, shown magnified. The kidney filters blood, the proximal tubule reclaims bicarbonate into the blood, and the distal tubule and collecting duct secrete acid into the urine with help from aldosterone. The level slider switches between proximal type 2 bicarbonate wasting, distal type 1 failure of acid secretion with alkaline urine and stones, and type 4 hypoaldosteronism with high potassium. All three give a normal anion gap hyperchloraemic acidosis. Gauges show bicarbonate reclaim, acid secretion, urine pH, stones, potassium and chloride. Treatment choices are potassium, a mineralocorticoid and bicarbonate.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "rta.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With bicarbonate",
  sourcesLis: [
    "<strong>The shared picture.</strong> In renal tubular acidosis the glomeruli filter fairly normally, but the tubule cannot keep blood bicarbonate up, so blood becomes acidic while chloride rises to balance it. That is a normal anion gap, hyperchloraemic acidosis. This is standard teaching in medicine and nephrology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Proximal type 2 and distal type 1.</strong> In proximal (type 2) disease the proximal tubule fails to reclaim filtered bicarbonate, so bicarbonate is wasted in the urine and blood bicarbonate falls. In distal (type 1) disease alpha-intercalated cells in the distal tubule and collecting duct fail to secrete hydrogen ions, so the urine cannot be acidified, urine pH stays high, and calcium stones and nephrocalcinosis are favoured, often with low potassium. Flagged for review.",
    "<strong>Type 4 and treatment ideas shown.</strong> In type 4 disease aldosterone is lacking or resisted, so potassium excretion fails and potassium rises, with a milder acidosis because less ammonium is made. Bicarbonate (alkali) replaces what is lost or not regenerated, potassium replaces a low potassium where present, and a mineralocorticoid replaces missing aldosterone action in type 4. These are teaching toggles only, and potassium given when potassium is already high would be harmful in real care.",
  ],
  simplified: "Causes of each type, Fanconi syndrome features in proximal disease, bone disease, growth effects, ammonium handling in detail, urine anion gap testing, stone composition, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
