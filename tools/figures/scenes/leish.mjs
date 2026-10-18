/* Visceral leishmaniasis (kala-azar) as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/leish.mjs [--print-model]
 * Static layout here; parasites, macrophages and gauges move in leish.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of visceral disease", a: [0.3, 0.65, 1], names: ["early", "established", "advanced"], ticks: ["early", "established", "advanced"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "liposomal amphotericin" },
    { label: "miltefosine" },
    { label: "supportive care only" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "liposomal amphotericin", "miltefosine", "supportive care only"],
};
function modelOf(S, level, drug) {
  const KILL = [0, 0.88, 0.62, 0];
  const a = S.level.a[level], kill = KILL[drug], sup = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const P = cl(a * (1 - kill));
  const F = cl(0.06 + 0.86 * P - sup * 0.18);
  const Sp = cl(0.04 + 0.92 * a * (1 - kill * 0.55));
  const Cy = cl(0.04 + 0.82 * Sp - sup * 0.28 - kill * a * 0.18);
  const Bc = cl(1 - Cy);
  const G = cl(0.08 + 0.8 * a * (1 - kill * 0.45));
  const D = cl(0.03 + 0.78 * a * a * (1 - kill * 0.3));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.25, 0.55, ["low", "moderate", "high"]), w(Sp, 0.3, 0.65, ["near normal", "enlarged", "massive"]), w(Bc, 0.35, 0.65, ["low", "reduced", "near normal"])];
  return { a, drug, kill, sup, P, F, Sp, Cy, Bc, G, D, words, readout: "parasite load " + words[0] + " · spleen " + words[1] + " · blood cells " + words[2] };
}
const TESTS = [
  [1, 0, "parasite load high · spleen enlarged · blood cells reduced"],
  [1, 1, "parasite load low · spleen enlarged · blood cells near normal"],
  [1, 3, "parasite load high · spleen enlarged · blood cells near normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">SKIN</text>
<text class="sc-zone" x="266" y="68">BLOOD AND SPREAD</text>
<text class="sc-zone" x="578" y="68">LIVER, SPLEEN AND MARROW</text>
<rect class="le-skin" x="30" y="82" width="190" height="340" rx="14"/>
<rect class="le-vessel" x="246" y="178" width="290" height="58" rx="24"/>
<g id="organs">
<ellipse class="le-liver" cx="705" cy="142" rx="102" ry="44"/>
<g id="spleenG"><ellipse class="le-spleen" cx="665" cy="278" rx="62" ry="38"/></g>
<g class="le-bone"><rect class="le-marrow" x="790" y="322" width="128" height="58" rx="26"/><ellipse class="le-marrowIn" cx="854" cy="351" rx="42" ry="18"/></g>
</g>
<g id="patches"></g>
<g id="fly"></g>
<g id="rbcs"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "visceral-leishmaniasis", fig: "Fig 1", title: "Visceral leishmaniasis (kala-azar): sandfly to organs", W, H, body,
  label: "An animated scene of visceral leishmaniasis. A sandfly bite puts promastigotes into skin. Macrophages take them up and they change into amastigotes that multiply inside macrophages of liver, spleen and bone marrow. Rising parasite load brings fever, a large spleen, pancytopenia and hypergammaglobulinaemia, and later skin patches of the post kala-azar dermal form. Gauges show parasite load, fever, spleen size, blood cells, antibody and skin form. Treatments compared are liposomal amphotericin, miltefosine and supportive care only.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "leish.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `.le-skin{fill:#c98a5e;opacity:.38}.le-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper))}.le-liver{fill:#b85c4a;opacity:.85;stroke:color-mix(in srgb,#b85c4a 55%,#000);stroke-width:1}.le-spleen{fill:#8e5aa8;opacity:.88;stroke:color-mix(in srgb,#8e5aa8 55%,#000);stroke-width:1}.le-marrow{fill:#e8ddc8;opacity:.9;stroke:var(--anatomy-mid);stroke-width:1}.le-marrowIn{fill:#d98a94;opacity:.85}.le-flyB{fill:#6b5a44;stroke:#3d3226;stroke-width:.8}.le-flyW{fill:#dfeaf2;opacity:.65;stroke:var(--anatomy-mid);stroke-width:.6}.le-bite{fill:var(--c-bad)}.p-pro{fill:#7fcf6a;stroke:#3f7a32;stroke-width:.5}.p-flag{fill:none;stroke:#3f7a32;stroke-width:1}.p-am{fill:#2f6b2f;stroke:#173d17;stroke-width:.4}.p-trt{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}.p-trt2{fill:var(--c-bad);opacity:.75}.p-heat{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-linecap:round;opacity:.7}.le-patch{fill:#8a5a34;opacity:.8;stroke:#5e3c20;stroke-width:.6}.dr-g-fill.g-par{fill:#7fcf6a}.dr-g-fill.g-fever{fill:var(--c-bad)}.dr-g-fill.g-spleen{fill:#8e5aa8}`,
  sourcesLis: [
    "<strong>How kala-azar develops.</strong> A sandfly bite injects promastigotes of Leishmania donovani into skin. Macrophages take them up, and inside the macrophage they change into amastigotes that multiply and spread through blood to macrophages of liver, spleen and bone marrow. Heavy parasite load in these organs brings prolonged fever, massive splenomegaly, pancytopenia from marrow involvement and a large spleen, and hypergammaglobulinaemia with many antibodies that do not clear the parasite. After or alongside visceral disease, parasites in skin can give the post kala-azar dermal form with patches and nodules. This is standard teaching in infectious disease and tropical medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Liposomal amphotericin and miltefosine kill the parasite by different routes, shown here only as a qualitative fall in parasite load. Supportive care only can help fever and blood cells a little but does not clear parasites. These are teaching toggles only.",
  ],
  simplified: "Sandfly biology and the animal reservoir, lymph node and gut involvement, HIV coinfection, relapse and resistance, drug toxicity and monitoring, splenic aspiration and other tests, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
