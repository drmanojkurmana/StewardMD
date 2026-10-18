/* Leukocyte adhesion and migration as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/leukadh.mjs [--print-model]
 * Static layout here; leukocytes, chemokines and gauges move in leukadh.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of the response", a: [0.25, 0.6, 1], names: ["early", "developing", "established"], ticks: ["early", "developing", "late"], start: 1 },
  drugLabel: "Treatment or defect",
  settings: [
    { label: "none" },
    { label: "anti-integrin (blocks firm adhesion)" },
    { label: "adhesion deficiency defect" },
  ],
  status: "Response: {level} · {drug} ·",
  drugNames: ["no treatment", "anti-integrin", "adhesion deficiency"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const anti = drug === 1 ? 1 : 0, def = drug === 2 ? 1 : 0;
  const Chem = cl(0.15 + 0.8 * a);
  const Roll = cl(Chem * (def ? 0.15 : 1) * (anti ? 0.9 : 1));
  const Firm = cl(Roll * (anti ? 0.06 : def ? 0.1 : 0.95));
  const Tissue = cl(Firm * (0.4 + 0.6 * a));
  const Blood = cl(1 - 0.75 * Tissue);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Roll, 0.3, 0.6, ["little", "some", "much"]), w(Firm, 0.3, 0.6, ["weak", "patchy", "strong"]), w(Tissue, 0.3, 0.6, ["few", "some", "many"])];
  return { a, anti, def, Chem, Roll, Firm, Tissue, Blood, words, readout: "rolling " + words[0] + " · firm adhesion " + words[1] + " · cells in tissue " + words[2] };
}
const TESTS = [
  [0, 0, "rolling some · firm adhesion patchy · cells in tissue few"],
  [2, 0, "rolling much · firm adhesion strong · cells in tissue many"],
  [2, 1, "rolling much · firm adhesion weak · cells in tissue few"],
  [2, 2, "rolling little · firm adhesion weak · cells in tissue few"],
];

/* ---------------- static layout ---------------- */
const CY = 290;
const siteDots = [[812, 98], [836, 92], [852, 108], [822, 122], [846, 128], [806, 114], [860, 88], [834, 142]]
  .map(([x, y], i) => `<ellipse class="lk-bac2" cx="${x}" cy="${y}" rx="${i % 2 ? 6 : 4.2}" ry="3" transform="rotate(${i * 37} ${x} ${y})"/>`).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TISSUE</text>
<text class="sc-zone sc-dim" x="34" y="${CY + 5}">BLOOD VESSEL</text>
<text class="sc-zone sc-dim" x="34" y="424">TISSUE</text>
<circle class="lk-site" cx="832" cy="112" r="34"/>
${siteDots}
<path class="lk-grad" d="M806 138C740 180 700 205 664 232"/>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 42}" width="${W - 28}" height="84"/>
<g id="rbcs"></g>
<g id="endo"></g>
<g id="marks"></g>
<g id="parts"></g>
<g id="cells"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.lk-site{fill:color-mix(in srgb,var(--c-bad) 16%,transparent);stroke:var(--c-bad);stroke-width:1.2;stroke-dasharray:5 4}
.lk-bac2{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.6}
.lk-grad{fill:none;stroke:var(--c-cyt);stroke-width:2;stroke-dasharray:3 6;stroke-linecap:round;opacity:.65}
.p-chem{--cc:#ff9a3d}
.lk-sel{fill:none;stroke:var(--c-eos);stroke-width:1.4;stroke-linecap:round}
.lk-icam{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-linecap:round}
.lk-int{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 50%,#000);stroke-width:.5}
.lk-block{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 50%,#000);stroke-width:.5}
.lk-bond{fill:none;stroke:var(--c-eos);stroke-width:1;opacity:.8}
.lk-bond2{fill:none;stroke:var(--c-good);stroke-width:1.4;opacity:.9}
`;

buildScene({
  id: "leukocyte-adhesion-cascade", fig: "Fig 1", title: "Leukocyte adhesion and migration", W, H, body, extraCss,
  label: "An animated blood vessel and tissue. Leukocytes flow in the blood, roll slowly on selectins on the activated vessel wall, are activated by chemokines, stick firmly when their integrins bind ICAM, cross the endothelium, then follow chemokines through the tissue to the site. Gauges show chemokines, rolling, firm adhesion and cells reaching the tissue. Choices include an anti-integrin blocker and an adhesion deficiency defect.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "leukadh.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How leukocytes leave the blood.</strong> At an inflamed site the vessel lining (endothelium) is activated and displays selectins, which catch passing leukocytes and make them roll slowly along the wall. Chemokines shown on the wall switch on leukocyte integrins. Those integrins bind ICAM on the endothelium and hold the cell firmly. The cell then squeezes between endothelial cells (transmigration, or diapedesis) and follows chemokine signals through the tissue (chemotaxis) to the site. This is standard teaching in immunology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What the choices show.</strong> An anti-integrin blocker leaves rolling largely intact but prevents firm sticking, so cells roll on and are carried away. An adhesion deficiency defect (as in leukocyte adhesion deficiency) weakens rolling and firm adhesion, so leukocytes stay in the blood and few reach the tissue even though the signals are present. These are teaching toggles only.",
  ],
  simplified: "The separate selectin, integrin and ICAM family members, inside-out integrin signalling in detail, junction molecules used during crossing, other leukocyte types, and all drug names, doses and clinical management are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
