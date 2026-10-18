/* Chronic myeloid leukaemia and the Philadelphia chromosome as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cml.mjs [--print-model]
 * Static layout here; marrow cells, kinase signals, blood, spleen and gauges move in cml.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease phase", a: [0, 1, 2], names: ["chronic phase", "accelerated phase", "blast phase"], ticks: ["chronic", "accelerated", "blast"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "chemotherapy" },
    { label: "tyrosine kinase inhibitor" },
    { label: "stem cell transplant" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "chemotherapy", "a tyrosine kinase inhibitor", "a stem cell transplant"],
};
function modelOf(S, level, drug) {
  const baseK = [0.85, 0.9, 0.95];
  const baseG = [0.78, 0.85, 0.45];
  const baseB = [0.07, 0.35, 0.88];
  const baseN = [0.72, 0.48, 0.22];
  const baseSp = [0.55, 0.75, 0.85];
  const effK = [[0, 0, 0], [0.2, 0.18, 0.15], [0.88, 0.62, 0.32], [0.9, 0.88, 0.85]][drug][level];
  const effC = [[0, 0, 0], [0.45, 0.4, 0.35], [0.85, 0.55, 0.3], [0.9, 0.88, 0.82]][drug][level];
  const tox = [0, 0.12, 0.02, 0.08][drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = cl(baseK[level] * (1 - effK));
  const G = cl(baseG[level] * (1 - effC));
  const B = cl(baseB[level] * (1 - effC));
  const N = cl(baseN[level] + effC * (1 - baseN[level]) * 0.85 - tox);
  const Sp = cl(baseSp[level] * (1 - effC * 0.75));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.6, ["low", "raised", "high"]), w(G, 0.25, 0.55, ["low", "raised", "high"]), w(B, 0.15, 0.4, ["low", "raised", "high"])];
  return { K, G, B, N, Sp, effC, drug, words, readout: "kinase " + words[0] + " · granulocytes " + words[1] + " · blasts " + words[2] };
}
const TESTS = [
  [0, 0, "kinase high · granulocytes high · blasts low"],
  [2, 0, "kinase high · granulocytes raised · blasts high"],
  [0, 2, "kinase low · granulocytes low · blasts low"],
  [2, 2, "kinase high · granulocytes raised · blasts high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CHROMOSOME CHANGE</text>
<text class="sc-zone" x="335" y="68">BONE MARROW</text>
<text class="sc-zone" x="688" y="68">BLOOD AND SPLEEN</text>
<rect class="cml-chr9" x="72" y="100" width="16" height="68" rx="7"/>
<rect class="cml-chr22" x="152" y="100" width="16" height="46" rx="7"/>
<text class="sc-lab" x="80" y="184" text-anchor="middle">9</text>
<text class="sc-lab" x="160" y="162" text-anchor="middle">22</text>
<path class="cml-arrow" d="M94 112C112 96 132 96 148 108"/>
<path class="cml-arrow" d="M148 132C132 146 112 146 94 136"/>
<rect class="cml-chr22" x="112" y="198" width="14" height="22" rx="6"/>
<rect class="cml-chr9" x="112" y="220" width="14" height="16" rx="6"/>
<rect class="cml-bcr" x="52" y="262" width="86" height="26" rx="6"/>
<rect class="cml-abl" x="138" y="262" width="96" height="26" rx="6"/>
<text class="sc-lab" x="95" y="279" text-anchor="middle">BCR</text>
<text class="sc-lab" x="186" y="279" text-anchor="middle">ABL</text>
<path class="cml-arrow" d="M150 290V326"/>
<path class="cml-arrow" d="M176 352H312"/>
<g id="kinase"><circle class="cml-kin" cx="150" cy="352" r="21"/><circle class="cml-kinin" cx="150" cy="352" r="8"/></g>
<rect class="cml-marrow" x="320" y="84" width="330" height="310" rx="16"/>
<rect class="cml-vessel" x="688" y="84" width="88" height="210" rx="16"/>
<g id="spleen"></g>
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cml-marrow{fill:color-mix(in srgb,var(--c-bac) 9%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.cml-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.cml-chr9{fill:#d9a441;stroke:color-mix(in srgb,#d9a441 55%,#000);stroke-width:.7}
.cml-chr22{fill:#5fa8d3;stroke:color-mix(in srgb,#5fa8d3 55%,#000);stroke-width:.7}
.cml-bcr{fill:#5fa8d3;stroke:color-mix(in srgb,#5fa8d3 55%,#000);stroke-width:.7}
.cml-abl{fill:#d9a441;stroke:color-mix(in srgb,#d9a441 55%,#000);stroke-width:.7}
.cml-kin{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:1}
.cml-kinin{fill:var(--anatomy-paper);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.7}
.cml-spleen{fill:#b0526b;stroke:color-mix(in srgb,#b0526b 55%,#000);stroke-width:1}
.cml-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.cl-cmlstem{--cc:#4fae94}.cl-cmlprog{--cc:#d9a441}.cl-cmlblast{--cc:#e07a6a}
.p-sig{--cc:var(--c-cyt)}.p-tki{--cc:#ffd24a}.p-div{--cc:var(--c-bad)}
.mk-c{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.4}.mk-x{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
`;

buildScene({
  id: "cml-philadelphia", fig: "Fig 1", title: "Chronic myeloid leukaemia: the Philadelphia chromosome", W, H, body, extraCss,
  label: "An animated chromosome change, bone marrow, blood and spleen. A swap between chromosomes 9 and 22 makes the Philadelphia chromosome and a BCR-ABL fusion gene. Its kinase is always on and drives a clonal stem cell to make too many granulocytes, so the spleen enlarges. In chronic phase the cells still mature, in accelerated phase maturation falters, and in blast phase immature blasts take over and normal blood production fails. Gauges show kinase activity, granulocytes, blasts and normal blood. Treatment choices include chemotherapy, a tyrosine kinase inhibitor and stem cell transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cml.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>The chromosome change and the clone.</strong> Chronic myeloid leukaemia is a clonal myeloid neoplasm of a haematopoietic stem cell. A reciprocal swap between chromosomes 9 and 22 creates the Philadelphia chromosome and joins BCR on chromosome 22 to ABL on chromosome 9. The fusion gene makes a tyrosine kinase that stays switched on without its usual controls, so signalling for growth and survival never stops and granulocyte production expands. The clone gradually takes over haematopoiesis in the marrow. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Phases, blood and spleen.</strong> In chronic phase the excess cells still mature, so granulocytes and sometimes platelets rise, red cell production is often fairly preserved at first, and the enlarged spleen may be the main finding. Further genetic aberrations and mutations can occur as the clone evolves. In accelerated phase maturation falters, blasts and basophils rise and anaemia deepens. In blast phase immature blasts dominate like an acute leukaemia, normal marrow fails, and anaemia, infection and bleeding follow. Germline predisposition is uncommon in this disease; radiation is a recognised risk factor in classic teaching. Classification follows the phase and the fusion, in line with World Health Organization style grouping of myeloid neoplasms. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A tyrosine kinase inhibitor blocks the BCR-ABL kinase and is highly effective in chronic phase, less so once blast phase and resistant variants develop. Chemotherapy reduces the dividing clone less selectively. Stem cell transplant can replace the clonal stem cell population and remains a potentially curative option for selected patients, previously the main curative route before kinase inhibitors. These are teaching toggles only and the likely response varies by phase.",
  ],
  simplified: "Other chromosome aberrations and kinase domain variants, basophil and eosinophil detail, risk scores, monitoring of the fusion transcript, second generation inhibitors, transplant conditioning and graft effects, and all drug choices and doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
