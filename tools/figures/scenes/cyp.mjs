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
  level: { label: "Interaction present", a: [0, 1, 2], names: ["no interaction", "inducer present", "inhibitor present"], ticks: ["none", "inducer", "inhibitor"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "inducer (rifampicin, carbamazepine, phenytoin type)" },
    { label: "inhibitor (macrolide, azole, grapefruit type)" },
  ],
  status: "Interaction: {level} · {drug} ·",
  drugNames: ["none", "inducer added", "inhibitor added"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const mode = drug === 1 ? "ind" : drug === 2 ? "inh" : level === 1 ? "ind" : level === 2 ? "inh" : "none";
  const ind = mode === "ind" ? 1 : 0, inh = mode === "inh" ? 1 : 0;
  const E = cl(0.5 + 0.42 * ind - 0.34 * inh);
  const Clear = cl(0.5 + 0.44 * ind - 0.36 * inh);
  const Lev = cl(0.52 - 0.36 * ind + 0.4 * inh);
  const Eff = cl(0.52 - 0.36 * ind + 0.4 * inh);
  const Tox = cl(0.18 - 0.1 * ind + 0.62 * inh);
  const Prod = cl(0.48 + 0.4 * ind - 0.36 * inh);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Lev, 0.3, 0.65, ["low", "usual", "high"]), w(Eff, 0.3, 0.65, ["reduced", "usual", "excessive"]), w(Tox, 0.3, 0.6, ["low", "some", "high"])];
  return { ind, inh, E, Clear, Lev, Eff, Tox, Prod, words, readout: "drug level " + words[0] + " · effect " + words[1] + " · toxicity " + words[2] };
}
const TESTS = [
  [0, 0, "drug level usual · effect usual · toxicity low"],
  [1, 0, "drug level low · effect reduced · toxicity low"],
  [2, 0, "drug level high · effect excessive · toxicity high"],
  [0, 2, "drug level high · effect excessive · toxicity high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LIVER AND BLOODSTREAM</text>
<rect class="cy-hep" x="190" y="110" width="580" height="225" rx="55"/>
<path class="cy-er" d="M235 205C330 175 420 225 510 195C590 170 660 210 735 190"/>
<path class="cy-er" d="M245 245C340 220 430 260 520 235C600 215 670 250 730 232"/>
<ellipse class="cy-nuc" cx="630" cy="272" rx="42" ry="34"/>
<ellipse class="cy-nuc2" cx="618" cy="260" rx="16" ry="12"/>
<rect class="cy-lumen" x="14" y="355" width="${W - 28}" height="60" rx="12"/>
<g id="rbcs"></g>
<g id="cypnodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "cytochrome-p450-interactions", fig: "Fig 1", title: "Cytochrome P450: drug metabolism and interactions", W, H, body,
  label: "An animated liver cell and bloodstream. A parent drug enters the liver cell, cytochrome P450 enzymes on the endoplasmic reticulum oxidise it to a metabolite, and the metabolite leaves in the blood. An inducer makes more enzyme so clearance speeds up and drug levels fall. An inhibitor blocks enzyme so clearance slows and drug levels rise. Gauges show enzyme activity, clearance, drug level, effect, toxicity and prodrug activation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the classes named are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cyp.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "No interaction", withLabel: "With interaction",
  sourcesLis: [
    "<strong>How CYP metabolism works.</strong> Many drugs are oxidised in liver cells by cytochrome P450 enzymes, a family of haem proteins seated in the endoplasmic reticulum. Oxidation usually makes a drug easier to remove, and sometimes it creates the active form of a prodrug. This is standard teaching in pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Inducers and inhibitors.</strong> Inducers such as rifampicin, carbamazepine and phenytoin increase enzyme production, so a substrate drug is cleared faster and its level and effect can fall. Inhibitors such as macrolides, azole antifungals and grapefruit components block enzyme activity, so clearance slows and levels, effect and toxicity can rise. The risk is greatest for drugs with a narrow therapeutic index, such as warfarin, where a small level change matters. These are teaching toggles only.",
  ],
  simplified: "Individual CYP families and their substrates, transporters, genetic variation in enzyme activity, liver disease, time course of induction, metabolite activity in detail, and all doses and monitoring are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cy-hep{fill:color-mix(in srgb,#c96a3a 28%,var(--anatomy-paper));stroke:color-mix(in srgb,#c96a3a 60%,#000);stroke-width:1.2}
.cy-er{fill:none;stroke:color-mix(in srgb,#c96a3a 55%,var(--anatomy-mid));stroke-width:7;stroke-linecap:round;opacity:.55}
.cy-nuc{fill:#8a5a7a;stroke:color-mix(in srgb,#8a5a7a 55%,#000);stroke-width:1}
.cy-nuc2{fill:color-mix(in srgb,#8a5a7a 45%,#fff);opacity:.8}
.cy-lumen{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.cy-cyp{fill:#e9b84a;stroke:color-mix(in srgb,#e9b84a 55%,#000);stroke-width:1}
.cy-cypin{fill:color-mix(in srgb,#e9b84a 45%,var(--anatomy-paper));stroke:none}
.cy-ind{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 50%,#000);stroke-width:.7}
.cy-inh{fill:#e5484d;stroke:color-mix(in srgb,#e5484d 55%,#000);stroke-width:.8}
.p-parent{--cc:#f08a4b}.p-met{--cc:#38b8a8}.p-ind{--cc:#3ddc97}.p-inh{--cc:#e5484d}
.dr-g-fill.g-enz{fill:#e9b84a}.dr-g-fill.g-clr{fill:#38b8a8}.dr-g-fill.g-lev{fill:#f08a4b}.dr-g-fill.g-eff{fill:var(--c-good)}.dr-g-fill.g-tox{fill:var(--c-bad)}.dr-g-fill.g-pro{fill:#7fc4e8}
`,
});
