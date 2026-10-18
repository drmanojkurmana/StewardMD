/* Dyslipidaemia and statin pathway as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/lipid.mjs [--print-model]
 * Static layout here; lipoproteins, receptors and gauges move in lipid.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Cholesterol pattern", a: [0.3, 0.65, 1], names: ["normal", "high LDL", "familial"], ticks: ["normal", "high LDL", "familial"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "statin" },
    { label: "ezetimibe" },
    { label: "PCSK9 inhibitor (concept)" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "a statin", "ezetimibe", "a PCSK9 inhibitor"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], statin = drug === 1 ? 1 : 0, eze = drug === 2 ? 1 : 0, pcsk9i = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Prod = cl((0.30 + 0.45 * a) * (statin ? 0.38 : 1));
  const Abs = cl((0.25 + 0.35 * a) * (eze ? 0.32 : 1));
  const V = cl(0.15 + 0.6 * Prod + 0.35 * Abs);
  const recBase = level === 2 ? 0.18 : 0.9;
  const R = cl(recBase * (pcsk9i ? 1 : 0.72) * (statin ? 1.25 : 1) * (pcsk9i && level === 2 ? 1.6 : 1));
  const L = cl(0.12 + 0.95 * V - 0.55 * R + (level === 2 ? 0.18 : 0));
  const Hd = cl(0.58 - 0.16 * a + (statin ? 0.04 : 0));
  const Per = cl(0.85 * L - 0.25 * Hd + 0.1);
  const Pk = pcsk9i ? 0.08 : cl(0.45 + 0.25 * a);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(L, 0.35, 0.65, ["low", "raised", "high"]), w(R, 0.3, 0.6, ["very low", "reduced", "good"]), w(Per, 0.3, 0.55, ["low", "raised", "high"])];
  return { a, statin, eze, pcsk9i, Prod, Abs, V, R, L, Hd, Per, Pk, words, readout: "blood LDL " + words[0] + " · receptor uptake " + words[1] + " · tissue cholesterol " + words[2] };
}
const TESTS = [
  [0, 0, "blood LDL low · receptor uptake good · tissue cholesterol low"],
  [1, 0, "blood LDL raised · receptor uptake good · tissue cholesterol raised"],
  [2, 0, "blood LDL high · receptor uptake very low · tissue cholesterol high"],
  [1, 1, "blood LDL low · receptor uptake good · tissue cholesterol low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="li-box" x="30" y="108" width="150" height="150" rx="14"/>
<rect class="li-box" x="640" y="108" width="290" height="150" rx="14"/>
<rect class="li-blood" x="30" y="316" width="900" height="84" rx="12"/>
<text class="sc-zone li-cap" x="105" y="248">GUT</text>
<text class="sc-zone li-cap" x="390" y="248">LIVER</text>
<text class="sc-zone li-cap" x="785" y="248">PERIPHERAL TISSUE</text>
<g id="gutn"></g><g id="livn"></g><g id="pern"></g>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "dyslipidaemia-statin-pathway", fig: "Fig 1", title: "Cholesterol metabolism and lipid lowering treatment", W, H, body,
  label: "An animated map of cholesterol metabolism. The gut absorbs cholesterol from food, the liver makes cholesterol through HMG-CoA reductase and releases VLDL into the blood, VLDL becomes LDL, LDL receptors on the liver clear LDL, and HDL carries cholesterol from peripheral tissue back to the liver. In familial hypercholesterolaemia the LDL receptor is faulty. Treatment choices are a statin, ezetimibe and a PCSK9 inhibitor concept. Gauges show liver production, gut uptake, blood LDL, receptor uptake, HDL return and tissue cholesterol.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "lipid.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How cholesterol moves.</strong> The liver makes cholesterol, with HMG-CoA reductase as the controlling enzyme, and packages lipid into VLDL. In the blood VLDL loses lipid and becomes LDL, the main cholesterol carrier to tissues. Liver LDL receptors bind LDL and pull it back into the liver for clearance. HDL does the return journey, carrying cholesterol from peripheral tissues back to the liver (reverse cholesterol transport). The gut also absorbs dietary and biliary cholesterol. This is standard teaching in medicine, biochemistry and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Familial hypercholesterolaemia and treatment ideas shown.</strong> A faulty LDL receptor gene leaves few working receptors, so LDL stays high from early life. A statin blocks HMG-CoA reductase; the liver responds by making more LDL receptors. Ezetimibe blocks cholesterol uptake from the gut. A PCSK9 inhibitor stops PCSK9 marking LDL receptors for destruction, so more receptors survive; it works best when some receptors can still be made. These are teaching toggles only.",
  ],
  simplified: "Chylomicrons and their remnants, IDL detail, bile acid loss and medicines that act on it, lipoprotein(a), triglyceride pathways in detail, receptor genetics beyond the single faulty receptor idea, drug choice, combinations and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.li-box{fill:var(--c-tis);opacity:.5}
.li-cap{text-anchor:middle}
.li-blood{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.li-gut{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 65%,#000);stroke-width:1.2}
.li-liver{fill:color-mix(in srgb,#d97a56 52%,var(--c-tis));stroke:color-mix(in srgb,#d97a56 60%,#000);stroke-width:1.2}
.li-periph{fill:color-mix(in srgb,#7fc4e8 26%,var(--c-tis));stroke:color-mix(in srgb,#7fc4e8 55%,#000);stroke-width:1}
.li-enz{fill:#ffd24a;stroke:#9a7a1f;stroke-width:1}
.li-trans{fill:#3ddc97;stroke:#147a52;stroke-width:.8}
.li-rec{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round}
.li-recbad{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.li-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.li-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.cl-tiss{--cc:#7fc4e8}
.p-chol{--cc:#ffd24a}.p-vldl{--cc:#e6c85a}.p-ldl{--cc:#f08a4b}.p-hdl{--cc:#38d1ff}.p-pcsk{--cc:#c084fc}
.dr-g-fill.g-ldl{fill:#f08a4b}.dr-g-fill.g-hdl{fill:#38d1ff}.dr-g-fill.g-rec{fill:var(--c-good)}.dr-g-fill.g-prod{fill:#e6c85a}
`,
});
