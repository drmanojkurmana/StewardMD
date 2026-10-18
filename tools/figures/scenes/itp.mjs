/* Thrombocytopenia: ITP, TTP and HIT as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/itp.mjs [--print-model]
 * Static layout here; platelets, antibodies, clots and gauges move in itp.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Cause of low platelets", a: [0, 1, 2], names: ["immune destruction (ITP)", "TTP, missing ADAMTS13", "HIT, heparin reaction"], ticks: ["ITP", "TTP", "HIT"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "plasma exchange" },
    { label: "stop heparin" },
    { label: "steroids and IVIG" },
  ],
  status: "Cause: {level} · {drug} ·",
  drugNames: ["no treatment", "plasma exchange", "stopping heparin with a non-heparin anticoagulant", "steroids and IVIG"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const loss0 = [0.9, 0.75, 0.68][t], clot0 = [0.12, 0.92, 0.88][t], haem0 = [0.08, 0.9, 0.15][t];
  const plas = drug === 1 ? 1 : 0, noHep = drug === 2 ? 1 : 0, ster = drug === 3 ? 1 : 0;
  const redLoss = ster ? [0.72, 0.08, 0.05][t] : plas ? [0.15, 0.68, 0.08][t] : noHep ? [0.02, 0.02, 0.78][t] : 0;
  const redClot = plas ? [0.05, 0.78, 0.05][t] : noHep ? [0.02, 0.02, 0.72][t] : 0;
  const redHaem = plas && t === 1 ? 0.75 : 0;
  const loss = cl(loss0 * (1 - redLoss)), clot = cl(clot0 * (1 - redClot)), haem = cl(haem0 * (1 - redHaem));
  const plt = cl(0.95 - 0.85 * loss - 0.1 * clot);
  const bleed = cl(0.06 + 0.78 * (1 - plt));
  const marr = cl(0.45 + 0.55 * (1 - plt));
  const vwf = t === 1 ? cl(clot * 1.05) : 0;
  const adam = t === 1 ? (plas ? 0.85 : 0.15) : 0.9;
  const act = t === 2 ? cl(clot) : t === 1 ? cl(clot * 0.6) : 0.15;
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(plt, 0.35, 0.65, ["low", "reduced", "normal"]), w(loss, 0.3, 0.6, ["low", "raised", "high"]), w(clot, 0.3, 0.6, ["few", "some", "many"]), w(haem, 0.3, 0.6, ["none", "some", "marked"])];
  return { t, drug, loss, clot, haem, plt, bleed, marr, vwf, adam, act, ster, plas, noHep, words, readout: "platelets " + words[0] + " · platelet loss " + words[1] + " · clots " + words[2] + " · red cell break-up " + words[3] };
}
const TESTS = [
  [0, 0, "platelets low · platelet loss high · clots few · red cell break-up none"],
  [1, 0, "platelets low · platelet loss high · clots many · red cell break-up marked"],
  [2, 0, "platelets low · platelet loss high · clots many · red cell break-up none"],
  [0, 3, "platelets normal · platelet loss low · clots few · red cell break-up none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="40" width="${W - 28}" height="400" rx="18"/>
<rect class="it-marrow" x="28" y="150" width="170" height="250" rx="14"/>
<rect class="sc-lumen" x="214" y="235" width="718" height="74"/>
<rect class="it-wall" x="214" y="227" width="718" height="8" rx="4"/>
<rect class="it-wall" x="214" y="309" width="718" height="8" rx="4"/>
<rect class="sc-lumen" x="480" y="368" width="452" height="36"/>
<rect class="it-wall" x="480" y="360" width="452" height="8" rx="4"/>
<rect class="it-wall" x="480" y="404" width="452" height="8" rx="4"/>
<g id="spleenSlot"></g>
<g id="back"></g><g id="flow"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.it-marrow{fill:color-mix(in srgb,var(--c-plt) 12%,var(--anatomy-card));stroke:var(--anatomy-faint);stroke-width:1}
.it-wall{fill:color-mix(in srgb,var(--c-endo) 70%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.it-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-mega{--cc:var(--c-plt)}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.it-vwf{fill:none;stroke:var(--c-lymph);stroke-width:1.6;stroke-linecap:round;opacity:0}
.it-spike{fill:none;stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1;stroke-linecap:round}
.it-fib{fill:none;stroke:color-mix(in srgb,var(--c-plt) 55%,var(--anatomy-paper));stroke-width:1;stroke-linecap:round}
.p-adam{fill:var(--c-good)}
.p-hep{fill:#ff9a3d}
.p-haem{fill:var(--c-rbc)}
.p-bleed{fill:var(--c-rbc)}
.p-trt{fill:var(--c-good)}
.p-bud{--cc:var(--c-plt)}
.it-schist{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:.6}
`;

buildScene({
  id: "thrombocytopenia-itp-ttp", fig: "Fig 1", title: "Low platelets: ITP, TTP and HIT", W, H, body, extraCss,
  label: "An animated marrow, blood vessel, spleen and small vessels. In ITP antibody coats platelets and the spleen removes them. In TTP missing ADAMTS13 leaves long von Willebrand factor strings that trap platelets into microthrombi and break red cells. In HIT a heparin complex switches platelets on so they are used up in large clots. Gauges show platelets, platelet loss, clots, red cell break-up and bleeding risk. Treatment choices are plasma exchange, stopping heparin, and steroids and IVIG.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, laboratory values or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "itp.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With steroids and IVIG",
  sourcesLis: [
    "<strong>Why platelets fall.</strong> Platelets can fall because the marrow makes too few, because they are destroyed or trapped after release, or because they are used up in clots. ITP is immune destruction: antibody coated platelets are removed by macrophages, mainly in the spleen, while the marrow tries to compensate. TTP follows severe lack of the enzyme ADAMTS13, which normally trims von Willebrand factor; the long strings trap platelets into microthrombi in small vessels and red cells fragment as they pass (haemolysis). HIT follows an antibody to heparin with platelet factor 4 that activates platelets, so the count falls at the same time as new clots form. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Steroids and IVIG calm immune removal in ITP, plasma exchange removes antibody and replaces ADAMTS13 in TTP, and in HIT heparin is stopped and a non-heparin anticoagulant is used so platelet activation settles without leaving clots untreated. They are teaching toggles that show which step each approach acts on.",
  ],
  simplified: "Marrow failure detail, inherited platelet disorders, drug causes other than heparin, splenic pooling, laboratory testing and diagnostic thresholds, complement and neurologic or kidney injury detail, transfusion, surgery, second line immune treatments and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
