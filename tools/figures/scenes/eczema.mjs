/* Atopic dermatitis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/eczema.mjs [--print-model]
 * Static layout here; particles, cells and gauges move in eczema.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Skin state", a: [0.3, 0.68, 1], names: ["dry skin", "acute flare", "chronic lichenified"], ticks: ["dry skin", "acute flare", "chronic lichenified"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "emollient" },
    { label: "topical steroid" },
    { label: "topical immunomodulator or biologic" },
  ],
  status: "Skin: {level} · {drug} ·",
  drugNames: ["no treatment", "emollient", "topical steroid", "immunomodulator or biologic"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const em = drug === 1 ? 1 : 0, st = drug === 2 ? 1 : 0, ib = drug === 3 ? 1 : 0;
  const barr = cl(0.12 + 0.82 * a * (em ? 0.5 : 1));
  const water = cl(0.08 + 0.88 * barr * (em ? 0.5 : 1));
  const aller = cl(barr * (em ? 0.55 : 1) * (0.35 + 0.65 * a));
  const th2 = cl(0.05 + 0.9 * aller * (st ? 0.35 : 1) * (ib ? 0.28 : 1) * (em ? 0.85 : 1));
  const ige = cl(0.04 + 0.85 * th2 * (ib ? 0.5 : 1) * (st ? 0.75 : 1));
  const itch = cl(0.05 + 0.9 * th2 * (st ? 0.5 : 1) * (ib ? 0.35 : 1));
  const scratch = cl(itch * (0.4 + 0.6 * a));
  const staph = cl(0.05 + 0.78 * a * (0.4 + 0.6 * barr) * (st ? 0.6 : 1) * (em ? 0.65 : 1) * (ib ? 0.8 : 1));
  const thick = cl((a - 0.55) * 1.8 * (st ? 0.7 : 1) * (ib ? 0.75 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(barr, 0.3, 0.6, ["mild defect", "leaky", "very leaky"]), w(water, 0.3, 0.6, ["low", "raised", "high"]), w(th2, 0.3, 0.6, ["low", "raised", "high"]), w(itch, 0.3, 0.6, ["low", "raised", "high"])];
  return { a, em, st, ib, barr, water, aller, th2, ige, itch, scratch, staph, thick, words, readout: "barrier " + words[0] + " · water loss " + words[1] + " · inflammation " + words[2] + " · itch " + words[3] };
}
const TESTS = [
  [0, 0, "barrier leaky · water loss raised · inflammation low · itch low"],
  [1, 0, "barrier very leaky · water loss high · inflammation raised · itch raised"],
  [2, 0, "barrier very leaky · water loss high · inflammation high · itch high"],
  [2, 2, "barrier very leaky · water loss high · inflammation raised · itch low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">SKIN</text>
<text class="sc-zone sc-dim" x="34" y="282">DERMIS</text>
<rect id="epi" class="epi-b" x="24" y="212" width="616" height="56" rx="6"/>
<rect id="vessel" class="vessel-b" x="30" y="388" width="600" height="26" rx="13"/>
<path id="nerveP" class="nerve" d="M540 414C530 370 552 340 540 300C530 272 544 250 538 222"/>
<g id="scratchG"><path class="scratch-p" d="M560 178l10 14l8 -12l10 14l8 -12l10 12"/><path class="scratch-p" d="M584 176l8 12l8 -10l8 12"/></g>
<g id="bricks"></g><g id="staphG"></g><g id="cellsG"></g><g id="parts"></g>
<rect class="inset-b" x="660" y="62" width="272" height="368" rx="14"/>
<text class="sc-zone" x="796" y="86" text-anchor="middle">DISTRIBUTION BY AGE</text>
<g>
<circle class="fig-b" cx="716" cy="122" r="14"/><ellipse class="fig-b" cx="716" cy="168" rx="19" ry="32"/><path class="fig-limb" d="M700 148L684 176M732 148L748 176M706 196L700 220M726 196L732 220"/>
<ellipse class="patch" cx="710" cy="120" rx="4" ry="3"/><ellipse class="patch" cx="722" cy="120" rx="4" ry="3"/><ellipse class="patch" cx="716" cy="166" rx="8" ry="10"/>
<text class="dr-pt2" x="716" y="242" text-anchor="middle">Infant</text><text class="dr-pt2" x="716" y="256" text-anchor="middle">face, trunk</text>
<circle class="fig-b" cx="796" cy="122" r="14"/><ellipse class="fig-b" cx="796" cy="168" rx="19" ry="32"/><path class="fig-limb" d="M780 148L764 176M812 148L828 176M786 196L780 220M806 196L812 220"/>
<ellipse class="patch" cx="766" cy="174" rx="5" ry="4"/><ellipse class="patch" cx="826" cy="174" rx="5" ry="4"/><ellipse class="patch" cx="782" cy="218" rx="5" ry="4"/><ellipse class="patch" cx="810" cy="218" rx="5" ry="4"/>
<text class="dr-pt2" x="796" y="242" text-anchor="middle">Child</text><text class="dr-pt2" x="796" y="256" text-anchor="middle">fold areas</text>
<circle class="fig-b" cx="876" cy="122" r="14"/><ellipse class="fig-b" cx="876" cy="168" rx="19" ry="32"/><path class="fig-limb" d="M860 148L844 176M892 148L908 176M866 196L860 220M886 196L892 220"/>
<ellipse class="patch" cx="844" cy="178" rx="5" ry="6"/><ellipse class="patch" cx="908" cy="178" rx="5" ry="6"/><ellipse class="patch" cx="862" cy="218" rx="5" ry="4"/><ellipse class="patch" cx="890" cy="218" rx="5" ry="4"/>
<text class="dr-pt2" x="876" y="242" text-anchor="middle">Adult</text><text class="dr-pt2" x="876" y="256" text-anchor="middle">hands, folds</text>
</g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "atopic-dermatitis", fig: "Fig 1", title: "Atopic dermatitis: broken barrier to itch", W, H, body,
  label: "An animated cross section of skin in atopic dermatitis. A filaggrin related barrier defect leaves gaps between the surface bricks, so water escapes and allergens and Staphylococcus enter. In the dermis, Th2 cells release IL-4 and IL-13, helping B cells make IgE and driving itch through a skin nerve. Scratching breaks the barrier further. Chronic disease thickens and roughens the skin. A side panel shows the typical distribution by age: face and trunk in infants, fold areas in children, and hands and folds in adults. Gauges show barrier defect, water loss, Th2 inflammation, IgE, itch and Staphylococcus. Treatment choices include an emollient, a topical steroid, and a topical immunomodulator or biologic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "eczema.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How atopic dermatitis develops.</strong> In many people the skin barrier is weakened, in part through filaggrin, a protein that helps the outer skin bricks hold together and hold water. Gaps in that barrier increase water loss, so skin dries, and let allergens and microbes enter. Staphylococcus aureus often colonises the broken, inflamed skin and can worsen flares. Immune cells in the skin take a Th2 pattern and release IL-4 and IL-13, which further weaken the barrier, help B cells make IgE, and drive itch. Scratching for itch breaks the barrier again, so the itch and scratch cycle keeps the disease going. Long standing rubbing and inflammation thicken the skin, called lichenification. The typical sites change with age: face and trunk in infancy, the elbow and knee folds in childhood, and hands and folds in adults. This is standard teaching in dermatology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An emollient fills gaps, reduces water loss and helps the barrier recover. A topical steroid calms the Th2 inflammation and itch in the skin. A topical immunomodulator or a biologic that blocks IL-4 and IL-13 signalling reduces Th2 drive, IgE help and itch. These are teaching toggles only.",
  ],
  simplified: "Other barrier genes, skin acidity and lipids in detail, food allergy testing, infection that needs separate treatment, eye and other complications, wet wrap and phototherapy, systemic treatments beyond the IL-4 and IL-13 idea, side effects, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.epi-b{fill:color-mix(in srgb,var(--c-endo) 34%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8}
.vessel-b{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8}
.brick{fill:#d9a05f;stroke:color-mix(in srgb,#d9a05f 55%,#000);stroke-width:.8}
body[data-theme="light"] .brick{fill:#c98d45}
.nerve{fill:none;stroke:var(--c-neut);stroke-width:2.4;stroke-linecap:round}
.scratch-p{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.inset-b{fill:color-mix(in srgb,var(--anatomy-paper) 72%,transparent);stroke:var(--anatomy-mid);stroke-width:.9}
.fig-b{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.8}
.fig-limb{fill:none;stroke:var(--c-lymph);stroke-width:5;stroke-linecap:round}
.patch{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:.5}
.staph-c{fill:#e9c33c;stroke:color-mix(in srgb,#e9c33c 55%,#000);stroke-width:.6}
.p-allg{--cc:#7fcf6a}
.p-treat{--cc:#5ec1a0}
.ige-p{fill:none;stroke:var(--c-b);stroke-width:1.6;stroke-linecap:round}
.cyt-l{fill:var(--anatomy-strong);stroke:none}
`,
});
