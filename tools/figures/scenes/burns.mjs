/* Burns and fluid resuscitation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/burns.mjs [--print-model]
 * Static layout here; burn depth, mediators, leak and gauges move in burns.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Burn extent", a: [0.25, 0.8, 0.9], names: ["small", "major", "inhalation"], ticks: ["small", "major", "inhalation"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "cooling and dressing" },
    { label: "formula fluid resuscitation" },
    { label: "airway protection" },
  ],
  status: "Burn: {level} · {drug} ·",
  drugNames: ["no treatment", "cooling and dressing", "formula fluid resuscitation", "airway protection"],
};
function modelOf(S, level, drug) {
  const DEPTHW = ["superficial", "deep partial and full thickness", "deep partial and full thickness"];
  const AREAW = ["small area", "large area by rule of nines", "large area by rule of nines"];
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const cool = drug === 1 ? 1 : 0, fluid = drug === 2 ? 1 : 0, airwayTx = drug === 3 ? 1 : 0, inh = level === 2 ? 1 : 0;
  const depth = level === 0 ? 0.25 : 0.9;
  const Med = cl(a * (cool ? 0.55 : 1) * (0.5 + 0.5 * depth + 0.5));
  const Leak = cl(0.06 + 0.88 * Med);
  const Oed = cl(Leak * (fluid ? 1.05 : 0.92));
  const Vol = cl(1 - 0.72 * Leak + fluid * 0.52);
  const BP = cl(0.12 + 0.86 * Vol);
  const AirOed = cl(inh * (0.25 + 0.75 * a));
  const Air = cl(1 - 0.88 * AirOed + airwayTx * 0.78 * AirOed);
  const Inf = cl(0.08 + 0.72 * a * depth - cool * 0.22);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Vol, 0.45, 0.72, ["low", "reduced", "maintained"]), w(Oed, 0.3, 0.62, ["little", "moderate", "marked"]), w(Air, 0.45, 0.75, ["obstructed", "narrowed", "open"])];
  return { a, cool, fluid, airwayTx, inh, depth, Med, Leak, Oed, Vol, BP, AirOed, Air, Inf, depthWord: DEPTHW[level], areaWord: AREAW[level], words, readout: "circulating volume " + words[0] + " · tissue oedema " + words[1] + " · airway " + words[2] };
}
const TESTS = [
  [0, 0, "circulating volume maintained · tissue oedema little · airway open"],
  [1, 0, "circulating volume low · tissue oedema marked · airway open"],
  [1, 2, "circulating volume maintained · tissue oedema marked · airway open"],
  [2, 0, "circulating volume low · tissue oedema marked · airway obstructed"],
  [2, 3, "circulating volume low · tissue oedema marked · airway open"],
];

/* ---------------- static layout ---------------- */
const CY = 372;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="oedema" class="sc-oed" x="330" y="252" width="602" height="76" rx="12" opacity="0"/>
<text class="sc-zone" x="34" y="68">SKIN AND AREA</text>
<text class="sc-zone sc-dim" x="690" y="68">AIRWAY</text>
<g id="skinG"></g>
<g id="bodyG"></g>
<g id="airG"></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 38}" width="${W - 28}" height="76"/>
<g id="rbcs"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "burns-fluid-resuscitation", fig: "Fig 1", title: "Burns: fluid shift, hypovolaemia and airway swelling", W, H, body,
  label: "An animated burn scene. On the left, skin layers show burn depth from superficial to full thickness and a body map shows area by the rule of nines. In the middle, inflammatory mediators from the burn make capillaries leak, fluid shifts to the third space as oedema, circulating volume and pressure fall, shown as hypovolaemia. On the right, inhalation injury swells the airway. Gauges show mediators, leak, oedema, circulating volume, airway and infection risk. Treatments are cooling and dressing, formula fluid resuscitation and airway protection.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds, fluid volumes or drug names are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "burns.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.bn-epi{fill:#e8b48a;stroke:#8a5a34;stroke-width:1}
.bn-derm{fill:#d97a68;stroke:#8a3d34;stroke-width:1}
.bn-sub{fill:#e8d36a;stroke:#8a7a24;stroke-width:1}
.bn-fat{fill:#f2e2a0;stroke:#b8a24a;stroke-width:.7}
.bn-burn{fill:#5a1f1f;opacity:.55}
.bn-dress{fill:#eef2f5;stroke:#7a8a96;stroke-width:1.2;opacity:0}
.bn-body{fill:#c9a186;stroke:#6a4a34;stroke-width:1.2}
.bn-burned{fill:#a83232;opacity:0}
.bn-airwall{fill:#d9788f;stroke:#7a3044;stroke-width:1}
.bn-airlumen{fill:var(--anatomy-paper);stroke:#7a3044;stroke-width:1}
.bn-ett{fill:#7ab8ff;stroke:#2f5a8a;stroke-width:1.2;opacity:0}
.bn-smoke{fill:#6a6a72}
.bn-cap{fill:#8a4a5a;font-size:10px}
.g-med{fill:var(--c-cyt)}.g-leak{fill:var(--c-fl)}.g-oed{fill:var(--c-fl)}.g-vol{fill:var(--c-good)}.g-air{fill:var(--c-good)}.g-inf{fill:var(--c-bad)}
`,
  sourcesLis: [
    "<strong>How burns cause fluid shift.</strong> Heat injures skin in depth (superficial, partial thickness and full thickness) and in area, estimated in teaching by the rule of nines. Injured tissue releases inflammatory mediators that increase capillary permeability widely. Plasma leaks from vessels into the interstitial third space as oedema, so circulating volume falls (hypovolaemia) even though total body water may rise. Smoke inhalation can injure and swell the airway lining, narrowing or obstructing it. Open burn wounds also carry a later infection risk. This is standard teaching in surgery and critical care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Cooling and a dressing limit further injury and contamination, formula fluid resuscitation replaces leaked circulating volume (fluid type, volume and formula are not shown), and airway protection keeps a swollen airway open. These are teaching toggles only.",
  ],
  simplified: "Burn shock timing, oedema in unburned tissue, cardiac and renal responses, eschar and compartment problems, nutrition, grafting, analgesia, tetanus, and all fluid formulas, volumes, rates, doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
