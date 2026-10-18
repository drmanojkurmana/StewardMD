/* Sarcoidosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/sarcoid.mjs [--print-model]
 * Static layout here; cells, cytokines and gauges move in sarcoid.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of disease", a: [0.35, 0.65, 1], names: ["early", "established", "fibrotic"], ticks: ["early", "established", "fibrotic"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "observe (no drug treatment)" },
    { label: "corticosteroid" },
    { label: "immunosuppressant" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["observation", "a corticosteroid", "an immunosuppressant"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const sup = [0, 0.55, 0.75][drug];
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
  [2, 1, "granuloma active · fibrosis extensive · calcium raised"],
  [2, 2, "granuloma active · fibrosis extensive · calcium normal"],
];

/* ---------------- static layout ---------------- */
const card = (id, y, title, sub, info, icon, line) => `<g class="hot sc-card" tabindex="0" data-info="${esc(info)}"><rect class="sc-card-r" x="640" y="${y}" width="290" height="68" rx="12"/><text class="sc-zone" x="728" y="${y + 22}">${esc(title)}</text><text class="sc-lab" x="728" y="${y + 40}">${esc(sub)}</text><text class="sc-lab sc-dim2" x="728" y="${y + 56}">${esc(line || "granulomas can form here")}</text>${icon}<g id="${id}"></g></g>`;
const skinIcon = `<path class="sg-skin" d="M656 116q14 -10 28 0q14 10 28 0l0 20l-56 0Z"/><circle class="sg-spot" cx="672" cy="114" r="5"/><circle class="sg-spot" cx="692" cy="118" r="4"/>`;
const eyeIcon = `<g transform="translate(0 16)"><ellipse class="sg-eye" cx="684" cy="202" rx="30" ry="16"/><circle class="sg-iris" cx="684" cy="202" r="10"/><circle class="sg-pupil" cx="684" cy="202" r="4"/></g>`;
const heartIcon = `<g transform="translate(0 38)"><path class="sg-heart" d="M684 262c-12 -13 -28 -4 -28 8c0 10 13 18 28 27c15 -9 28 -17 28 -27c0 -12 -16 -21 -28 -8Z"/></g>`;
const calcIcon = `<g transform="translate(0 44)"><circle class="sg-sun" cx="684" cy="358" r="12"/><path class="sg-ray" d="M684 338v7M684 371v7M664 358h7M697 358h7M670 344l5 5M693 367l5 5M698 344l-5 5M675 367l-5 5"/></g>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">UNKNOWN TRIGGER</text>
<text class="sc-zone" x="330" y="68">LUNG AND HILAR NODES</text>
<text class="sc-zone" x="640" y="68">OTHER ORGANS</text>
<rect class="sg-lung" x="305" y="125" width="300" height="260" rx="22"/>
<rect class="sg-med" x="428" y="130" width="44" height="58" rx="10"/>
<g id="fibBands" opacity="0.1"><path class="sg-fib" d="M320 348q70 -16 140 0t130 -4"/><path class="sg-fib" d="M322 364q70 -14 138 -2t128 -2"/><path class="sg-fib" d="M330 334q60 -12 120 -2t118 -4"/></g>
${card("spotSkin", 92, "Skin", "papules and plaques", "Skin involvement: raised papules and plaques, and tender red shin lumps in some people. A skin biopsy can show granulomas.", skinIcon)}
${card("spotEye", 184, "Eye", "red eye, blurred vision", "Eye involvement: inflammation inside the eye (uveitis) can redden the eye, blur vision and threaten sight if missed.", eyeIcon)}
${card("spotHeart", 276, "Heart", "palpitations, block", "Heart involvement: granulomas in heart muscle can disturb rhythm and conduction and cause palpitations or fainting.", heartIcon)}
${card("spotCalc", 368, "Calcium", "active vitamin D", "Hypercalcaemia: activated macrophages make active vitamin D outside the kidney, so gut calcium absorption and blood calcium rise.", calcIcon, "from granuloma macrophages")}
<g id="ags"></g>
<g id="cells"></g>
<g id="gran"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sc-card-r{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-dim2{opacity:.75}
.sg-lung{fill:color-mix(in srgb,var(--c-endo) 16%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.sg-med{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sg-fib{fill:none;stroke:var(--c-sm);stroke-width:5;stroke-linecap:round;opacity:.8}
.sg-core{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1;opacity:.9}
.sg-skin{fill:var(--c-donor);stroke:color-mix(in srgb,var(--c-donor) 55%,#000);stroke-width:1}
.sg-spot{fill:var(--c-bad)}
.sg-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.sg-iris{fill:var(--c-lymph)}.sg-pupil{fill:#1a1030}
.sg-heart{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.sg-sun{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1}
.sg-ray{fill:none;stroke:var(--c-plt);stroke-width:2;stroke-linecap:round}
.p-ag{--cc:#ff9a3d}.p-vit{--cc:var(--c-plt)}
.dr-g-fill.g-fib{fill:var(--c-sm)}.dr-g-fill.g-org{fill:var(--c-eos)}
`;

buildScene({
  id: "sarcoidosis", fig: "Fig 1", title: "Sarcoidosis: granulomas in lung and other organs", W, H, body, extraCss,
  label: "An animated scene of sarcoidosis. An unknown antigen is presented to CD4 T cells, which activate macrophages. Activated macrophages gather into non-caseating granulomas in the lung, enlarge both hilar lymph nodes, and can involve skin, eye and heart. Macrophages also make active vitamin D, raising blood calcium. Later stage brings lung fibrosis that treatment does not reverse. Gauges show granuloma, inflammation, hilar nodes, fibrosis, organ involvement and calcium. Treatment choices are observation, a corticosteroid and an immunosuppressant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "sarcoid.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Core mechanism.</strong> Sarcoidosis is a multisystem granulomatous inflammatory disorder of unknown cause. A presumed inhaled or environmental antigen is presented to CD4 T lymphocytes, which release cytokines that recruit and activate macrophages. Macrophages become epithelioid cells and multinucleated giant cells and organise into tight non-caseating granulomas, meaning granulomas without the central cheese-like necrosis seen in tuberculosis. Granulomatous inflammation favours lung and lymph nodes but can involve skin, eye, heart, liver and nervous system. This is standard teaching in medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Presentation, testing and biopsy.</strong> Common presentation is bilateral hilar lymphadenopathy with lung infiltrates, sometimes with cough, breathlessness, fatigue, skin lesions or eye inflammation; some people are found incidentally. Testing usually combines chest imaging, lung function, blood calcium and eye and heart checks when indicated. Biopsy of an accessible site (skin, lymph node or lung) showing non-caseating granulomas, with infection and other causes excluded, supports the diagnosis. Hypercalcaemia comes from macrophage activation of vitamin D inside granulomas.",
    "<strong>Treatment ideas shown.</strong> Observation when disease is mild or settling, a corticosteroid to suppress granulomatous inflammation, and an immunosuppressant when steroid alone is not enough or not tolerated. Suppressing inflammation can lower granuloma activity and calcium, but established lung fibrosis is scar and is not reversed by these choices.",
  ],
  simplified: "The unknown antigen, genetics, spontaneous remission, organ by organ staging scans, detailed drug choices, monitoring schedules and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
