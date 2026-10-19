/* Megaloblastic anaemia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/megalo.mjs [--print-model]
 * Static layout here; vitamin flow, marrow cells, blood cells, myelin and gauges move in megalo.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "What is missing", a: [0, 1, 2], names: ["folate deficiency", "vitamin B12 deficiency", "pernicious anaemia"], ticks: ["folate low", "B12 low", "pernicious"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "folate replacement" },
    { label: "vitamin B12 replacement" },
    { label: "folate and B12 replacement" },
  ],
  status: "Picture: {level} · {drug} ·",
  drugNames: ["no treatment", "folate replacement", "vitamin B12 replacement", "folate and B12 replacement"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const folLow = [0.88, 0.18, 0.18][t], bLow = [0.12, 0.86, 0.97][t], ifK = [1, 1, 0][t];
  const txF = drug === 1 || drug === 3 ? 1 : 0, txB = drug === 2 || drug === 3 ? 1 : 0;
  const bEff = cl(bLow * (txB ? 0.06 : 1));
  const fDirect = cl(folLow * (txF ? 0.06 : 1));
  const trap = bEff * 0.82;
  const fEff = cl(Math.max(fDirect, txF ? trap * 0.32 : trap));
  const dna = cl(1 - fEff * 1.02);
  const macro = cl(fEff * 1.05);
  const nerve = cl(1 - bEff);
  const folLvl = cl(1 - fDirect), bLvl = cl(1 - bEff);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(dna, 0.3, 0.65, ["low", "reduced", "working"]), w(macro, 0.3, 0.65, ["normal", "large", "very large"]), w(nerve, 0.35, 0.7, ["damaged", "at risk", "intact"])];
  return { t, txF, txB, ifK, folLow, bLow, bEff, fDirect, fEff, dna, macro, nerve, folLvl, bLvl, words, readout: "DNA synthesis " + words[0] + " · red cells " + words[1] + " · nerves " + words[2] };
}
const TESTS = [
  [0, 0, "DNA synthesis low · red cells very large · nerves intact"],
  [1, 0, "DNA synthesis low · red cells very large · nerves damaged"],
  [1, 1, "DNA synthesis working · red cells normal · nerves damaged"],
  [2, 2, "DNA synthesis working · red cells normal · nerves intact"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="286" height="396" rx="18"/>
<rect class="sc-tissue mg-marrow" x="312" y="44" width="328" height="396" rx="18"/>
<rect class="sc-tissue" x="652" y="44" width="294" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">SUPPLY AND ABSORPTION</text>
<text class="sc-zone" x="332" y="68">BONE MARROW</text>
<text class="sc-zone" x="672" y="68">BLOOD AND NERVES</text>
<path class="mg-flow" d="M252 412H356"/>
<path class="mg-flow" d="M596 412H690"/>
<rect class="mg-vessel" x="672" y="92" width="254" height="168" rx="16"/>
<rect class="mg-inset" x="336" y="292" width="280" height="92" rx="10"/>
<path class="mg-axon" d="M682 352H928"/>
<g id="stomachSlot"></g>
<g id="bowelSlot"></g>
<g id="supply"></g>
<g id="marrow"></g>
<g id="blood"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-fol:#7fcf6a;--c-b12:#c084fc;--c-if:#ffd24a;--c-myel:#f2d27a}
body[data-theme="light"]{--c-fol:#4fa63c;--c-b12:#7c3aed;--c-if:#d9a92c;--c-myel:#d9a92c}
.mg-marrow{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--c-tis))}
.mg-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.mg-inset{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.mg-flow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.mg-axon{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round}
.mg-dna{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.mg-rung{fill:none;stroke:var(--anatomy-mid);stroke-width:1}
.mg-block{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.mg-myel{fill:var(--c-myel);stroke:color-mix(in srgb,var(--c-myel) 55%,#000);stroke-width:.8}
.mg-gap{fill:color-mix(in srgb,#000 55%,transparent);stroke:none}
.mg-halo{fill:#e88ca0;stroke:none}
.mg-tab{fill:var(--c-fol);stroke:color-mix(in srgb,var(--c-fol) 55%,#000);stroke-width:1}
.mg-vial{fill:color-mix(in srgb,var(--c-b12) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-b12) 60%,#000);stroke-width:1.2}
.mg-vcap{fill:color-mix(in srgb,var(--c-b12) 60%,#000);stroke:none}
.mg-trap{fill:color-mix(in srgb,var(--c-fol) 45%,#888);stroke:color-mix(in srgb,var(--c-fol) 55%,#000);stroke-width:.6}
.mg-cap{fill:var(--anatomy-strong);font-size:13px}
.cl-fol{--cc:var(--c-fol)}.cl-b12{--cc:var(--c-b12)}.cl-mega{--cc:#e88ca0}.cl-daught{--cc:#e9a2b3}
.p-fol{--cc:var(--c-fol)}.p-b12{--cc:var(--c-b12)}.p-b12if{--cc:var(--c-b12);stroke:var(--c-if);stroke-width:2}
.p-if{fill:var(--c-if);stroke:color-mix(in srgb,var(--c-if) 55%,#000);stroke-width:.5}
.dr-g-fill.g-fol{fill:var(--c-fol)}.dr-g-fill.g-b12{fill:var(--c-b12)}.dr-g-fill.g-macro{fill:var(--c-rbc)}
`;

buildScene({
  id: "megaloblastic-anaemia", fig: "Fig 1", title: "Megaloblastic anaemia: when DNA synthesis lags behind", W, H, body, extraCss,
  label: "An animated supply chain, bone marrow, blood and nerve picture. Folate and vitamin B12 are both needed to make DNA building blocks. B12 is taken in with food, binds intrinsic factor from the stomach, and is absorbed in the terminal ileum. When folate or B12 is missing, marrow cells keep growing their cytoplasm but cannot divide their nucleus on time, so they release large red cells called macrocytes and neutrophils with too many nucleus lobes. B12 lack also traps folate in an unusable form and damages myelin and nerves, which folate lack does not. Folate tablets restock DNA blocks, B12 replacement frees trapped folate and reaches the marrow even when the gut cannot absorb, and gauges show DNA synthesis, vitamin levels, red cell size and nerve health. Treatment choices are folate replacement and B12 replacement.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "megalo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With folate and B12",
  sourcesLis: [
    "<strong>Why the cells become large.</strong> Folate, helped by vitamin B12, supplies one carbon units needed to build thymine and other DNA building blocks. Without enough of either vitamin, DNA copying slows while RNA and protein making in the cytoplasm carries on. The nucleus lags behind the cytoplasm (nuclear cytoplasmic asynchrony), marrow precursors grow large and divide fewer times, and the blood shows large red cells (macrocytes, raised mean cell volume) and neutrophils with extra nucleus lobes (hypersegmented neutrophils). This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>How B12 is absorbed, and pernicious anaemia.</strong> Vitamin B12 from food binds intrinsic factor, a protein made by parietal cells of the stomach. The combined complex is absorbed in the terminal ileum. In pernicious anaemia the immune system attacks parietal cells or intrinsic factor itself, so intrinsic factor is missing and B12 cannot be absorbed even when the diet contains enough. Folate is absorbed higher in the small bowel and does not need intrinsic factor. This is standard teaching in haematology and gastroenterology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Nerves, and the treatment trap.</strong> Vitamin B12 is also needed to keep myelin healthy, so B12 deficiency can damage the spinal cord and peripheral nerves, while folate deficiency alone does not do this. B12 lack also traps folate in a form the cell cannot use for DNA, so giving folate to a person who lacks B12 can repair the blood picture while nerve damage carries on, which is why the missing vitamin must be identified. Treatment choices in the figure are teaching toggles only.",
  ],
  simplified: "Causes of folate and B12 lack beyond diet and pernicious anaemia (bowel disease and surgery, medicines, pregnancy demand, alcohol), homocysteine and methylmalonic acid testing, antibodies and gastric biopsy, other blood lineages and pancytopenia, glossitis and other clinical features, how B12 replacement is given in practice, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
