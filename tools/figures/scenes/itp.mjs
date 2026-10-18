/* Thrombocytopenia: ITP, TTP and HIT as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/itp.mjs [--print-model]
 * Static layout here; platelets, antibodies, clots and gauges move in itp.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Cause of low platelets shown", a: [0, 1, 2], names: ["immune destruction (ITP)", "TTP, missing ADAMTS13", "HIT, heparin reaction"], ticks: ["ITP", "TTP", "HIT"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "steroids and IVIG (immune treatment)" },
    { label: "plasma exchange" },
    { label: "stop heparin, use a non-heparin anticoagulant" },
  ],
  status: "Cause: {level} · {drug} ·",
  drugNames: ["no treatment", "steroids and IVIG", "plasma exchange", "stopping heparin with a non-heparin anticoagulant"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const loss0 = [0.9, 0.75, 0.68][t], clot0 = [0.12, 0.92, 0.88][t], haem0 = [0.08, 0.9, 0.15][t];
  const redLoss = drug === 1 ? [0.72, 0.08, 0.05][t] : drug === 2 ? [0.15, 0.68, 0.08][t] : drug === 3 ? [0.02, 0.02, 0.78][t] : 0;
  const redClot = drug === 1 ? 0 : drug === 2 ? [0.05, 0.78, 0.05][t] : drug === 3 ? [0.02, 0.02, 0.72][t] : 0;
  const redHaem = drug === 2 && t === 1 ? 0.75 : 0;
  const loss = cl(loss0 * (1 - redLoss)), clot = cl(clot0 * (1 - redClot)), haem = cl(haem0 * (1 - redHaem));
  const plt = cl(0.95 - 0.85 * loss - 0.1 * clot);
  const bleed = cl(0.06 + 0.78 * (1 - plt));
  const marr = cl(0.45 + 0.55 * (1 - plt));
  const vwf = t === 1 ? cl(clot * 1.05) : 0;
  const adam = t === 1 ? (drug === 2 ? 0.85 : 0.15) : 0.9;
  const act = t === 2 ? cl(clot) : t === 1 ? cl(clot * 0.6) : 0.15;
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(plt, 0.35, 0.65, ["low", "reduced", "normal"]), w(loss, 0.3, 0.6, ["low", "raised", "high"]), w(clot, 0.3, 0.6, ["few", "some", "many"]), w(haem, 0.3, 0.6, ["none", "some", "marked"])];
  return { t, drug, loss, clot, haem, plt, bleed, marr, vwf, adam, act, ster: drug === 1 ? 1 : 0, plas: drug === 2 ? 1 : 0, noHep: drug === 3 ? 1 : 0, words, readout: "platelets " + words[0] + " · platelet loss " + words[1] + " · clots " + words[2] + " · red cell break-up " + words[3] };
}
const TESTS = [
  [0, 0, "platelets low · platelet loss high · clots few · red cell break-up none"],
  [1, 0, "platelets low · platelet loss high · clots many · red cell break-up marked"],
  [2, 0, "platelets low · platelet loss high · clots many · red cell break-up none"],
  [0, 1, "platelets normal · platelet loss low · clots few · red cell break-up none"],
];

/* ---------------- static layout ---------------- */
const CARDS = [
  ["ITP  immune destruction", "antibody coats platelets", "eaten in the spleen"],
  ["TTP  missing ADAMTS13", "vWF strings trap platelets", "microthrombi, red cells break"],
  ["HIT  heparin reaction", "antibody switches platelets on", "platelets used up, big clots"],
];
const cards = CARDS.map((c, i) => { const x = 22 + i * 309;
  return `<g class="hot sc-card" id="card${i}" tabindex="0" data-info="${esc(["ITP: immune thrombocytopenia. Antibody coats platelets and spleen macrophages remove them. The marrow makes platelets normally and tries to make more.", "TTP: thrombotic thrombocytopenic purpura. Without enough ADAMTS13, very long von Willebrand factor strings trap platelets into microthrombi. Red cells are sheared as they squeeze past, so they break up.", "HIT: heparin induced thrombocytopenia. Heparin with platelet factor 4 and antibody forms a complex that switches platelets on. Platelets are used up in clots, so the count falls while clotting rises."][i])}"><rect class="sc-card-r" x="${x}" y="46" width="298" height="72" rx="12"/><text class="sc-zone" x="${x + 12}" y="66">${esc(c[0])}</text><text class="sc-lab" x="${x + 12}" y="86">${esc(c[1])}</text><text class="sc-lab sc-dim2" x="${x + 12}" y="104">${esc(c[2])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue" x="14" y="126" width="${W - 28}" height="316" rx="18"/>
${cards}
<rect class="it-marrow" x="28" y="160" width="170" height="250" rx="14"/>
<text class="sc-zone" x="38" y="178">BONE MARROW</text>
<text class="sc-zone" x="228" y="150">BLOOD VESSEL</text>
<ellipse class="it-spleen" cx="810" cy="192" rx="102" ry="40"/>
<rect class="sc-lumen" x="214" y="235" width="718" height="74"/>
<rect class="it-wall" x="214" y="227" width="718" height="8" rx="4"/>
<rect class="it-wall" x="214" y="309" width="718" height="8" rx="4"/>
<rect class="sc-lumen" x="480" y="368" width="452" height="36"/>
<rect class="it-wall" x="480" y="360" width="452" height="8" rx="4"/>
<rect class="it-wall" x="480" y="404" width="452" height="8" rx="4"/>
<text class="sc-zone sc-dim" x="490" y="428">SMALL VESSELS</text>
<g class="hot" tabindex="0" data-info="Marrow failure is a different cause of low platelets: the marrow itself makes too few platelets, for example after marrow damage or infiltration. In ITP, TTP and HIT the marrow is working and the problem is loss, trapping or use of platelets after they are made."><rect class="it-box" x="214" y="345" width="250" height="85" rx="10"/><text class="sc-zone" x="228" y="369">MARROW FAILURE IS DIFFERENT</text><text class="sc-lab" x="228" y="390">Marrow makes too few platelets.</text><text class="sc-lab" x="228" y="408">Here marrow keeps working.</text></g>
<g id="back"></g><g id="flow"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.sc-card-r{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-card.on .sc-card-r{stroke:var(--anatomy-lit);stroke-width:2;fill:color-mix(in srgb,var(--anatomy-lit) 10%,var(--anatomy-card))}
.sc-dim2{opacity:.75}
.it-marrow{fill:color-mix(in srgb,var(--c-plt) 12%,var(--anatomy-card));stroke:var(--anatomy-faint);stroke-width:1}
.it-spleen{fill:color-mix(in srgb,var(--c-sm) 45%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-sm) 60%,#000);stroke-width:1}
.it-wall{fill:color-mix(in srgb,var(--c-endo) 70%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.it-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
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
  label: "An animated marrow, blood vessel, spleen and small vessels. In ITP antibody coats platelets and the spleen removes them. In TTP missing ADAMTS13 leaves long von Willebrand factor strings that trap platelets into microthrombi and break red cells. In HIT a heparin complex switches platelets on so they are used up in large clots. A box contrasts marrow failure, where the marrow makes too few platelets. Gauges show platelets, platelet loss, clots, red cell break-up and bleeding risk. Treatment choices are steroids and IVIG, plasma exchange, and stopping heparin with a non-heparin anticoagulant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, laboratory values or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "itp.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Why platelets fall.</strong> Platelets can fall because the marrow makes too few, because they are destroyed or trapped after release, or because they are used up in clots. ITP is immune destruction: antibody coated platelets are removed by macrophages, mainly in the spleen, while the marrow tries to compensate. TTP follows severe lack of the enzyme ADAMTS13, which normally trims von Willebrand factor; the long strings trap platelets into microthrombi in small vessels and red cells fragment as they pass (haemolysis). HIT follows an antibody to heparin with platelet factor 4 that activates platelets, so the count falls at the same time as new clots form. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Steroids and IVIG calm immune removal in ITP, plasma exchange removes antibody and replaces ADAMTS13 in TTP, and in HIT heparin is stopped and a non-heparin anticoagulant is used so platelet activation settles without leaving clots untreated. They are teaching toggles that show which step each approach acts on.",
  ],
  simplified: "Marrow failure detail, inherited platelet disorders, drug causes other than heparin, splenic pooling, laboratory testing and diagnostic thresholds, complement and neurologic or kidney injury detail, transfusion, surgery, second line immune treatments and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
