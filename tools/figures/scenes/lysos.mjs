/* Lysosomal storage diseases as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/lysos.mjs [--print-model]
 * Static layout here; particles, lysosome filling, organs and gauges move in lysos.page.js. Qualitative: no doses, no numbers. */
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
  { name: "No defect", enzyme: "all lysosomal enzymes", substrate: "lipids and glycogen", sites: "breakdown keeps up",
    caps: ["Healthy cell. Lysosomes clear storage as fast as it arrives.", "Healthy cell. No storage builds up, so treatment adds nothing.", "Healthy cell. No storage builds up, so treatment adds nothing."] },
  { name: "Gaucher disease", enzyme: "glucocerebrosidase", substrate: "glucocerebroside lipid", sites: "liver, spleen and bone",
    caps: ["No treatment. Fatty storage fills the lysosome and swells liver and spleen.", "Enzyme replacement adds the missing enzyme. Storage drains and organs shrink.", "Substrate reduction slows new storage. Less arrives, so swelling eases."] },
  { name: "Tay-Sachs disease", enzyme: "hexosaminidase A", substrate: "ganglioside lipid", sites: "brain and nerve cells",
    caps: ["No treatment. Fatty storage fills brain cells and nerves fail.", "Enzyme replacement helps organs. Little reaches the brain, so nerves stay affected.", "Substrate reduction slows new storage. Brain swelling eases a little."] },
  { name: "Fabry disease", enzyme: "alpha-galactosidase A", substrate: "fatty storage lipid", sites: "kidney, heart and nerves",
    caps: ["No treatment. Storage injures kidney, heart and nerves.", "Enzyme replacement adds the missing enzyme. Storage drains and organs recover.", "Substrate reduction slows new storage. Less arrives, so injury slows."] },
  { name: "Niemann-Pick disease", enzyme: "sphingomyelinase", substrate: "sphingomyelin lipid", sites: "liver, spleen and brain",
    caps: ["No treatment. Storage fills liver, spleen and brain.", "Enzyme replacement adds the missing enzyme. Organs shrink, but nerves stay affected.", "Substrate reduction slows new storage. Less arrives, so swelling eases."] },
  { name: "Pompe disease", enzyme: "acid maltase", substrate: "glycogen", sites: "heart and skeletal muscle",
    caps: ["No treatment. Glycogen storage swells heart and muscle.", "Enzyme replacement adds the missing enzyme. Storage drains and the heart shrinks back.", "Substrate reduction slows new storage. Less arrives, so swelling eases a little."] },
];
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="glowG"></g>
<g id="liverSlot"></g>
<g id="heartSlot"></g>
<g id="brainSlot"></g>
<g id="supplyG"></g>
<g id="lysoG"></g>
<g id="cellG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.stored{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.ly-wash{fill:#ff9a3d;stroke:none;pointer-events:none}
.og-wash{fill:#ff9a3d;stroke:none;pointer-events:none}
.br-wash{fill:var(--c-cyt2);stroke:none;pointer-events:none}
.br-glow{fill:var(--c-cyt2);stroke:none;pointer-events:none}
.enz-p{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.enz-dock{fill:none;stroke:#38d1ff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.xmark{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.p-sub{--cc:#ff9a3d}.p-frag{--cc:var(--c-good)}.p-ert{--cc:#38d1ff}
.ves{fill:color-mix(in srgb,#ff9a3d 22%,var(--anatomy-paper));stroke:#ff9a3d;stroke-width:1.4}
.pipe{fill:none;stroke:color-mix(in srgb,#ff9a3d 55%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round;opacity:.75}
.pipe-out{fill:none;stroke:var(--c-good);stroke-width:5;stroke-linecap:round;stroke-dasharray:5 5;opacity:.6}
.gate{fill:var(--anatomy-strong);stroke:none}
.arr{fill:var(--anatomy-mid);stroke:none}
.ly-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
`;

buildScene({
  id: "lysosomal-storage-diseases", fig: "Fig 1", title: "Lysosomal storage diseases: one missing enzyme, stored substrate", W, H, body, extraCss,
  label: "An animated cell and its organs, left to right. Substrate made in the cell flows into a lysosome, where one missing enzyme leaves its substrate stored. Filled lysosomes swell cells, and the liver, heart and brain show what swells or fails in the body. The slider picks Gaucher, Tay-Sachs, Fabry, Niemann-Pick or Pompe disease. Treatment choices are enzyme replacement, which adds a working copy of the missing enzyme, and substrate reduction, which makes less substrate in the first place. Gauges show enzyme activity, stored substrate, cell swelling, organ enlargement, nerve involvement and cell function.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, diseases: DISEASES }, pageJs: readFileSync(join(HERE, "lysos.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With enzyme replacement",
  sourcesLis: [
    "<strong>One missing lysosome enzyme, one stored substrate.</strong> Lysosomes are the cell recycling compartments. Their acid enzymes break down lipids and glycogen delivered from the cytosol. Each storage disease lacks one enzyme, so only its substrate builds up: Gaucher disease (glucocerebrosidase; glucocerebroside, mainly liver, spleen and bone), Tay-Sachs disease (hexosaminidase A; ganglioside lipid, mainly brain), Fabry disease (alpha-galactosidase A; fatty storage lipid, kidney, heart and nerves), Niemann-Pick disease (sphingomyelinase; sphingomyelin, liver, spleen and brain) and Pompe disease (acid maltase, also called acid alpha-glucosidase; glycogen, heart and muscle). Filled lysosomes swell cells, enlarge organs and injure nerves. This is standard teaching in pathology and metabolic medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Enzyme replacement supplies a working copy of the missing enzyme taken up into lysosomes; it reaches blood-fed organs well and the brain poorly. Substrate reduction makes less of the stored substrate in the first place, so less arrives at the lysosome. They are teaching toggles only.",
  ],
  simplified: "Inheritance, newborn screening, carrier testing, chaperone and gene therapies, bone and eye findings, the cholesterol-trafficking form of Niemann-Pick disease, and every drug and dose are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
