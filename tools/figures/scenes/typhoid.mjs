/* Typhoid fever as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/typhoid.mjs [--print-model]
 * Static layout here; bacteria, macrophages and gauges move in typhoid.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Week of illness", a: [0.25, 0.55, 0.85, 1], names: ["week 1", "week 2", "week 3", "week 4"], ticks: ["week 1", "week 2", "week 3", "week 4"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotic" },
    { label: "fluids only (support)" },
    { label: "surgery for perforation" },
  ],
  status: "Illness: {level} · {drug} ·",
  drugNames: ["no treatment", "antibiotic", "fluids only", "surgery for perforation"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const abx = drug === 1 ? 1 : 0, flu = drug === 2 ? 1 : 0, surg = drug === 3 ? 1 : 0;
  const baseB = [0.5, 0.95, 0.9, 0.65][level], baseF = [0.45, 0.85, 0.9, 0.6][level];
  const baseR = [0.05, 0.7, 0.6, 0.3][level], baseU = [0.05, 0.25, 0.75, 0.85][level];
  const basePf = [0, 0.05, 0.55, 0.7][level], baseCar = [0.02, 0.1, 0.3, 0.75][level];
  const B = cl(baseB * (abx ? 0.15 : 1));
  const F = cl(baseF * (abx ? 0.4 : flu ? 0.85 : 1));
  const R = cl(baseR * (abx ? 0.3 : 1));
  const U = cl(baseU * (abx ? 0.65 : 1));
  const Pf = cl(basePf * (abx ? 0.5 : 1) * (surg ? 0.08 : 1));
  const Car = cl(baseCar * (abx ? 0.45 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.55, ["cleared", "present", "high"]), w(F, 0.3, 0.6, ["settling", "raised", "high"]), w(U, 0.25, 0.6, ["intact", "inflamed", "ulcerated"]), w(Pf, 0.15, 0.4, ["none", "at risk", "likely"])];
  return { a: S.level.a[level], abx, flu, surg, B, F, R, U, Pf, Car, words, readout: "bacteraemia " + words[0] + " · fever " + words[1] + " · bowel " + words[2] + " · perforation " + words[3] };
}
const TESTS = [
  [0, 0, "bacteraemia present · fever raised · bowel intact · perforation none"],
  [2, 0, "bacteraemia high · fever high · bowel ulcerated · perforation likely"],
  [2, 1, "bacteraemia cleared · fever raised · bowel inflamed · perforation at risk"],
  [2, 3, "bacteraemia high · fever high · bowel ulcerated · perforation none"],
];

/* ---------------- static layout ---------------- */
const body = `
<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#8a8496"/></marker></defs>
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="ty-glass" d="M58 88L106 88L100 146L64 146Z"/>
<path class="ty-water" d="M62 104L102 104L99 142L65 142Z"/>
<path class="ty-arrow" d="M112 118C135 128 150 140 168 158"/>
<g id="bowelSlot"></g>
<ellipse class="ty-peyer" cx="272" cy="296" rx="20" ry="9" transform="rotate(-12 272 296)"/>
<ellipse class="ty-peyer" cx="332" cy="302" rx="20" ry="9" transform="rotate(-4 332 302)"/>
<ellipse class="ty-peyer" cx="392" cy="278" rx="18" ry="8" transform="rotate(38 392 278)"/>
<ellipse id="gutHot" class="ty-guthot" cx="300" cy="215" rx="105" ry="105" opacity="0"/>
<rect class="ty-skin" x="545" y="76" width="180" height="140" rx="12"/>
<ellipse id="heat" class="ty-heat" cx="635" cy="146" rx="95" ry="72" opacity="0"/>
<g id="liverSlot"></g>
<rect class="sc-lumen" x="520" y="300" width="412" height="52" rx="10"/>
<g id="bac"></g><g id="vbac"></g><g id="rbcs"></g><g id="macs"></g>
<g id="rose"></g><g id="gbdots"></g><g id="ulcer"></g><g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "typhoid-fever", fig: "Fig 1", title: "Typhoid fever: bowel to bloodstream and back", W, H, body,
  label: "An animated small bowel, bloodstream, skin and gallbladder in typhoid fever. Salmonella Typhi is taken in with food or water, invades the small bowel over the Peyer patches, rides inside macrophages into the blood, and causes a stepwise fever and rose spots. Later the patches ulcerate and may perforate, and bacteria may settle in the gallbladder as a carrier state. Gauges show bacteraemia, fever, rose spots, bowel ulceration, perforation and the carrier state. Treatment choices include an antibiotic, fluids and surgery for perforation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "typhoid.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antibiotic",
  extraCss: `.ty-glass{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}.ty-water{fill:var(--c-fl);opacity:.45}.ty-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:4 3;marker-end:url(#arr)}.ty-peyer{fill:var(--c-mac);opacity:.65;stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:.8}.ty-guthot{fill:var(--c-bad);stroke:none}.ty-skin{fill:color-mix(in srgb,var(--c-eos) 30%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}.ty-heat{fill:var(--c-bad);stroke:none}.ty-rose{fill:var(--c-bad);stroke:none;opacity:.55}.ty-ulcer-rim{fill:var(--c-bad);opacity:.55}.ty-ulcer-hole{fill:#2a1215;stroke:none}.ty-stitch{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}.ty-leak{fill:var(--c-bad);stroke:none;opacity:.8}.p-tybac{--cc:var(--c-bac)}.ty-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}`,
  sourcesLis: [
    "<strong>How typhoid fever develops.</strong> Salmonella Typhi is taken in with contaminated food or water, reaches the small bowel and invades the lining over the Peyer patches. It is taken up by macrophages but can survive inside them, riding to lymph tissue and into the blood. The resulting bacteraemia gives a fever that climbs in steps and then stays high, with faint pink rose spots on the trunk. As the swollen Peyer patches break down, the bowel wall ulcerates and may bleed or perforate, usually later in the illness. After recovery, bacteria may persist in the gallbladder and be shed in stool as a carrier state. This is standard teaching in medicine and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An antibiotic clears bacteria from the blood and bowel; fluids alone support the patient without clearing the infection; surgery is shown for perforation, closing the hole without clearing bacteria elsewhere. These are teaching toggles only.",
  ],
  simplified: "Stomach acid and dose effects, lymph-node and bone-marrow spread in detail, relative bradycardia and blood-count changes, bowel bleeding as a separate event, resistance patterns, vaccine and public-health measures, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
