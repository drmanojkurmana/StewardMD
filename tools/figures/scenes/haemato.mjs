/* Haematopoiesis: stem cell to blood lineages, as an animated working scene (original drawing).
 *   node tools/figures/scenes/haemato.mjs [--print-model]
 * Layout and model here; organs, cells, growth factors and gauges move in haemato.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "State of the marrow", a: [1, 0.32, 1.35], names: ["normal", "marrow suppression", "stress response"], ticks: ["normal", "suppressed", "stress"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "growth factor" },
    { label: "transplant" },
  ],
  status: "Marrow: {level} · {drug} ·",
  drugNames: ["no treatment", "a growth factor", "a transplant"],
};
function modelOf(S, level, drug) {
  const base = [1, 0.32, 1.35][level];
  const gfK = [0, 1, 0][drug], txK = [0, 0, 1][drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const stem = cl(txK ? 0.92 : base * 0.85);
  const drive = stem + (gfK ? 0.34 : 0);
  const ery = cl(drive * (level === 2 ? 0.82 : 1) * (txK ? 1.02 : 1));
  const plt = cl(drive * 0.95 * (txK ? 1.02 : 1));
  const gran = cl(drive * (level === 2 ? 1.22 : 1));
  const mono = cl(drive * (level === 2 ? 1.12 : 0.95));
  const lymph = cl((stem + (gfK ? 0.07 : 0)) * (level === 2 ? 0.72 : 1));
  const marrow = cl(stem * 1.05);
  const epo = cl(1.08 - ery * 0.75 + (gfK ? 0.3 : 0));
  const tpo = cl(1.05 - plt * 0.7 + (gfK ? 0.25 : 0));
  const csf = cl(0.3 + (1 - gran) * 0.45 + (level === 2 ? 0.3 : 0) + (gfK ? 0.3 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(ery, 0.35, 0.7, ["low", "reduced", "normal"]), w(plt, 0.35, 0.7, ["low", "reduced", "normal"]), w(gran, 0.35, 0.7, ["low", "reduced", "normal"]), w(marrow, 0.35, 0.7, ["empty", "sparse", "cellular"])];
  return { base, gf: gfK, tx: txK, stem, ery, plt, gran, mono, lymph, marrow, epo, tpo, csf, words, readout: "red cells " + words[0] + " · platelets " + words[1] + " · neutrophils " + words[2] + " · marrow " + words[3] };
}
const TESTS = [
  [0, 0, "red cells normal · platelets normal · neutrophils normal · marrow cellular"],
  [1, 0, "red cells low · platelets low · neutrophils low · marrow empty"],
  [1, 1, "red cells reduced · platelets reduced · neutrophils reduced · marrow empty"],
  [1, 2, "red cells normal · platelets normal · neutrophils normal · marrow cellular"],
  [2, 0, "red cells normal · platelets normal · neutrophils normal · marrow cellular"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<rect class="hm-cavity" x="225" y="70" width="370" height="345" rx="20"/>
<rect id="marrowFull" class="hm-full" x="231" y="76" width="358" height="333" rx="16"/>
<g id="kidneySlot"></g>
<g id="liverSlot"></g>
<g id="vesselSlot"></g>
<g id="links"></g>
<g id="beams"></g>
<g id="halos"></g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-hsc{--cc:#2fb3a6}.cl-cmp{--cc:#dfa83e}.cl-clp{--cc:#4aa3d8}.cl-eryp{--cc:#e07070}.cl-mega{--cc:#e3c65e}.cl-granp{--cc:#eeb84e}.cl-monop{--cc:#63bfa0}.cl-lymp{--cc:#63aee2}.cl-strom{--cc:#c9a189}
.hm-cavity{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.hm-full{fill:var(--c-rbc);stroke:none}
.hm-niche{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 4}
.hm-link{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.hm-beam{fill:none;stroke-linecap:round}
.hm-epo{stroke:#e5484d}.hm-tpo{stroke:#e8a33d}.hm-csf{stroke:#3fbfae}
.hm-gfglow{fill:#e8a33d;stroke:none}
.hm-graft{fill:#f2b84a;stroke:none}
.hm-strom{fill:color-mix(in srgb,var(--c-eos) 55%,var(--anatomy-paper));stroke:none}
.hm-cap{fill:var(--anatomy-strong)}
.p-epo{--cc:#e5484d}.p-tpo{--cc:#e8a33d}.p-csf{--cc:#3fbfae}
.dr-g-fill.g-ery{fill:var(--c-rbc)}.dr-g-fill.g-plt2{fill:var(--c-plt)}.dr-g-fill.g-gran{fill:var(--c-neut)}.dr-g-fill.g-mono{fill:#63bfa0}.dr-g-fill.g-lym{fill:var(--c-lymph)}.dr-g-fill.g-stem{fill:#2fb3a6}
`;

buildScene({
  id: "haematopoiesis-lineages", fig: "Fig 1", title: "Haematopoiesis: stem cell to blood cells", W, H, body, extraCss,
  label: "An animated bone marrow. Left to right: signal organs on the left, the marrow in the middle, the blood on the right. A stem cell in its marrow niche gives myeloid and lymphoid progenitors. The kidney sends EPO and the liver sends TPO through signal beams that reach the marrow, and infection signals arrive from the blood. The lines mature into red cells, platelets and white cells that leave through a blood vessel. A growth factor widens the signal beams and boosts the progenitor lines. A transplant brings donor stem cells through the blood to the niche, so every line can recover.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, counts or thresholds are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "haemato.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With transplant",
  sourcesLis: [
    "<strong>How blood is made.</strong> Haematopoietic stem cells sit in a marrow niche of stromal, bone and vessel cells that hold and instruct them. A stem cell gives a common myeloid progenitor and a common lymphoid progenitor. Erythropoietin, made mainly by the kidney when oxygen delivery falls, drives red cell production. Thrombopoietin, made mainly by the liver, drives megakaryocytes to release platelets. Colony stimulating factors drive granulocytes and monocytes and rise in infection and stress. Lymphoid progenitors give lymphocytes. Mature cells leave the marrow and enter the blood. This is standard teaching in haematology and physiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A growth factor boosts progenitor output in the lines it acts on, but it cannot rebuild an empty stem cell pool. A transplant replaces the stem cell pool itself, so every lineage can recover. These are teaching toggles only.",
  ],
  simplified: "Detailed progenitor stages, other growth factors and interleukins, iron and vitamin requirements, spleen roles, cell lifespans, laboratory counts and all drug names, doses and transplant procedures are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
