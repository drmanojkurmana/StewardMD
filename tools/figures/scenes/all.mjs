/* Acute lymphoblastic leukaemia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/all.mjs [--print-model]
 * Static layout here; lymphoblasts, sanctuary cells and gauges move in all.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease activity", a: [0, 1, 2], names: ["remission", "relapse risk", "active disease"], ticks: ["remission", "relapse risk", "active"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "induction chemotherapy" },
    { label: "CNS prophylaxis" },
    { label: "targeted therapy or transplant" },
  ],
  status: "Disease: {level} · {drug} ·",
  drugNames: ["no treatment", "induction chemotherapy", "CNS prophylaxis", "targeted therapy or transplant"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const C0 = [0.04, 0.42, 0.90][level], S0 = [0.03, 0.55, 0.78][level], M0 = [0.02, 0.28, 0.62][level];
  const R0 = [0.94, 0.62, 0.22][level], N0 = [0.94, 0.60, 0.20][level], P0 = [0.94, 0.64, 0.24][level];
  const effM = [0, 0.82, 0.12, 0.88][drug], effS = [0, 0.18, 0.85, 0.62][drug], effMed = [0, 0.78, 0.05, 0.85][drug], tox = [0, 0.10, 0.03, 0.07][drug];
  const clone = cl(C0 * (1 - effM)), sanc = cl(S0 * (1 - effS)), med = cl(M0 * (1 - effMed));
  const rec = (b) => cl(b + effM * (1 - b) * 0.85 - tox * b);
  const red = rec(R0), neut = rec(N0), plt = rec(P0);
  const cells = cl((red + neut + plt) / 3);
  const relapse = cl(0.45 * clone + 0.65 * sanc + 0.25 * med);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(clone, 0.25, 0.6, ["cleared", "present", "high"]), w(sanc, 0.22, 0.55, ["cleared", "present", "seated"]), w(cells, 0.35, 0.65, ["low", "reduced", "normal"])];
  return { drug, clone, sanc, med, red, neut, plt, cells, relapse, effM, words, readout: "lymphoblasts " + words[0] + " · sanctuary cells " + words[1] + " · blood cells " + words[2] };
}
const TESTS = [
  [2, 0, "lymphoblasts high · sanctuary cells seated · blood cells low"],
  [2, 1, "lymphoblasts cleared · sanctuary cells seated · blood cells normal"],
  [2, 2, "lymphoblasts high · sanctuary cells cleared · blood cells low"],
  [2, 3, "lymphoblasts cleared · sanctuary cells present · blood cells normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue all-bone" x="14" y="56" width="560" height="360" rx="18"/>
<rect id="healthLay" class="all-health" x="14" y="56" width="560" height="360" rx="18" opacity="0"/>
<rect id="crowdLay" class="all-crowd" x="14" y="56" width="560" height="360" rx="18" opacity="0"/>
<path class="all-arrow" d="M574 240H600"/>
<path class="all-arrow" d="M672 150H742"/>
<path class="all-arrow" d="M672 250H742"/>
<path class="all-arrow" d="M672 340H742"/>
<text class="sc-zone" x="30" y="80">BONE MARROW</text>
<text class="sc-zone sc-dim" x="592" y="80">BLOOD</text>
<text class="sc-zone sc-dim" x="748" y="80">SHELTERS</text>
<g id="vesselSlot"></g>
<g id="brainSlot"></g>
<g id="testisSlot"></g>
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.all-bone{stroke:var(--anatomy-faint);stroke-width:1}
.all-health{fill:var(--c-good);stroke:none}
.all-crowd{fill:var(--c-bad);stroke:none}
.all-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.all-barrier{fill:color-mix(in srgb,var(--c-bad) 10%,transparent);stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:5 4}
.all-chrA{fill:#d9a441;stroke:color-mix(in srgb,#d9a441 55%,#000);stroke-width:.7}
.all-chrB{fill:#5fa8d3;stroke:color-mix(in srgb,#5fa8d3 55%,#000);stroke-width:.7}
.all-fus{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.7}
.all-rec{fill:color-mix(in srgb,var(--c-bad) 30%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:1.6}
.all-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-risk{--cc:#d9a441}.cl-lyb{--cc:var(--c-lymph)}.cl-prog2{--cc:#4fae94}
.p-div{--cc:var(--c-bad)}.p-cns{--cc:var(--c-cyt2)}.p-tgt{--cc:#ffd24a}.p-sig{--cc:var(--c-cyt2)}
.dr-g-fill.g-rbc{fill:var(--c-rbc)}.dr-g-fill.g-med{fill:var(--c-sm)}.dr-g-fill.g-sanc{fill:var(--c-cyt)}
`;

buildScene({
  id: "acute-lymphoblastic-leukaemia", fig: "Fig 1", title: "Acute lymphoblastic leukaemia: a lymphoblast clone takes over", W, H, body, extraCss,
  label: "An animated bone marrow, blood, and sanctuary sites in acute lymphoblastic leukaemia. A predisposed lymphoid progenitor gains a genetic hit and expands as a B or T lymphoblast clone. The clone replaces the marrow, so red cells, neutrophils and platelets fall. Blasts can shelter behind barriers in the brain and testis, and T lineage disease can form a mediastinal mass. Gauges show lymphoblasts, sanctuary cells, the mediastinal mass, red cells, neutrophils and platelets. Treatment choices include induction chemotherapy, CNS prophylaxis, and targeted therapy or transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "all.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With targeted therapy or transplant",
  sourcesLis: [
    "<strong>How the clone starts.</strong> Acute lymphoblastic leukaemia is a clonal neoplasm of B or T lymphoblasts. Genetic aberrations, including fusion genes and other mutations, block lymphoid maturation and drive growth. Some first hits arise before birth, and germline genetic predisposition, inherited variant patterns and prior radiation exposure can raise risk in a minority. A predisposed progenitor that gains further mutations expands as one clone. This is standard teaching in haematology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Marrow replacement and cytopenias.</strong> Lymphoblasts fill the marrow and normal hematopoiesis is crowded out and suppressed. Red cell loss gives anemia, neutrophil loss allows infection, and platelet loss gives bruising and bleeding. Blasts also enter the blood. Classification in practice follows the World Health Organization approach, separating B and T lineage and recurrent genetic groups, because lineage and genetics guide therapy and relapse risk. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Sanctuary sites and the mediastinal mass.</strong> The central nervous system and the testis sit behind barriers that many drugs cross poorly, so blasts seated there can survive marrow directed therapy and later seed relapse, which is why CNS prophylaxis is given even when no CNS disease is found. T lineage disease often arises in the thymus and can present as a mediastinal mass that presses on nearby structures. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Induction chemotherapy kills dividing blasts and aims for remission, but reaches sanctuary sites poorly. CNS prophylaxis directs therapy at the CNS reservoir. Targeted therapy uses a genetic lesion where one is present, and transplant can replace the marrow in selected high risk or relapsed disease; neither is effective for every patient. These are teaching toggles only.",
  ],
  simplified: "B and T subtypes and their genetic groups, risk stratification, measurable residual disease, tumour lysis, infection support, late effects, transplant conditioning, and all drug choices and doses are left out. The mediastinal mass is shown as a T lineage feature and will be small or absent in many B lineage cases. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
