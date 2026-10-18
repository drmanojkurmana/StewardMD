/* Diarrhoea and ORS as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/diarr.mjs [--print-model]
 * Static layout here; toxin, solute, invaders, transport, fluid loss and gauges move in diarr.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Type of diarrhoea", a: [0.9, 0.7, 0.85], names: ["secretory", "osmotic", "invasive"], ticks: ["secretory", "osmotic", "invasive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "oral rehydration solution (ORS)" },
    { label: "intravenous fluids" },
    { label: "antibiotic" },
  ],
  status: "Type: {level} · {drug} ·",
  drugNames: ["no treatment", "ORS", "intravenous fluids", "an antibiotic"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ors = drug === 1 ? 1 : 0, iv = drug === 2 ? 1 : 0, abx = drug === 3 ? 1 : 0;
  let Camp = [0.92, 0.08, 0.28][level], Sol = [0.08, 0.95, 0.15][level], Inv = [0.05, 0.05, 0.95][level];
  if (abx) { Camp *= 0.3; Inv *= 0.25; }
  const Sec = cl(0.08 + 0.78 * Camp + 0.28 * Inv);
  let Abs = [0.55, 0.3, 0.25][level];
  if (ors) Abs = cl(Abs + (level === 2 ? 0.3 : 0.48));
  let Int = [0.92, 0.85, 0.35][level];
  if (abx && level === 2) Int = cl(Int + 0.28);
  const L = cl(0.08 + 0.68 * Sec + 0.52 * Sol + 0.38 * Inv - 0.1 * Abs * ors);
  const D = cl(0.05 + 0.85 * L - ors * 0.32 - iv * 0.52 - abx * 0.15 * L);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(L, 0.35, 0.65, ["mild", "moderate", "heavy"]), w(D, 0.3, 0.6, ["none", "some", "severe"]), w(Abs, 0.35, 0.65, ["poor", "partial", "working well"])];
  return { ors, iv, abx, Camp, Sol, Inv, Sec, Abs, Int, L, D, words, readout: "stool loss " + words[0] + " · dehydration " + words[1] + " · absorption " + words[2] };
}
const TESTS = [
  [0, 0, "stool loss heavy · dehydration severe · absorption partial"],
  [0, 1, "stool loss moderate · dehydration none · absorption working well"],
  [2, 3, "stool loss moderate · dehydration some · absorption poor"],
  [1, 1, "stool loss moderate · dehydration none · absorption working well"],
];

/* ---------------- static layout ---------------- */
const CY = 350;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GUT LUMEN</text>
<text class="sc-zone sc-dim" x="300" y="432">BLOOD AND BODY FLUID</text>
<rect class="dia-lumen" x="28" y="72" width="808" height="96" rx="12"/>
<rect class="dia-epi" x="28" y="168" width="708" height="84" rx="10"/>
<rect id="cap" class="dia-cap" x="48" y="322" width="660" height="56" rx="28"/>
<rect class="dia-pipe" x="790" y="168" width="46" height="142"/>
<path class="dia-beaker" d="M768 310h110l-12 84h-86z"/>
<rect id="stool" class="dia-stool" x="782" y="380" width="82" height="8" rx="3"/>
<g id="cells"></g><g id="parts"></g><g id="rbcs"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-ent{--cc:#e9c07a}.cl-inv{--cc:var(--c-bac)}
.dia-lumen{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-mid));stroke-width:1}
.dia-epi{fill:color-mix(in srgb,#e9c07a 14%,transparent)}
.dia-cap{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 40%,var(--anatomy-mid));stroke-width:1}
.dia-pipe{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper))}
.dia-beaker{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.dia-stool{fill:var(--c-fl);opacity:.75}
.dia-sglt{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.dia-cftr{fill:#c084fc;stroke:color-mix(in srgb,#c084fc 55%,#000);stroke-width:.8}
.dia-villi{stroke:color-mix(in srgb,#e9c07a 70%,#000);stroke-width:1.1;stroke-linecap:round}
.dia-zinc{fill:#e8d36a;stroke:color-mix(in srgb,#e8d36a 55%,#000);stroke-width:.7}
.p-tox{--cc:#ff9a3d}.p-solute{--cc:#e8d36a}.p-camp{--cc:#c084fc}.p-cl{--cc:#38d1ff}.p-na{--cc:#b27af0}.p-glu{--cc:#e8d36a}.p-ors{fill:var(--c-fl)}.p-abx{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.dr-g-fill.g-sec{fill:#c084fc}.dr-g-fill.g-abs{fill:var(--c-good)}.dr-g-fill.g-loss{fill:var(--c-fl)}.dr-g-fill.g-deh{fill:var(--c-bad)}.dr-g-fill.g-int{fill:#e9c07a}
`;

buildScene({
  id: "diarrhoea-ors", fig: "Fig 1", title: "Diarrhoea: fluid loss and oral rehydration", W, H, body, extraCss,
  label: "An animated cross-section of gut wall. The slider picks secretory, osmotic or invasive diarrhoea. In secretory diarrhoea a toxin raises cAMP, opens chloride channels and fluid pours into the lumen. In osmotic diarrhoea unabsorbed solute holds water in the lumen. In invasive diarrhoea organisms damage the epithelium and absorption fails. Sodium glucose co-transport stays open and oral rehydration solution uses it to pull sodium and water into the blood. Gauges show secretion, absorption, stool loss, dehydration and epithelial integrity, and treatments are ORS, intravenous fluids and an antibiotic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, volumes or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "diarr.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Three ways fluid is lost.</strong> Secretory diarrhoea: cholera toxin locks a stimulatory G protein on, adenylate cyclase stays active and cyclic AMP rises inside the enterocyte. That opens CFTR chloride channels, chloride leaves into the lumen, and sodium and water follow, while sodium chloride absorption is reduced. Osmotic diarrhoea: solute that is not absorbed (for example after mucosal damage or disaccharidase loss) holds water in the lumen by osmosis. Invasive diarrhoea: organisms such as Shigella or Campylobacter invade and inflame the epithelium, cells are damaged, absorption fails and blood and mucus may appear. This is standard teaching in medicine, physiology and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why ORS works, and the role of zinc.</strong> The sodium glucose co-transporter (SGLT) on the brush border is not switched off by cyclic AMP, so glucose with sodium is still absorbed and water follows it. Oral rehydration solution uses that route to replace losses even while secretion continues; it replaces fluid rather than stopping the diarrhoea at once. Intravenous fluids restore the circulation directly when losses or dehydration are too great for the gut route. An antibiotic helps only where a bacterial cause is present, for example cholera or invasive bacterial disease, and does nothing for an osmotic cause. Zinc as an adjunct supports epithelial recovery and is part of standard childhood diarrhoea care in many guidelines. These are teaching toggles only.",
  ],
  simplified: "Viral causes such as rotavirus, toxin types beyond cholera toxin, motility and inflammatory diarrhoeas in detail, malabsorption syndromes, blood and mucus grading, dehydration examination signs and fluid calculations, ORS composition, zinc dosing, resistant organisms, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
