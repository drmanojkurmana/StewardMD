/* Kawasaki disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/kawasaki.mjs [--print-model]
 * Static layout here; signs, artery wall, aneurysm, clot and gauges move in kawasaki.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of the illness", a: [0, 1, 2], names: ["acute", "subacute", "convalescent with aneurysm"], ticks: ["acute", "subacute", "convalescent"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "aspirin" },
    { label: "anticoagulation for large aneurysm" },
    { label: "IVIG" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["no treatment", "aspirin", "anticoagulation", "IVIG"],
};
function modelOf(S, level, drug) {
  const PH = [
    { f: 1, i: 1, a: 0.22, t: 0.22 },
    { f: 0.45, i: 0.62, a: 1, t: 0.95 },
    { f: 0.08, i: 0.2, a: 1, t: 0.58 },
  ][level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const asp = drug === 1 ? 1 : 0, ac = drug === 2 ? 1 : 0, ivig = drug === 3 ? 1 : 0;
  const F = cl(PH.f * (1 - 0.65 * ivig) - 0.04 * asp);
  const I = cl(PH.i * (1 - 0.7 * ivig) - 0.06 * asp);
  const A = cl(PH.a * (1 - 0.55 * ivig) * (0.65 + 0.35 * PH.i));
  const T = cl(PH.t * (0.35 + 0.65 * A) * (1 - 0.45 * asp) * (1 - 0.7 * ac) * (1 - 0.2 * ivig));
  const Flow = cl(1 - 0.5 * T - 0.2 * A * T);
  const Strain = cl(T * (0.35 + 0.65 * A) + (1 - Flow) * 0.25);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(F, 0.3, 0.65, ["settled", "present", "high"]), w(I, 0.3, 0.65, ["calm", "inflamed", "very inflamed"]), w(A, 0.25, 0.6, ["none", "small", "large"]), w(T, 0.25, 0.6, ["low", "raised", "high"])];
  return { F, I, A, T, Flow, Strain, ivig, asp, ac, words, readout: "fever " + words[0] + " · artery wall " + words[1] + " · aneurysm " + words[2] + " · clot risk " + words[3] };
}
const TESTS = [
  [0, 0, "fever high · artery wall very inflamed · aneurysm none · clot risk low"],
  [1, 0, "fever present · artery wall inflamed · aneurysm large · clot risk high"],
  [1, 3, "fever settled · artery wall calm · aneurysm small · clot risk raised"],
  [2, 2, "fever settled · artery wall calm · aneurysm large · clot risk low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="330" height="396" rx="18"/>
<rect class="sc-tissue" x="356" y="44" width="590" height="396" rx="18"/>
<text class="sc-zone" x="30" y="66">THE CHILD</text>
<text class="sc-zone" x="376" y="66">CORONARY ARTERY</text>
<ellipse id="feverHalo" class="kw-halo" cx="150" cy="130" rx="62" ry="70" opacity="0.4"/>
<circle class="kw-skin" cx="150" cy="128" r="36"/>
<rect class="kw-body" x="116" y="166" width="68" height="112" rx="22"/>
<path class="kw-limb" d="M122 190L86 232M178 190L214 232M132 272L118 356M168 272L182 356"/>
<g id="signs">
<circle class="kw-red" cx="137" cy="122" r="4.5"/><circle class="kw-red" cx="163" cy="122" r="4.5"/>
<ellipse class="kw-red" cx="150" cy="145" rx="10" ry="4"/>
<circle class="kw-node" cx="194" cy="168" r="11"/>
<g class="kw-rash"><circle cx="138" cy="205" r="3"/><circle cx="158" cy="218" r="3"/><circle cx="146" cy="238" r="3"/><circle cx="166" cy="200" r="2.6"/><circle cx="132" cy="252" r="2.6"/><circle cx="162" cy="252" r="3"/></g>
<circle class="kw-red" cx="82" cy="235" r="13"/><circle class="kw-red" cx="218" cy="235" r="13"/>
<ellipse class="kw-red" cx="115" cy="362" rx="19" ry="9"/><ellipse class="kw-red" cx="185" cy="362" rx="19" ry="9"/>
</g>
<circle class="kw-eye" cx="137" cy="121" r="1.6"/><circle class="kw-eye" cx="163" cy="121" r="1.6"/>
<rect class="kw-thermo" x="288" y="100" width="8" height="72" rx="4"/>
<rect id="thermoF" class="kw-thermof" x="288" y="100" width="8" height="70" rx="4"/>
<circle class="kw-thermof" cx="292" cy="182" r="10"/>
<g id="art"></g><g id="cells"></g><g id="parts"></g><g id="heartg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "kawasaki-disease", fig: "Fig 1", title: "Kawasaki disease: fever, inflamed artery and aneurysm", W, H, body,
  label: "An animated scene of Kawasaki disease. On the left a child shows fever, red eyes and a rash. On the right a coronary artery wall becomes inflamed and weak, bulges into an aneurysm where blood swirls slowly, and may form a clot that threatens the heart muscle downstream. A slider moves from the acute phase to the subacute phase and then to the convalescent phase with an aneurysm. Treatment choices are aspirin, anticoagulation for a large aneurysm and IVIG.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "kawasaki.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With IVIG",
  sourcesLis: [
    "<strong>How Kawasaki disease develops.</strong> Kawasaki disease is a childhood vasculitis of medium sized arteries, most importantly the coronary arteries. Days of fever come with red eyes without discharge, red and cracked lips and mouth changes, a rash, red and swollen hands and feet, and one large neck lymph node. Inflammation through the artery wall weakens it, so the wall can bulge into a coronary artery aneurysm. Blood swirls slowly inside an aneurysm and can form a thrombus, which can block the artery and injure heart muscle. This is standard teaching in paediatric and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> IVIG given early calms the inflammation and makes coronary aneurysms less likely, aspirin makes platelets less sticky while the artery is inflamed or dilated, and anticoagulation is used for a large aneurysm where slow moving blood is likely to clot. These are teaching toggles only.",
  ],
  simplified: "The trigger and immune mechanism, other arteries, myocarditis and valve changes, shock and macrophage activation presentations, laboratory markers, echocardiography follow up, refractory disease and extra treatments, and all doses and timing are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.kw-skin{fill:#e0a878;stroke:color-mix(in srgb,#e0a878 55%,#000);stroke-width:1}
.kw-body{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:1}
.kw-limb{fill:none;stroke:#e0a878;stroke-width:11;stroke-linecap:round}
.kw-red{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.kw-node{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.8}
.kw-rash circle{fill:var(--c-bad)}
.kw-eye{fill:#241a20}
.kw-halo{fill:var(--c-bad)}
.kw-thermo{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.kw-thermof{fill:var(--c-bad)}
.kw-lum{fill:color-mix(in srgb,var(--c-rbc) 12%,var(--anatomy-paper))}
.kw-wall{fill:color-mix(in srgb,var(--c-endo) 48%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:.8}
.kw-infl{fill:none;stroke:var(--c-bad);stroke-width:15;stroke-linecap:round}
.kw-clotm{fill:color-mix(in srgb,var(--c-plt) 55%,var(--c-rbc));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.7}
.kw-isch{fill:#8a5fc4}
.kw-cap{fill:var(--anatomy-strong);font-size:13px}
.kw-pivig{--cc:var(--c-ab)}.kw-pac{--cc:#b48cf2}
.dr-g-fill.g-bad{fill:var(--c-bad)}
`,
});
