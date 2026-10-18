/* Wound healing as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/wound.mjs [--print-model]
 * Static layout here; cells, vessels and gauges move in wound.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of healing", a: [0.2, 0.6, 1], names: ["inflammation", "proliferation", "remodelling"], ticks: ["inflammation", "proliferation", "remodelling"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "clean and dress" },
    { label: "treat infection and ischaemia" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "cleaned and dressed", "infection and ischaemia treated"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const clotB = [1, 0.35, 0.08][level];
  const neuB = [1, 0.35, 0.1][level];
  const macB = [0.55, 0.65, 0.25][level];
  const fibB = [0.15, 1, 0.45][level];
  const angB = [0.1, 1, 0.35][level];
  const granB = [0.05, 1, 0.25][level];
  const epiB = [0.05, 0.65, 1][level];
  const c3B = [0.1, 0.85, 0.25][level];
  const c1B = [0.02, 0.25, 1][level];
  const conB = [0.05, 0.35, 0.9][level];
  const infB = [0.9, 0.55, 0.28][level];
  const infectF = [1, 0.4, 0.07][drug];
  const perf = [0.38, 0.68, 1][drug];
  const Infect = cl(infB * infectF * 1.05);
  const Clean = cl((0.55 * neuB + 0.45 * macB) * (1 - 0.25 * Infect));
  const Fib = cl(fibB * (0.4 + 0.6 * perf) * (1 - 0.5 * Infect));
  const Ang = cl(angB * perf * (1 - 0.45 * Infect));
  const Gran = cl(granB * (0.5 + 0.5 * perf) * (1 - 0.5 * Infect));
  const Epi = cl(epiB * (0.55 + 0.45 * perf) * (1 - 0.65 * Infect));
  const Coll3 = cl(c3B * (0.6 + 0.4 * perf) * (1 - 0.3 * Infect));
  const Coll1 = cl(c1B * (0.55 + 0.45 * perf) * (1 - 0.35 * Infect));
  const Contract = cl(conB * (0.6 + 0.4 * perf) * (1 - 0.3 * Infect));
  const Scar = cl(Coll1 * 0.9 + Contract * 0.2);
  const Strength = cl(Coll1 * 0.85 + Contract * 0.15);
  const Delay = cl(Infect * 0.55 + (1 - perf) * 0.35 + (1 - Strength) * 0.12);
  const Keloid = cl(Scar * (0.35 + 0.65 * Delay));
  const Clot = cl(clotB * (1 - 0.3 * Infect));
  const Neu = cl(neuB * (1 - 0.2 * Infect));
  const Mac = cl(macB * (1 - 0.15 * Infect));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Clean, 0.3, 0.6, ["slow", "active", "brisk"]), w(Gran, 0.25, 0.6, ["little", "filling", "full"]), w(Epi, 0.3, 0.65, ["open", "closing", "closed"]), w(Strength, 0.25, 0.6, ["weak", "gaining", "strong"])];
  return { a: S.level.a[level], perf, Clot, Neu, Mac, Clean, Fib, Ang, Gran, Epi, Coll3, Coll1, Contract, Scar, Strength, Infect, Delay, Keloid, words, readout: "cleaning " + words[0] + " · fill " + words[1] + " · closure " + words[2] + " · strength " + words[3] };
}
const TESTS = [
  [0, 0, "cleaning brisk · fill little · closure open · strength weak"],
  [0, 2, "cleaning brisk · fill little · closure open · strength weak"],
  [1, 0, "cleaning active · fill filling · closure open · strength weak"],
  [2, 2, "cleaning slow · fill little · closure closed · strength strong"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">WOUND IN CROSS SECTION</text>
<g id="skinL">
<rect class="wd-epi" x="30" y="108" width="320" height="14"/>
<rect class="wd-derm" x="30" y="122" width="320" height="168"/>
<rect class="wd-fat" x="30" y="290" width="320" height="70"/>
<path class="wd-edge" d="M350 108L368 180L362 290L350 360"/>
</g>
<g id="skinR">
<rect class="wd-epi" x="610" y="108" width="320" height="14"/>
<rect class="wd-derm" x="610" y="122" width="320" height="168"/>
<rect class="wd-fat" x="610" y="290" width="320" height="70"/>
<path class="wd-edge" d="M610 108L592 180L598 290L610 360"/>
</g>
<rect class="wd-bed" x="362" y="290" width="236" height="70"/>
<g id="gran"></g>
<g id="clotG"></g>
<g id="collG"></g>
<g id="vess"></g>
<g id="epi"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "wound-healing-fibrosis", fig: "Fig 1", title: "Wound healing: cleaning, filling and remodelling", W, H, body,
  label: "An animated wound seen in cross section. A clot plugs the gap, then neutrophils and later macrophages clean it. Fibroblasts lay down granulation tissue, new vessels grow in, and new skin crawls across. Later, type III collagen is replaced by stronger type I collagen, myofibroblasts pull the edges together, and a scar remains. Gauges show cleaning, fill, closure and strength. Treatment choices are cleaning and dressing, and treating infection and poor blood supply.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "wound.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
body{--c-epi:#e8b4a0;--c-derm:#d99a8a;--c-fat:#f2d27a;--c-bed:#b66a6a;--c-gran:#e88a7a;--c-clot:#8e2432;--c-fib:#7fc4a8;--c-myo:#c978a8;--c-coll3:#7ab8ff;--c-coll1:#e9b84a}
body[data-theme="light"]{--c-epi:#d99078;--c-derm:#c97a68;--c-fat:#d9a92c;--c-bed:#a85a5a;--c-gran:#d96a58;--c-clot:#a02838;--c-fib:#3f9f7c;--c-myo:#a84f88;--c-coll3:#2f7ad8;--c-coll1:#c9961f}
.wd-epi{fill:var(--c-epi);stroke:color-mix(in srgb,var(--c-epi) 55%,#000);stroke-width:.8}
.wd-derm{fill:var(--c-derm);opacity:.75;stroke:color-mix(in srgb,var(--c-derm) 55%,#000);stroke-width:.8}
.wd-fat{fill:var(--c-fat);opacity:.5;stroke:color-mix(in srgb,var(--c-fat) 55%,#000);stroke-width:.8}
.wd-bed{fill:var(--c-bed);opacity:.55}
.wd-edge{fill:color-mix(in srgb,var(--c-derm) 80%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-derm) 55%,#000);stroke-width:.8}
.wd-gran{fill:var(--c-gran);stroke:color-mix(in srgb,var(--c-gran) 55%,#000);stroke-width:.8}
.wd-clot{fill:var(--c-clot);stroke:color-mix(in srgb,var(--c-clot) 55%,#000);stroke-width:.8}
.wd-epi-new{fill:var(--c-epi);stroke:color-mix(in srgb,var(--c-epi) 55%,#000);stroke-width:.8}
.wd-scar{fill:var(--c-epi);stroke:color-mix(in srgb,var(--c-epi) 55%,#000);stroke-width:.8;opacity:.9}
.wd-vess{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.wd-vess2{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-linecap:round;opacity:.7}
.wd-c3{fill:none;stroke:var(--c-coll3);stroke-width:1.4;stroke-linecap:round}
.wd-c1{fill:none;stroke:var(--c-coll1);stroke-width:2.6;stroke-linecap:round}
.wd-arrow{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.cl-fib{--cc:var(--c-fib)}.cl-myo{--cc:var(--c-myo)}
.dr-g-fill.g-clean{fill:var(--c-good)}.dr-g-fill.g-fill{fill:var(--c-gran)}.dr-g-fill.g-close{fill:var(--c-epi)}.dr-g-fill.g-str{fill:var(--c-coll1)}.dr-g-fill.g-delay{fill:var(--c-bad)}
.p-bac{--cc:var(--c-bac)}.p-deb{--cc:#c9b8a8}
`,
  sourcesLis: [
    "<strong>How a wound heals.</strong> Bleeding is stopped by a clot of platelets and fibrin (haemostasis). Neutrophils arrive first, then macrophages, and together they clear microbes and dead tissue. Fibroblasts then make granulation tissue, new blood vessels grow in (angiogenesis), and new skin cells crawl across the surface (re-epithelialisation). Later the early type III collagen is replaced by stronger type I collagen, myofibroblasts pull the edges together (contraction), and a scar remains. A raised scar that grows beyond the wound is a keloid. This is standard textbook teaching in pathology and surgery and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What delays healing, and treatment ideas shown.</strong> Infection, poor blood supply (ischaemia), diabetes and steroids can all delay healing. Cleaning and dressing protects the wound and keeps it moist. Treating infection and restoring blood supply removes two major blocks to filling and closure. These are teaching toggles only.",
  ],
  simplified: "Diabetes and steroid effects are described in words rather than drawn as separate toggles, nerve and hair regrowth, wound dressings by type, sutures and grafts, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
