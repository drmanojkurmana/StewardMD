/* Diabetic complications as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dmc.mjs [--print-model]
 * Static layout here; glucose, AGEs, sorbitol, organ damage and gauges move in dmc.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Years of poor control", a: [0.2, 0.55, 1], names: ["a few years", "many years", "decades"], ticks: ["a few years", "many years", "decades"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "glucose control" },
    { label: "blood pressure control" },
    { label: "statin (lipid lowering)" },
    { label: "glucose, pressure and statin combined" },
  ],
  status: "Poor control: {level} · {drug} ·",
  drugNames: ["no treatment", "glucose control", "blood pressure control", "a statin", "combined treatment"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const glu = drug === 1 || drug === 4 ? 1 : 0, bp = drug === 2 || drug === 4 ? 1 : 0, stat = drug === 3 || drug === 4 ? 1 : 0;
  const G = cl(0.18 + 0.78 * a * (glu ? 0.32 : 1));
  const AGE = cl(0.06 + 0.9 * a * (glu ? 0.55 : 1));
  const Sorb = cl(0.05 + 0.9 * a * (glu ? 0.34 : 1));
  const Ret = cl(0.06 + 0.9 * a * (glu ? 0.48 : 1) * (bp ? 0.78 : 1));
  const Kid = cl(0.05 + 0.94 * a * (glu ? 0.5 : 1) * (bp ? 0.52 : 1));
  const Nerv = cl(0.05 + 0.92 * a * (glu ? 0.44 : 1));
  const Macro = cl(0.05 + 0.9 * a * (stat ? 0.44 : 1) * (bp ? 0.64 : 1) * (glu ? 0.82 : 1));
  const Limb = cl(Math.max(Macro * 0.92, Nerv * 0.66));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Ret, 0.3, 0.6, ["healthy", "damaged", "severe"]), w(Kid, 0.3, 0.6, ["healthy", "leaking", "failing"]), w(Nerv, 0.3, 0.6, ["healthy", "damaged", "severe"]), w(Macro, 0.3, 0.6, ["clear", "narrowed", "diseased"])];
  return { a, glu, bp, stat, G, AGE, Sorb, Ret, Kid, Nerv, Macro, Limb, words, readout: "retina " + words[0] + " · kidney " + words[1] + " · nerve " + words[2] + " · arteries " + words[3] };
}
const TESTS = [
  [1, 0, "retina damaged · kidney leaking · nerve damaged · arteries narrowed"],
  [1, 4, "retina healthy · kidney healthy · nerve healthy · arteries clear"],
  [2, 0, "retina severe · kidney failing · nerve severe · arteries diseased"],
  [2, 4, "retina damaged · kidney healthy · nerve damaged · arteries clear"],
];

/* ---------------- static layout ---------------- */
const tile = (x, y, w, name) => `<rect class="dm-tile" x="${x}" y="${y}" width="${w}" height="156" rx="14"/><text class="sc-zone" x="${x + 12}" y="${y + 20}">${name}</text>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
${tile(320, 84, 196, "RETINA")}
${tile(532, 84, 196, "KIDNEY")}
${tile(744, 84, 202, "NERVE")}
${tile(320, 256, 196, "HEART")}
${tile(532, 256, 196, "BRAIN")}
${tile(744, 256, 202, "FOOT")}
<g id="src"></g><g id="glow"></g><g id="org"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
body{--c-gluc:#f2b23a;--c-age:#c98a3d;--c-sorb:#9a6ae0;--c-alb:#7ab8ff;--c-stat:#35b184}
body[data-theme="light"]{--c-gluc:#c98a1f;--c-age:#a86e28;--c-sorb:#7c4fc4;--c-alb:#2f7ad8;--c-stat:#1e7f5c}
.dm-tile{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.8}
.dm-vess{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,var(--anatomy-mid));stroke-width:1.6}
.dm-nodeA{fill:color-mix(in srgb,var(--c-age) 30%,var(--anatomy-paper));stroke:var(--c-age);stroke-width:1.6}
.dm-nodeP{fill:color-mix(in srgb,var(--c-sorb) 26%,var(--anatomy-paper));stroke:var(--c-sorb);stroke-width:1.6}
.dm-wallO{fill:color-mix(in srgb,var(--c-endo) 40%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.dm-wallI{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper))}
.dm-cross{fill:none;stroke:var(--c-age);stroke-width:1.4;stroke-linecap:round}
.dm-dotP{fill:var(--c-sorb)}
.dm-micro{fill:var(--c-bad)}
.dm-myel{fill:color-mix(in srgb,var(--c-neut) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-neut) 60%,#000);stroke-width:1}
.dm-art{fill:none;stroke:var(--c-rbc);stroke-width:5;stroke-linecap:round}
.dm-plaque{fill:#d9b97a;stroke:#b8962f;stroke-width:.8}
.dm-ulcer{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1}
.dm-beam{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 5;opacity:.5}
.dm-glow{fill:var(--c-bad);stroke:none}
.dm-gate{fill:var(--c-stat);stroke:color-mix(in srgb,var(--c-stat) 60%,#000);stroke-width:1}
.dm-cap{fill:var(--anatomy-strong);font-size:12px}
.p-gluc{--cc:var(--c-gluc)}.p-alb{--cc:var(--c-alb)}.p-stat{--cc:var(--c-stat)}
.dr-g-fill.g-gluc{fill:var(--c-gluc)}.dr-g-fill.g-age{fill:var(--c-age)}.dr-g-fill.g-sorb{fill:var(--c-sorb)}
`;

buildScene({
  id: "diabetic-complications", fig: "Fig 1", title: "Diabetic complications: small and large vessel damage", W, H, body, extraCss,
  label: "An animated map of the chronic complications of diabetes. Years of high glucose build advanced glycation end products that cross link proteins and thicken vessel walls, and drive the polyol pathway that fills cells with sorbitol and weakens antioxidant defence. Small vessel damage affects the retina, the kidney glomerulus and peripheral nerves. Large vessel atherosclerosis affects the heart, the brain and the limb. Gauges show glucose, AGE load, sorbitol stress, retina, kidney, nerve and arterial plaque. Treatment choices are glucose control, blood pressure control and a statin.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "dmc.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With combined treatment",
  sourcesLis: [
    "<strong>How chronic complications develop.</strong> Long standing hyperglycaemia glycates proteins and lipids to form advanced glycation end products (AGEs). AGEs cross link collagen, thicken capillary basement membranes and bind receptors that drive inflammation and oxidative stress. Glucose is also converted by aldose reductase through the polyol pathway to sorbitol and fructose, consuming NADPH, weakening glutathione defence and adding osmotic stress, especially in lens, nerve and kidney cells. Protein kinase C and other pathways add vessel injury. This is standard teaching in medicine and diabetes texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Small and large vessel patterns.</strong> Microvascular disease gives retinopathy (pericyte loss, microaneurysms, leak, bleeding and new vessels), nephropathy (glomerular basement membrane thickening, mesangial expansion, albumin in the urine and falling filtration) and neuropathy (sorbitol and ischaemic injury to peripheral nerves, with sensory loss). Macrovascular disease is faster and more extensive atherosclerosis, giving coronary heart disease, stroke and peripheral arterial disease, and in the foot it combines with neuropathy to raise ulcer and amputation risk. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Glucose control slows AGE and sorbitol formation and most clearly protects the small vessels. Blood pressure control protects the kidney, retina, brain and heart. A statin lowers lipid driven plaque growth and most clearly protects the large arteries. These are teaching toggles only.",
  ],
  simplified: "Diabetic foot care, eye screening and injection treatments, kidney protective drug classes beyond pressure control, lipid and glucose targets, erectile and gut autonomic problems, and all doses and drug choices are left out. Damage built up over years is only partly reversible, and the figure does not say how any patient should be treated.",
});
