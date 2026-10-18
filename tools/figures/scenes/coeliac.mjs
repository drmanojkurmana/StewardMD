/* Coeliac disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/coeliac.mjs [--print-model]
 * Static layout here; villi, crypts, particles and gauges move in coeliac.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;
const SURF = 290;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Villous atrophy", a: [0, 0.55, 1], names: ["normal", "partial villous atrophy", "total villous atrophy"], ticks: ["normal", "partial", "total"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment (gluten continues)" },
    { label: "gluten-free diet" },
    { label: "nutrient replacement (iron, folate, fat support)" },
  ],
  status: "Mucosa: {level} · {drug} ·",
  drugNames: ["no treatment", "a gluten-free diet", "nutrient replacement"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const gfd = drug === 1 ? 1 : 0, repl = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Gl = gfd ? 0.06 : 0.92;
  const D = cl(Gl * (0.3 + 0.7 * a));
  const I = cl(0.06 + 0.88 * a * (gfd ? 0.15 : 1));
  const Ab = cl(0.05 + 0.82 * a * (gfd ? 0.4 : 1));
  const V = cl(1 - 0.9 * a * (gfd ? 0.28 : 1));
  const C = cl(0.12 + 0.82 * a * (gfd ? 0.3 : 1));
  const Abs = cl(0.08 + 0.88 * V);
  const N = cl(Abs * 0.9 + repl * 0.45 + gfd * a * 0.05);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(V, 0.35, 0.7, ["flat", "short", "tall"]), w(I, 0.3, 0.6, ["low", "moderate", "high"]), w(Abs, 0.35, 0.65, ["poor", "reduced", "good"]), w(N, 0.35, 0.65, ["low", "borderline", "ok"])];
  return { a, gfd, repl, Gl, D, I, Ab, V, C, Abs, N, words, readout: "villi " + words[0] + " · T-cell attack " + words[1] + " · absorption " + words[2] + " · nutrients " + words[3] };
}
const TESTS = [
  [0, 0, "villi tall · T-cell attack low · absorption good · nutrients ok"],
  [2, 0, "villi flat · T-cell attack high · absorption poor · nutrients low"],
  [2, 1, "villi tall · T-cell attack low · absorption good · nutrients ok"],
  [2, 2, "villi flat · T-cell attack high · absorption poor · nutrients borderline"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="co-lumen" x="14" y="44" width="${W - 28}" height="150" rx="18"/>
<rect id="blood" class="sc-lumen" x="24" y="400" width="${W - 48}" height="30" rx="15"/>
<text class="sc-zone" x="34" y="68">GUT LUMEN</text>
<text class="sc-zone sc-dim" x="34" y="392">LAMINA PROPRIA</text>
<text class="sc-zone sc-dim" x="880" y="392" text-anchor="end">BLOOD</text>
<g id="crypts"></g>
<g id="villi"></g>
<g id="parts"></g>
<g id="immune"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "coeliac-malabsorption", fig: "Fig 1", title: "Coeliac disease: gluten to malabsorption", W, H, body,
  label: "An animated small bowel mucosa. Gluten gliadin reaches the mucosa and is deamidated by tissue transglutaminase. An antigen-presenting cell carrying HLA-DQ2 or DQ8 shows deamidated gliadin to T cells. Activated T cells attack enterocytes, villi flatten and crypts deepen, so iron, folate and fat are poorly absorbed into the blood. Antibodies to tissue transglutaminase and endomysium appear. Gauges show gliadin load, T-cell attack, antibodies, villi, absorption and nutrient stores. A gluten-free diet removes the driver and nutrient replacement supports stores without healing the mucosa.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or test cut-offs are shown or implied.",
  scene: { SURF, W, H }, pageJs: readFileSync(join(HERE, "coeliac.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `.co-lumen{fill:var(--c-fl);opacity:.14}.co-villus{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}.co-crypt{fill:var(--c-mac);opacity:.45;stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:.8}.co-surface{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;opacity:.6}.p-glu{--cc:#d9a441}.p-deam{--cc:#f08a4b}.p-atk{--cc:#e5484d}.p-iron{--cc:#c98a5e}.p-folate{--cc:#3ddc97}.p-fat{--cc:#f2d27a}.p-repl{--cc:#5ec1a0}.p-ttg{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 50%,#000);stroke-width:.5}.co-ab{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round}.dr-g-fill.g-gli{fill:#d9a441}.dr-g-fill.g-atk{fill:var(--c-bad)}.dr-g-fill.g-ab2{fill:var(--c-ab)}.dr-g-fill.g-vil{fill:var(--c-good)}.dr-g-fill.g-abs{fill:var(--c-fl)}.dr-g-fill.g-nut{fill:#e9b84a}`,
  sourcesLis: [
    "<strong>How coeliac disease develops.</strong> In people with HLA-DQ2 or HLA-DQ8, gliadin peptides from dietary gluten resist digestion and cross the small bowel epithelium. In the lamina propria the enzyme tissue transglutaminase deamidates gliadin, which makes it bind HLA-DQ2 or DQ8 on antigen-presenting cells much more strongly. Those cells activate gluten-specific CD4 T cells. T-cell cytokines and cytotoxic attack injure enterocytes, producing villous atrophy with crypt hyperplasia and a flat mucosa that absorbs iron, folate, fat and other nutrients poorly. Antibodies to tissue transglutaminase and to endomysium are markers of the same response. This is standard teaching in gastroenterology and immunology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A lifelong gluten-free diet removes the trigger and lets the mucosa recover. Nutrient replacement corrects deficiencies such as iron and folate while the mucosa is damaged, but on its own it does not stop the immune attack or heal villi. These are teaching toggles only.",
  ],
  simplified: "Increased epithelial permeability pathways, intraepithelial lymphocyte killing in detail, B-cell maturation, dermatitis herpetiformis, refractory coeliac disease, lymphoma risk, biopsy grading, antibody test performance, dietetic support and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
