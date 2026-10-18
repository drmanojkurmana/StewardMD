/* Acne vulgaris pathogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/acnefig.mjs [--print-model]
 * Static layout here; sebum, plug, bacteria and inflammation animate in acnefig.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pattern of acne shown", a: [0, 1, 2], names: ["comedonal", "inflammatory", "nodulocystic"], ticks: ["comedonal", "inflammatory", "nodulocystic"], start: 1 },
  drugLabel: "Treatment concept",
  settings: [
    { label: "no treatment" },
    { label: "topical retinoid" },
    { label: "antibiotic with benzoyl peroxide" },
    { label: "oral isotretinoin (concept)" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "a topical retinoid", "an antibiotic with benzoyl peroxide", "oral isotretinoin (concept)"],
};
function modelOf(S, level, drug) {
  const base = [
    { seb: 0.5, plug: 0.85, bac: 0.4, infl: 0.18, depth: 0.2 },
    { seb: 0.72, plug: 0.8, bac: 0.78, infl: 0.72, depth: 0.55 },
    { seb: 0.95, plug: 0.85, bac: 0.9, infl: 0.97, depth: 1 },
  ][level];
  const eff = [
    { seb: 1, plug: 1, bac: 1, infl: 1 },
    { seb: 0.88, plug: 0.22, bac: 0.72, infl: 0.78 },
    { seb: 1, plug: 0.9, bac: 0.18, infl: 0.55 },
    { seb: 0.14, plug: 0.32, bac: 0.3, infl: 0.48 },
  ][drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Seb = cl(base.seb * eff.seb);
  const Plug = cl(base.plug * eff.plug);
  const Bac = cl(base.bac * eff.bac * (0.45 + 0.55 * Plug) * (0.5 + 0.5 * Seb / Math.max(0.2, base.seb)));
  const Infl = cl(base.infl * eff.infl * (0.45 + 0.55 * (base.bac ? Bac / Math.max(0.15, base.bac * eff.bac) : 1)));
  const Les = cl(0.3 * Plug + 0.42 * Infl + 0.28 * Bac);
  const Scar = cl(Les * (0.25 + 0.75 * base.depth) * (0.4 + 0.6 * Infl));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Seb, 0.3, 0.62, ["low", "moderate", "high"]), w(Plug, 0.3, 0.62, ["small", "forming", "blocking"]), w(Bac, 0.28, 0.6, ["few", "present", "many"]), w(Infl, 0.28, 0.6, ["calm", "inflamed", "intense"])];
  return { Seb, Plug, Bac, Infl, Les, Scar, depth: base.depth, words, readout: "sebum " + words[0] + " · plug " + words[1] + " · C. acnes " + words[2] + " · inflammation " + words[3] };
}
const TESTS = [
  [0, 0, "sebum moderate · plug blocking · C. acnes present · inflammation calm"],
  [1, 0, "sebum high · plug blocking · C. acnes many · inflammation intense"],
  [1, 2, "sebum high · plug blocking · C. acnes few · inflammation inflamed"],
  [2, 3, "sebum low · plug small · C. acnes few · inflammation inflamed"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="sc-derm" x="14" y="138" width="${W - 28}" height="302" rx="18"/>
<rect class="sc-epi" x="14" y="102" width="${W - 28}" height="38" rx="10"/>
<text class="sc-zone" x="34" y="68">SKIN AND PILOSEBACEOUS UNIT</text>
<text class="sc-zone sc-dim" x="34" y="128">EPIDERMIS</text>
<text class="sc-zone sc-dim" x="34" y="162">DERMIS</text>
<path class="sc-foll" d="M448 108 L462 342 Q480 356 498 342 L512 108 L498 108 L492 326 Q480 334 468 326 L462 108 Z"/>
<path class="sc-duct" d="M448 232 L466 246 L466 262 L442 252 Z"/>
<rect id="vessel" class="sc-lumen" x="14" y="392" width="${W - 28}" height="34"/>
<text class="sc-zone sc-dim" x="34" y="414">DERMAL VESSEL</text>
<path id="hair" class="sc-hair" d="M477 58 L483 58 L482 330 L478 330 Z"/>
<g id="nodule"></g>
<g id="gland"></g>
<g id="plug"></g>
<g id="lesion"></g>
<g id="bac"></g>
<g id="rbcs"></g>
<g id="parts"></g>
<g id="cells"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-seb:#e9b84a;--c-ker:#e6d3a3;--c-cac:#7fcf6a;--c-les:#e5484d;--c-pus:#f5e6a8}
body[data-theme="light"]{--c-seb:#c9931a;--c-ker:#b89b5e;--c-cac:#4fa63c;--c-les:#c42a3d;--c-pus:#d9b84a}
.cl-seb{--cc:var(--c-seb)}.cl-ker{--cc:var(--c-ker)}
.sc-epi{fill:color-mix(in srgb,var(--c-endo) 34%,var(--anatomy-paper));opacity:.85}
.sc-derm{fill:color-mix(in srgb,var(--c-tis) 70%,var(--anatomy-paper));opacity:.5}
.sc-foll{fill:color-mix(in srgb,var(--c-ker) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.sc-duct{fill:color-mix(in srgb,var(--c-seb) 30%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.sc-hair{fill:#8a6a4a;stroke:#6b4f33;stroke-width:.8}
.sc-plug{fill:var(--c-ker);stroke:color-mix(in srgb,var(--c-ker) 55%,#000);stroke-width:1}
.sc-lesion{fill:var(--c-les);opacity:.55}
.sc-pust{fill:var(--c-pus);stroke:color-mix(in srgb,var(--c-pus) 55%,#000);stroke-width:.8}
.sc-nodule{fill:var(--c-les);opacity:.38;stroke:var(--c-les);stroke-width:1.4}
.sc-scar{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round;opacity:.7}
.p-seb{fill:var(--c-seb);stroke:color-mix(in srgb,var(--c-seb) 50%,#000);stroke-width:.5}
.p-ker{fill:var(--c-ker);stroke:color-mix(in srgb,var(--c-ker) 50%,#000);stroke-width:.5}
.p-cyt2{--cc:var(--c-cyt)}
.p-treat{fill:#38d1ff;stroke:#0a6a9a;stroke-width:.5}
.dr-g-fill.g-seb{fill:var(--c-seb)}.dr-g-fill.g-plug{fill:var(--c-ker)}.dr-g-fill.g-les{fill:var(--c-les)}.dr-g-fill.g-scar{fill:var(--anatomy-strong)}
`;

buildScene({
  id: "acne-pathogenesis", fig: "Fig 1", title: "Acne vulgaris: from sebum and plug to inflamed lesion", W, H, body, extraCss,
  label: "An animated cross section of skin with a hair follicle and sebaceous gland. Androgen driven sebum and abnormal shedding of follicle lining cells form a comedone plug. Cutibacterium acnes grows in the plugged, sebum rich follicle and inflammation follows, making papules and pustules and, when deep, nodules that can scar. Gauges show sebum, plug, bacteria, inflammation, lesion and scar risk. Treatment concepts include a topical retinoid, an antibiotic with benzoyl peroxide, and oral isotretinoin.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "acnefig.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How acne develops.</strong> Four linked steps are standard teaching: androgens at puberty enlarge sebaceous glands and increase sebum; follicle lining cells shed abnormally and stick together (follicular hyperkeratinisation), plugging the follicle as a comedone; Cutibacterium acnes (formerly Propionibacterium acnes), a normal skin resident, multiplies in the plugged sebum rich follicle; and inflammation follows, from early inflammatory signals around the follicle to papules, pustules and, when deep and intense, nodules and cyst like lesions that can scar. Whiteheads are closed comedones and blackheads are open comedones, the dark colour coming from exposed keratin and lipid, not dirt. This is standard teaching in dermatology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A topical retinoid mainly normalises follicle shedding and unplugs comedones. An antibiotic with benzoyl peroxide mainly reduces C. acnes and inflammation (benzoyl peroxide also limits resistance). Oral isotretinoin, shown as a concept only, shrinks sebaceous glands and cuts sebum, and indirectly reduces plugging, bacteria and inflammation. They are teaching toggles only.",
  ],
  simplified: "Hormonal detail beyond the androgen signal, diet, cosmetics, picking and squeezing, hormonal acne patterns, rosacea and other acne look alikes, antimicrobial resistance detail, maintenance therapy, and all doses, durations and safety monitoring are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
