/* Leukaemias as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/leuk.mjs [--print-model]
 * Static layout here; marrow cells, chromosome inset and gauges move in leuk.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Leukaemia type and stage", a: [0, 1, 2, 3, 4, 5, 6], names: ["normal marrow", "AML (acute myeloid leukaemia)", "ALL (acute lymphoid leukaemia)", "CML, chronic phase", "CML, blast crisis", "CLL, early", "CLL, advanced"], ticks: ["normal", "AML", "ALL", "CML chronic", "CML blast", "CLL early", "CLL advanced"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "chemotherapy" },
    { label: "targeted kinase inhibitor (BCR-ABL)" },
    { label: "stem cell transplant" },
  ],
  status: "Picture: {level} · {drug} ·",
  drugNames: ["no treatment", "chemotherapy", "a targeted kinase inhibitor", "a stem cell transplant"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const blast0 = [0.03, 0.85, 0.88, 0.07, 0.82, 0.02, 0.03][t];
  const clone0 = [0.02, 0.85, 0.88, 0.70, 0.90, 0.45, 0.88][t];
  const lymph0 = [0, 0, 0, 0, 0, 0.50, 0.90][t];
  const myel0 = [0.30, 0.08, 0.06, 0.85, 0.30, 0.10, 0.08][t];
  const red0 = [0.95, 0.25, 0.22, 0.78, 0.25, 0.85, 0.30][t];
  const neut0 = [0.95, 0.18, 0.20, 0.88, 0.22, 0.80, 0.35][t];
  const plt0 = [0.95, 0.22, 0.20, 0.72, 0.25, 0.85, 0.32][t];
  const effC = [0, 0.70, 0.75, 0.25, 0.50, 0.35, 0.40][t];
  const effK = [0, 0.03, 0.03, 0.85, 0.45, 0.03, 0.03][t];
  const effT = [0, 0.85, 0.85, 0.80, 0.80, 0.75, 0.75][t];
  const eff = drug === 1 ? effC : drug === 2 ? effK : drug === 3 ? effT : 0;
  const tox = drug === 1 ? 0.12 : drug === 2 ? 0.02 : drug === 3 ? 0.08 : 0;
  const clone = cl(clone0 * (1 - eff));
  const blast = cl(blast0 * (1 - eff));
  const lymph = cl(lymph0 * (1 - eff));
  const myel = myel0 > 0.3 ? cl(0.3 + (myel0 - 0.3) * (1 - eff)) : myel0;
  const rec = (b) => cl(b + eff * (1 - b) * 0.85 - tox * b);
  const red = rec(red0), neut = rec(neut0), plt = rec(plt0);
  const mature = cl((red + neut + plt) / 3);
  const F = cl(0.45 * clone + 0.75 * (1 - mature));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(clone, 0.25, 0.6, ["low", "moderate", "high"]), w(mature, 0.35, 0.65, ["low", "reduced", "preserved"]), w(F, 0.35, 0.65, ["working", "strained", "failing"])];
  return { t, drug, eff, blast, clone, lymph, myel, red, neut, plt, mature, F, words, readout: "leukaemic cells " + words[0] + " · normal blood cells " + words[1] + " · marrow " + words[2] };
}
const TESTS = [
  [0, 0, "leukaemic cells low · normal blood cells preserved · marrow working"],
  [1, 0, "leukaemic cells high · normal blood cells low · marrow failing"],
  [3, 2, "leukaemic cells low · normal blood cells preserved · marrow working"],
  [6, 1, "leukaemic cells moderate · normal blood cells reduced · marrow strained"],
];

/* ---------------- static layout ---------------- */
const CARDS = [
  ["AML  acute myeloid", "myeloid blasts build up", "marrow fails quickly"],
  ["ALL  acute lymphoid", "lymphoid blasts build up", "marrow fails quickly"],
  ["CML  chronic myeloid", "Philadelphia chromosome", "slow phase, then blast crisis"],
  ["CLL  chronic lymphocytic", "mature lymphocytes build up", "slow build up over years"],
];
const cards = CARDS.map((c, i) => { const x = 22 + i * 232;
  return `<g class="hot sc-card" id="card${i}" tabindex="0" data-info="${esc(["AML: acute myeloid leukaemia. Immature myeloid blasts accumulate in the marrow and crowd out normal blood cell production.", "ALL: acute lymphoblastic leukaemia. Immature lymphoid blasts accumulate in the marrow and crowd out normal blood cell production.", "CML: chronic myeloid leukaemia. A chromosome change creates the BCR-ABL kinase, driving excess myeloid cells. It can progress from chronic phase to blast crisis.", "CLL: chronic lymphocytic leukaemia. Long lived, mature looking lymphocytes accumulate slowly in marrow, blood and lymph nodes."][i])}"><rect class="sc-card-r" x="${x}" y="46" width="220" height="72" rx="12"/><text class="sc-zone" x="${x + 12}" y="66">${esc(c[0])}</text><text class="sc-lab" x="${x + 12}" y="86">${esc(c[1])}</text><text class="sc-lab sc-dim2" x="${x + 12}" y="104">${esc(c[2])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue lk-bone" x="14" y="126" width="${W - 28}" height="316" rx="18"/>
${cards}
<text class="sc-zone" x="34" y="150">BONE MARROW</text>
<text class="sc-zone sc-dim" x="806" y="150">PERIPHERAL BLOOD</text>
<path class="lk-arrow" d="M178 292H618"/>
<path class="lk-arrow" d="M690 292H796"/>
<rect id="phbox" class="lk-phbox" x="648" y="158" width="278" height="82" rx="10" opacity="0"/>
<rect class="lk-vessel" x="800" y="240" width="126" height="186" rx="18"/>
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sc-card-r{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-card.on .sc-card-r{stroke:var(--anatomy-lit);stroke-width:2;fill:color-mix(in srgb,var(--anatomy-lit) 10%,var(--anatomy-card))}
.sc-dim2{opacity:.75}
.lk-bone{stroke:var(--anatomy-faint);stroke-width:1}
.lk-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.lk-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.lk-phbox{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.lk-block{stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.lk-chr9{fill:#d9a441;stroke:color-mix(in srgb,#d9a441 55%,#000);stroke-width:.7}
.lk-chr22{fill:#5fa8d3;stroke:color-mix(in srgb,#5fa8d3 55%,#000);stroke-width:.7}
.lk-fus{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.7}
.lk-pht{fill:var(--anatomy-strong);font:600 9px var(--anatomy-mono);pointer-events:none}
.cl-stem{--cc:#4fae94}.cl-prog{--cc:#d9a441}.cl-blast{--cc:#e07a6a}.cl-lyblast{--cc:#7fc4e8}.cl-cll{--cc:var(--c-lymph)}
.p-div{--cc:var(--c-bad)}.p-tki{--cc:#ffd24a}
.dr-g-fill.g-rbc{fill:var(--c-rbc)}
.mk-c{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.4}.mk-x{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.mk-g{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
`;

buildScene({
  id: "leukaemias", fig: "Fig 1", title: "Leukaemias: when marrow makes the wrong cells", W, H, body, extraCss,
  label: "An animated bone marrow and peripheral blood. A stem cell normally makes progenitors that mature into red cells, neutrophils and platelets. In leukaemia a clonal population builds up: immature blasts in AML and ALL, excess myeloid cells driven by the Philadelphia chromosome change in CML, and mature looking lymphocytes in CLL. The crowd blocks normal production, so red cells, neutrophils and platelets fall and anaemia, infection and bleeding follow. Gauges show leukaemic cells, red cells, neutrophils and platelets. Treatment choices include chemotherapy, a targeted kinase inhibitor and stem cell transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "leuk.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Normal production and how leukaemia blocks it.</strong> Haematopoietic stem cells in the marrow make progenitor cells that mature along myeloid and lymphoid lines into red cells, neutrophils, other white cells and platelets. In leukaemia a single altered stem or progenitor cell expands as a clone. In AML (acute myeloid leukaemia) and ALL (acute lymphoblastic leukaemia) immature blasts accumulate and normal maturation is blocked, so the marrow fails quickly, causing anaemia, infection from lack of neutrophils, and bleeding from lack of platelets. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The chronic leukaemias.</strong> In CML (chronic myeloid leukaemia) a swap between chromosomes 9 and 22 (the Philadelphia translocation) joins BCR to ABL and creates a constantly active kinase that drives excess myeloid cell production; the disease can progress from a chronic phase with few blasts to blast crisis, which behaves like an acute leukaemia. In CLL (chronic lymphocytic leukaemia) long lived, mature looking lymphocytes accumulate slowly and marrow failure, when it comes, is late. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Chemotherapy kills dividing cells including blasts. A targeted kinase inhibitor blocks the BCR-ABL kinase, so it helps in CML where that target is present and does little where it is absent. Stem cell transplant replaces the marrow stem cell population after the leukaemic marrow is cleared. These are teaching toggles only.",
  ],
  simplified: "Subtypes and risk groups, cytogenetic and molecular variants beyond the Philadelphia change, staging systems, lymph node and spleen enlargement, immune dysfunction in CLL, tumour lysis, transplant conditioning and graft effects, and all drug choices and doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
