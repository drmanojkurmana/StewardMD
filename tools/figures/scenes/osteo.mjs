/* Osteoporosis and bone remodelling as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/osteo.mjs [--print-model]
 * Static layout here; cells, signals and gauges move in osteo.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Bone state", a: [0, 0.5, 1], names: ["normal", "osteopenia", "osteoporosis"], ticks: ["normal", "osteopenia", "osteoporosis"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "bisphosphonate" },
    { label: "calcium and vitamin D" },
    { label: "anabolic agent" },
  ],
  status: "Bone state: {level} · {drug} ·",
  drugNames: ["no treatment", "bisphosphonate", "calcium and vitamin D", "anabolic agent"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const oes = cl(0.9 - 0.7 * a);
  const rankl = cl(0.28 + 0.62 * a);
  const opg = cl(0.78 - 0.5 * a + (drug === 2 ? 0.05 : 0));
  let R = cl(0.3 + 0.6 * a) * (1 - 0.45 * opg * 0.5);
  let F = cl(0.55 - 0.25 * a);
  if (drug === 1) { R *= 0.35; F *= 0.85; }
  if (drug === 2) { R *= 0.85; F = cl(F + 0.15); }
  if (drug === 3) { F = cl(F + 0.5); R = cl(R + 0.08); }
  R = cl(R); F = cl(F);
  const gain = (drug === 1 ? 0.14 : drug === 2 ? 0.07 : drug === 3 ? 0.24 : 0) * (0.4 + 0.6 * a);
  const dens = cl(0.92 - 0.58 * a + gain);
  const fx = cl(1.08 - dens - (drug === 3 ? 0.04 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(R, 0.3, 0.6, ["balanced", "raised", "high"]), w(F, 0.35, 0.6, ["low", "steady", "active"]), w(dens, 0.45, 0.7, ["thin", "reduced", "preserved"]), w(fx, 0.3, 0.6, ["low", "raised", "high"])];
  return { a, oes, rankl, opg, R, F, dens, fx, words, readout: "resorption " + words[0] + " · formation " + words[1] + " · bone density " + words[2] + " · fracture risk " + words[3] };
}
const TESTS = [
  [0, 0, "resorption balanced · formation steady · bone density preserved · fracture risk low"],
  [2, 0, "resorption high · formation low · bone density thin · fracture risk high"],
  [2, 1, "resorption balanced · formation low · bone density reduced · fracture risk high"],
  [2, 3, "resorption high · formation active · bone density reduced · fracture risk raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TRABECULAR BONE AND ITS SIGNALS</text>
<rect class="os-bone" id="bone" x="60" y="150" width="480" height="230" rx="16"/>
<g id="trab"></g>
<g id="pits"></g>
<g id="cells"></g>
<rect class="os-box" x="565" y="118" width="365" height="172" rx="14"/>
<text class="sc-zone sc-dim" x="585" y="278">SIGNALLING</text>
<rect class="os-box" x="565" y="305" width="365" height="125" rx="14"/>
<text class="sc-zone sc-dim" x="585" y="330">FRAGILITY</text>
<g id="signal"></g>
<g id="fracture"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "osteoporosis-bone-remodelling", fig: "Fig 1", title: "Osteoporosis: the bone remodelling cycle out of balance", W, H, body,
  label: "An animated cut surface of trabecular bone with a signalling panel and a fragility panel. Osteoclasts resorb bone and osteoblasts form new bone. Osteoblast lineage cells make RANKL, which drives osteoclast formation, and osteoprotegerin, which blocks RANKL. Oestrogen restrains resorption, so oestrogen loss tips the balance toward bone loss. Trabeculae thin, bone density falls and fracture risk rises. Treatment choices include a bisphosphonate, calcium and vitamin D, and an anabolic agent. Gauges show resorption, formation, RANKL, osteoprotegerin, density and fracture risk.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "osteo.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
body{--c-bone2:#e9dcba;--c-cort:#b8934f;--c-obl:#d9a441;--c-ocl:#c96a7a;--c-oes:#2f9f8a;--c-opg:#3a86b8;--c-rankl:#e07a2f}
body[data-theme="light"]{--c-bone2:#efe3c2;--c-cort:#9a7a38;--c-obl:#b9821e;--c-ocl:#b44a5e;--c-oes:#177a66;--c-opg:#2f6fa3;--c-rankl:#c25e14}
.os-bone{fill:var(--c-bone2);stroke:var(--c-cort);stroke-width:5}
.os-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.os-trab{stroke:var(--c-cort);stroke-linecap:round}
.os-ocyte{fill:var(--c-cort);opacity:.55}
.os-pit{fill:var(--c-tis)}
.os-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.os-inhib{fill:none;stroke:var(--c-oes);stroke-width:1.6;stroke-linecap:round}
.os-oes{fill:var(--c-oes);stroke:color-mix(in srgb,var(--c-oes) 55%,#000);stroke-width:.9}
.os-crack{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.os-fbone{fill:var(--c-bone2);stroke:var(--c-cort);stroke-width:1.2}
.cl-obl{--cc:var(--c-obl)}.cl-ocl{--cc:var(--c-ocl)}.cl-opg{--cc:var(--c-opg)}
.p-rankl{--cc:var(--c-rankl)}.p-opg{--cc:var(--c-opg)}.p-chip{--cc:var(--c-cort)}.p-matrix{--cc:var(--c-obl)}.p-tx{--cc:var(--c-oes)}
.dr-g-fill.g-res{fill:var(--c-ocl)}.dr-g-fill.g-form{fill:var(--c-obl)}.dr-g-fill.g-rankl{fill:var(--c-rankl)}.dr-g-fill.g-opg{fill:var(--c-opg)}.dr-g-fill.g-dens{fill:var(--c-good)}.dr-g-fill.g-fx{fill:var(--c-bad)}
`,
  sourcesLis: [
    "<strong>How bone is remodelled.</strong> Bone is continually renewed. Osteoclasts resorb old bone and osteoblasts lay down new bone in its place, with osteocytes embedded in the bone sensing strain. Osteoblast lineage cells control osteoclast formation through RANKL, which binds RANK on osteoclast precursors, and osteoprotegerin (OPG), a decoy receptor that blocks RANKL. When resorption runs ahead of formation over many cycles, trabeculae thin and perforate, cortical bone thins, density falls and the bone breaks with little trauma (a fragility fracture). This is standard teaching in endocrinology, rheumatology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Why oestrogen matters.</strong> Oestrogen restrains osteoclast formation and activity and supports osteoclast death. After the menopause, oestrogen loss raises RANKL signalling relative to OPG, speeds the remodelling cycle and tips each cycle toward net loss, fastest in trabecular bone such as the spine and the neck of the femur. Ageing, immobility, glucocorticoids, hyperparathyroidism, thyrotoxicosis, alcohol and smoking can also drive loss. These are teaching points only, shown without any numbers.",
    "<strong>Treatment ideas shown.</strong> A bisphosphonate settles on bone mineral and is taken up by osteoclasts, which then resorb less and die sooner. Calcium and vitamin D support mineralisation where intake or levels are low. An anabolic agent stimulates osteoblasts to form new bone. These are teaching toggles only.",
  ],
  simplified: "Cortical bone detail, the hip and spine geometry, bone density scanning and its cut offs, falls and frailty, secondary causes in detail, glucocorticoid induced loss, male osteoporosis, treatment sequencing and monitoring, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
