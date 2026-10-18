/* Infective endocarditis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/endo.mjs [--print-model]
 * Static layout here; bacteria, vegetation, emboli, regurgitant jet and gauges move in endo.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of the illness", a: [0.35, 1], names: ["subacute", "acute"], ticks: ["subacute", "acute"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotic only" },
    { label: "valve surgery only" },
    { label: "antibiotic and valve surgery" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "an antibiotic", "valve surgery", "an antibiotic and valve surgery"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], abx = drug === 1 || drug === 3 ? 1 : 0, surg = drug === 2 || drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const B = cl(abx ? a * 0.12 : a * (0.55 + 0.45 * a));
  const Vg = cl((0.3 + 0.6 * a) * (abx ? 0.5 : 1) * (surg ? 0.07 : 1));
  const D = cl(0.12 + 0.78 * a);
  const R = cl(D * (surg ? 0.22 : 1));
  const E = cl(Vg * (0.35 + 0.55 * a) * (abx ? 0.65 : 1));
  const dur = level === 0 ? 1 : 0.3;
  const I = cl((0.2 + 0.6 * dur) * (abx ? 0.55 : 1) * (surg ? 0.8 : 1));
  const HF = cl(0.75 * R + 0.25 * E);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.15, 0.45, ["cleared", "low", "high"]), w(Vg, 0.25, 0.6, ["small", "present", "large"]), w(R, 0.25, 0.6, ["mild", "moderate", "severe"]), w(E, 0.2, 0.5, ["few", "some", "many"])];
  return { a, abx, surg, B, Vg, D, R, E, I, HF, words, readout: "bacteraemia " + words[0] + " · vegetation " + words[1] + " · regurgitation " + words[2] + " · emboli " + words[3] };
}
const TESTS = [
  [1, 0, "bacteraemia high · vegetation large · regurgitation severe · emboli many"],
  [0, 0, "bacteraemia low · vegetation present · regurgitation moderate · emboli some"],
  [1, 1, "bacteraemia cleared · vegetation present · regurgitation severe · emboli some"],
  [1, 3, "bacteraemia cleared · vegetation small · regurgitation mild · emboli few"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEART AND VALVE</text>
<text class="sc-zone" x="640" y="62">WHERE CLOTS LAND</text>
<path id="vesselIn" class="en-vessel" d="M40 200 L180 200"/>
<path id="vesselOut" class="en-vessel" d="M250 140 Q470 60 612 328"/>
<path id="brBrain" class="en-track" d="M612 328 L730 220"/>
<path id="brKidney" class="en-track" d="M612 328 L730 290"/>
<path id="brSkin" class="en-track" d="M612 328 L720 380"/>
<g id="heartSlot"></g>
<g id="brainSlot"></g>
<g id="kidneySlot"></g>
<g id="skinSlot"></g>
<g id="valveSite">
<circle id="glow" class="en-glow" cx="0" cy="0" r="72" opacity="0"/>
<path id="jetCone" class="en-jetcone" d="M0 0 L-78 -88 L-30 -102 Z" opacity="0"/>
<g id="leaflets">
<path class="en-leaf" d="M-64 0 Q-32 -22 0 0 Q-32 10 -64 0 Z"/>
<path class="en-leaf" d="M64 0 Q32 -22 0 0 Q32 10 64 0 Z"/>
<path id="dmgMark" class="en-dmg" d="M-22 -12 l7 9 -6 5 8 7 M22 -14 l-6 10 7 5 -7 8" opacity="0"/>
</g>
<g id="prosth" opacity="0"><ellipse class="en-prosth" cx="0" cy="0" rx="60" ry="16"/><ellipse class="en-prosth2" cx="0" cy="0" rx="44" ry="9"/></g>
</g>
<g id="veg"></g>
<g id="spots">
<g id="brainSpot"><circle class="en-spot" cx="0" cy="0" r="14"/><path class="en-spotx" d="M-6 -6 l12 12 M6 -6 l-12 12"/></g>
<g id="kidneySpot"><path class="en-spot" d="M-4 -14 L16 4 L-8 14 L-12 -2 Z"/><circle class="en-icdot" cx="-22" cy="10" r="4"/><circle class="en-icdot" cx="-8" cy="18" r="4"/><circle class="en-icdot" cx="-32" cy="0" r="4"/></g>
<g id="skinSpot"><circle class="en-spot" cx="-34" cy="-8" r="6"/><circle class="en-spot" cx="2" cy="2" r="5"/><circle class="en-spot" cx="36" cy="-12" r="6"/><circle class="en-icdot" cx="-16" cy="-18" r="3.4"/><circle class="en-icdot" cx="20" cy="12" r="3.4"/></g>
</g>
<g id="flow"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.en-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:17;stroke-linecap:round;opacity:.8}
.en-track{fill:none;stroke:var(--anatomy-faint);stroke-width:1.6;stroke-dasharray:5 6}
.en-leaf{fill:color-mix(in srgb,var(--c-endo) 72%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.en-dmg{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.en-prosth{fill:none;stroke:var(--c-good);stroke-width:3.5}
.en-prosth2{fill:none;stroke:var(--anatomy-mid);stroke-width:1.5}
.en-glow{fill:var(--c-bad);stroke:none}
.en-jetcone{fill:var(--c-cyt2);stroke:none}
.en-spot{fill:var(--c-bad);stroke:none;opacity:.82}
.en-spotx{fill:none;stroke:var(--anatomy-paper);stroke-width:1.8;stroke-linecap:round}
.en-icdot{fill:var(--c-cyt);stroke:none}
.en-cap{fill:var(--anatomy-strong);font-size:12px}
.p-emb{--cc:#ff9a3d}.p-icx{--cc:var(--c-cyt)}.p-reg{fill:var(--c-cyt2);stroke:none}
`;

buildScene({
  id: "infective-endocarditis", fig: "Fig 1", title: "Infective endocarditis: valve infection and emboli", W, H, body, extraCss,
  label: "An animated heart valve with a damaged leaflet. Bacteria in the blood stick to the damage and grow into a vegetation of bacteria, fibrin and platelets. Pieces break off as septic emboli to the brain, kidney and skin. The valve is destroyed and leaks backwards, and circulating immune complexes settle in the kidney and skin. The slider contrasts a slow subacute course with a fast acute course. Gauges show bacteraemia, vegetation, regurgitation, emboli, immune complexes and heart failure. Treatment choices are an antibiotic, valve surgery, or both.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "endo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antibiotic and valve surgery",
  sourcesLis: [
    "<strong>How endocarditis develops.</strong> A valve leaflet that is already damaged or abnormal loses its smooth lining, and platelets and fibrin settle on the raw surface. Bacteria circulating in the blood (bacteraemia, for example from teeth, skin, a line or injecting) stick to that deposit and multiply inside it, forming a friable mass called a vegetation. Acute disease, classically with Staphylococcus aureus, destroys the valve fast, perforates or tears a leaflet and causes severe regurgitation and heart failure. Subacute disease, classically with viridans streptococci on a previously abnormal valve, runs slowly over weeks, so immune phenomena have time to appear. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Emboli and immune complexes.</strong> Fragments of vegetation break off into the circulation and lodge downstream: in the brain (stroke, abscess), the kidney (infarct, blood in the urine) and the skin and eyes (small haemorrhagic spots and lesions), and in the spleen and elsewhere. Separately, prolonged bacteraemia drives circulating immune complexes that deposit in small vessels and glomeruli, causing vasculitic skin lesions and glomerulonephritis. Which pattern dominates depends on how fast and how long the infection runs, which is what the slider shows.",
    "<strong>Treatment ideas shown.</strong> A prolonged course of an antibiotic that kills the bacteria inside the vegetation, and valve surgery to remove infected tissue and repair or replace a destroyed, leaking valve. Antibiotics alone cannot fix a mechanically destroyed valve, and surgery alone cannot sterilise the blood, so severe disease often needs both. These are teaching toggles only.",
  ],
  simplified: "Which valve and which organism in detail, prosthetic valve and device infection, culture negative disease, blood cultures and echocardiography, the full Duke criteria, abscess and heart block, every embolic site, antibiotic choice and duration, surgical indications and timing, and every dose are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
