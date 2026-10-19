/* Sarcoidosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/sarcoid.mjs [--print-model]
 * Static layout here; cells, cytokines and gauges move in sarcoid.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of disease", a: [0.35, 0.65, 1], names: ["early", "established", "fibrotic"], ticks: ["early", "established", "fibrotic"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "observation" },
    { label: "corticosteroid" },
    { label: "immunosuppressant" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["observation", "a corticosteroid", "an immunosuppressant"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const sup = [0, 0.75, 0.55][drug];
  const fibTab = [0.08, 0.35, 0.85];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const T = cl(a * (1 - sup * 0.85));
  const G = cl(0.12 + 0.78 * T);
  const F = fibTab[level];
  const Ca = cl(0.85 * G - 0.08);
  const N = cl(0.15 + 0.75 * G);
  const O = cl(0.1 + 0.75 * G);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(G, 0.35, 0.65, ["small", "active", "extensive"]), w(F, 0.25, 0.6, ["none", "some", "extensive"]), w(Ca, 0.3, 0.6, ["normal", "raised", "high"])];
  return { a, sup, T, G, F, Ca, N, O, words, readout: "granuloma " + words[0] + " · fibrosis " + words[1] + " · calcium " + words[2] };
}
const TESTS = [
  [0, 0, "granuloma active · fibrosis none · calcium normal"],
  [2, 0, "granuloma extensive · fibrosis extensive · calcium high"],
  [2, 1, "granuloma active · fibrosis extensive · calcium normal"],
  [2, 2, "granuloma active · fibrosis extensive · calcium raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="lungSlot"></g>
<g id="skinSlot"></g>
<g id="eyeSlot"></g>
<g id="heartSlot"></g>
<g id="fibBands"></g>
<g id="ags"></g>
<g id="cells"></g>
<g id="gran"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sa-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.sg-fib{fill:none;stroke:var(--c-sm);stroke-width:5;stroke-linecap:round;opacity:.8}
.sg-core{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1;opacity:.9}
.sg-spot{fill:var(--c-bad)}
.sg-sun{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1}
.sg-ray{fill:none;stroke:var(--c-plt);stroke-width:2;stroke-linecap:round}
.p-ag{--cc:#ff9a3d}.p-vit{--cc:var(--c-plt)}
.p-cap{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.p-capB1{fill:#e8a13d;opacity:.9}.p-capB2{fill:#38d1ff;opacity:.9}
.dr-g-fill.g-fib{fill:var(--c-sm)}.dr-g-fill.g-org{fill:var(--c-eos)}
`;

buildScene({
  id: "sarcoidosis", fig: "Fig 1", title: "Sarcoidosis: granulomas in lung and other organs", W, H, body, extraCss,
  label: "An animated scene of sarcoidosis, left to right. An unknown trigger is shown to CD4 T cells by a macrophage. The T cells release signals that gather macrophages into a non-caseating granuloma in the lung, with enlarged nodes at both lung roots. Later stage brings lung scarring that treatment does not reverse. Granulomas can also reach skin, eye and heart, and macrophages make active vitamin D that raises blood calcium. Drug capsules dock on the immune cells, the signal fades and the granuloma shrinks. Gauges show granuloma, hilar nodes, scarring, other organs and calcium. Treatment choices are observation, a corticosteroid and an immunosuppressant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "sarcoid.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With corticosteroid",
  sourcesLis: [
    "<strong>Core mechanism.</strong> Sarcoidosis is a multisystem granulomatous inflammatory disorder of unknown cause. A presumed inhaled or environmental antigen is presented to CD4 T lymphocytes, which release cytokines that recruit and activate macrophages. Macrophages become epithelioid cells and multinucleated giant cells and organise into tight non-caseating granulomas, meaning granulomas without the central cheese-like necrosis seen in tuberculosis. Granulomatous inflammation favours lung and lymph nodes but can involve skin, eye, heart, liver and nervous system. This is standard teaching in medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Presentation, testing and biopsy.</strong> Common presentation is bilateral hilar lymphadenopathy with lung infiltrates, sometimes with cough, breathlessness, fatigue, skin lesions or eye inflammation; some people are found incidentally. Testing usually combines chest imaging, lung function, blood calcium and eye and heart checks when indicated. Biopsy of an accessible site (skin, lymph node or lung) showing non-caseating granulomas, with infection and other causes excluded, supports the diagnosis. Hypercalcaemia comes from macrophage activation of vitamin D inside granulomas.",
    "<strong>Treatment ideas shown.</strong> Observation when disease is mild or settling, a corticosteroid to suppress granulomatous inflammation, and an immunosuppressant when steroid alone is not enough or not tolerated. Suppressing inflammation can lower granuloma activity and calcium, but established lung scarring is scar and is not reversed by these choices.",
  ],
  simplified: "The unknown antigen, genetics, spontaneous remission, organ by organ staging scans, detailed drug choices, monitoring schedules and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
