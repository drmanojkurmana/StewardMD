/* Atherosclerosis plaque development as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/athero.mjs [--print-model]
 * Static layout here; particles, cells and gauges move in athero.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Plaque stage", a: [0.22, 0.52, 0.8, 1], names: ["fatty streak", "stable plaque", "vulnerable plaque", "rupture"], ticks: ["fatty streak", "stable", "vulnerable", "rupture"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "statin" },
    { label: "antiplatelet" },
    { label: "risk factor control" },
    { label: "statin, antiplatelet and risk factor control" },
  ],
  status: "Plaque stage: {level} · {drug} ·",
  drugNames: ["no treatment", "a statin", "an antiplatelet drug", "risk factor control", "combined treatment"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const stat = drug === 1 || drug === 4 ? 1 : 0, ap = drug === 2 || drug === 4 ? 1 : 0, risk = drug === 3 || drug === 4 ? 1 : 0;
  const Endo = cl(0.25 + 0.65 * a - 0.3 * risk - 0.1 * stat);
  const Ldl = cl((0.12 + 0.78 * a) * (stat ? 0.42 : 1) * (risk ? 0.62 : 1));
  const Ox = cl(Ldl * (0.45 + 0.5 * a) * (risk ? 0.72 : 1) * (stat ? 0.85 : 1));
  const Foam = cl(0.08 + 0.85 * Ox);
  const Core = cl(Math.max(0, a - 0.18) * 1.05 * (stat ? 0.62 : 1) * (risk ? 0.8 : 1));
  const CapBase = [0.08, 0.85, 0.32, 0.18][level];
  const Cap = cl(CapBase + 0.16 * stat + 0.12 * risk);
  const Smc = cl([0.1, 0.8, 0.55, 0.45][level] + 0.1 * stat);
  const Bulk = cl(0.12 + 0.68 * a * (stat ? 0.85 : 1) * (risk ? 0.92 : 1));
  const Vuln = cl(Core * 0.55 + (1 - Cap) * 0.45 + Ox * 0.25 - 0.18 * stat - 0.12 * risk);
  const Rupt = level === 3 ? cl(0.45 + 0.5 * Vuln) : cl(Math.max(0, Vuln - 0.68) * 0.4);
  const Thr = cl(Rupt * 1.05 * (ap ? 0.32 : 1));
  const Narrow = cl(Bulk * 0.72 + Thr * 0.35);
  const Flow = cl(1 - Narrow);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const plaqueW = ["fatty streak", "stable plaque", "vulnerable plaque", "ruptured plaque"][level];
  const words = [plaqueW, w(Narrow, 0.3, 0.62, ["open", "narrowed", "tight"]), w(Thr, 0.12, 0.45, ["no clot", "small clot", "large clot"])];
  return { a, stat, ap, risk, Endo, Ldl, Ox, Foam, Core, Cap, Smc, Bulk, Vuln, Rupt, Thr, Narrow, Flow, words, readout: "plaque " + words[0] + " · lumen " + words[1] + " · " + words[2] };
}
const TESTS = [
  [0, 0, "plaque fatty streak · lumen open · no clot"],
  [1, 0, "plaque stable plaque · lumen narrowed · no clot"],
  [2, 0, "plaque vulnerable plaque · lumen narrowed · no clot"],
  [3, 0, "plaque ruptured plaque · lumen tight · large clot"],
  [3, 2, "plaque ruptured plaque · lumen tight · small clot"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="66">ARTERY, CUT OPEN ALONG ITS LENGTH</text>
<g id="art"></g><g id="parts"></g><g id="cells"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "atherosclerosis-plaque", fig: "Fig 1", title: "Atherosclerosis: from fatty streak to rupture", W, H, body,
  label: "An animated artery cut open along its length. Injury to the endothelium lets LDL in, where it is oxidised. Monocytes follow, take up the oxidised LDL and become foam cells that build a fatty streak. Smooth muscle cells migrate and lay down a fibrous cap over a necrotic lipid core. A thick cap makes a stable plaque, a thin cap over a large core makes a vulnerable plaque, and when the cap breaks, platelets form a clot. Gauges show LDL entry, oxidised LDL, foam cells, lipid core, cap strength and clot. Treatment choices are a statin, an antiplatelet drug and risk factor control.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "athero.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How an atherosclerotic plaque develops.</strong> Endothelial injury and retained low-density lipoprotein (LDL) in the intima start the process. LDL becomes oxidised, monocytes enter and become macrophages that take up oxidised LDL and turn into foam cells, forming a fatty streak. Smooth muscle cells migrate into the intima and make a fibrous cap. Foam cells die and leave a necrotic lipid core. A stable plaque has a thick cap and a smaller core; a vulnerable plaque has a thin cap, a large core and more inflammation. Cap rupture exposes core material and triggers platelet clotting and thrombosis. This is standard teaching in pathology and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A statin lowers LDL entry and plaque lipid and helps stabilise the cap. An antiplatelet drug reduces platelet clotting after rupture but does not shrink the plaque. Risk factor control (for example not smoking, and controlling blood pressure, blood sugar and lipids) reduces endothelial injury and oxidation. These are teaching toggles only.",
  ],
  simplified: "Calcification, plaque erosion, healing and remodelling, collateral vessels, individual lipid and blood pressure targets, drug choice, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
  extraCss: `
.at-lum{fill:color-mix(in srgb,var(--c-rbc) 12%,var(--anatomy-paper))}
.at-wall{fill:color-mix(in srgb,var(--c-endo) 38%,var(--c-tis))}
.at-media{fill:color-mix(in srgb,var(--c-sm) 30%,var(--c-tis))}
.at-plaque{fill:color-mix(in srgb,#d9b97a 52%,var(--c-tis));stroke:color-mix(in srgb,#d9b97a 60%,#000);stroke-width:.8}
.at-core{fill:#e6c85a;stroke:#b8962f;stroke-width:.9}
.at-cap{fill:none;stroke:#f3e6c4;stroke-linecap:round}
.at-thr{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--c-plt));stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:.7}
.at-intima{fill:none;stroke:var(--c-endo);stroke-width:2.2}
.cl-foam{--cc:#f0d98a}.cl-foam .cl-n{fill:#b8962f;opacity:.5}
.cl-mono{--cc:var(--c-mac)}.cl-smc{--cc:var(--c-sm)}.cl-endo2{--cc:var(--c-endo)}
.at-vac{fill:none;stroke:#b8962f;stroke-width:.8}
.at-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.at-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.p-ldl{--cc:#e6c85a}.p-ox{--cc:#ff9a3d}
.dr-g-fill.g-ldl{fill:#e6c85a}.dr-g-fill.g-ox{fill:#ff9a3d}.dr-g-fill.g-foam{fill:#f0d98a}.dr-g-fill.g-core{fill:#e6c85a}
`,
});
