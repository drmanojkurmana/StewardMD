/* Neonatal jaundice as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/nnjaund.mjs [--print-model]
 * Static layout here; bilirubin, conjugation and gauges move in nnjaund.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pattern of jaundice", a: [0.3, 0.65, 1], names: ["physiological", "pathological", "severe"], ticks: ["physiological", "pathological", "severe"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "feed and monitor" },
    { label: "phototherapy" },
    { label: "exchange transfusion" },
  ],
  status: "Jaundice: {level} · {drug} ·",
  drugNames: ["feed and monitor", "phototherapy", "exchange transfusion"],
};
function modelOf(S, level, drug) {
  const LV = [
    { prod: 0.38, conj: 0.52, bbb: 0.18, haem: 0.08 },
    { prod: 0.72, conj: 0.34, bbb: 0.5, haem: 0.72 },
    { prod: 1, conj: 0.2, bbb: 0.85, haem: 1 },
  ];
  const TX = [
    { photo: 0, exch: 0, feed: 1 },
    { photo: 1, exch: 0, feed: 0.35 },
    { photo: 0.25, exch: 1, feed: 0.2 },
  ];
  const L = LV[level], T = TX[drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const prod = cl(L.prod * (1 - 0.45 * T.exch));
  const conj = cl(L.conj + 0.12 * T.feed);
  const excr = cl(conj * 0.75 + 0.55 * T.photo + 0.35 * T.exch + 0.18 * T.feed);
  let bil = cl(prod * (1 - 0.55 * conj) + 0.18 * L.haem);
  bil = cl(bil * (1 - 0.42 * T.photo) * (1 - 0.68 * T.exch) * (1 - 0.12 * T.feed));
  const free = cl(bil * bil * 1.25 + bil * 0.18 - 0.08);
  const brain = cl(free * (0.35 + 0.75 * L.bbb) * (1 - 0.35 * T.exch));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(bil, 0.28, 0.58, ["mild", "raised", "high"]), w(brain, 0.12, 0.38, ["minimal", "possible", "likely"]), w(excr, 0.35, 0.62, ["low", "steady", "good"])];
  return { a: S.level.a[level], prod, conj, excr, bil, free, brain, haem: L.haem, bbb: L.bbb, photo: T.photo, exch: T.exch, feed: T.feed, words, readout: "bilirubin " + words[0] + " · brain entry " + words[1] + " · excretion " + words[2] };
}
const TESTS = [
  [0, 0, "bilirubin mild · brain entry minimal · excretion good"],
  [2, 0, "bilirubin high · brain entry likely · excretion steady"],
  [2, 1, "bilirubin raised · brain entry likely · excretion good"],
  [2, 2, "bilirubin mild · brain entry minimal · excretion good"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="286" height="186" rx="16"/>
<rect class="sc-tissue" x="330" y="44" width="290" height="186" rx="16"/>
<rect class="sc-tissue" x="650" y="44" width="296" height="186" rx="16"/>
<rect class="sc-tissue" x="14" y="256" width="540" height="184" rx="16"/>
<rect class="sc-tissue" x="570" y="256" width="130" height="184" rx="16"/>
<rect class="sc-tissue" x="714" y="256" width="232" height="184" rx="16"/>
<text class="sc-zone" x="34" y="68">RED CELL TURNOVER</text>
<text class="sc-zone" x="344" y="68">LIVER</text>
<text class="sc-zone" x="664" y="68">GUT</text>
<text class="sc-zone" x="34" y="280">BLOOD</text>
<text class="sc-zone" x="728" y="280">BRAIN</text>
<ellipse class="nn-liver" cx="478" cy="152" rx="104" ry="58"/>
<ellipse class="nn-liver-hl" cx="448" cy="132" rx="42" ry="18"/>
<g id="ugt"></g>
<path class="nn-gut" d="M712 118 h150 a24 24 0 0 1 0 48 h-120 a20 20 0 0 0 0 40 h110"/>
<circle class="nn-gut-end" cx="852" cy="206" r="7"/>
<rect class="sc-lumen" x="24" y="306" width="520" height="58" rx="12"/>
<rect class="sc-lumen" x="544" y="326" width="176" height="18"/>
<g id="rbcsTop"></g><g id="alb"></g>
<g id="baby">
<circle class="nn-skin" cx="635" cy="322" r="23"/>
<ellipse class="nn-skin" cx="635" cy="386" rx="36" ry="42"/>
<circle id="skinOv" class="nn-jaund" cx="635" cy="322" r="23" opacity="0"/>
<ellipse id="skinOv2" class="nn-jaund" cx="635" cy="386" rx="36" ry="42" opacity="0"/>
</g>
<g id="photoLamp" opacity="0">
<rect class="nn-lamp" x="600" y="262" width="70" height="12" rx="6"/>
<path class="nn-ray" d="M610 274 L600 306M635 274 L635 306M660 274 L670 306"/>
</g>
<ellipse class="nn-brain" cx="836" cy="352" rx="82" ry="58"/>
<path class="nn-brain-line" d="M786 330 q20 -18 42 0 q22 -16 40 2 M792 372 q22 16 44 2 q20 14 38 -2"/>
<ellipse id="brainOv" class="nn-jaund" cx="836" cy="352" rx="82" ry="58" opacity="0"/>
<path class="nn-bbb" d="M720 286 V424"/>
<g id="endoBBB"></g>
<g id="exchG" opacity="0">
<path class="nn-exch" d="M70 396 h70 M126 386 l14 10 l-14 10"/>
<path class="nn-exch2" d="M210 396 h-70 M154 386 l-14 10 l14 10"/>
</g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "neonatal-jaundice", fig: "Fig 1", title: "Neonatal jaundice: bilirubin production, conjugation and brain risk", W, H, body,
  label: "An animated newborn bilirubin pathway. Red cell turnover releases unconjugated bilirubin. The immature liver conjugates only part of it for excretion in the gut. The rest travels in blood on albumin, yellows the skin, and when free bilirubin is high it can cross the blood brain barrier into the brain. Gauges show breakdown, bilirubin, brain entry and excretion. Treatment choices include feeding and monitoring, phototherapy and exchange transfusion.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "nnjaund.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Feed and monitor", withLabel: "Exchange transfusion",
  sourcesLis: [
    "<strong>Why newborns become jaundiced.</strong> Newborn red cells turn over quickly and the newborn liver has immature conjugation (low UGT activity), so unconjugated bilirubin accumulates. Prematurity makes both worse. Breast milk can increase enterohepatic reabsorption and reduce conjugation, prolonging physiological jaundice. This is standard teaching in paediatrics and neonatology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Pathological causes and brain injury.</strong> Haemolysis from ABO or Rh incompatibility or G6PD deficiency greatly increases bilirubin production. Unconjugated bilirubin that is not bound to albumin can cross the blood brain barrier and injure basal ganglia and brainstem nuclei (kernicterus). This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Feeding and monitoring supports gut excretion and reduces reabsorption. Phototherapy converts bilirubin in skin and blood to forms that can be excreted without conjugation. Exchange transfusion removes bilirubin and, in haemolysis, antibody coated red cells. These are teaching toggles only.",
  ],
  simplified: "Albumin binding detail, direct and conjugated hyperbilirubinaemia, cholestasis, sepsis and metabolic causes, gestational age charts, bilirubin thresholds, phototherapy irradiance and exchange volumes, and long term neurodevelopmental follow up are left out. Counts and speeds are illustrative, and the figure does not say how any baby should be treated.",
  extraCss: `
body{--c-bili:#e8c832;--c-conj:#2ec4a6;--c-liver:#c25e6d;--c-brain:#e8a2c0;--c-alb:#5aa0e8;--c-skin:#f0c8a0;--c-jaund:#e8b81e}
body[data-theme="light"]{--c-bili:#b8910a;--c-conj:#0f8f76;--c-liver:#b04a5a;--c-brain:#d478a8;--c-alb:#2f6fc2;--c-skin:#e8b88a;--c-jaund:#c9960a}
.p-bili{--cc:var(--c-bili)}.p-conj{--cc:var(--c-conj)}.p-alb{--cc:var(--c-alb)}.p-ent{--cc:#e8843a}
.nn-liver{fill:var(--c-liver);stroke:color-mix(in srgb,var(--c-liver) 55%,#000);stroke-width:1}
.nn-liver-hl{fill:color-mix(in srgb,var(--c-liver) 45%,#fff);opacity:.5}
.nn-gut{fill:none;stroke:var(--c-conj);stroke-width:18;stroke-linecap:round;opacity:.75}
.nn-gut-end{fill:var(--c-conj)}
.nn-skin{fill:var(--c-skin);stroke:color-mix(in srgb,var(--c-skin) 55%,#000);stroke-width:.9}
.nn-jaund{fill:var(--c-jaund)}
.nn-brain{fill:var(--c-brain);stroke:color-mix(in srgb,var(--c-brain) 55%,#000);stroke-width:1}
.nn-brain-line{fill:none;stroke:color-mix(in srgb,var(--c-brain) 45%,#000);stroke-width:1.4;opacity:.6}
.nn-bbb{stroke:var(--c-bad);stroke-width:3;stroke-dasharray:7 5;fill:none}
.nn-lamp{fill:var(--c-alb);stroke:color-mix(in srgb,var(--c-alb) 55%,#000)}
.nn-ray{stroke:var(--c-alb);stroke-width:2.4;fill:none;opacity:.8}
.nn-exch{stroke:var(--c-bad);stroke-width:2.4;fill:none}.nn-exch2{stroke:var(--c-good);stroke-width:2.4;fill:none}
.dr-g-fill.g-bili{fill:var(--c-bili)}.dr-g-fill.g-brain{fill:var(--c-bad)}.dr-g-fill.g-conj{fill:var(--c-conj)}.dr-g-fill.g-prod{fill:var(--c-rbc)}
.cl-ugt{--cc:var(--c-conj)}
`,
});
