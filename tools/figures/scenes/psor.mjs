/* Psoriasis pathogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/psor.mjs [--print-model]
 * Static layout here; skin layers, immune cells and gauges move in psor.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Plaque extent and thickness", a: [0.08, 0.55, 1], names: ["clear", "mild plaque", "severe"], ticks: ["clear", "mild plaque", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "topical steroid and vitamin D" },
    { label: "phototherapy" },
    { label: "biologic targeting TNF, IL-17 or IL-23" },
  ],
  status: "Disease: {level} · {drug} ·",
  drugNames: ["no treatment", "topical steroid and vitamin D", "phototherapy", "a biologic targeting TNF, IL-17 or IL-23"],
};
function modelOf(S, level, drug) {
  const EFF = [
    { dc: 1, th: 1, cyt: 1, joint: 1 },
    { dc: 0.85, th: 0.85, cyt: 0.7, joint: 0.95 },
    { dc: 0.7, th: 0.75, cyt: 0.65, joint: 0.85 },
    { dc: 0.5, th: 0.45, cyt: 0.4, joint: 0.35 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level], e = EFF[drug];
  const D = cl(a * e.dc);
  const T17 = cl(D * 1.05 * e.th);
  const Cyt = cl(T17 * e.cyt);
  const K = cl(0.05 + Cyt);
  const Thick = cl(0.06 + K * 0.85);
  const Scale = cl(Thick * 1.02 - 0.04);
  const Vessel = cl(0.04 + Cyt * 0.98);
  const Joint = cl(a * a * 1.15 * e.joint);
  const top = drug === 1 ? 1 : 0, pho = drug === 2 ? 1 : 0, bio = drug === 3 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Thick, 0.25, 0.6, ["near normal", "thickened", "very thick"]), w(Scale, 0.25, 0.6, ["none", "some", "heavy"]), w(Vessel, 0.25, 0.6, ["quiet", "red", "very red"]), w(Joint, 0.2, 0.5, ["quiet", "aching", "inflamed"])];
  return { a, D, T17, Cyt, K, Thick, Scale, Vessel, Joint, top, pho, bio, words, readout: "epidermis " + words[0] + " · scale " + words[1] + " · redness " + words[2] + " · joints " + words[3] };
}
const TESTS = [
  [2, 0, "epidermis very thick · scale heavy · redness very red · joints inflamed"],
  [2, 3, "epidermis near normal · scale none · redness quiet · joints aching"],
  [0, 0, "epidermis near normal · scale none · redness quiet · joints quiet"],
  [1, 1, "epidermis thickened · scale some · redness red · joints aching"],
];

/* ---------------- static layout ---------------- */
const EPITOP = 118;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="ps-derm" x="14" y="185" width="${W - 28}" height="255" rx="18"/>
<text class="sc-zone" x="34" y="68">SKIN PLAQUE, CROSS SECTION</text>
<text class="sc-zone sc-dim" x="34" y="208">DERMIS</text>
<g id="vessels"></g>
<path id="epi" class="ps-epi" d=""/>
<path id="gran" class="ps-gran" d=""/>
<g id="kcs"></g>
<g id="scales"></g>
<g id="joint"></g>
<g id="immune"></g>
<g id="fx"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "psoriasis-pathogenesis", fig: "Fig 1", title: "Psoriasis: immune drive to scaly plaque", W, H, body,
  label: "An animated cross section of skin with a psoriasis plaque. Dendritic cells in the dermis are activated and release IL-23, which sustains Th17 cells. Th17 cells release IL-17 and TNF, which drive keratinocytes in the epidermis to divide too fast. The epidermis thickens, its granular layer thins, nuclei are retained in the scale (parakeratosis), dermal vessels dilate, and a scaly plaque forms. Removing scale can give pinpoint bleeding (Auspitz sign), injury can seed new lesions (Koebner phenomenon), and the same inflammation can involve joints. Gauges show immune drive, cytokines, epidermal thickness, scale, redness and joint inflammation. Treatments include topical steroid with vitamin D, phototherapy, and biologics targeting TNF, IL-17 or IL-23.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H, EPITOP }, pageJs: readFileSync(join(HERE, "psor.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How psoriasis develops.</strong> In susceptible skin, triggers and injury activate dendritic cells. Their IL-23 sustains Th17 cells, and Th17 cytokines IL-17 and TNF act on keratinocytes, which proliferate and mature too fast. The epidermis thickens with elongated rete ridges, the granular layer is lost, and nuclei persist in the stratum corneum (parakeratosis), giving a silvery scaly plaque over dilated dermal vessels. Pinpoint bleeding when scale is lifted is the Auspitz sign; new plaques at sites of trauma are the Koebner phenomenon; a related inflammatory arthritis can affect joints. This is standard teaching in dermatology and internal medicine texts covering eczema, psoriasis and other common skin disorders, including topical agents and systemic options for characteristic lesions, and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Topical steroid with a vitamin D agent calms inflammation and slows keratinocyte growth on the skin, phototherapy dampens cutaneous immune activity, and a biologic that targets TNF, IL-17 or IL-23 interrupts the cytokine axis and can also help joint disease. These are teaching toggles only.",
  ],
  simplified: "Genetic susceptibility, triggers such as infection and medicines, the full cytokine network, nail disease, plaque subtypes, cardiovascular and metabolic associations, infection and malignancy screening for systemic therapy, and all doses and product choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-dc{--cc:var(--c-mac)}.cl-th17{--cc:var(--c-lymph)}.cl-kc{--cc:var(--c-endo)}
.ps-derm{fill:color-mix(in srgb,var(--c-endo) 10%,var(--anatomy-paper));opacity:.7}
.ps-epi{fill:color-mix(in srgb,var(--c-endo) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 60%,#000);stroke-width:1}
.ps-gran{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;stroke-dasharray:5 4;opacity:.8}
.ps-scale{fill:#eadfc2;stroke:#b8a678;stroke-width:.7}
.ps-para{fill:#7a5c8f}
.ps-vessel{fill:none;stroke:var(--c-rbc);stroke-linecap:round}
.ps-vesselbg{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke-linecap:round}
.ps-bone{fill:#e9dec4;stroke:#a89468;stroke-width:1}
.ps-jointbox{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ps-jointglow{fill:var(--c-bad)}
.ps-scratch{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.ps-denuded{fill:color-mix(in srgb,var(--c-rbc) 18%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:.7}
.ps-dot{fill:var(--c-rbc)}
.ps-cream{fill:#f3e9f7;stroke:#b9a3cc;stroke-width:.7}
.ps-ray{stroke:#f2c94c;stroke-width:2;stroke-linecap:round}
.p-il23{--cc:var(--c-cyt)}.p-il17{--cc:var(--c-cyt2)}.p-tnf{--cc:#ff9a3d}.p-ab{--cc:var(--c-good)}
.ps-ab{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-linecap:round}
.dr-g-fill.g-imm{fill:var(--c-mac)}.dr-g-fill.g-epi{fill:var(--c-endo)}.dr-g-fill.g-scale{fill:#d9c98a}
`,
});
