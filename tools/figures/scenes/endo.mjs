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
<text class="sc-zone" x="640" y="62">WHERE EMBOLI LAND</text>
<path class="en-track" d="M620 328C665 260 700 195 748 162"/>
<path class="en-track" d="M620 328C665 302 695 288 728 282"/>
<path class="en-track" d="M620 328C660 352 690 366 718 374"/>
<g id="organs">
<ellipse class="en-organ" cx="795" cy="150" rx="85" ry="52"/>
<path class="en-squig" d="M730 138q18 -16 36 0q18 -16 36 0q18 -14 34 2M736 168q16 -14 34 0q18 -14 34 0q16 -12 30 0"/>
<g id="brainSpot" opacity="0"><circle class="en-spot" cx="818" cy="138" r="13"/><path class="en-spotx" d="M812 132l12 12M824 132l-12 12"/></g>
<path class="en-organ" d="M795 233c38 0 70 19 70 42s-32 42 -70 42c-30 0 -56 -13 -66 -32c14 -6 14 -14 0 -20c10 -19 36 -32 66 -32Z"/>
<g id="kidSpot" opacity="0"><path class="en-spot" d="M812 258l18 10 -6 16 -20 -4 -4 -16Z"/><circle class="en-icdot" cx="772" cy="292" r="4"/><circle class="en-icdot" cx="788" cy="300" r="4"/><circle class="en-icdot" cx="758" cy="282" r="4"/></g>
<rect class="en-organ" x="715" y="345" width="170" height="60" rx="12"/>
<g id="skinSpot" opacity="0"><circle class="en-spot" cx="762" cy="372" r="6"/><circle class="en-spot" cx="800" cy="382" r="5"/><circle class="en-spot" cx="838" cy="368" r="6"/><circle class="en-icdot" cx="782" cy="360" r="3.4"/><circle class="en-icdot" cx="820" cy="392" r="3.4"/></g>
</g>
<g id="heart">
<rect class="en-wall" x="80" y="130" width="360" height="280" rx="30"/>
<rect class="en-ch" x="105" y="155" width="310" height="85" rx="14"/>
<rect class="en-ch" x="105" y="285" width="310" height="100" rx="14"/>
<rect class="en-aorta" x="415" y="310" width="205" height="36" rx="10"/>
<text class="sc-lab" x="118" y="176">atrium</text>
<text class="sc-lab" x="118" y="306">ventricle</text>
<text class="sc-lab" x="500" y="302">aorta</text>
<g id="leaflets">
<path class="en-leaf" d="M172 262Q216 238 260 262Q216 274 172 262Z"/>
<path class="en-leaf" d="M348 262Q304 238 260 262Q304 274 348 262Z"/>
<path id="dmgMark" class="en-dmg" d="M238 250l7 9 -6 5 8 7M282 248l-6 10 7 5 -7 8" opacity="0"/>
</g>
<g id="prosth" opacity="0"><ellipse class="en-prosth" cx="260" cy="262" rx="58" ry="17"/><ellipse class="en-prosth2" cx="260" cy="262" rx="42" ry="10"/></g>
<g id="veg"></g>
<g id="flow"></g>
<g id="parts"></g>
</g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.en-wall{fill:color-mix(in srgb,var(--c-bad) 26%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 62%,#000);stroke-width:1.4}
.en-ch{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 48%,#000);stroke-width:.9}
.en-aorta{fill:color-mix(in srgb,var(--c-rbc) 26%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 52%,#000);stroke-width:.9}
.en-leaf{fill:color-mix(in srgb,var(--c-endo) 72%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.en-dmg{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.en-prosth{fill:none;stroke:var(--c-good);stroke-width:3}
.en-prosth2{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.en-organ{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.3}
.en-squig{fill:none;stroke:var(--anatomy-mid);stroke-width:1.3;stroke-linecap:round}
.en-track{fill:none;stroke:var(--anatomy-faint);stroke-width:1.6;stroke-dasharray:5 6}
.en-spot{fill:var(--c-bad);opacity:.82}
.en-spotx{fill:none;stroke:var(--anatomy-paper);stroke-width:1.8;stroke-linecap:round}
.en-icdot{fill:var(--c-cyt)}
.p-emb{--cc:#ff9a3d}.p-icx{--cc:var(--c-cyt)}.p-reg{fill:var(--c-cyt2)}
`;

buildScene({
  id: "infective-endocarditis", fig: "Fig 1", title: "Infective endocarditis: valve infection and emboli", W, H, body, extraCss,
  label: "An animated heart valve with a damaged leaflet. Bacteria in the blood stick to the damage and grow into a vegetation of bacteria, fibrin and platelets. Pieces break off as septic emboli to the brain, kidney and skin. The valve is destroyed and leaks backwards, and circulating immune complexes settle in the kidney and skin. The slider contrasts a slow subacute course with a fast acute course. Gauges show bacteraemia, vegetation, regurgitation, emboli, immune complexes and heart failure. Treatment choices are an antibiotic, valve surgery, or both.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "endo.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How endocarditis develops.</strong> A valve leaflet that is already damaged or abnormal loses its smooth lining, and platelets and fibrin settle on the raw surface. Bacteria circulating in the blood (bacteraemia, for example from teeth, skin, a line or injecting) stick to that deposit and multiply inside it, forming a friable mass called a vegetation. Acute disease, classically with Staphylococcus aureus, destroys the valve fast, perforates or tears a leaflet and causes severe regurgitation and heart failure. Subacute disease, classically with viridans streptococci on a previously abnormal valve, runs slowly over weeks, so immune phenomena have time to appear. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Emboli and immune complexes.</strong> Fragments of vegetation break off into the circulation and lodge downstream: in the brain (stroke, abscess), the kidney (infarct, blood in the urine) and the skin and eyes (small haemorrhagic spots and lesions), and in the spleen and elsewhere. Separately, prolonged bacteraemia drives circulating immune complexes that deposit in small vessels and glomeruli, causing vasculitic skin lesions and glomerulonephritis. Which pattern dominates depends on how fast and how long the infection runs, which is what the slider shows.",
    "<strong>Treatment ideas shown.</strong> A prolonged course of an antibiotic that kills the bacteria inside the vegetation, and valve surgery to remove infected tissue and repair or replace a destroyed, leaking valve. Antibiotics alone cannot fix a mechanically destroyed valve, and surgery alone cannot sterilise the blood, so severe disease often needs both. These are teaching toggles only.",
  ],
  simplified: "Which valve and which organism in detail, prosthetic valve and device infection, culture negative disease, blood cultures and echocardiography, the full Duke criteria, abscess and heart block, every embolic site, antibiotic choice and duration, surgical indications and timing, and every dose are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
