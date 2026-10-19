/* Cytochrome P450 drug interactions as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cyp.mjs [--print-model]
 * Static layout here; drug particles, CYP enzymes and gauges move in cyp.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Parent drug arriving", a: [0.62, 1, 1.45], names: ["little parent drug", "usual parent drug", "much parent drug"], ticks: ["little", "usual", "much"], start: 1 },
  drugLabel: "Other drug",
  settings: [
    { label: "none" },
    { label: "inducer (rifampicin, carbamazepine, phenytoin type)" },
    { label: "inhibitor (macrolide, azole, grapefruit type)" },
  ],
  status: "Drug arriving: {level} · {drug} ·",
  drugNames: ["none", "inducer added", "inhibitor added"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const dose = S.level.a[level];
  const ind = drug === 1 ? 1 : 0, inh = drug === 2 ? 1 : 0;
  const E = cl(0.5 + 0.42 * ind - 0.34 * inh);
  const Clear = cl(0.5 + 0.44 * ind - 0.36 * inh);
  const Lev = cl(0.52 * dose - 0.36 * ind + 0.4 * inh);
  const Eff = Lev;
  const Tox = cl(0.06 + 0.12 * dose - 0.08 * ind + 0.55 * inh);
  const Prod = cl(0.48 + 0.4 * ind - 0.36 * inh);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Lev, 0.3, 0.65, ["low", "usual", "high"]), w(Eff, 0.3, 0.65, ["reduced", "usual", "excessive"]), w(Tox, 0.3, 0.6, ["low", "some", "high"])];
  return { ind, inh, E, Clear, Lev, Eff, Tox, Prod, words, readout: "drug level " + words[0] + " · effect " + words[1] + " · toxicity " + words[2] };
}
const TESTS = [
  [1, 0, "drug level usual · effect usual · toxicity low"],
  [1, 1, "drug level low · effect reduced · toxicity low"],
  [1, 2, "drug level high · effect excessive · toxicity high"],
  [2, 0, "drug level high · effect excessive · toxicity low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LIVER AND BLOOD</text>
<path id="vesselIn" class="cy-vessel" d="M24 302 L318 258"/>
<path id="vesselOut" class="cy-vessel" d="M398 75 C560 70 660 140 740 230 C800 290 860 340 936 380"/>
<rect class="cy-lumen" x="14" y="355" width="${W - 28}" height="60" rx="12"/>
<rect id="bloodTint" class="cy-tint" x="20" y="361" width="920" height="48" rx="10" opacity="0"/>
<g id="liverSlot"></g>
<ellipse id="toxGlow" class="cy-tox" cx="740" cy="385" rx="140" ry="42" opacity="0"/>
<g id="cypnodes"></g>
<g id="rbcs"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "cytochrome-p450-interactions", fig: "Fig 1", title: "Cytochrome P450: drug metabolism and interactions", W, H, body,
  label: "An animated liver and bloodstream. A parent drug arrives in the blood and enters the liver, where cytochrome P450 enzymes change it to a metabolite that leaves in the blood. An inducer makes the liver build extra enzyme, so the drug is cleared faster and its level falls. An inhibitor plugs the enzyme, so uncleared drug builds up in the blood and harm rises. A slider sets how much parent drug arrives.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the classes named are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cyp.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "No interaction", withLabel: "With inhibitor",
  sourcesLis: [
    "<strong>How CYP metabolism works.</strong> Many drugs are oxidised in liver cells by cytochrome P450 enzymes, a family of haem proteins seated in the endoplasmic reticulum. Oxidation usually makes a drug easier to remove, and sometimes it creates the active form of a prodrug. This is standard teaching in pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Inducers and inhibitors.</strong> Inducers such as rifampicin, carbamazepine and phenytoin increase enzyme production, so a substrate drug is cleared faster and its level and effect can fall. Inhibitors such as macrolides, azole antifungals and grapefruit components block enzyme activity, so clearance slows and levels, effect and toxicity can rise. The risk is greatest for drugs with a narrow therapeutic index, such as warfarin, where a small level change matters. These are teaching toggles only.",
  ],
  simplified: "Individual CYP families and their substrates, transporters, genetic variation in enzyme activity, liver disease, time course of induction, metabolite activity in detail, and all doses and monitoring are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cy-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:12;stroke-linecap:round;opacity:.8}
.cy-lumen{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.cy-tint{fill:#f08a4b;stroke:none}
.cy-tox{fill:var(--c-bad);stroke:none}
.cy-cyp{fill:#e9b84a;stroke:color-mix(in srgb,#e9b84a 55%,#000);stroke-width:1}
.cy-cypin{fill:color-mix(in srgb,#e9b84a 45%,var(--anatomy-paper));stroke:none}
.cy-ind{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 50%,#000);stroke-width:.7}
.cy-inh{fill:#e5484d;stroke:color-mix(in srgb,#e5484d 55%,#000);stroke-width:.8}
.cy-cap{fill:var(--anatomy-strong);font-size:12px}
.p-parent{--cc:#f08a4b}.p-met{--cc:#38b8a8}.p-ind{--cc:#3ddc97}.p-inh{--cc:#e5484d}
.dr-g-fill.g-enz{fill:#e9b84a}.dr-g-fill.g-clr{fill:#38b8a8}.dr-g-fill.g-lev{fill:#f08a4b}.dr-g-fill.g-eff{fill:var(--c-good)}.dr-g-fill.g-tox{fill:var(--c-bad)}.dr-g-fill.g-pro{fill:#7fc4e8}
`,
});
