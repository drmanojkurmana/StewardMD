/* Sepsis pathogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/sepsis.mjs [--print-model]
 * Static layout here; cells, mediators and gauges move in sepsis.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the infection", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotics only (treat the source)" },
    { label: "fluids and a vasopressor only (support)" },
    { label: "antibiotics with fluids and a vasopressor" },
  ],
  status: "Infection: {level} · {drug} ·",
  drugNames: ["no treatment", "antibiotics only", "fluids and vasopressor only", "antibiotics with support"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], abx = drug === 1 || drug === 3 ? 1 : 0, sup = drug === 2 || drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const B = abx ? a * 0.12 : a * (0.55 + 0.45 * a);
  const C = cl(0.1 + 0.85 * a * (abx ? 0.45 : 1));
  const P = cl(0.06 + 0.82 * C);
  const V = cl(0.05 + 0.9 * C), Ve = cl(V - sup * 0.5);
  const T = cl(0.04 + 0.85 * C * (a > 0.5 ? 1 : 0.55));
  const Vol = cl(1 - 0.75 * P + sup * 0.5);
  const BP = cl(0.95 - 0.55 * Ve - 0.4 * (1 - Vol));
  const La = cl(0.06 + 0.55 * (1 - BP) + 0.4 * T * (1 - 0.5 * BP));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.5, ["controlled", "present", "spreading"]), w(1 - BP, 0.22, 0.45, ["maintained", "borderline", "low"]), w(La, 0.25, 0.5, ["normal", "raised", "high"])];
  return { a, abx, sup, B, C, P, V, Ve, T, Vol, BP, La, words, readout: "infection " + words[0] + " · blood pressure " + words[1] + " · lactate " + words[2] };
}
const TESTS = [
  [1, 0, "infection spreading · blood pressure low · lactate high"],
  [1, 1, "infection controlled · blood pressure borderline · lactate raised"],
  [1, 2, "infection spreading · blood pressure maintained · lactate raised"],
  [1, 3, "infection controlled · blood pressure maintained · lactate normal"],
];

/* ---------------- static layout ---------------- */
const CY = 350;                                                // vessel centre line
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="oedema" class="sc-oed" x="14" y="44" width="${W - 28}" height="${CY - 70 - 44}" rx="18" opacity="0"/>
<text class="sc-zone" x="34" y="68">INFECTED TISSUE</text>
<text class="sc-zone sc-dim" x="34" y="${CY + 4}">CAPILLARY</text>
<g id="bacteria"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 40}" width="${W - 28}" height="80"/>
<g id="rbcs"></g><g id="clots"></g>
<g id="endo"></g>
<g id="parts"></g>
<g id="phag"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "sepsis-pathogenesis", fig: "Fig 1", title: "Sepsis: infection to organ failure", W, H, body,
  label: "An animated capillary and infected tissue. Bacteria release signals that wake macrophages. Macrophages release cytokines that act on the vessel wall. The wall relaxes and widens, which drops blood pressure, leaks fluid into the tissue, and starts small clots. Gauges show infection, inflammation, leak, clotting, blood pressure and lactate. Treatment choices include antibiotics and fluids with a vasopressor.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "sepsis.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How sepsis develops.</strong> Microbial molecules (for example bacterial endotoxin) bind pattern-recognition receptors such as Toll-like receptors on macrophages and other cells. That switches on inflammatory genes (NF-kB) and releases cytokines (TNF, IL-1, IL-6). On blood-vessel lining cells these cause nitric-oxide-driven vasodilation, a leaky capillary wall, and activation of clotting (tissue factor, microthrombi). The result is low blood pressure, poor organ perfusion and a rising lactate. This is standard teaching in medicine and critical-care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Treating the source (antibiotics, drainage), restoring circulating volume with fluids, and tightening vessels with a vasopressor. These are teaching toggles only.",
  ],
  simplified: "The anti-inflammatory and immune-paralysis phase, organ-specific damage, mitochondrial dysfunction, resistant organisms, steroid and other adjuncts, source control by drainage or surgery, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
