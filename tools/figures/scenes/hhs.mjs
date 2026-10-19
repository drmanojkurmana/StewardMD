/* Hyperosmolar hyperglycaemic state as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hhs.mjs [--print-model]
 * Static layout here; cells, particles and gauges move in hhs.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How the state develops", a: [0.4, 0.7, 1], names: ["hyperglycaemia", "dehydration", "severe"], ticks: ["hyperglycaemia", "dehydration", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "fluids first" },
    { label: "insulin only" },
    { label: "fluids first, then insulin" },
    { label: "full treatment (fluids, insulin, electrolytes, clot prevention)" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "fluids first", "insulin only", "fluids first, then insulin", "full treatment"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const fl = drug === 1 || drug >= 3 ? 1 : 0, ins = drug === 2 || drug >= 3 ? 1 : 0, el = drug === 4 ? 1 : 0, tp = drug === 4 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const G0 = cl(0.35 + 0.6 * a), D0 = cl(0.25 + 0.65 * a);
  const G = cl(G0 * (ins ? 0.35 : fl ? 0.82 : 1));
  const De = cl(D0 * (fl ? 0.25 : ins ? 1.08 : 1));
  const Osm = cl(0.15 + 0.55 * G + 0.45 * De);
  const Ke = cl((0.08 + 0.08 * a) * (ins ? 0.7 : 1));
  const Imp = cl(-0.05 + 0.65 * Osm);
  const Alert = cl(1 - Imp);
  const T = cl((0.05 + 0.55 * De + 0.3 * Osm) * (tp ? 0.35 : 1));
  const Eloss = cl((0.15 + 0.55 * D0) * (el ? 0.3 : 1) * (fl ? 0.85 : 1));
  const InsEndo = 0.55;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(G, 0.4, 0.7, ["controlled", "high", "very high"]), w(Osm, 0.35, 0.65, ["normal", "raised", "very high"]), w(De, 0.3, 0.6, ["corrected", "moderate", "severe"]), w(Imp, 0.3, 0.6, ["alert", "drowsy", "severely impaired"])];
  return { a, fl, ins, el, tp, G, De, Osm, Ke, Imp, Alert, T, Eloss, InsEndo, words, readout: "glucose " + words[0] + " · osmolality " + words[1] + " · dehydration " + words[2] + " · ketones low · consciousness " + words[3] };
}
const TESTS = [
  [1, 0, "glucose very high · osmolality very high · dehydration severe · ketones low · consciousness drowsy"],
  [1, 1, "glucose high · osmolality raised · dehydration corrected · ketones low · consciousness drowsy"],
  [1, 2, "glucose controlled · osmolality raised · dehydration severe · ketones low · consciousness drowsy"],
  [1, 4, "glucose controlled · osmolality raised · dehydration corrected · ketones low · consciousness alert"],
];

/* ---------------- static layout ---------------- */
const CY = 288;
const tube = "M620 386L706 392L766 414L856 396L928 420";
const body = `
<rect class="sc-tissue" x="14" y="44" width="226" height="190" rx="16"/>
<rect class="sc-tissue" x="250" y="44" width="310" height="190" rx="16"/>
<rect class="sc-tissue" x="570" y="44" width="376" height="190" rx="16"/>
<rect class="sc-tissue" x="14" y="346" width="536" height="96" rx="16" opacity="0.7"/>
<rect class="sc-tissue" x="560" y="346" width="386" height="96" rx="16" opacity="0.7"/>
<text class="sc-zone" x="32" y="68">PANCREAS</text><text class="sc-zone" x="268" y="68">LIVER</text><text class="sc-zone" x="588" y="68">BRAIN AND BODY CELLS</text>
<text class="sc-zone" x="32" y="364">TREATMENT, WHEN GIVEN</text><text class="sc-zone" x="578" y="364">KIDNEY</text>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 32}" width="932" height="64"/>
<text class="sc-zone sc-dim" x="30" y="${CY + 4}">BLOOD</text>
<path id="tube" class="hhs-tube" d="${tube}"/>
<g id="pancSlot"></g><g id="liverSlot"></g><g id="brainSlot"></g><g id="kidneySlot"></g>
<g id="cells"></g><g id="sparks"></g><g id="clots"></g><g id="parts"></g><g id="marks"></g><g id="tr"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.hhs-tube{fill:none;stroke:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke-width:24;stroke-linecap:round;stroke-linejoin:round}
.cl-bodycell{--cc:#8fc7a8}
.p-gluc{--cc:#f2b23a}.p-ket{--cc:#ee6a4a}.p-k{--cc:#b27af0}.p-ins{--cc:#2fc2a3}.p-salt{--cc:#d9d4f2}
.p-iv{fill:var(--c-fl)}
.hhs-icon{fill:color-mix(in srgb,var(--c-fl) 42%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.hhs-ico2{fill:color-mix(in srgb,#2fc2a3 42%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.3}
.hhs-ico3{fill:color-mix(in srgb,#b27af0 42%,var(--anatomy-paper));stroke:#b27af0;stroke-width:1.3}
.hhs-ico4{fill:color-mix(in srgb,var(--c-good) 38%,var(--anatomy-paper));stroke:var(--c-good);stroke-width:1.3}
.hhs-x{fill:color-mix(in srgb,var(--anatomy-paper) 72%,transparent);stroke:var(--c-bad);stroke-width:1.8}
.hhs-spark{fill:var(--c-neut);stroke:var(--c-neut);stroke-width:1.4;stroke-linecap:round}
.hhs-cap{fill:var(--anatomy-strong);font-size:13px}
.dr-g-fill.g-gl{fill:#f2b23a}.dr-g-fill.g-osm{fill:#ee8a3a}.dr-g-fill.g-dehy{fill:var(--c-fl)}.dr-g-fill.g-ket{fill:#ee6a4a}.dr-g-fill.g-alert{fill:var(--c-good)}.dr-g-fill.g-clot{fill:var(--c-plt)}
`;

buildScene({
  id: "hyperosmolar-hyperglycaemic-state", fig: "Fig 1", title: "Hyperosmolar hyperglycaemic state: dry and concentrated, without ketones", W, H, body, extraCss,
  label: "An animated map of the hyperosmolar hyperglycaemic state in type 2 diabetes. Some insulin is still made, enough to prevent ketone production, but not enough to control glucose. Very high glucose drags water out in the urine, causing profound dehydration and concentrated blood. Water leaves brain and body cells, alertness falls, and thick, slow blood raises clot risk. Treatment choices put fluids first, then insulin, with electrolyte replacement and clot prevention. Gauges show glucose, osmolality, dehydration, ketones, alertness and clot risk.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { CY, W, H, tube: [[620, 386], [706, 392], [766, 414], [856, 396], [928, 420]] },
  pageJs: readFileSync(join(HERE, "hhs.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With full treatment",
  sourcesLis: [
    "<strong>How this state develops.</strong> In type 2 diabetes there is usually enough insulin to suppress fat breakdown and ketone production, so ketones and acidosis are not the main problem, unlike diabetic ketoacidosis. Insulin is still too little, or works too poorly, to control glucose. Very high glucose passes into the urine and drags water and electrolytes with it (osmotic diuresis). Over days this causes profound dehydration and hyperosmolality: the blood becomes concentrated, water is pulled out of cells including brain cells, and alertness falls from drowsiness toward coma. Slow, concentrated blood and immobility raise the risk of clots. Illness, infection, missed treatment or new diabetes are common triggers. This is standard teaching in medicine and endocrine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Fluids first to restore circulating volume and slowly lower osmolality, then insulin to lower glucose once fluids are running; replacing electrolytes lost in urine, with monitoring; and preventing clots while the blood is concentrated and flow is slow. Insulin without fluids is shown as incomplete because dehydration and hyperosmolality persist and glucose and water can shift quickly. The figure shows direction only, not how much to give or when.",
    "<strong>Contrast with diabetic ketoacidosis.</strong> Ketoacidosis is driven by near absent insulin, ketone acids and acidosis, often over hours. This state is driven by dehydration and hyperosmolality with ketones low, often over days, usually in type 2 diabetes.",
  ],
  simplified: "Triggers in detail, sodium correction and safe rates of osmolality change, potassium thresholds, cerebral oedema, insulin regimens, clot prevention choices, and all doses, rates and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
