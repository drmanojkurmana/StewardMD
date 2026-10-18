/* Chronic inflammation and granuloma as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/chronicinf.mjs [--print-model]
 * Static layout here; cells, cytokines and gauges move in chronicinf.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of the inflammation", a: [0.3, 0.7, 1], names: ["acute resolving", "persistent", "fibrosis"], ticks: ["acute resolving", "persistent", "fibrosis"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "remove the trigger" },
    { label: "anti-inflammatory" },
    { label: "anti-cytokine biologic" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "remove the trigger", "anti-inflammatory", "anti-cytokine biologic"],
};
function modelOf(S, level, drug) {
  const trigB = [0.38, 0.88, 0.72];
  const infB = [0.34, 0.82, 0.76];
  const cytB = [0.3, 0.86, 0.7];
  const angB = [0.18, 0.55, 0.78];
  const fibB = [0.07, 0.36, 0.96];
  const cl = (v) => Math.max(0, Math.min(1, v));
  let Trig = trigB[level], Inf = infB[level], Cyt = cytB[level], Ang = angB[level], Fib = fibB[level];
  if (drug === 1) { Trig *= 0.12; Inf *= 0.45; Cyt *= 0.4; Ang *= 0.6; Fib *= 0.75; }
  if (drug === 2) { Trig = cl(Trig * 1.15); Inf *= 0.6; Cyt *= 0.45; Ang *= 0.7; Fib *= 0.85; }
  if (drug === 3) { Trig = cl(Trig * 1.1); Inf *= 0.8; Cyt *= 0.22; Ang *= 0.8; Fib *= 0.8; }
  Trig = cl(Trig); Inf = cl(Inf); Cyt = cl(Cyt); Ang = cl(Ang); Fib = cl(Fib);
  const Act = cl(0.82 * Cyt + 0.18 * Trig);
  const Destr = cl(0.72 * Act + 0.28 * Cyt);
  const Gran = cl((0.5 * Trig + 0.3 * Inf + 0.2 * Cyt) * (level === 0 ? 0.18 : 1));
  const Resol = level === 0 ? cl(1 - 0.55 * Cyt) : cl(0.18 * (1 - Cyt));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Trig, 0.3, 0.6, ["clearing", "present", "persistent"]), w(Inf, 0.3, 0.6, ["few cells", "many cells", "dense cells"]), w(Cyt, 0.3, 0.6, ["low", "raised", "high"]), w(Destr, 0.3, 0.6, ["little damage", "damage", "marked damage"])];
  return { a: S.level.a[level], drugAny: drug > 0 ? 1 : 0, Trig, Inf, Cyt, Act, Destr, Ang, Fib, Gran, Resol, words, readout: "trigger " + words[0] + " · infiltrate " + words[1] + " · cytokines " + words[2] + " · tissue " + words[3] };
}
const TESTS = [
  [1, 0, "trigger persistent · infiltrate dense cells · cytokines high · tissue marked damage"],
  [1, 1, "trigger clearing · infiltrate many cells · cytokines raised · tissue damage"],
  [0, 0, "trigger present · infiltrate many cells · cytokines raised · tissue damage"],
  [2, 3, "trigger persistent · infiltrate dense cells · cytokines low · tissue little damage"],
];

/* ---------------- static layout ---------------- */
const CY = 368;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">TISSUE</text>
<text class="sc-zone sc-dim" x="34" y="432">BLOOD VESSEL</text>
<g id="angio"></g>
<g id="collagen"></g>
<g id="damage"></g>
<g id="bac"></g>
<g id="gran"></g>
<g id="cells"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 36}" width="${W - 28}" height="72"/>
<g id="rbcs"></g>
<g id="endo"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "chronic-inflammation-granuloma", fig: "Fig 1", title: "Chronic inflammation: persistence, granuloma and fibrosis", W, H, body,
  label: "An animated tissue with a blood vessel below. When a trigger persists or resolution fails, macrophages and lymphocytes gather. Th1 and Th17 cells provide interferon gamma and interleukin 17, and macrophages provide tumour necrosis factor. Activated macrophages damage tissue. New vessels grow in, fibroblasts lay down fibrosis, and a granuloma walls the trigger off. Gauges show trigger, infiltrate, cytokines, tissue damage, new vessels and fibrosis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "chronicinf.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `.cl-epi{--cc:#d9b8e6}.cl-giant{--cc:#c9a0dc}.cl-th1{--cc:#6fb7e8}.cl-th17{--cc:#f0a35e}.cl-fib{--cc:#e8c98a}.cl-dam{--cc:#a89888}body[data-theme="light"] .cl-dam{--cc:#8a7868}.angio-v{fill:none;stroke:var(--c-rbc);stroke-width:5;stroke-linecap:round;opacity:.55}.angio-tip{fill:var(--c-rbc)}.coll-f{fill:none;stroke:var(--c-plt);stroke-width:2.2;stroke-linecap:round}.p-ifn{--cc:var(--c-cyt)}.p-tnf{--cc:var(--c-cyt2)}.p-il17{--cc:#f08a4b}.gran-core{fill:color-mix(in srgb,var(--c-bac) 16%,transparent);stroke:color-mix(in srgb,var(--c-mac) 65%,transparent);stroke-width:1.4;stroke-dasharray:5 4}`,
  sourcesLis: [
    "<strong>How chronic inflammation develops.</strong> Chronic inflammation follows a trigger that persists or a response that fails to resolve. Neutrophils give way to macrophages and lymphocytes. Th1 cells release interferon gamma and Th17 cells release interleukin 17, while activated macrophages release tumour necrosis factor. Together these cytokines keep macrophages activated, so enzymes and reactive products damage tissue. New blood vessels grow in (angiogenesis) and fibroblasts lay down collagen, giving fibrosis. When macrophages cannot clear the trigger they become epithelioid cells and multinucleated giant cells and wall it off as a granuloma, with a cuff of lymphocytes around it. This is standard textbook teaching in pathology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Removing the trigger lets the infiltrate and cytokines settle, though laid down fibrosis fades only partly. An anti-inflammatory broadly lowers cytokines, infiltration and damage while the trigger may persist. An anti-cytokine biologic strongly lowers cytokine signalling and macrophage activation, so damage falls while cells and trigger may remain. These are teaching toggles only.",
  ],
  simplified: "The many causes of granuloma, macrophage polarisation states, individual cytokine pathways, scarring in specific organs, infection specific patterns, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
