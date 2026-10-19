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
    { label: "anti-inflammatory" },
    { label: "anti-cytokine biologic" },
    { label: "remove the trigger" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "anti-inflammatory", "anti-cytokine biologic", "remove the trigger"],
};
function modelOf(S, level, drug) {
  const trigB = [0.38, 0.88, 0.72];
  const infB = [0.34, 0.82, 0.76];
  const cytB = [0.3, 0.86, 0.7];
  const angB = [0.18, 0.55, 0.78];
  const fibB = [0.07, 0.36, 0.96];
  const cl = (v) => Math.max(0, Math.min(1, v));
  let Trig = trigB[level], Inf = infB[level], Cyt = cytB[level], Ang = angB[level], Fib = fibB[level];
  const ster = drug === 1 ? 1 : 0, bio = drug === 2 ? 1 : 0, rem = drug === 3 ? 1 : 0;
  if (rem) { Trig *= 0.12; Inf *= 0.45; Cyt *= 0.4; Ang *= 0.6; Fib *= 0.75; }
  if (ster) { Trig = cl(Trig * 1.15); Inf *= 0.6; Cyt *= 0.45; Ang *= 0.7; Fib *= 0.85; }
  if (bio) { Trig = cl(Trig * 1.1); Inf *= 0.8; Cyt *= 0.22; Ang *= 0.8; Fib *= 0.8; }
  Trig = cl(Trig); Inf = cl(Inf); Cyt = cl(Cyt); Ang = cl(Ang); Fib = cl(Fib);
  const Act = cl(0.82 * Cyt + 0.18 * Trig);
  const Destr = cl(0.72 * Act + 0.28 * Cyt);
  const Gran = cl((0.5 * Trig + 0.3 * Inf + 0.2 * Cyt) * (level === 0 ? 0.18 : 1));
  const Resol = level === 0 ? cl(1 - 0.55 * Cyt) : cl(0.18 * (1 - Cyt));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Trig, 0.3, 0.6, ["clearing", "present", "persistent"]), w(Inf, 0.3, 0.6, ["few cells", "many cells", "dense cells"]), w(Cyt, 0.3, 0.6, ["low", "raised", "high"]), w(Destr, 0.3, 0.6, ["little damage", "damage", "marked damage"])];
  return { a: S.level.a[level], drugAny: drug > 0 ? 1 : 0, ster, bio, rem, Trig, Inf, Cyt, Act, Destr, Ang, Fib, Gran, Resol, words, readout: "trigger " + words[0] + " · infiltrate " + words[1] + " · cytokines " + words[2] + " · tissue " + words[3] };
}
const TESTS = [
  [1, 0, "trigger persistent · infiltrate dense cells · cytokines high · tissue marked damage"],
  [1, 3, "trigger clearing · infiltrate many cells · cytokines raised · tissue damage"],
  [0, 0, "trigger present · infiltrate many cells · cytokines raised · tissue damage"],
  [2, 2, "trigger persistent · infiltrate dense cells · cytokines low · tissue little damage"],
];

/* ---------------- static layout ---------------- */
const CY = 368;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="lungSlot"></g>
<ellipse id="flush" class="ci-flush" cx="560" cy="218" rx="175" ry="115" opacity="0"/>
<path id="airway" class="ci-air" d="M558 46L558 66"/>
<g id="angio"></g>
<g id="collagen"></g>
<g id="damage"></g>
<g id="bac"></g>
<g id="gran"></g>
<g id="cells"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 36}" width="${W - 28}" height="72"/>
<g id="rbcs"></g>
<g id="endo"></g>
<g id="seals"></g>
<g id="parts"></g>
<g id="blk"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "chronic-inflammation-granuloma", fig: "Fig 1", title: "Chronic inflammation: persistence, granuloma and fibrosis", W, H, body,
  label: "An animated granuloma in the lung. An inhaled trigger persists, so macrophages and lymphocytes gather. Helper T cells release interferon gamma and interleukin 17, and macrophages release tumour necrosis factor, which keeps macrophages switched on so they damage tissue. New vessels sprout in, fibroblasts lay down fibrosis, and epithelioid macrophages and giant cells wall the trigger off as a granuloma. A slider sets the course, and treatment choices are an anti-inflammatory, an anti-cytokine biologic and removing the trigger.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "chronicinf.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With trigger removal",
  extraCss: `.cl-epi{--cc:#d9b8e6}.cl-giant{--cc:#c9a0dc}.cl-th1{--cc:#6fb7e8}.cl-th17{--cc:#f0a35e}.cl-fib{--cc:#e8c98a}.cl-dam{--cc:#a89888}body[data-theme="light"] .cl-dam{--cc:#8a7868}.angio-v{fill:none;stroke:var(--c-rbc);stroke-width:5;stroke-linecap:round;opacity:.55}.angio-tip{fill:var(--c-rbc)}.coll-f{fill:none;stroke:var(--c-plt);stroke-width:2.2;stroke-linecap:round}.p-ifn{--cc:var(--c-cyt)}.p-tnf{--cc:var(--c-cyt2)}.p-il17{--cc:#f08a4b}.p-trig{--cc:var(--c-bac)}.gran-core{fill:color-mix(in srgb,var(--c-bac) 16%,transparent);stroke:color-mix(in srgb,var(--c-mac) 65%,transparent);stroke-width:1.4;stroke-dasharray:5 4}
.ci-flush{fill:color-mix(in srgb,var(--c-bad) 34%,transparent);stroke:none}
.ci-air{fill:none;stroke:color-mix(in srgb,var(--anatomy-mid) 70%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round}
.act-ring{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-dasharray:6 5}
.seal-t{fill:none;stroke:var(--c-good);stroke-width:3;stroke-linecap:round}
.blk-y{fill:none;stroke:var(--c-ab);stroke-width:2;stroke-linecap:round}
.ci-cap{fill:var(--anatomy-strong);font-size:13px}`,
  sourcesLis: [
    "<strong>How chronic inflammation develops.</strong> Chronic inflammation follows a trigger that persists or a response that fails to resolve. The scene places the granuloma in the lung, with the trigger arriving down the airway. Neutrophils give way to macrophages and lymphocytes. Th1 cells release interferon gamma and Th17 cells release interleukin 17, while activated macrophages release tumour necrosis factor. Together these cytokines keep macrophages activated, so enzymes and reactive products damage tissue. New blood vessels grow in (angiogenesis) and fibroblasts lay down collagen, giving fibrosis. When macrophages cannot clear the trigger they become epithelioid cells and multinucleated giant cells and wall it off as a granuloma, with a cuff of lymphocytes around it. This is standard textbook teaching in pathology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An anti-inflammatory broadly lowers cytokines, infiltration and damage while the trigger may persist. An anti-cytokine biologic strongly lowers cytokine signalling and macrophage activation, so damage falls while cells and trigger may remain. Removing the trigger lets the infiltrate and cytokines settle, though laid down fibrosis fades only partly. These are teaching toggles only.",
  ],
  simplified: "The many causes of granuloma, macrophage polarisation states, individual cytokine pathways, scarring in specific organs, infection specific patterns, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
