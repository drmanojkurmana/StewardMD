/* Oxygen haemoglobin dissociation curve as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ohb.mjs [--print-model]
 * Static layout here; curves, haemoglobin, oxygen particles and gauges move in ohb.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Curve position", a: [-1, 0, 1], names: ["left shift", "normal", "right shift"], ticks: ["left shift", "normal", "right shift"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "acid-base correction" },
  ],
  status: "Curve: {level} · {drug} ·",
  drugNames: ["none", "acid-base correction"],
};
function modelOf(S, level, drug) {
  const SHIFT = [-1, 0, 1];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const raw = SHIFT[level];
  const corr = drug === 1 ? 1 : 0;
  const eff = raw * (corr ? 0.3 : 1);
  const affinity = cl(0.5 - eff * 0.35);
  const p50v = cl(0.5 + eff * 0.35);
  const load = cl(0.9 - eff * 0.07);
  const release = cl(0.5 + eff * 0.35);
  const satT = cl(0.5 - eff * 0.3);
  const driverR = cl(0.5 + eff * 0.4);
  const driverL = cl(0.5 - eff * 0.4);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(affinity, 0.33, 0.66, ["low", "normal", "high"]), w(p50v, 0.33, 0.66, ["low", "normal", "high"]), w(release, 0.33, 0.66, ["low", "normal", "high"])];
  return { raw, corr, eff, affinity, p50v, load, release, satT, driverR, driverL, words, readout: "affinity " + words[0] + " · P50 " + words[1] + " · oxygen release " + words[2] };
}
const TESTS = [
  [0, 0, "affinity high · P50 low · oxygen release low"],
  [1, 0, "affinity normal · P50 normal · oxygen release normal"],
  [2, 0, "affinity low · P50 high · oxygen release high"],
  [2, 1, "affinity normal · P50 normal · oxygen release normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<rect class="oh-panel" x="56" y="62" width="496" height="336" rx="14"/>
<rect class="oh-panel" x="572" y="62" width="360" height="164" rx="14"/>
<rect class="oh-panel" x="572" y="240" width="360" height="158" rx="14"/>
<text class="oh-zone" x="72" y="84">DISSOCIATION CURVE</text>
<text class="oh-zone" x="588" y="84">LUNGS: LOADING</text>
<text class="oh-zone" x="588" y="262">TISSUES: UNLOADING</text>
<g id="chart"></g>
<g id="lung"></g>
<g id="tissue"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "oxygen-haemoglobin-dissociation-curve", fig: "Fig 1", title: "Oxygen haemoglobin dissociation curve: loading and unloading", W, H, body,
  label: "An animated oxygen haemoglobin dissociation curve with lung loading and tissue unloading. The sigmoid curve reflects cooperative binding. Its position shifts right with raised carbon dioxide, acid, temperature and 2,3-BPG so oxygen is released more easily, and left with fetal haemoglobin, carbon monoxide and alkalosis so oxygen is held more tightly. P50 marks half saturation. Gauges show affinity, P50, lung loading, tissue release and the acid and carbon dioxide drive. Treatment includes acid-base correction, which moves the curve back toward normal.",
  caption: "Schematic, not to scale. Curve positions, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ohb.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How oxygen binding works.</strong> Haemoglobin has four subunits. Binding of the first oxygen makes the next ones easier to bind, and release is likewise cooperative, which gives the sigmoid dissociation curve. P50 is the oxygen partial pressure at half saturation: a higher P50 means lower affinity and easier release, a lower P50 means higher affinity and tighter holding. In the lungs, where oxygen partial pressure is high, haemoglobin loads; in the tissues, where it is lower, haemoglobin unloads. This is standard teaching in physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Shifts and the Bohr effect.</strong> Raised carbon dioxide and hydrogen ions (the Bohr effect), raised temperature and raised 2,3-BPG shift the curve right and favour unloading to active tissues. Fetal haemoglobin, carbon monoxide and alkalosis shift it left and favour holding oxygen. Acid-base correction is shown as a teaching toggle that moves an acid or alkali driven shift back toward the normal position; it does not correct fetal haemoglobin, carbon monoxide, temperature or 2,3-BPG effects in full.",
  ],
  simplified: "Myoglobin, methaemoglobin, detailed allosteric structure, the chloride shift, carbamino carriage, altitude adaptation, transfusion and all clinical thresholds and values are left out. The lung and tissue panels are schematic compartments, not anatomy. The figure does not say how any patient should be treated.",
  extraCss: `
.oh-panel{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.oh-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.oh-lab{fill:var(--anatomy-text);font-size:11px;pointer-events:none}
.oh-dim{fill:var(--anatomy-muted);font-size:10px;pointer-events:none}
.oh-axis{stroke:var(--anatomy-mid);stroke-width:1.2}
.oh-grid{stroke:var(--anatomy-faint);stroke-width:.6;opacity:.5}
.oh-ref{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;opacity:.38;stroke-linecap:round}
.oh-act{fill:none;stroke:var(--c-good);stroke-width:3.2;stroke-linecap:round}
.oh-p50l{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:4 4;opacity:.8}
.oh-p50d{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.6}
.oh-alv{fill:color-mix(in srgb,var(--c-lymph) 24%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.4}
.oh-arrow{stroke:var(--anatomy-mid);stroke-width:1.6;fill:none}
.oh-ah{fill:var(--anatomy-mid)}
.cl-hb{--cc:#d94f5f}.cl-tcell{--cc:#c9a86a}
.p-o2{--cc:#e5484d}.p-co2{--cc:#7ab8ff}
.oh-o2dot{fill:#ffe08a;stroke:#b8962f;stroke-width:.6}
.oh-chip-r{fill:color-mix(in srgb,var(--c-bad) 22%,var(--anatomy-card));stroke:var(--c-bad);stroke-width:1}
.oh-chip-l{fill:color-mix(in srgb,var(--c-lymph) 22%,var(--anatomy-card));stroke:var(--c-lymph);stroke-width:1}
.oh-chip-t{fill:var(--anatomy-strong);font-size:10px;font-weight:600;pointer-events:none}
.dr-g-fill.g-aff{fill:var(--c-lymph)}.dr-g-fill.g-p50{fill:#e9b84a}.dr-g-fill.g-load{fill:var(--c-good)}.dr-g-fill.g-rel{fill:var(--c-bad)}.dr-g-fill.g-drv{fill:#c084fc}
`,
});
