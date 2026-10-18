/* Dengue as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dengue.mjs [--print-model]
 * Static layout here; mosquito, virus, immune cells, capillary, platelets and gauges move in dengue.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of illness", a: [0, 1, 2], names: ["febrile", "critical", "recovery"], ticks: ["febrile", "critical", "recovery"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "fluids and monitoring" },
    { label: "platelet support only if bleeding" },
    { label: "fluids and monitoring with platelet support if bleeding" },
  ],
  status: "Phase: {level} · {drug} ·",
  drugNames: ["none", "fluids and monitoring", "platelet support only if bleeding", "fluids and monitoring with platelet support if bleeding"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const supF = drug === 1 || drug === 3 ? 1 : 0, supP = drug === 2 || drug === 3 ? 1 : 0;
  const V = [0.85, 0.45, 0.12][level];
  const F = [0.9, 0.5, 0.18][level];
  const L = [0.12, 0.92, 0.28][level];
  const H = cl([0.3, 0.88, 0.38][level] - supF * 0.12 * L);
  const Pl = cl(1 - [0.3, 0.88, 0.35][level] + supP * 0.3 * (level === 1 ? 1 : 0.4));
  const Vol = cl(0.95 - 0.7 * L + supF * 0.45);
  const BP = cl(0.35 + 0.6 * Vol - 0.15 * L);
  const Sh = cl((1 - BP) * 1.1 + L * 0.2 - 0.1);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const wv = w(V, 0.25, 0.6, ["low", "present", "high"]);
  const wl = w(L, 0.25, 0.6, ["none", "mild", "severe"]);
  const wp = Pl < 0.35 ? "very low" : Pl < 0.6 ? "falling" : "preserved";
  const wc = BP < 0.45 ? "at risk" : BP < 0.7 ? "borderline" : "stable";
  const words = [wv, wl, wp, wc];
  return { V, F, L, H, Pl, Vol, BP, Sh, supF, supP, lev: level, words, readout: "virus " + wv + " · plasma leak " + wl + " · platelets " + wp + " · circulation " + wc };
}
const TESTS = [
  [0, 0, "virus high · plasma leak none · platelets preserved · circulation stable"],
  [1, 0, "virus present · plasma leak severe · platelets very low · circulation at risk"],
  [1, 3, "virus present · plasma leak severe · platelets falling · circulation borderline"],
  [2, 0, "virus low · plasma leak mild · platelets preserved · circulation stable"],
];

/* ---------------- static layout ---------------- */
const CY = 285;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="fever" class="dn-fever" x="14" y="44" width="${W - 28}" height="396" rx="18" opacity="0"/>
<rect id="oedema" class="sc-oed" x="14" y="44" width="${W - 28}" height="${CY - 70 - 44}" rx="18" opacity="0"/>
<text class="sc-zone" x="34" y="68">SKIN AND TISSUE</text>
<text class="sc-zone sc-dim" x="34" y="${CY - 52}">CAPILLARY</text>
<rect class="dn-skin" x="34" y="146" width="250" height="9" rx="4"/>
<g id="mosq"></g>
<g id="immune"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 38}" width="${W - 28}" height="76"/>
<g id="rbcs"></g><g id="plts"></g>
<g id="endo"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "dengue-fever", fig: "Fig 1", title: "Dengue: bite to plasma leakage and recovery", W, H, body,
  label: "An animated dengue scene. An Aedes mosquito bite introduces virus at the skin. Virus copies itself in immune cells and spreads in the blood. In the febrile phase fever dominates. In the critical phase the capillary wall leaks plasma, the blood concentrates, platelets fall and circulation can fail. In recovery leaked fluid is reabsorbed and platelets rise. Gauges show virus, fever, plasma leak, haemoconcentration, platelets and circulation. Treatment choices are fluids with monitoring and platelet support only if bleeding.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "dengue.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.dn-fever{fill:var(--c-bad)}.dn-skin{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.7}
.dn-mos{fill:color-mix(in srgb,#8a8f9c 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.dn-wing{fill:var(--anatomy-card);stroke:var(--anatomy-mid);opacity:.75}
.dn-leg{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;stroke-linecap:round}
.dn-prob{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;stroke-linecap:round}
.cl-vir{--cc:#e5484d}.p-vir{fill:#e5484d;stroke:#7a1f22;stroke-width:.5}.p-virs{stroke:#e5484d;stroke-width:1;stroke-linecap:round}
.p-pltsup{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 50%,#000);stroke-width:.5}
.dr-g-fill.g-vir{fill:var(--c-bad)}.dr-g-fill.g-fev{fill:#e07a2f}.dr-g-fill.g-hct{fill:#b46ad9}
body[data-theme="light"] .dr-g-fill.g-hct{fill:#8a3db0}
`,
  sourcesLis: [
    "<strong>How dengue develops.</strong> Dengue virus is carried by Aedes mosquitoes and enters at the bite. It infects and copies itself in immune cells, then circulates in the blood. The early febrile phase has fever and a rising virus level. Around defervescence some patients enter a critical phase: mediators loosen the capillary wall so plasma leaks out of vessels, the remaining blood becomes concentrated (rising haematocrit), platelets fall, and loss of circulating volume can lead to shock. In recovery the leak stops, leaked fluid is reabsorbed, haematocrit settles and platelets rise again. Warning features and bleeding can occur, and platelet support is reserved for bleeding rather than used to chase a count alone. This is standard teaching in medicine, infectious-disease and tropical-medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Careful fluids with close monitoring to replace leaked plasma and support circulation, and platelet support only if there is bleeding. Fluids do not seal the leak or clear the virus, and platelet support alone does not restore circulating volume. These are teaching toggles only.",
  ],
  simplified: "Dengue serotypes and secondary-infection antibody enhancement in detail, warning-sign checklists, bleeding and organ involvement, fluid types and rates, transfusion triggers, pregnancy and comorbidity, and all doses, thresholds and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
