/* Cardiomyopathies as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cmp.mjs [--print-model]
 * Static layout here; the ventricle, atrium, outflow tract and gauges move in cmp.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Cardiomyopathy type", a: [1, 1, 1], names: ["dilated", "hypertrophic", "restrictive"], ticks: ["dilated", "hypertrophic", "restrictive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "heart failure therapy" },
    { label: "beta-blocker or myectomy for outflow obstruction" },
    { label: "treat the cause" },
  ],
  status: "Type: {level} · {drug} ·",
  drugNames: ["no treatment", "heart failure therapy", "beta-blocker or myectomy", "treat the cause"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const hf = drug === 1 ? 1 : 0, bb = drug === 2 ? 1 : 0, cause = drug === 3 ? 1 : 0;
  const P0 = level === 0 ? 1 : 0, P1 = level === 1 ? 1 : 0, P2 = level === 2 ? 1 : 0;
  let Dil = P0 ? 0.92 : P1 ? 0.24 : 0.30;
  let Wall = P0 ? 0.18 : P1 ? 0.92 : 0.46;
  let Stiff = P0 ? 0.30 : P1 ? 0.55 : 0.95;
  let Dia = P0 ? 0.45 : P1 ? 0.78 : 0.92;
  let Sys = P0 ? 0.88 : P1 ? 0.24 : 0.34;
  let Out = P1 ? 0.86 : 0.05;
  if (hf) { Sys = cl(Sys - (P0 ? 0.36 : 0.08)); Dia = cl(Dia - 0.10); }
  if (bb) { Out = cl(Out - (P1 ? 0.66 : 0.02)); Dia = cl(Dia - (P1 ? 0.26 : 0.03)); Sys = cl(Sys - (P1 ? 0.04 : 0)); }
  if (cause) { Dil = cl(Dil - (P0 ? 0.24 : 0.04)); Stiff = cl(Stiff - (P2 ? 0.32 : 0.05)); Dia = cl(Dia - (P2 ? 0.32 : P0 ? 0.14 : 0.04)); Sys = cl(Sys - (P0 ? 0.16 : 0.05)); Wall = cl(Wall - (P2 ? 0.06 : 0)); }
  const Fill = cl(1 - Dia), Ej = cl(1 - Sys);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Dil, 0.35, 0.65, ["small", "normal", "dilated"]), w(Wall, 0.35, 0.65, ["thin", "normal", "thick"]), w(Fill, 0.35, 0.65, ["poor", "reduced", "good"]), w(Ej, 0.35, 0.65, ["poor", "reduced", "good"])];
  return { hf, bb, cause, P0, P1, P2, Dil, Wall, Stiff, Dia, Sys, Out, Fill, Ej, words, readout: "chamber " + words[0] + " · wall " + words[1] + " · filling " + words[2] + " · ejection " + words[3] };
}
const TESTS = [
  [0, 0, "chamber dilated · wall thin · filling reduced · ejection poor"],
  [1, 0, "chamber small · wall thick · filling poor · ejection good"],
  [2, 0, "chamber small · wall normal · filling poor · ejection good"],
  [1, 2, "chamber small · wall thick · filling reduced · ejection good"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CAUSES</text>
<text class="sc-zone" x="604" y="68">WHAT GOES WRONG</text>
<text class="sc-zone sc-dim" x="400" y="68">LEFT HEART, CUT OPEN</text>
<g id="causes"></g><g id="heart"></g><g id="cons"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cardiomyopathies", fig: "Fig 1", title: "Cardiomyopathies: three ways the ventricle fails", W, H, body,
  label: "An animated left heart in dilated, hypertrophic and restrictive cardiomyopathy. In dilated disease the ventricle stretches, the wall thins and squeezing fails, after causes such as alcohol, viral or immune myocarditis and genetic disease. In hypertrophic disease the septum thickens, blocks outflow and impairs filling, with a risk of sudden death. In restrictive disease amyloid and scarring stiffen the wall so filling fails. Gauges show dilatation, wall thickness, stiffness, filling, ejection and outflow block. Treatment choices are heart failure therapy, a beta-blocker or myectomy for outflow obstruction, and treating the cause.",
  caption: "Schematic, not to scale. Chamber sizes, speeds and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cmp.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>What cardiomyopathy means.</strong> A cardiomyopathy is disease of heart muscle where the cardiac muscle itself fails, without valve, coronary or pressure overload explaining it. The three classic patterns are dilated (ventricular dilatation, thin wall, systolic failure), hypertrophic (septal hypertrophy, dynamic outflow obstruction, diastolic dysfunction and sudden death risk) and restrictive (a stiff ventricle, classically from amyloid, with poor filling). This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Causes stressed for dilated disease.</strong> Multiple causes are implicated, often together in a patient with an initial insult and systemic involvement. Stressed examples are alcohol, viral myocarditis including COVID-19, inflammatory and immune disease including immune checkpoint therapy, systemic disease with cardiac involvement, and genetic disease. Myocarditis is inflammation of heart muscle that can heal, scar or progress to a dilated ventricle. These are teaching associations only.",
    "<strong>Treatment ideas shown.</strong> Heart failure therapy supports a failing ventricle, a beta-blocker or septal myectomy relieves outflow obstruction in hypertrophic disease, and treating the cause means removing alcohol, treating myocarditis or treating amyloid and other systemic causes. These are teaching toggles only.",
  ],
  simplified: "Genetic subtypes and testing, arrhythmia devices and anticoagulation, transplant and mechanical support, specific amyloid therapies, imaging measurements, exercise advice and all doses and drug choices are left out. The heart is a simple two chamber schematic and does not show the right ventricle separately. The figure does not say how any patient should be treated.",
  extraCss: `
.cmp-myo{fill:color-mix(in srgb,var(--c-rbc) 52%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.cmp-cav{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.cmp-la{fill:color-mix(in srgb,var(--c-rbc) 42%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.cmp-aorta{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.cmp-sept{fill:color-mix(in srgb,var(--c-rbc) 68%,#000);opacity:.55}
.cmp-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.cmp-icon{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.7}
.cmp-icon2{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.7}
.cmp-icon3{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.7}
.cmp-icon4{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.7}
.cmp-fib{fill:none;stroke:var(--c-cyt);stroke-width:1.4;stroke-linecap:round}
.p-in{--cc:var(--c-fl)}.p-out{--cc:var(--c-rbc)}.p-amy{--cc:var(--c-cyt)}
.dr-g-fill.g-dil{fill:var(--c-bad)}.dr-g-fill.g-wall{fill:var(--c-neut)}.dr-g-fill.g-stiff{fill:var(--c-cyt)}.dr-g-fill.g-fill{fill:var(--c-fl)}.dr-g-fill.g-ej{fill:var(--c-good)}.dr-g-fill.g-out{fill:var(--c-eos)}
`,
});
