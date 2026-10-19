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
    { label: "ORS with antibiotic" },
  ],
  status: "Type: {level} · {drug} ·",
  drugNames: ["no treatment", "ORS", "intravenous fluids", "an antibiotic", "ORS with an antibiotic"],
};
function modelOf(S, level, drug) {
  const ty = level;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ors = drug === 1 || drug === 4 ? 1 : 0, iv = drug === 2 ? 1 : 0, abx = drug === 3 || drug === 4 ? 1 : 0;
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
  return { ty, drug, ors, iv, abx, Camp, Sol, Inv, Sec, Abs, Int, L, D, words, readout: "stool loss " + words[0] + " · dehydration " + words[1] + " · absorption " + words[2] };
}
const TESTS = [
  [0, 0, "stool loss heavy · dehydration severe · absorption partial"],
  [0, 4, "stool loss mild · dehydration none · absorption working well"],
  [2, 3, "stool loss moderate · dehydration some · absorption poor"],
  [1, 1, "stool loss moderate · dehydration none · absorption working well"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="dia-lumen" x="28" y="72" width="808" height="72" rx="12"/>
<path id="orsFlowA" class="dia-orsflow" d="M320 224 C330 250 390 252 448 248"/>
<path id="orsFlowB" class="dia-orsflow" d="M460 224 L469 243"/>
<path id="orsFlowC" class="dia-orsflow" d="M600 224 C590 250 540 252 492 248"/>
<g id="glowG"><ellipse id="dehyHalo" class="dia-halo" cx="470" cy="325" rx="86" ry="100" opacity="0"/></g>
<g id="bowelSlot"></g>
<g id="vesselSlot"></g>
<ellipse id="bowelUlc" class="dia-ulc" cx="164" cy="339" rx="26" ry="34" opacity="0"/>
<rect class="dia-pipe" x="800" y="144" width="36" height="170"/>
<path class="dia-beaker" d="M772 314h104l-11 78h-82z"/>
<rect id="stool" class="dia-stool" x="784" y="380" width="70" height="8" rx="3"/>
<g id="bagG" opacity="0">
<rect class="dia-bag" x="352" y="268" width="46" height="58" rx="8"/>
<rect class="dia-bagfl" x="357" y="290" width="36" height="31" rx="5"/>
<path class="dia-tube" d="M375 326 C375 348 400 350 427 342"/>
</g>
<g id="cells"></g><g id="parts"></g><g id="rbcs"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-ent{--cc:#e9c07a}.cl-inv{--cc:var(--c-bac)}
.dia-lumen{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-mid));stroke-width:1}
.dia-pipe{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper))}
.dia-beaker{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.dia-stool{fill:var(--c-fl);opacity:.75}
.dia-stoolb{fill:var(--c-bad);opacity:.8}
.dia-sglt{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.dia-cftr{fill:#c084fc;stroke:color-mix(in srgb,#c084fc 55%,#000);stroke-width:.8}
.dia-villi{fill:none;stroke:color-mix(in srgb,#e9c07a 70%,#000);stroke-width:1.1;stroke-linecap:round}
.dia-orsflow{fill:none;stroke:var(--c-good);stroke-width:9;stroke-linecap:round;opacity:0}
.dia-bag{fill:color-mix(in srgb,var(--anatomy-paper) 80%,var(--c-fl));stroke:var(--anatomy-mid);stroke-width:1.2}
.dia-bagfl{fill:var(--c-fl);stroke:none}
.dia-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:2.5}
.dia-ulc{fill:color-mix(in srgb,var(--c-bad) 55%,#5a1f1f);stroke:color-mix(in srgb,var(--c-bad) 65%,#000);stroke-width:1.2}
.dia-halo{fill:var(--c-bad);stroke:none}
.di-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-tox{--cc:#ff9a3d}.p-solute{--cc:#e8d36a}.p-camp{--cc:#c084fc}.p-cl{--cc:#38d1ff}.p-na{--cc:#b27af0}.p-glu{--cc:#e8d36a}.p-ors{fill:var(--c-fl)}.p-abx{--cc:#c084fc}
.dr-g-fill.g-sec{fill:#c084fc}.dr-g-fill.g-abs{fill:var(--c-good)}.dr-g-fill.g-loss{fill:var(--c-fl)}.dr-g-fill.g-deh{fill:var(--c-bad)}.dr-g-fill.g-int{fill:#e9c07a}
`;

buildScene({
  id: "diarrhoea-ors", fig: "Fig 1", title: "Diarrhoea: fluid loss and oral rehydration", W, H, body, extraCss,
  label: "An animated cross-section of gut wall above a real small bowel and a blood vessel. The slider picks secretory, osmotic or invasive diarrhoea. In secretory diarrhoea a toxin raises cAMP, opens chloride channels and fluid pours into the lumen. In osmotic diarrhoea unabsorbed solute holds water in the lumen. In invasive diarrhoea germs damage the wall and absorption fails. Sodium glucose co-transport stays open and oral rehydration solution uses it to pull salt and water into blood. Gauges show secretion, absorption, stool loss, dehydration and wall injury, and treatments are ORS, intravenous fluids, an antibiotic, and ORS with antibiotic combined.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, volumes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "diarr.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With ORS and antibiotic",
  sourcesLis: [
    "<strong>Three ways fluid is lost.</strong> Secretory diarrhoea: cholera toxin locks a stimulatory G protein on, adenylate cyclase stays active and cyclic AMP rises inside the wall. That opens CFTR chloride channels, chloride leaves into the lumen, and salt and water follow, while salt uptake is reduced. Osmotic diarrhoea: solute that is not absorbed holds water in the lumen by osmosis. Invasive diarrhoea: germs such as Shigella or Campylobacter invade and inflame the wall, cells are damaged, absorption fails and blood and mucus may appear. This is standard teaching in medicine, physiology and infectious disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why ORS works.</strong> The sodium glucose co-transporter (SGLT) on the surface is not switched off by cyclic AMP, so sugar with salt is still taken up and water follows it. Oral rehydration solution uses that route to replace losses even while secretion continues; it replaces fluid rather than stopping the diarrhoea at once. Intravenous fluids restore the blood directly when losses are too great for the gut route. An antibiotic helps only where a bacterial cause is present, for example cholera or invasive bacterial disease, and does nothing for an osmotic cause. These are teaching toggles only.",
  ],
  simplified: "Viral causes such as rotavirus, toxin types beyond cholera toxin, motility and inflammatory diarrhoeas in detail, malabsorption syndromes, blood and mucus grading, dehydration examination signs and fluid calculations, ORS composition, resistant germs, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
