/* Lung cancer types as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/lungca.mjs [--print-model]
 * Static layout here; tumour, smoke, spread, hormones and gauges move in lungca.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Lung cancer type", a: [1, 0.72, 0.84], names: ["small cell", "squamous", "adenocarcinoma"], ticks: ["small cell", "squamous", "adenocarcinoma"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "surgery" },
    { label: "chemotherapy and radiotherapy" },
    { label: "targeted therapy" },
  ],
  status: "Type: {level} · {drug} ·",
  drugNames: ["no treatment", "surgery", "chemotherapy and radiotherapy", "targeted therapy"],
};
function modelOf(S, level, drug) {
  const spreadBase = [0.95, 0.42, 0.64][level];
  const localBase = [0.72, 0.92, 0.38][level];
  const hormBase = [0.95, 0.86, 0.18][level];
  const effTable = [[0, 0.1, 0.76, 0.12], [0, 0.6, 0.52, 0.2], [0, 0.52, 0.44, 0.8]];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const eff = effTable[level][drug];
  const B = cl(a * (1 - 0.85 * eff));
  const Mspr = cl(spreadBase * (1 - 0.55 * eff));
  const L = cl(localBase * (1 - 0.6 * eff));
  const H = cl(hormBase * (0.25 + 0.75 * B));
  const R = eff;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.3, 0.62, ["controlled", "present", "large"]), w(Mspr, 0.3, 0.62, ["limited", "possible", "extensive"]), w(H, 0.3, 0.62, ["none", "possible", "marked"])];
  return { a, eff, B, Mspr, L, H, R, words, readout: "tumour " + words[0] + " · spread " + words[1] + " · hormone effects " + words[2] };
}
const TESTS = [
  [0, 0, "tumour large · spread extensive · hormone effects marked"],
  [0, 2, "tumour present · spread possible · hormone effects possible"],
  [2, 0, "tumour large · spread extensive · hormone effects none"],
  [2, 3, "tumour controlled · spread possible · hormone effects none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<rect class="lc-side" x="648" y="44" width="298" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LUNG AND AIRWAY</text>
<text class="sc-zone" x="668" y="68">BODY EFFECTS</text>
<rect class="lc-cig" x="52" y="82" width="34" height="9" rx="4"/>
<rect class="lc-cigtip" x="80" y="82" width="7" height="9" rx="2"/>
<rect class="lc-air" x="351" y="56" width="28" height="122" rx="11"/>
<path id="bronchL" class="lc-bronch" d="M365 176L300 220"/>
<path id="bronchR" class="lc-bronch" d="M365 176L430 220"/>
<rect class="lc-svc" x="392" y="62" width="15" height="96" rx="7"/>
<g id="lungSlotL"></g><g id="lungSlotR"></g><g id="brainSlot"></g><g id="kidneySlot"></g><g id="svc"></g><g id="nodes"></g><g id="mets"></g><g id="bone"></g><g id="tum"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "lung-cancer-types", fig: "Fig 1", title: "Lung cancer: types, local effects and spread", W, H, body,
  label: "An animated chest schematic. Smoke reaches the airway. The main tumour sits near the airway for small cell and squamous types and out in the lung for adenocarcinoma, with cavitation for squamous and hormone signals for small cell and squamous. Nearby nodes, the brain, the kidney and bone show spread and hormone effects. Each treatment visibly acts on the tumour: surgery cuts it out, chemoradiotherapy beams shrink it, targeted therapy parks blockers on its receptors. Gauges show tumour, local effects, spread, hormone effects and treatment response. Treatment choices are surgery, chemotherapy with radiotherapy, and targeted therapy.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "lungca.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With targeted therapy",
  sourcesLis: [
    "<strong>How lung cancer develops and differs by type.</strong> Inhaled carcinogens, most often from tobacco smoke, damage airway lining DNA. Small cell cancer arises from neuroendocrine cells, is usually central, grows and spreads early, and can release ADH like and ACTH like activity causing SIADH and cortisol excess. Squamous cancer is usually central, can cavitate, and can release PTHrP causing raised calcium. Adenocarcinoma is usually peripheral and arises in glandular tissue. Local growth can obstruct the superior vena cava. This is standard teaching in medicine and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Surgery can remove a localised non small cell tumour but rarely helps small cell cancer that has already spread. Chemotherapy with radiotherapy is a main approach for small cell and is also used in non small cell disease. Targeted therapy can control adenocarcinomas with a targetable driver change. These are teaching toggles only.",
  ],
  simplified: "Staging, imaging, biopsy and molecular testing, immunotherapy, screening, performance status, operative fitness, specific drug choice and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.lc-side{fill:var(--anatomy-card);opacity:.5;stroke:var(--anatomy-faint);stroke-width:1}
.lc-air{fill:color-mix(in srgb,var(--c-lymph) 28%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.lc-bronch{fill:none;stroke:var(--anatomy-mid);stroke-width:9;stroke-linecap:round;opacity:.55}
.lc-svc{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:.8;opacity:.85}
.lc-pinch{fill:var(--c-bad);opacity:.35}
.lc-cig{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.8}.lc-cigtip{fill:#e07a3a}
.lc-cav{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.lc-gran{fill:#7c3aed}.lc-gland{fill:none;stroke:var(--anatomy-strong);stroke-width:1.2}
.lc-bone{fill:#e8dcc0;stroke:#b8a888;stroke-width:1}
.lc-ring{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-dasharray:5 4}
.lc-ray{fill:none;stroke:var(--c-neut);stroke-width:2;stroke-linecap:round;opacity:.85}
.lc-recep{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.lc-glow{fill:var(--c-cyt);stroke:none}
.lc-kglow{fill:var(--c-fl);stroke:none}
.lc-ca{fill:#e9b84a;stroke:none}
.lc-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-tum{--cc:#d66a6a}.cl-lymph2{--cc:var(--c-lymph)}
.p-smoke{--cc:#9aa3ad}.p-horm{--cc:#e9b84a}.p-spread{--cc:var(--c-cyt)}.p-targ{--cc:var(--c-good)}
.dr-g-fill.g-horm{fill:var(--c-neut)}
`,
});
