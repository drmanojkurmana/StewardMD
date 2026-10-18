/* Inflammatory bowel disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ibd.mjs [--print-model]
 * Static layout here; map lesions, wall depth, ulcers, fistula and gauges move in ibd.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease pattern", a: [0, 1, 2], names: ["Crohn disease", "ulcerative colitis", "severe flare"], ticks: ["Crohn", "ulcerative colitis", "severe flare"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "aminosalicylate" },
    { label: "corticosteroid" },
    { label: "biologic (anti TNF)" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "an aminosalicylate", "a corticosteroid", "a biologic"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const baseI = [0.78, 0.72, 0.96][t], baseU = [0.70, 0.76, 0.94][t], baseD = [0.92, 0.34, 0.88][t];
  const baseF = [0.85, 0.05, 0.70][t];
  const eI = [[0, 0, 0], [0.18, 0.48, 0.12], [0.55, 0.58, 0.62], [0.68, 0.65, 0.75]][drug][t];
  const eU = [[0, 0, 0], [0.15, 0.45, 0.10], [0.48, 0.52, 0.55], [0.62, 0.60, 0.70]][drug][t];
  const eD = [[0, 0, 0], [0.08, 0.28, 0.05], [0.30, 0.32, 0.35], [0.55, 0.48, 0.62]][drug][t];
  const I = cl(baseI * (1 - eI)), U = cl(baseU * (1 - eU)), D = cl(baseD * (1 - eD));
  const Sym = cl(0.55 * I + 0.30 * U + 0.15 * D);
  const Fist = cl(baseF * (0.25 + 0.75 * (baseI ? I / baseI : 0)));
  const crohnP = t === 0 ? 1 : t === 2 ? 0.55 : 0;
  const ucP = t === 1 ? 1 : t === 2 ? 0.75 : 0;
  const flareP = t === 2 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(I, 0.3, 0.6, ["low", "moderate", "high"]), w(U, 0.35, 0.65, ["little", "some", "extensive"]), w(D, 0.45, 0.75, ["mucosal", "deep", "transmural"]), w(Sym, 0.32, 0.62, ["mild", "moderate", "severe"])];
  return { t, drug, I, U, D, Sym, Fist, crohnP, ucP, flareP, asa: drug === 1 ? 1 : 0, ster: drug === 2 ? 1 : 0, bio: drug === 3 ? 1 : 0, words, readout: "inflammation " + words[0] + " · ulceration " + words[1] + " · wall damage " + words[2] + " · symptoms " + words[3] };
}
const TESTS = [
  [0, 0, "inflammation high · ulceration extensive · wall damage transmural · symptoms severe"],
  [1, 1, "inflammation moderate · ulceration some · wall damage mucosal · symptoms moderate"],
  [2, 3, "inflammation low · ulceration little · wall damage mucosal · symptoms mild"],
  [0, 3, "inflammation low · ulceration little · wall damage mucosal · symptoms mild"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">DISEASE MAP, TERMINAL ILEUM TO RECTUM</text>
<rect class="ibd-map" x="40" y="86" width="880" height="34" rx="17"/>
<g id="mapSeg"></g>
<text class="sc-lab" x="48" y="136">terminal ileum</text>
<text class="sc-lab" x="480" y="136" text-anchor="middle">colon</text>
<text class="sc-lab" x="912" y="136" text-anchor="end">rectum</text>
<rect class="ibd-lum" x="40" y="185" width="880" height="36" rx="8"/>
<text class="sc-lab sc-dim" x="52" y="207">lumen</text>
<rect class="ibd-muc" x="40" y="221" width="880" height="54"/>
<rect class="ibd-sub" x="40" y="275" width="880" height="42"/>
<rect class="ibd-musc" x="40" y="317" width="880" height="54"/>
<rect class="ibd-ser" x="40" y="371" width="880" height="22"/>
<rect id="inflam" class="ibd-inflam" x="40" y="221" width="880" height="120" opacity="0.3"/>
<text class="sc-lab" x="912" y="252" text-anchor="end">mucosa</text>
<text class="sc-lab" x="912" y="300" text-anchor="end">submucosa</text>
<text class="sc-lab" x="912" y="348" text-anchor="end">muscle</text>
<text class="sc-lab" x="912" y="386" text-anchor="end">serosa</text>
<g id="wallFx"></g>
<g id="cellsG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.ibd-map{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ibd-lesC{fill:var(--c-bad)}
.ibd-lesU{fill:#ff9a3d}
.ibd-lesF{fill:var(--c-bad)}
.ibd-lum{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 40%,var(--anatomy-mid));stroke-width:1}
.ibd-muc{fill:color-mix(in srgb,var(--c-endo) 30%,transparent)}
.ibd-sub{fill:color-mix(in srgb,var(--c-plt) 18%,transparent)}
.ibd-musc{fill:color-mix(in srgb,var(--c-rbc) 22%,transparent)}
.ibd-ser{fill:color-mix(in srgb,var(--c-mac) 28%,transparent)}
.ibd-inflam{fill:var(--c-bad)}
.ibd-ulc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.1}
.ibd-fiss{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.1}
.ibd-fist{fill:none;stroke:var(--c-bad);stroke-width:5;stroke-linecap:round}
.ibd-abs{fill:color-mix(in srgb,var(--c-bad) 55%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:1.2}
.cl-ent{--cc:#e9c07a}
.p-tnfp{--cc:var(--c-cyt)}
.p-bactp{--cc:var(--c-bac)}
.p-asap{--cc:#ffd24a}
.dr-g-fill.g-inf{fill:var(--c-bad)}
.dr-g-fill.g-ulc{fill:#ff9a3d}
.dr-g-fill.g-wall{fill:var(--c-cyt)}
.dr-g-fill.g-sym{fill:var(--c-fl)}
`;

buildScene({
  id: "inflammatory-bowel-disease", fig: "Fig 1", title: "Inflammatory bowel disease: Crohn disease and ulcerative colitis", W, H, body, extraCss,
  label: "An animated map and bowel wall in inflammatory bowel disease. The pattern slider shows Crohn disease with patchy skip lesions, deep fissures and a fistula, ulcerative colitis with continuous inflammation spreading up from the rectum and shallow mucosal ulcers, and a severe flare with widespread deep inflammation. A broken barrier lets microbes meet immune cells, which release cytokines and recruit more cells. Gauges show inflammation, ulceration, wall damage and symptoms. Treatment choices are an aminosalicylate, a corticosteroid and a biologic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ibd.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Two patterns of one group of diseases.</strong> Inflammatory bowel disease is chronic immune mediated inflammation of the gut, thought to arise from a disturbed barrier, gut microbes and a dysregulated immune response in a susceptible person. Crohn disease can affect any part of the gut, most often the terminal ileum and colon, in patchy skip lesions with healthy bowel between. Its inflammation goes through the full wall, so deep fissures, strictures, fistulae and abscesses can form. Ulcerative colitis affects the colon only, starts in the rectum and spreads upward without gaps, and its inflammation stays mainly in the mucosa, giving shallow ulcers, bleeding and urgency. A severe flare is widespread active inflammation with extensive ulceration and systemic upset in either pattern. This is standard teaching in medicine, gastroenterology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An aminosalicylate calms the mucosal surface and helps most in ulcerative colitis, with less effect on deep Crohn inflammation. A corticosteroid broadly suppresses immune activity and settles a flare, but does not heal the wall fully and is not a long term plan. A biologic that blocks tumour necrosis factor neutralises a key cytokine, so immune recruitment, ulceration and transmural damage fall in both patterns. These are teaching toggles only and name no individual drug or dose.",
  ],
  simplified: "Genetics and environmental triggers, the microbiome in detail, granulomas, strictures and bowel shortening, cancer risk, surgery, infection screening, individual biologics and small molecules, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
