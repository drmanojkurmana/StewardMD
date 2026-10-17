/* Coagulation cascade, platelet plug and DIC as an animated, working scene. Original drawing.
 *   node tools/figures/scenes/coag.mjs [--print-model]
 * Layout and model here; platelets, fibrin, the cascade, small vessels and gauges move in coag.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How big is the trigger", a: [0, 1, 2], names: ["local injury", "extensive tissue injury", "massive systemic trigger (DIC)"], ticks: ["local injury", "extensive injury", "systemic (DIC)"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "heparin (works through antithrombin on Xa and thrombin)" },
    { label: "warfarin (fewer vitamin K factors II, VII, IX, X)" },
    { label: "direct oral anticoagulant (blocks Xa or thrombin)" },
    { label: "antiplatelet (blocks platelet activation or aggregation)" },
    { label: "replace factors and platelets, treat the cause" },
  ],
  status: "Trigger: {level} · {drug} ·",
  drugNames: ["no treatment", "heparin", "warfarin", "direct oral anticoagulant", "antiplatelet", "replacement and treating the cause"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const hep = drug === 1 ? 1 : 0, warf = drug === 2 ? 1 : 0, doac = drug === 3 ? 1 : 0, apl = drug === 4 ? 1 : 0, cause = drug === 5 ? 1 : 0;
  const T0 = [0.5, 0.78, 1][level], dic = [0, 0.3, 1][level];
  const T = T0 * (cause ? 0.3 : 1);                                  // trigger drive after the cause is treated
  const F = cause ? 0.95 : 1 - 0.65 * warf;                           // level of the vitamin K factors II VII IX X
  const ext = cl(T * F), intr = cl(T * (0.55 + 0.45 * dic) * F);
  const X = cl((ext + intr) / 1.3) * F * (1 - 0.55 * hep) * (1 - 0.75 * doac);
  const thr = cl(X * F * (1 - 0.7 * hep) * (1 - 0.75 * doac));
  const pl = cl(T0 * (cause ? 0.5 : 1) * (1 - 0.7 * apl));            // platelet plug at the injury
  const Cf = cl(0.55 * thr + 0.45 * pl);                               // clot formation at the injury
  const M = cl(dic * (cause ? 0.15 : 1) * (1 - 0.35 * (hep + doac) * 0.5));   // widespread microthrombi
  const Pl = cl(1 - 0.75 * M + (cause ? 0.3 : 0)), Fg = cl(1 - 0.8 * M + (cause ? 0.35 : 0));
  const D = hep * 0.8 + warf * 0.9 + doac * 0.85 + apl * 0.45;
  const Bl = cl(0.08 + 0.4 * (1 - Pl) + 0.4 * (1 - Fg) + 0.4 * D);
  const Th = cl(0.1 + 0.5 * M * (1 - 0.35 * (hep + doac)) + 0.4 * T * (1 - 0.85 * Math.max(hep, warf, doac, apl * 0.7)));
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(Cf, 0.3, 0.62, ["weak", "forming", "strong"]), w(Math.min(Pl, Fg), 0.4, 0.75, ["depleted", "reduced", "normal"]), w(Bl, 0.32, 0.58, ["low", "raised", "high"])];
  return { T, F, ext, intr, X, thr, pl, Cf, M, dic, Pl, Fg, Bl, Th, hep, warf, doac, apl, cause, words, readout: "clot " + words[0] + " · platelets and fibrinogen " + words[1] + " · bleeding risk " + words[2] };
}
const TESTS = [
  [0, 0, "clot forming · platelets and fibrinogen normal · bleeding risk low"],
  [2, 0, "clot strong · platelets and fibrinogen depleted · bleeding risk high"],
  [0, 2, "clot weak · platelets and fibrinogen normal · bleeding risk raised"],
  [2, 5, "clot forming · platelets and fibrinogen normal · bleeding risk low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="462" height="396" rx="18"/>
<rect class="sc-tissue" x="486" y="44" width="460" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">INJURY SITE</text>
<text class="sc-zone" x="506" y="68">CLOTTING CASCADE</text>
<g id="inj"></g><g id="mini"></g><g id="casc"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "coagulation-dic", fig: "Fig 1", title: "Clotting: plug, cascade and DIC", W, H, body,
  label: "An animated blood vessel with a break in its lining. Platelets stick, change shape and clump into a plug, while the clotting cascade turns fibrinogen into a fibrin mesh. A second small vessel shows what happens when the trigger is systemic: widespread micro-clots use up platelets and clotting factors and then bleeding follows (DIC). Gauges show clot formation, platelets, fibrinogen, bleeding risk and clotting risk. Treatment choices include heparin, warfarin, a direct oral anticoagulant, an antiplatelet drug, and replacing factors while treating the cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, laboratory values or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "coag.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How a clot forms.</strong> When the vessel lining breaks, collagen and tissue factor are exposed. Platelets stick through von Willebrand factor (primary haemostasis), activate and clump through fibrinogen bridges (GPIIb/IIIa) into a plug. At the same time the clotting cascade runs: tissue factor with factor VIIa (extrinsic arm, tested by PT), the contact factors XII, XI, IX with VIII (intrinsic arm, tested by aPTT), both feeding factor X with V (common arm) to make thrombin. Thrombin turns fibrinogen into fibrin and factor XIII cross-links it. Plasmin later dissolves the clot (fibrinolysis), releasing D-dimer. This is standard teaching in medicine, haematology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>DIC.</strong> A massive trigger (for example severe sepsis or an obstetric catastrophe) switches clotting on everywhere. Micro-clots block small vessels, and platelets and clotting factors are consumed faster than they are made, so the same patient can clot and bleed. Treating the cause matters most.",
    "<strong>Treatment ideas shown.</strong> Heparin acts through antithrombin on Xa and thrombin, warfarin lowers the vitamin K factors II, VII, IX and X, direct oral anticoagulants block Xa or thrombin, antiplatelet drugs block platelet activation or aggregation, and replacement restores what was used up. These are teaching toggles only.",
  ],
  simplified: "The cell-based model of coagulation, natural anticoagulants (protein C, protein S, antithrombin), contact-activation detail, inherited bleeding and clotting disorders, laboratory interpretation, reversal agents, monitoring, targets and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sc-lum{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper))}
.cg-col{fill:none;stroke:color-mix(in srgb,var(--c-neut) 55%,var(--anatomy-paper));stroke-width:2.4;stroke-linecap:round}
.cg-tf{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 50%,#000);stroke-width:.6}
.cg-vwf{stroke:var(--anatomy-hi);stroke-width:1.2;stroke-linecap:round}
.cg-link{stroke:var(--c-ab);stroke-width:1.4}
.cg-fib{fill:none;stroke:color-mix(in srgb,var(--c-plt) 55%,var(--anatomy-paper));stroke-width:1.1;stroke-linecap:round}
.cg-spike{fill:none;stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1;stroke-linecap:round}
.p-dd{fill:color-mix(in srgb,var(--c-neut) 70%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.5}
.p-plm{fill:var(--c-good)}
.p-bl{fill:var(--c-rbc)}
.cg-node{fill:color-mix(in srgb,var(--c-cyt) calc(var(--act,0) * 55%),var(--anatomy-card));stroke:var(--anatomy-mid);stroke-width:1.1}
.cg-nt{fill:var(--anatomy-strong);font:600 10.5px var(--anatomy-mono);pointer-events:none}
.cg-vk{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 50%,#000);stroke-width:.5}
.cg-vkt{fill:#1a1030;font:700 7.5px var(--anatomy-mono);pointer-events:none}
.cg-ar{fill:none;stroke:color-mix(in srgb,var(--c-cyt) 70%,var(--anatomy-mid));stroke-width:1.8;stroke-dasharray:5 4;stroke-linecap:round}
.cg-fb{fill:none;stroke:var(--c-neut);stroke-width:1.3;stroke-dasharray:3 4}
.cg-br{fill:none;stroke-width:3;stroke-linecap:round}.cg-br.pt{stroke:var(--c-neut)}.cg-br.ap{stroke:var(--c-lymph)}
.cg-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.cg-xp{stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.cg-wall{fill:color-mix(in srgb,var(--c-endo) 28%,var(--anatomy-paper))}
.cg-thr{fill:color-mix(in srgb,var(--c-plt) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 50%,#000);stroke-width:.8}
.cg-schist{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:.6}
.g-plt{fill:var(--c-neut)}.g-fg{fill:var(--c-fl)}
`,
});
