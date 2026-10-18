/* Nephron function and acute kidney injury as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/nephron.mjs [--print-model]
 * Static layout here; blood, filtrate, protein, cells and gauges move in nephron.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
/* inj[level] = [blood flow, back-pressure, tubule injury, glomerular inflammation, protein leak] before any treatment */
const MD = {
  level: {
    label: "Where the injury is", a: [0, 1, 2, 3, 4],
    names: ["prerenal (low blood flow)", "intrinsic: tubule injury", "intrinsic: nephritic glomerulus", "intrinsic: nephrotic glomerulus", "postrenal (blocked drainage)"],
    ticks: ["prerenal", "tubule", "nephritic", "nephrotic", "blocked"],
    tags: ["Prerenal: too little blood reaches the glomerulus", "Intrinsic (tubular): tubule cells are injured", "Intrinsic (nephritic): inflamed glomerulus, blood in urine", "Intrinsic (nephrotic): leaky glomerulus, protein in urine", "Postrenal: urine cannot drain, pressure backs up"],
    inj: [[0.25, 0, 0.12, 0, 0.02], [0.85, 0, 0.9, 0, 0.05], [0.85, 0, 0.1, 0.85, 0.3], [0.9, 0, 0.05, 0.1, 0.9], [0.85, 0.9, 0.3, 0, 0.02]],
    start: 1,
  },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "fluids (restore blood volume)" },
    { label: "relieve the obstruction" },
    { label: "stop the nephrotoxin" },
    { label: "steroid (calm the immune attack)" },
  ],
  status: "Injury: {level} · {drug} ·",
  drugNames: ["no treatment", "fluids", "relieving the obstruction", "stopping the nephrotoxin", "a steroid"],
};
function modelOf(S, level, drug) {
  const b = S.level.inj[level], cl = (v) => Math.max(0, Math.min(1, v));
  let F = b[0], O = b[1], T = b[2], G = b[3], P = b[4];
  const fl = drug === 1 ? 1 : 0, rel = drug === 2 ? 1 : 0, stopT = drug === 3 ? 1 : 0, imm = drug === 4 ? 1 : 0;
  if (fl && level === 0) { F = 0.88; T = 0.02; }
  if (rel && level === 4) { O = 0.04; T = 0.12; }
  if (stopT && level === 1) T = 0.5;
  if (imm && level === 2) { G = 0.3; P = 0.12; }
  if (imm && level === 3) P = 0.3;
  const X = level === 1 && !stopT ? 1 : 0, stop = level === 1 && stopT ? 1 : 0;
  const GFR = cl(F / 0.85) * (1 - 0.8 * O) * (1 - 0.55 * T) * (1 - 0.5 * G) * (1 - 0.15 * P);
  const UO = GFR * (1 - 0.9 * O);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const urine = P > 0.6 ? "heavy protein" : G > 0.4 ? "blood and cells" : T > 0.35 ? "muddy casts" : P > 0.2 ? "some protein" : O > 0.5 ? "scant" : F < 0.6 ? "concentrated" : "unremarkable";
  const words = [w(GFR, 0.35, 0.75, ["very low", "reduced", "near normal"]), w(UO, 0.1, 0.55, ["very little", "low", "adequate"]), urine];
  return { F, O, T, G, P, GFR, UO, X, stop, fl, imm, words, readout: "filtration " + words[0] + " · urine output " + words[1] + " · urine " + words[2] };
}
const TESTS = [
  [1, 0, "filtration reduced · urine output low · urine muddy casts"],
  [0, 1, "filtration near normal · urine output adequate · urine unremarkable"],
  [3, 0, "filtration near normal · urine output adequate · urine heavy protein"],
  [4, 0, "filtration very low · urine output very little · urine scant"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text id="tag" class="sc-zone" x="930" y="68" text-anchor="end"></text>
<g id="caps"></g><g id="tub"></g><g id="vess"></g><g id="glom"></g>
<g id="rbcs"></g><g id="parts"></g><g id="stone"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-brown:#8a5a2b}body[data-theme="light"]{--c-brown:#7a4a1e}
.nf-wall{fill:none;stroke:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid));stroke-linecap:round;stroke-linejoin:round}
.nf-lum{fill:none;stroke:color-mix(in srgb,var(--c-fl) 24%,var(--anatomy-paper));stroke-linecap:round;stroke-linejoin:round}
.nf-vw{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-mid));stroke-linecap:round;stroke-linejoin:round}
.nf-vl{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 18%,var(--anatomy-paper));stroke-linecap:round;stroke-linejoin:round}
.nf-dmg{fill:none;stroke:var(--c-brown);stroke-dasharray:1 7;stroke-linecap:round;stroke-linejoin:round}
.nf-caps{fill:color-mix(in srgb,var(--c-fl) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid));stroke-width:2.6}
.nf-tuft{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,var(--anatomy-paper));stroke-width:1.2}
.nf-coil{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 40%,var(--anatomy-paper));stroke-width:5;stroke-linecap:round;opacity:.65}
.nf-bar{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4;stroke-linecap:round}
.nf-dep{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 50%,#000);stroke-width:.5}
.nf-stone{fill:var(--anatomy-mid);stroke:var(--anatomy-strong);stroke-width:1.2;stroke-linejoin:round}
.nf-stop{fill:none;stroke:var(--c-bad);stroke-width:2.2}
.p-fd{fill:var(--c-fl)}.p-prot{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 45%,#000);stroke-width:.6}
.p-bl{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:.5}.p-sl{fill:var(--c-brown);stroke:color-mix(in srgb,var(--c-brown) 50%,#000);stroke-width:.5}
`;

buildScene({
  id: "nephron-aki", fig: "Fig 1", title: "The nephron and acute kidney injury", W, H, body, extraCss,
  label: "An animated nephron. Blood enters a glomerulus through the afferent arteriole and is filtered into Bowman space. The filtrate flows along the proximal tubule, loop of Henle, distal tubule and collecting duct to the ureter. A level slider moves the injury between low blood flow before the kidney (prerenal), tubule injury, an inflamed nephritic glomerulus, a leaky nephrotic glomerulus, and a blocked ureter after the kidney (postrenal). Gauges show blood flow, back-pressure, tubule damage, inflammation, protein leak, filtration and urine output. Treatment choices include fluids, relieving an obstruction, stopping a nephrotoxin and a steroid.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "nephron.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How the kidney filters.</strong> Blood enters the glomerulus through the afferent arteriole. The filtration barrier (capillary lining, basement membrane and podocytes) lets water and small solutes into Bowman space while keeping blood cells and most protein in the blood. The filtrate is then reworked along the tubule (the proximal tubule reclaims most of it) and leaves as urine through the ureter. This is standard physiology teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Three broad groups of acute kidney injury.</strong> Prerenal: too little blood reaches the glomerulus (low volume, poor pump function, drugs that change glomerular blood flow), so filtration falls while the kidney itself is intact; if it goes on, tubule cells can die. Intrinsic: damage inside the kidney, most often acute tubular necrosis from poor blood flow or a toxin (dead tubule cells shed and form casts), or disease of the glomerulus or interstitium. Postrenal: obstruction to drainage (for example a stone or an enlarged prostate) raises pressure back toward the kidney and lowers filtration. Flagged for review.",
    "<strong>Nephritic versus nephrotic.</strong> A nephritic picture is an inflamed glomerulus: red cells in the urine, red cell casts, often high blood pressure and swelling, and reduced filtration. A nephrotic picture is a leaky filter: heavy protein loss in the urine with low blood albumin and swelling, while filtration may stay near normal early on. Some immune-driven forms respond to steroids or other immune treatment, but many causes need different management. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Fluids for low volume, relieving a blockage, stopping a kidney-damaging toxin, and a steroid for an immune-driven glomerular disease. These are teaching toggles only; each helps only when it matches the cause, which is the point of the figure.",
  ],
  simplified: "Real cases overlap (for example prolonged low blood flow becomes tubule injury, and obstruction can follow other injury), and the interstitial and vascular causes, fluid overload, electrolyte and acid-base effects, the need for dialysis, the many causes of each glomerular disease, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
