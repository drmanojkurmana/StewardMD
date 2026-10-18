/* Lysosomal storage diseases as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/lysos.mjs [--print-model]
 * Static layout here; particles, lysosome filling and gauges move in lysos.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease and severity of the enzyme defect", a: [0, 0.6, 1, 0.7, 0.85, 0.75], names: ["no defect", "Gaucher disease", "Tay-Sachs disease", "Fabry disease", "Niemann-Pick disease", "Pompe disease"], ticks: ["healthy", "Gaucher", "Tay-Sachs", "Fabry", "Niemann-Pick", "Pompe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "enzyme replacement" },
    { label: "substrate reduction" },
  ],
  status: "Disease: {level} · {drug} ·",
  drugNames: ["no treatment", "enzyme replacement", "substrate reduction"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const D = S.level.a[level];
  const visc = [0, 1, 0.25, 0.55, 0.95, 0.65][level], neuroF = [0, 0.2, 1, 0.4, 0.9, 0.3][level];
  const ertEff = [0, 0.8, 0.15, 0.7, 0.35, 0.75][level], srtEff = [0, 0.55, 0.3, 0.45, 0.4, 0.15][level];
  const ert = drug === 1 ? 1 : 0, srt = drug === 2 ? 1 : 0;
  const E = cl((1 - D) + ert * D * ertEff);
  const Acc = cl(D * (ert ? 1 - ertEff : 1) * (srt ? 1 - srtEff : 1));
  const Sw = Acc;
  const Org = cl(Acc * visc), Neuro = cl(Acc * neuroF);
  const Func = cl(1 - 0.45 * Sw - 0.35 * Org - 0.45 * Neuro);
  const inflow = srt ? cl(1 - 0.6 * srtEff - 0.2 * D * srtEff) : 1;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Acc, 0.25, 0.6, ["none", "some", "marked"]), w(Sw, 0.25, 0.6, ["normal", "swollen", "very swollen"]), w(Org, 0.2, 0.5, ["none", "mild", "marked"]), w(Neuro, 0.2, 0.5, ["none", "some", "marked"])];
  return { level, D, E, Acc, Sw, Org, Neuro, Func, ert, srt, inflow, visc, neuroF, words, readout: "stored substrate " + words[0] + " · cells " + words[1] + " · organ enlargement " + words[2] + " · nerve involvement " + words[3] };
}
const TESTS = [
  [1, 0, "stored substrate marked · cells very swollen · organ enlargement marked · nerve involvement none"],
  [1, 1, "stored substrate none · cells normal · organ enlargement none · nerve involvement none"],
  [2, 1, "stored substrate marked · cells very swollen · organ enlargement mild · nerve involvement marked"],
  [5, 2, "stored substrate marked · cells very swollen · organ enlargement mild · nerve involvement none"],
];

/* ---------------- static layout ---------------- */
const DISEASES = [
  { name: "No defect", enzyme: "lysosomal enzymes work", substrate: "lipids and glycogen", sites: "breakdown keeps up" },
  { name: "Gaucher disease", enzyme: "glucocerebrosidase missing", substrate: "glucocerebroside lipid", sites: "liver, spleen and bone" },
  { name: "Tay-Sachs disease", enzyme: "hexosaminidase A missing", substrate: "GM2 ganglioside lipid", sites: "brain and nerve cells" },
  { name: "Fabry disease", enzyme: "alpha-galactosidase A missing", substrate: "Gb3 lipid", sites: "kidney, heart and nerves" },
  { name: "Niemann-Pick disease", enzyme: "sphingomyelinase missing", substrate: "sphingomyelin lipid", sites: "liver, spleen and brain" },
  { name: "Pompe disease", enzyme: "acid maltase missing", substrate: "glycogen", sites: "heart and skeletal muscle" },
];
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CYTOSOL</text>
<text id="disTitle" class="sc-zone" x="620" y="66" text-anchor="middle"></text>
<text id="disSub" class="sc-lab" x="620" y="84" text-anchor="middle"></text>
<g id="swell"></g>
<g id="lysoG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.lyso-b{fill:color-mix(in srgb,var(--c-mac) 26%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.6}
.lyso-in{fill:color-mix(in srgb,var(--c-mac) 12%,var(--anatomy-paper));stroke:none}
.stored{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.enz-p{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.xmark{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.p-sub{--cc:#ff9a3d}.p-frag{--cc:var(--c-good)}.p-ert{--cc:#38d1ff}
.ves{fill:color-mix(in srgb,#ff9a3d 22%,var(--anatomy-paper));stroke:#ff9a3d;stroke-width:1.2}
.out-b{fill:color-mix(in srgb,var(--c-good) 16%,var(--anatomy-paper));stroke:var(--c-good);stroke-width:1.2}
`;

buildScene({
  id: "lysosomal-storage-diseases", fig: "Fig 1", title: "Lysosomal storage diseases: one missing enzyme, stored substrate", W, H, body, extraCss,
  label: "An animated cell. Substrate particles made in the cytosol flow into a lysosome, where enzymes break down lipids and glycogen. When one enzyme is missing, its substrate cannot be broken down and fills the lysosome, swelling cells and enlarging organs, with nerve involvement in some diseases. The slider picks Gaucher, Tay-Sachs, Fabry, Niemann-Pick or Pompe disease. Treatment choices are enzyme replacement, substrate reduction or none. Gauges show enzyme activity, stored substrate, cell swelling, organ enlargement, nerve involvement and cell function.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, diseases: DISEASES }, pageJs: readFileSync(join(HERE, "lysos.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>One missing lysosome enzyme, one stored substrate.</strong> Lysosomes are the cell recycling compartments. Their acid enzymes break down lipids and glycogen delivered from the cytosol. Each storage disease lacks one enzyme, so only its substrate builds up: Gaucher disease (glucocerebrosidase; glucocerebroside, mainly liver, spleen and bone), Tay-Sachs disease (hexosaminidase A; GM2 ganglioside, mainly brain), Fabry disease (alpha-galactosidase A; Gb3 lipid, kidney, heart and nerves), Niemann-Pick disease (sphingomyelinase; sphingomyelin, liver, spleen and brain) and Pompe disease (acid maltase, also called acid alpha-glucosidase; glycogen, heart and muscle). Filled lysosomes swell cells, enlarge organs and injure nerves. This is standard teaching in pathology and metabolic medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Enzyme replacement supplies a working copy of the missing enzyme taken up into lysosomes; it reaches blood-fed organs well and the brain poorly. Substrate reduction makes less of the stored substrate in the first place, so less arrives at the lysosome. They are teaching toggles only.",
  ],
  simplified: "Inheritance, newborn screening, carrier testing, chaperone and gene therapies, bone and eye findings, the cholesterol-trafficking form of Niemann-Pick disease, and every drug and dose are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
