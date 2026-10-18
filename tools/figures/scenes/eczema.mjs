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
    { label: "IL-4 and IL-13 blocker" },
  ],
  status: "Skin: {level} · {drug} ·",
  drugNames: ["no treatment", "emollient", "topical steroid", "IL-4 and IL-13 blocker"],
};
function modelOf(S, level, drug) {
  const EFF = [
    { seal: 1, calm: 1, block: 0 },
    { seal: 0.45, calm: 0.95, block: 0 },
    { seal: 0.95, calm: 0.4, block: 0 },
    { seal: 0.85, calm: 0.3, block: 1 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level], e = EFF[drug];
  const barr = cl((0.12 + 0.83 * a) * e.seal * (0.6 + 0.4 * e.calm));
  const water = cl((0.08 + 0.88 * barr) * (drug === 1 ? 0.55 : 1));
  const aller = cl(barr * (0.35 + 0.65 * a));
  const th2 = cl((0.05 + 0.9 * aller) * e.calm * (e.block ? 0.35 : 1));
  const ige = cl((0.04 + 0.85 * th2) * (e.block ? 0.5 : 1) * (drug === 2 ? 0.75 : 1));
  const itch = cl((0.05 + 0.8 * th2 + 0.15 * barr) * (e.block ? 0.5 : 1));
  const scratch = cl(itch * (0.4 + 0.6 * a));
  const staph = cl((0.05 + 0.78 * a * (0.4 + 0.6 * barr)) * (drug === 1 ? 0.65 : 1) * (drug === 2 ? 0.7 : 1) * (e.block ? 0.6 : 1));
  const thick = cl((a - 0.55) * 1.8 * (drug === 2 ? 0.7 : 1) * (e.block ? 0.75 : 1) * (drug === 1 ? 0.9 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(barr, 0.3, 0.6, ["mild defect", "leaky", "very leaky"]), w(water, 0.3, 0.6, ["low", "raised", "high"]), w(th2, 0.3, 0.6, ["low", "raised", "high"]), w(itch, 0.3, 0.6, ["low", "raised", "high"])];
  return { a, em: drug === 1 ? 1 : 0, st: drug === 2 ? 1 : 0, ib: drug === 3 ? 1 : 0, barr, water, aller, th2, ige, itch, scratch, staph, thick, words, readout: "barrier " + words[0] + " · water loss " + words[1] + " · inflammation " + words[2] + " · itch " + words[3] };
}
const TESTS = [
  [0, 0, "barrier leaky · water loss raised · inflammation low · itch low"],
  [1, 0, "barrier very leaky · water loss high · inflammation raised · itch raised"],
  [2, 0, "barrier very leaky · water loss high · inflammation high · itch high"],
  [2, 3, "barrier leaky · water loss raised · inflammation low · itch low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="skinSlotL"></g>
<g id="skinSlotR"></g>
<g id="vesselSlot"></g>
<g id="blushG"></g>
<g id="thickG"></g>
<g id="bricks"></g>
<g id="staphG"></g>
<g id="cellsG"></g>
<g id="nerveG"></g>
<g id="scratchG"></g>
<g id="parts"></g>
<g id="filmG"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "atopic-dermatitis", fig: "Fig 1", title: "Atopic dermatitis: broken barrier to itch", W, H, body,
  label: "An animated cross section of real skin in atopic dermatitis. Gaps between the surface bricks let water escape and let allergens and Staphylococcus enter. In the dermis, Th2 alarm cells release IL-4 and IL-13, which help B cells release IgE and drive itch along a skin nerve. Scratching tears the surface again, and long rubbing thickens the skin. Gauges show barrier defect, water loss, inflammation, itch and Staphylococcus. Treatments are an emollient that seals the surface, a topical steroid that calms the alarm cells, and a blocker of IL-4 and IL-13 that plugs their receivers.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "eczema.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With IL-4 and IL-13 blocker",
  sourcesLis: [
    "<strong>How atopic dermatitis develops.</strong> In many people the skin barrier is weakened, in part through filaggrin, a protein that helps the outer skin bricks hold together and hold water. Gaps in that barrier increase water loss, so skin dries, and let allergens and microbes enter. Staphylococcus aureus often colonises the broken, inflamed skin and can worsen flares. Immune cells in the skin take a Th2 pattern and release IL-4 and IL-13, which further weaken the barrier, help B cells make IgE, and drive itch. Scratching for itch breaks the barrier again, so the itch and scratch cycle keeps the disease going. Long standing rubbing and inflammation thicken the skin, called lichenification. This is standard teaching in dermatology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An emollient seals the surface, so less water escapes and fewer germs get in. A topical steroid calms the Th2 alarm cells in the skin. A blocker of IL-4 and IL-13 signalling plugs the receivers on cells, so the alarm signal, IgE help and itch fade. These are teaching toggles only.",
  ],
  simplified: "Other barrier genes, skin acidity and lipids in detail, food allergy testing, infection that needs separate treatment, eye and other complications, wet wrap and phototherapy, typical sites by age, systemic treatments beyond the IL-4 and IL-13 idea, side effects, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ec-blush{fill:var(--c-bad);stroke:none}
.ec-thick{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:none}
.ec-film{fill:color-mix(in srgb,var(--c-plt) 60%,var(--anatomy-paper));stroke:none}
.ec-filmb{fill:none;stroke:var(--c-plt);stroke-width:2}
.ec-block{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linecap:round}
.ec-nerve{fill:none;stroke:var(--c-neut);stroke-width:2.4;stroke-linecap:round}
.ec-scratch{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.ec-cap{fill:var(--anatomy-strong)}
.brick{fill:#d9a05f;stroke:color-mix(in srgb,#d9a05f 55%,#000);stroke-width:.8}
body[data-theme="light"] .brick{fill:#c98d45}
.staph-c{fill:#e9c33c;stroke:color-mix(in srgb,#e9c33c 55%,#000);stroke-width:.6}
.p-allg{--cc:#7fcf6a}
.p-emol{--cc:#5ec1a0}
.p-ster{--cc:#b48ce8}
.ige-p{fill:none;stroke:var(--c-b);stroke-width:1.6;stroke-linecap:round}
`,
});
