/* CKD mineral bone disorder as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ckdmbd.mjs [--print-model]
 * Static layout here; ions, hormones, bone cells and gauges move in ckdmbd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "CKD stage", a: [0.08, 0.38, 0.7, 1], names: ["early (stage 1 to 2)", "moderate (stage 3)", "advanced (stage 4)", "kidney failure (stage 5)"], ticks: ["stage 1 to 2", "stage 3", "stage 4", "stage 5"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "phosphate binder" },
    { label: "active vitamin D" },
    { label: "calcimimetic" },
    { label: "binder with active vitamin D and calcimimetic" },
  ],
  status: "CKD: {level} · {drug} ·",
  drugNames: ["no treatment", "a phosphate binder", "active vitamin D", "a calcimimetic", "combined treatment"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const stageTab = [0.08, 0.38, 0.7, 1];
  const s = stageTab[level];
  const binder = drug === 1 || drug === 4 ? 1 : 0;
  const vitRx = drug === 2 || drug === 4 ? 1 : 0;
  const cmim = drug === 3 || drug === 4 ? 1 : 0;
  const gfr = cl(0.96 - 0.86 * s);
  let phos = cl(0.12 + 0.84 * s * s + 0.18 * s);
  if (binder) phos = cl(phos * 0.42);
  let vitD = cl(0.92 - 0.78 * s);
  if (vitRx) vitD = cl(vitD + 0.58);
  const gutCa = cl(0.15 + 0.75 * vitD);
  let ca = cl(0.22 + 0.38 * gutCa + 0.08 * (1 - s) - 0.08 * phos);
  if (cmim) ca = cl(ca - 0.04);
  let pth = cl(0.02 + 0.5 * phos + 0.45 * (1 - ca) + 0.3 * (1 - vitD));
  if (binder) pth = cl(pth * 0.78);
  if (vitRx) pth = cl(pth * 0.72);
  if (cmim) pth = cl(pth * 0.38);
  if (drug === 4) pth = cl(pth * 0.75);
  const resorp = cl(0.08 + 0.88 * pth);
  const form = cl(0.12 + 0.7 * vitD * ca + 0.18 * (1 - pth));
  const bone = cl(resorp * (1 - 0.45 * form));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(phos, 0.32, 0.62, ["normal", "raised", "high"]), w(ca, 0.38, 0.62, ["low", "normal", "high"]), w(pth, 0.4, 0.65, ["normal", "raised", "high"]), w(bone, 0.3, 0.58, ["balanced", "increased", "high"])];
  return { s, gfr, phos, vitD, gutCa, ca, pth, resorp, form, bone, binder, vitRx, cmim, words, readout: "phosphate " + words[0] + " · calcium " + words[1] + " · parathyroid hormone " + words[2] + " · bone resorption " + words[3] };
}
const TESTS = [
  [0, 0, "phosphate normal · calcium normal · parathyroid hormone normal · bone resorption balanced"],
  [3, 0, "phosphate high · calcium low · parathyroid hormone high · bone resorption high"],
  [3, 1, "phosphate raised · calcium low · parathyroid hormone raised · bone resorption increased"],
  [3, 4, "phosphate raised · calcium normal · parathyroid hormone normal · bone resorption balanced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="66">KIDNEY AND VITAMIN D</text>
<text class="sc-zone" x="392" y="66">PARATHYROID</text>
<text class="sc-zone" x="676" y="66">BONE</text>
<g id="kidney">
  <path class="mb-kidney" d="M92 96 C58 118 54 176 84 208 C108 234 158 238 188 216 C216 196 224 158 206 124 C192 96 128 76 92 96 Z"/>
  <circle class="mb-glom" cx="118" cy="132" r="17"/><circle class="mb-glom" cx="168" cy="126" r="14"/><circle class="mb-glom" cx="142" cy="176" r="15"/>
  <path class="mb-tub" d="M118 149 C108 176 128 190 142 191 M168 140 C176 162 162 176 157 186 M142 191 C150 204 172 206 184 196"/>
  <circle id="vitnode" class="mb-vitnode" cx="196" cy="196" r="9"/>
  <path class="mb-ureter" d="M196 214 C214 238 224 254 228 272"/>
</g>
<g id="gland">
  <ellipse class="mb-gland" cx="482" cy="150" rx="68" ry="52"/>
  <circle class="mb-chief" cx="452" cy="128" r="13"/><circle class="mb-chief" cx="486" cy="122" r="15"/><circle class="mb-chief" cx="516" cy="140" r="12"/><circle class="mb-chief" cx="462" cy="166" r="14"/><circle class="mb-chief" cx="500" cy="170" r="13"/>
  <path id="casr" class="mb-casr" d="M540 118 C552 132 552 158 540 176"/>
</g>
<g id="boneg">
  <rect class="mb-bone" x="664" y="84" width="266" height="138" rx="14"/>
  <path id="bonemat" class="mb-matrix" d="M680 108 L914 108 L914 206 L680 206 Z"/>
  <path class="mb-trab" d="M692 132 C730 118 760 146 796 132 C830 120 862 146 902 130 M692 184 C728 168 764 196 800 182 C836 168 868 194 902 180"/>
  <path id="pit" class="mb-pit" d="M706 108 C716 126 736 126 746 108"/>
  <g id="osteocells"></g>
  <rect class="mb-marrow" x="680" y="192" width="234" height="18" rx="8"/>
</g>
<g id="vessel">
  <rect id="lumen" class="sc-lumen" x="30" y="278" width="900" height="42" rx="20"/>
</g>
<g id="gutg">
  <rect class="mb-gut" x="356" y="356" width="248" height="66" rx="16"/>
  <path class="mb-villi" d="M374 392 C384 366 394 366 402 392 C410 366 420 366 428 392 C436 366 446 366 454 392 C462 366 472 366 480 392 C488 366 498 366 506 392 C514 366 524 366 532 392 C540 366 550 366 558 392 C566 366 576 366 584 392"/>
</g>
<g id="rbcs"></g><g id="parts"></g><g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-phos:#c084fc;--c-pth:#f2b84a;--c-vitd:#3ddc97;--c-ca2:#58b7e8;--c-bone2:#ecd9a8;--c-marrow2:#d98a9a}
body[data-theme="light"]{--c-phos:#8b46c7;--c-pth:#b57f12;--c-vitd:#159a6c;--c-ca2:#247fb8;--c-bone2:#d9bd7d;--c-marrow2:#c46a7d}
.mb-kidney{fill:color-mix(in srgb,var(--c-endo) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 65%,var(--anatomy-mid));stroke-width:2}
.mb-glom{fill:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.mb-tub{fill:none;stroke:color-mix(in srgb,var(--c-endo) 70%,var(--anatomy-mid));stroke-width:2;stroke-linecap:round}
.mb-vitnode{fill:var(--c-vitd);stroke:color-mix(in srgb,var(--c-vitd) 55%,#000);stroke-width:1}
.mb-ureter{fill:none;stroke:color-mix(in srgb,var(--c-fl) 60%,var(--anatomy-mid));stroke-width:4;stroke-linecap:round}
.mb-gland{fill:color-mix(in srgb,var(--c-pth) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-pth) 65%,var(--anatomy-mid));stroke-width:2}
.mb-chief{fill:color-mix(in srgb,var(--c-pth) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-pth) 55%,#000);stroke-width:.8}
.mb-casr{fill:none;stroke:var(--c-ca2);stroke-width:3;stroke-linecap:round}
.mb-bone{fill:var(--c-bone2);stroke:color-mix(in srgb,var(--c-bone2) 50%,#000);stroke-width:1.6}
.mb-matrix{fill:color-mix(in srgb,var(--c-bone2) 72%,var(--anatomy-paper));stroke:none}
.mb-trab{fill:none;stroke:color-mix(in srgb,var(--c-bone2) 48%,#7a5c20);stroke-width:2}
.mb-pit{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.mb-marrow{fill:var(--c-marrow2);stroke:color-mix(in srgb,var(--c-marrow2) 55%,#000);stroke-width:1}
.cl-osteo{--cc:#e9a2b3}.cl-ostb{--cc:#8fc7e8}.cl-ocy{--cc:#c9a44a}
.mb-gut{fill:color-mix(in srgb,var(--c-graft) 26%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-graft) 62%,var(--anatomy-mid));stroke-width:2}
.mb-villi{fill:none;stroke:color-mix(in srgb,var(--c-graft) 72%,var(--anatomy-mid));stroke-width:2;stroke-linecap:round}
.p-phos2{--cc:var(--c-phos)}.p-pth2{--cc:var(--c-pth)}.p-vitd2{--cc:var(--c-vitd)}.p-ca2{--cc:var(--c-ca2)}.p-cmim{--cc:var(--c-bad)}
.dr-g-fill.g-phos2{fill:var(--c-phos)}.dr-g-fill.g-pth2{fill:var(--c-pth)}.dr-g-fill.g-vitd2{fill:var(--c-vitd)}.dr-g-fill.g-ca2{fill:var(--c-ca2)}.dr-g-fill.g-bone2{fill:var(--c-bone2)}
`;

buildScene({
  id: "renal-osteodystrophy-ckd-mbd", fig: "Fig 1", title: "CKD mineral bone disorder: phosphate, vitamin D, PTH and bone", W, H, body, extraCss,
  label: "An animated kidney, parathyroid gland, blood vessel, gut and bone in chronic kidney disease mineral bone disorder. As CKD stage advances, filtration falls, phosphate is retained, the kidney makes less active vitamin D, gut calcium absorption falls and calcium drops. Parathyroid hormone rises in secondary hyperparathyroidism and drives osteoclast bone resorption, weakening the collagen mineral matrix in renal osteodystrophy. Gauges show filtration, phosphate, active vitamin D, calcium, parathyroid hormone and bone resorption. Treatments are a phosphate binder, active vitamin D and a calcimimetic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ckdmbd.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With combined treatment",
  sourcesLis: [
    "<strong>From falling filtration to phosphate retention.</strong> As glomerular filtration falls in chronic kidney disease, phosphate excretion fails and phosphate is retained. The failing kidney also converts less precursor to active vitamin D, so gut calcium absorption falls and calcium tends to drop. Low active vitamin D, retained phosphate and low calcium together stimulate the parathyroid glands. This is standard teaching in nephrology and endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Secondary hyperparathyroidism and bone.</strong> Sustained parathyroid hormone excess is secondary hyperparathyroidism. In bone, parathyroid hormone signalling through osteoblast lineage cells increases the ligand that recruits osteoclasts. Osteoclasts are multinucleate cells derived from hematopoietic progenitors in marrow; they sit on the bone surface and resorb mineral and collagen matrix. Osteoblasts arise from mesenchymal progenitors, express the transcription factor Runx2 during differentiation, lay down collagen and other proteins as osteoid, and support mineralization. Some osteoblasts become osteocytes embedded in matrix, where they sense load and coordinate the next remodeling phase. When resorption outruns formation and mineralization, matrix weakens and renal osteodystrophy develops. Flagged for review.",
    "<strong>Bone cell lineage in brief.</strong> The osteo- prefix denotes bone. An osteoblast forms osteoid, an osteoclast resorbs it, and osteocytes maintain it. Osteoblast, osteoclast and chondrocytes share early marrow progenitor pools but follow distinct lineage paths. Growth and differentiation signals act on progenitors expressed at the bone surface and in marrow, and the balance between formation by osteoblasts and resorption by osteoclasts sets bone metabolism over each remodeling phase. Osteocytes, the former osteoblasts buried in mineral, help coordinate that balance. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> A phosphate binder binds dietary phosphate in the gut so less is absorbed. Active vitamin D replaces the missing hormone, restores gut calcium absorption and feeds back on the parathyroid. A calcimimetic makes the calcium sensing receptor act as if calcium were higher, turning parathyroid hormone down. These are teaching toggles only.",
  ],
  simplified: "Fibroblast growth factor 23 and klotho, vascular calcification, tertiary hyperparathyroidism, adynamic bone disease, osteomalacia from other causes, aluminium bone disease, fractures and growth failure in children, bone biopsy, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
