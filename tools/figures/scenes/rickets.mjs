/* Rickets and osteomalacia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/rickets.mjs [--print-model]
 * Static layout here; particles, growth plate, legs and gauges move in rickets.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of deficiency", a: [0.3, 0.65, 1], names: ["early", "established", "severe"], ticks: ["early", "established", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "vitamin D and calcium" },
    { label: "sunlight" },
    { label: "surgery for deformity" },
  ],
  status: "Deficiency: {level} · {drug} ·",
  drugNames: ["no treatment", "vitamin D and calcium", "sunlight", "surgery for deformity"],
};
function modelOf(S, level, drug) {
  const stageTab = [0.3, 0.65, 1];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const s = stageTab[level];
  const vitRx = drug === 1 ? 1 : 0, sunRx = drug === 2 ? 1 : 0, surg = drug === 3 ? 1 : 0;
  let vitD = cl(0.88 - 0.72 * s + 0.58 * vitRx + 0.42 * sunRx);
  const gut = cl(0.1 + 0.82 * vitD);
  let ca = cl(0.16 + 0.58 * gut + 0.14 * vitRx - 0.06 * s);
  let phos = cl(0.14 + 0.6 * gut + 0.06 * vitRx);
  let pth = cl(0.04 + 0.72 * (1 - ca) + 0.22 * (1 - vitD));
  phos = cl(phos - 0.12 * pth);
  const mineral = cl(0.08 + 0.62 * ((ca + phos) / 2) + 0.3 * vitD);
  let deform = cl(0.92 * s - 0.58 * surg - 0.1 * (vitRx + sunRx) * (1 - s));
  const osteoid = cl(1 - mineral);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(vitD, 0.34, 0.66, ["low", "reduced", "normal"]), w(ca, 0.36, 0.62, ["low", "reduced", "normal"]), w(pth, 0.38, 0.64, ["normal", "raised", "high"]), w(mineral, 0.36, 0.64, ["poor", "reduced", "good"]), w(deform, 0.3, 0.62, ["mild", "moderate", "severe"])];
  return { s, vitRx, sunRx, surg, vitD, gut, ca, phos, pth, mineral, osteoid, deform, words, readout: "active vitamin D " + words[0] + " · calcium " + words[1] + " · PTH " + words[2] + " · mineralisation " + words[3] + " · deformity " + words[4] };
}
const TESTS = [
  [0, 0, "active vitamin D normal · calcium reduced · PTH raised · mineralisation reduced · deformity mild"],
  [2, 0, "active vitamin D low · calcium low · PTH high · mineralisation poor · deformity severe"],
  [2, 1, "active vitamin D normal · calcium normal · PTH normal · mineralisation good · deformity severe"],
  [2, 3, "active vitamin D low · calcium low · PTH high · mineralisation poor · deformity moderate"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="66">VITAMIN D PATHWAY</text>
<text class="sc-zone" x="676" y="66">BONE AND GROWTH</text>
<g id="sunG">
  <circle class="rk-sun" cx="95" cy="90" r="15"/>
  <path class="rk-ray" d="M95 66v-8M95 114v8M71 90h-8M119 90h8M78 73l-6-6M112 73l6-6M78 107l-6 6M112 107l6 6"/>
</g>
<g id="nodes">
  <rect class="rk-skin" x="42" y="132" width="106" height="46" rx="12"/>
  <path class="rk-liver" d="M186 138 C186 128 200 122 224 124 L282 128 C296 130 300 140 296 152 C292 166 278 174 252 176 L210 176 C194 174 186 162 186 138 Z"/>
  <path class="rk-kidney" d="M352 128 C330 142 328 168 348 182 C368 194 400 192 414 176 C426 160 422 136 404 126 C388 118 366 118 352 128 Z"/>
  <circle class="rk-gutring" cx="240" cy="272" r="34"/>
  <path class="rk-villi" d="M216 272 C222 254 230 254 234 272 C240 254 248 254 252 272 C258 254 266 254 268 272"/>
  <path class="rk-bowl" d="M62 262 C66 288 84 300 100 300 C116 300 134 288 138 262 Z"/>
  <path class="rk-food" d="M70 262 C76 252 88 254 94 260 C100 250 114 250 120 260 C126 252 134 256 136 262 Z"/>
  <rect id="vessel" class="rk-vessel" x="392" y="252" width="218" height="40" rx="20"/>
  <g id="glandG"><ellipse class="rk-gland" cx="532" cy="270" rx="24" ry="17"/><circle class="rk-chief" cx="524" cy="264" r="6"/><circle class="rk-chief" cx="540" cy="266" r="5"/><circle class="rk-chief" cx="530" cy="278" r="5"/></g>
  <circle id="actnode" class="rk-act" cx="532" cy="155" r="13"/>
</g>
<g id="boneG">
  <rect class="rk-panel" x="662" y="80" width="272" height="352" rx="14"/>
  <rect id="boneShaft" class="rk-bone" x="700" y="96" width="34" height="150" rx="12"/>
  <rect id="gpBand" class="rk-cart" x="694" y="176" width="46" height="12" rx="5"/>
  <rect id="osteoidSeam" class="rk-osteoid" x="734" y="96" width="6" height="150" rx="3"/>
  <g id="rosary">
    <path class="rk-rib" d="M792 118 C818 106 848 106 872 120 M790 148 C818 136 850 136 874 150 M792 178 C818 168 848 168 870 180"/>
    <circle class="rk-bead" cx="800" cy="114" r="4"/><circle class="rk-bead" cx="800" cy="144" r="4"/><circle class="rk-bead" cx="800" cy="174" r="4"/>
    <circle class="rk-bead" cx="862" cy="116" r="4"/><circle class="rk-bead" cx="864" cy="146" r="4"/><circle class="rk-bead" cx="860" cy="176" r="4"/>
  </g>
  <path id="legL" class="rk-leg" d="M742 322 C742 356 738 386 744 416"/>
  <path id="legR" class="rk-leg" d="M798 322 C798 356 802 386 796 416"/>
  <path class="rk-hip" d="M730 322 L810 322"/>
</g>
<g id="rbcs"></g><g id="parts"></g><g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-vit:#f2c94c;--c-act:#3ddc97;--c-ca2:#58b7e8;--c-po4:#c084fc;--c-pth:#f2b84a;--c-bone2:#ecd9a8;--c-cart:#7fc4e8}
body[data-theme="light"]{--c-vit:#c79a12;--c-act:#159a6c;--c-ca2:#247fb8;--c-po4:#8b46c7;--c-pth:#b57f12;--c-bone2:#d9bd7d;--c-cart:#3a86b8}
.rk-sun{fill:var(--c-vit);stroke:color-mix(in srgb,var(--c-vit) 55%,#000);stroke-width:1.2}
.rk-ray{fill:none;stroke:var(--c-vit);stroke-width:2;stroke-linecap:round}
.rk-skin{fill:color-mix(in srgb,var(--c-eos) 38%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-eos) 65%,var(--anatomy-mid));stroke-width:1.6}
.rk-liver{fill:color-mix(in srgb,var(--c-bad) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1.6}
.rk-kidney{fill:color-mix(in srgb,var(--c-endo) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 62%,#000);stroke-width:1.6}
.rk-gutring{fill:color-mix(in srgb,var(--c-graft) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-graft) 62%,var(--anatomy-mid));stroke-width:1.8}
.rk-villi{fill:none;stroke:color-mix(in srgb,var(--c-graft) 72%,var(--anatomy-mid));stroke-width:2;stroke-linecap:round}
.rk-bowl{fill:color-mix(in srgb,var(--c-ca2) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-ca2) 60%,#000);stroke-width:1.5}
.rk-food{fill:color-mix(in srgb,var(--c-vit) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-vit) 55%,#000);stroke-width:1}
.rk-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-mid));stroke-width:1.4}
.rk-gland{fill:color-mix(in srgb,var(--c-pth) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-pth) 62%,var(--anatomy-mid));stroke-width:1.6}
.rk-chief{fill:color-mix(in srgb,var(--c-pth) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-pth) 55%,#000);stroke-width:.7}
.rk-act{fill:var(--c-act);stroke:color-mix(in srgb,var(--c-act) 55%,#000);stroke-width:1.2}
.rk-panel{fill:color-mix(in srgb,var(--anatomy-paper) 72%,transparent);stroke:var(--anatomy-mid);stroke-width:1.2}
.rk-bone{fill:var(--c-bone2);stroke:color-mix(in srgb,var(--c-bone2) 50%,#000);stroke-width:1.5}
.rk-cart{fill:var(--c-cart);stroke:color-mix(in srgb,var(--c-cart) 50%,#000);stroke-width:1}
.rk-osteoid{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 50%,#000);stroke-width:.8}
.rk-rib{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.rk-bead{fill:var(--c-cart);stroke:color-mix(in srgb,var(--c-cart) 50%,#000);stroke-width:.8}
.rk-leg{fill:none;stroke:var(--c-bone2);stroke-width:9;stroke-linecap:round}
.rk-hip{fill:none;stroke:color-mix(in srgb,var(--c-bone2) 55%,#000);stroke-width:5;stroke-linecap:round}
.p-vit{--cc:var(--c-vit)}.p-act{--cc:var(--c-act)}.p-ca2{--cc:var(--c-ca2)}.p-po4{--cc:var(--c-po4)}.p-pth{--cc:var(--c-pth)}
.dr-g-fill.g-vit{fill:var(--c-vit)}.dr-g-fill.g-act{fill:var(--c-act)}.dr-g-fill.g-ca2{fill:var(--c-ca2)}.dr-g-fill.g-po4{fill:var(--c-po4)}.dr-g-fill.g-pth{fill:var(--c-pth)}.dr-g-fill.g-min{fill:var(--c-cart)}
`;

buildScene({
  id: "rickets-vitamin-d-deficiency", fig: "Fig 1", title: "Rickets and osteomalacia: vitamin D, calcium and mineralisation", W, H, body, extraCss,
  label: "An animated vitamin D pathway, gut, blood, parathyroid gland and growing bone in rickets and osteomalacia. Vitamin D from sunlight on skin and from diet is activated in the liver and then the kidney. Active vitamin D lets the gut absorb calcium and phosphate. When it is lacking, calcium falls, parathyroid hormone rises, and new growth plate cartilage and osteoid fail to mineralise, so legs bow and rib ends swell as a rachitic rosary. Gauges show active vitamin D, calcium, phosphate, parathyroid hormone, mineralisation and deformity. Treatments are vitamin D with calcium, sunlight, and surgery for deformity.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "rickets.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Where vitamin D comes from and how it is switched on.</strong> Vitamin D is made in skin exposed to sunlight and taken in from diet. It is first changed in the liver and then activated in the kidney. Active vitamin D lets the gut absorb calcium and phosphate. This is standard teaching in endocrinology and paediatric texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why bone softens.</strong> When active vitamin D is lacking, gut calcium and phosphate absorption falls and blood calcium tends to drop. Low calcium raises parathyroid hormone. With too little calcium and phosphate available, new cartilage at the growth plate and new osteoid laid down by bone forming cells cannot mineralise properly. In children this is rickets at the growth plate; in adults the same failure in osteoid is osteomalacia. Growing bone bends under load, giving bowed legs, and swollen rib ends give the rachitic rosary. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Vitamin D with calcium restores the missing hormone and mineral supply, sunlight restores skin production, and surgery can straighten a fixed deformity but does not by itself restore mineralisation. These are teaching toggles only.",
  ],
  simplified: "Phosphate handling in detail, fibroblast growth factor 23, parathyroid bone resorption in depth, inherited and kidney related forms of rickets, vitamin D resistant forms, growth failure, dental changes, muscle weakness, fractures, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
