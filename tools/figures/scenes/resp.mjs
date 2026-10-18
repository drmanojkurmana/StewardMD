/* Respiratory mechanics as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/resp.mjs [--print-model]
 * Static layout here; breath, alveoli and the pressure volume curve move in resp.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Lung pattern", a: [1, 0.42, 1.45], names: ["normal", "restrictive fibrosis", "obstructive emphysema or asthma"], ticks: ["normal", "restrictive", "obstructive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "surfactant concept" },
    { label: "bronchodilator" },
  ],
  status: "Respiratory mechanics: {level} · {drug} ·",
  drugNames: ["no treatment", "surfactant concept", "bronchodilator"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const surf = drug === 1 ? 1 : 0, bron = drug === 2 ? 1 : 0;
  const resBase = [0.25, 0.38, 0.88][level], recoilBase = [0.55, 0.92, 0.28][level], tensBase = [0.48, 0.58, 0.52][level];
  const R = cl(resBase * (bron ? 0.45 : 1));
  const tension = cl(tensBase * (surf ? 0.45 : 1));
  const compN = cl((a / 1.55) * (surf ? 1.3 : 1));
  const recoil = cl(recoilBase * (surf ? 0.88 : 1));
  const flow = cl(0.98 * (1 - 0.68 * R) * (0.6 + 0.4 * compN));
  const Vt = cl(compN * 0.85 * (1 - 0.25 * R) + 0.08);
  const swing = cl(0.3 + 0.55 * (1 - compN) + 0.35 * R);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(compN, 0.4, 0.75, ["low", "normal", "high"]), w(R, 0.35, 0.65, ["low", "raised", "high"]), w(flow, 0.4, 0.6, ["low", "reduced", "good"]), w(tension, 0.35, 0.55, ["low", "normal", "high"])];
  return { a, surf, bron, R, tension, compN, recoil, flow, Vt, swing, words, readout: "compliance " + words[0] + " · resistance " + words[1] + " · airflow " + words[2] + " · surface tension " + words[3] };
}
const TESTS = [
  [0, 0, "compliance normal · resistance low · airflow good · surface tension normal"],
  [1, 0, "compliance low · resistance raised · airflow reduced · surface tension high"],
  [2, 0, "compliance high · resistance high · airflow low · surface tension normal"],
  [2, 2, "compliance high · resistance raised · airflow good · surface tension normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="496" height="396" rx="18"/>
<rect class="rp-panel" x="524" y="44" width="422" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CHEST AND LUNG</text>
<text class="sc-zone" x="544" y="68">PRESSURE VOLUME CURVE</text>
<ellipse id="pleura" class="rp-pleura" cx="300" cy="278" rx="148" ry="126"/>
<ellipse id="lungShape" class="rp-lung" cx="300" cy="278" rx="128" ry="108"/>
<g id="ribsG">
  <path class="rp-rib" d="M158 190Q132 278 158 366"/><path class="rp-rib" d="M442 190Q468 278 442 366"/>
  <path class="rp-rib" d="M166 220Q148 278 166 336"/><path class="rp-rib" d="M434 220Q452 278 434 336"/>
  <path class="rp-muscle" d="M440 232L456 244M438 262L454 274M438 292L454 304M440 322L456 334"/>
</g>
<g id="airwayG">
  <rect class="rp-airway" x="286" y="66" width="28" height="118" rx="10"/>
  <path class="rp-bronch" d="M300 184L262 232M300 184L338 232"/>
</g>
<g id="alvG"></g>
<path id="diaph" class="rp-diaph" d="M168 396Q300 352 432 396"/>
<g id="pvG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "respiratory-mechanics", fig: "Fig 1", title: "Respiratory mechanics: pressure, compliance and airflow", W, H, body,
  label: "An animated chest, lung and pressure volume curve. The diaphragm and intercostal muscles contract, the chest expands, pleural pressure falls, alveolar pressure falls below the mouth and air flows in. Alveoli expand against elastic recoil and surface tension, which surfactant lowers. The curve shows how much pressure is needed for a given volume: stiff fibrotic lungs need more pressure, while obstructed airways resist flow and emphysema loses recoil. Gauges show compliance, resistance, airflow, recoil, surface tension and effort. Treatment choices are a surfactant concept and a bronchodilator.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "resp.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How breathing in works.</strong> The diaphragm and external intercostal muscles contract and enlarge the chest. The pleural space follows the chest wall, pleural pressure becomes more negative, the lung is pulled open and alveolar pressure falls below atmospheric pressure, so air flows in through the airways. How easily the lung stretches for a given pressure change is its compliance. Stiff, fibrotic lungs have low compliance and high elastic recoil. Emphysema destroys elastic tissue, so compliance is high but recoil and the pull that holds small airways open are lost. In asthma and other obstructive patterns the main problem is high airway resistance, so flow, especially out, is slow. Surfactant made by type II alveolar cells lowers surface tension at the air liquid surface, stops small alveoli collapsing into larger ones and raises compliance. This is standard teaching in respiratory physiology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A surfactant concept lowers surface tension and eases alveolar opening; it is shown as a principle, not as a recommendation for any condition. A bronchodilator relaxes airway smooth muscle, lowers resistance and improves airflow, most clearly in the obstructive pattern, without changing lung stiffness or recoil. These are teaching toggles only.",
  ],
  simplified: "Gas exchange and diffusion, blood gas control of breathing, chest wall compliance in detail, expiratory muscle use, dynamic airway compression, ventilation perfusion matching, work of breathing in energy terms, and all doses, pressures and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--c-alv:#7fc4e8;--c-airp:#ffd76a;--c-diaph:#e59a88;--c-surf:#3ddc97;--c-curve:#38d1ff}
body[data-theme="light"]{--c-alv:#3fa0d4;--c-airp:#d9a400;--c-diaph:#d97a68;--c-surf:#0f9f76;--c-curve:#0a7fd1}
.rp-panel{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.rp-pleura{fill:color-mix(in srgb,var(--c-fl) 10%,transparent);stroke:var(--c-fl);stroke-width:1.4;stroke-dasharray:5 4}
.rp-lung{fill:color-mix(in srgb,var(--c-alv) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-alv) 65%,#000);stroke-width:1.2}
.rp-rib{fill:none;stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round;opacity:.75}
.rp-muscle{stroke:var(--c-sm);stroke-width:4;stroke-linecap:round}
.rp-airway{fill:color-mix(in srgb,var(--c-fl) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.rp-bronch{fill:none;stroke:var(--anatomy-mid);stroke-width:9;stroke-linecap:round}
.rp-diaph{fill:none;stroke:var(--c-diaph);stroke-width:9;stroke-linecap:round}
.rp-alv{fill:color-mix(in srgb,var(--c-alv) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-alv) 70%,#000);stroke-width:1.4}
.rp-surf{fill:var(--c-surf);stroke:color-mix(in srgb,var(--c-surf) 55%,#000);stroke-width:.5}
.p-airp{fill:var(--c-airp);stroke:color-mix(in srgb,var(--c-airp) 55%,#000);stroke-width:.5}
.rp-axis{stroke:var(--anatomy-mid);stroke-width:1}
.rp-curve{fill:none;stroke:var(--c-curve);stroke-width:2.6;stroke-linecap:round}
.rp-ref{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:5 4;opacity:.7}
.rp-dot{fill:var(--c-curve);stroke:var(--anatomy-paper);stroke-width:1.4}
.rp-step{fill:var(--anatomy-text);font:10.5px var(--anatomy-mono)}
.dr-g-fill.g-comp{fill:var(--c-alv)}.dr-g-fill.g-res{fill:var(--c-bad)}.dr-g-fill.g-flow{fill:var(--c-good)}.dr-g-fill.g-rec{fill:var(--c-cyt)}.dr-g-fill.g-ten{fill:var(--c-surf)}.dr-g-fill.g-eff{fill:var(--c-eos)}
`,
});
