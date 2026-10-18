/* Thalassaemia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/thal.mjs [--print-model]
 * Static layout here; chains, marrow cells, red cells and gauges move in thal.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the globin defect", a: [0.18, 0.55, 1], names: ["trait", "intermedia", "major"], ticks: ["trait", "intermedia", "major"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "transfusion" },
    { label: "chelation" },
    { label: "transplant" },
  ],
  status: "Thalassaemia: {level} · {drug} ·",
  drugNames: ["no treatment", "transfusion", "chelation", "transplant"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], tx = drug === 1 ? 1 : 0, chel = drug === 2 ? 1 : 0, hsct = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const Imb = cl(a * (tx ? 0.55 : 1) * (hsct ? 0.08 : 1));
  const Ineff = cl((0.08 + 0.85 * a) * (tx ? 0.5 : 1) * (hsct ? 0.15 : 1));
  const Ana = cl((0.05 + 0.8 * a) * (tx ? 0.35 : 1) * (hsct ? 0.12 : 1));
  const Haem = cl((0.05 + 0.8 * a) * (tx ? 0.45 : 1) * (hsct ? 0.1 : 1));
  const Micro = cl((0.1 + 0.8 * a) * (tx ? 0.6 : 1) * (hsct ? 0.1 : 1));
  const Iron = cl((0.05 + 0.75 * a * a + (tx ? 0.25 : 0)) * (chel ? 0.35 : 1) * (hsct ? 0.45 : 1));
  const Bone = cl((0.03 + 0.8 * a * a) * (tx ? 0.45 : 1) * (hsct ? 0.25 : 1));
  const Hep = cl(1 - 0.75 * a * (tx ? 0.6 : 1) * (hsct ? 0.3 : 1));
  const words = [w(Ana, 0.25, 0.55, ["mild", "moderate", "severe"]), w(Haem, 0.25, 0.55, ["little", "some", "marked"]), w(Iron, 0.25, 0.55, ["low", "raised", "high"])];
  return { a, tx, chel, hsct, Imb, Ineff, Ana, Haem, Micro, Iron, Bone, Hep, words, readout: "anaemia " + words[0] + " · haemolysis " + words[1] + " · iron load " + words[2] };
}
const TESTS = [
  [0, 0, "anaemia mild · haemolysis little · iron load low"],
  [2, 0, "anaemia severe · haemolysis marked · iron load high"],
  [2, 1, "anaemia moderate · haemolysis some · iron load high"],
  [2, 3, "anaemia mild · haemolysis little · iron load raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GLOBIN GENES AND CHAINS</text>
<text class="sc-zone" x="342" y="68">BONE MARROW</text>
<text class="sc-zone" x="660" y="68">BLOOD, BONE AND IRON</text>
<path class="th-div" d="M322 82V428M646 82V428"/>
<text class="sc-lab" x="34" y="100">alpha genes</text>
<g id="genesA">
  <rect class="th-geneA" x="118" y="88" width="30" height="14" rx="4"/><rect class="th-geneA" x="154" y="88" width="30" height="14" rx="4"/>
  <rect class="th-geneA" x="190" y="88" width="30" height="14" rx="4"/><rect class="th-geneA" x="226" y="88" width="30" height="14" rx="4"/>
</g>
<text class="sc-lab" x="34" y="126">beta genes</text>
<g id="genesB">
  <rect class="th-geneB" x="118" y="114" width="30" height="14" rx="4"/><rect class="th-geneB" x="154" y="114" width="30" height="14" rx="4"/>
</g>
<g id="geneX" opacity="0">
  <path class="th-cross" d="M226 88L256 102M256 88L226 102M154 114L184 128M184 114L154 128"/>
</g>
<g id="hb">
  <circle class="th-a" cx="76" cy="172" r="20"/><circle class="th-a" cx="112" cy="172" r="20"/>
  <circle class="th-b" cx="76" cy="206" r="20"/><circle class="th-b" cx="112" cy="206" r="20"/>
</g>
<path class="th-arrow" d="M140 188H196"/>
<circle id="incl" class="th-incl" cx="238" cy="188" r="26"/>
<text class="sc-lab" x="34" y="264">alpha chains</text>
<rect class="th-track" x="118" y="252" width="150" height="12" rx="6"/><rect id="barA" class="th-barA" x="118" y="252" width="140" height="12" rx="6"/>
<text class="sc-lab" x="34" y="290">beta chains</text>
<rect class="th-track" x="118" y="278" width="150" height="12" rx="6"/><rect id="barB" class="th-barB" x="118" y="278" width="140" height="12" rx="6"/>
<text class="sc-lab sc-dim" x="34" y="318">either chain may be reduced;</text>
<text class="sc-lab sc-dim" x="34" y="334">the partner is left in excess</text>
<rect id="boneOuter" class="th-bone" x="338" y="84" width="280" height="152" rx="58"/>
<rect id="marrowCav" class="th-marrow" x="356" y="100" width="244" height="120" rx="48"/>
<g id="prec"></g><g id="frag"></g>
<path class="th-arrow" d="M478 246V262"/>
<rect class="th-exit" x="356" y="268" width="262" height="30" rx="8"/>
<g id="retics"></g>
<g id="spleenG"><ellipse class="th-spleen" cx="700" cy="150" rx="34" ry="24"/></g>
<g id="liverG"><path class="th-liver" d="M792 132Q850 116 884 136Q892 158 866 168L800 168Q786 152 792 132Z"/></g>
<g id="ironDots"></g>
<path class="th-gut" d="M664 214Q682 196 700 214Q718 232 736 214"/>
<g id="vessel">
  <rect id="lumen2" class="sc-lumen" x="656" y="262" width="276" height="58" rx="8"/>
  <path class="th-wall" d="M656 262H932M656 320H932"/>
</g>
<g id="rbcs2"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "thalassaemia-globin-chains", fig: "Fig 1", title: "Thalassaemia: globin chain imbalance", W, H, body,
  label: "An animated scene of thalassaemia. Reduced alpha or beta globin chain production leaves the partner chain in excess. Excess chains damage developing red cells in the bone marrow, so many die before release and the marrow expands. Cells that reach the blood are small and pale and break down early. Suppressed hepcidin and transfusions load the body with iron. Gauges show chain imbalance, marrow loss, anaemia, haemolysis, iron load and bone change. Treatment choices include transfusion, chelation and transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "thal.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How thalassaemia develops.</strong> Alpha thalassaemia usually reflects loss of one or more of the four alpha globin genes; beta thalassaemia reflects reduced or absent beta chain production from the beta globin genes. Either way the two chains of adult haemoglobin are made in unequal amounts. The unpaired excess chains precipitate inside developing red cells, damaging membranes and killing many precursors in the marrow (ineffective erythropoiesis). Surviving red cells are microcytic and hypochromic and are removed early, chiefly in the spleen (haemolysis). Anaemia drives marrow expansion, which reshapes growing bones, and it suppresses hepcidin, so more iron is absorbed from the gut; regular transfusion adds further iron, which can load the liver, heart and endocrine organs. Trait is usually mild, intermedia is intermediate, and major presents early with severe anaemia. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Transfusion restores haemoglobin and suppresses the ineffective marrow but adds iron. Chelation binds excess iron so it can be removed, without fixing the chain defect. Transplant replaces the marrow with donor marrow that makes balanced chains. These are teaching toggles only.",
  ],
  simplified: "The separate genetics and naming of alpha and beta subtypes, HbH and Hb Bart hydrops detail, fetal haemoglobin switching, splenectomy, growth and endocrine monitoring, gene therapy, drug choice and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.th-div{fill:none;stroke:var(--anatomy-faint);stroke-width:1}
.th-geneA{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:1}
.th-geneB{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.th-cross{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.th-a{fill:color-mix(in srgb,var(--c-lymph) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1}
.th-b{fill:color-mix(in srgb,var(--c-rbc) 65%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.th-incl{fill:color-mix(in srgb,var(--c-cyt) 35%,var(--anatomy-paper));stroke:var(--c-cyt);stroke-width:1.4;stroke-dasharray:5 4}
.th-track{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.th-barA{fill:var(--c-lymph)}.th-barB{fill:var(--c-rbc)}
.th-bone{fill:#e8ddc4;stroke:#9a8a62;stroke-width:1.4}
.th-marrow{fill:color-mix(in srgb,var(--c-rbc) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.th-exit{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.th-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.th-spleen{fill:color-mix(in srgb,var(--c-mast) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:1.2}
.th-liver{fill:#c97b4a;stroke:#8a4f26;stroke-width:1.2}
.th-gut{fill:none;stroke:var(--c-fl);stroke-width:3;stroke-linecap:round}
.th-wall{fill:none;stroke:var(--c-endo);stroke-width:3}
.cl-prec{--cc:var(--c-endo)}.cl-ery{--cc:var(--c-rbc)}
.p-chain{--cc:var(--c-lymph)}.p-iron{--cc:#ff9a3d}.p-hep{--cc:var(--c-good)}
.th-frag{fill:none;stroke:var(--c-rbc);stroke-width:1.6;stroke-linecap:round}
.th-idot{fill:#ff9a3d;stroke:#8a4f26;stroke-width:.5}
.dr-g-fill.g-imb{fill:var(--c-cyt)}.dr-g-fill.g-iron{fill:#ff9a3d}.dr-g-fill.g-bone{fill:var(--c-neut)}
`,
});
