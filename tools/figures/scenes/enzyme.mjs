/* Enzyme kinetics and inhibition as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/enzyme.mjs [--print-model]
 * Static layout here; substrate, product, inhibitor, curves and gauges move in enzyme.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Inhibitor present", a: [0, 1, 2], names: ["no inhibitor", "competitive inhibitor", "non-competitive inhibitor"], ticks: ["none", "competitive", "non-competitive"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "more substrate" },
    { label: "allosteric modulator" },
  ],
  status: "Inhibitor: {level} · {drug} ·",
  drugNames: ["no treatment", "more substrate", "a modulator"],
};
function modelOf(S, level, drug) {
  const INH = [{ v: 1, k: 1 }, { v: 1, k: 2.7 }, { v: 0.42, k: 1 }];
  const TRT = [{ s: 0.38, v: 1, k: 1 }, { s: 0.95, v: 1, k: 1 }, { s: 0.38, v: 1.7, k: 0.45 }];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const inh = INH[level], trt = TRT[drug];
  const Vmax = Math.min(0.97, 0.86 * inh.v * trt.v);
  const KmF = inh.k * trt.k;
  const KmN = 0.32 * KmF;
  const KmG = cl(0.14 + 0.26 * KmF);
  const Sub = trt.s;
  const SubG = cl(0.12 + 0.88 * Sub);
  const Rate = cl(Vmax * Sub / (KmN + Sub));
  const comp = level === 1 ? 1 : 0, nonc = level === 2 ? 1 : 0;
  const moreSub = drug === 1 ? 1 : 0, modu = drug === 2 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Vmax, 0.55, 0.9, ["low", "usual", "high"]), w(KmG, 0.3, 0.65, ["low", "usual", "high"]), w(Rate, 0.28, 0.52, ["slow", "usual", "fast"])];
  return { Vmax, KmF, KmN, KmG, Sub, SubG, Rate, comp, nonc, moreSub, modu, words, readout: "max rate " + words[0] + " · Km " + words[1] + " · rate " + words[2] };
}
const TESTS = [
  [0, 0, "max rate usual · Km usual · rate usual"],
  [1, 0, "max rate usual · Km high · rate slow"],
  [2, 0, "max rate low · Km usual · rate slow"],
  [2, 2, "max rate usual · Km low · rate usual"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="enz-box" x="28" y="80" width="276" height="210" rx="14"/>
<rect class="enz-box" x="322" y="80" width="308" height="210" rx="14"/>
<rect class="enz-box" x="648" y="80" width="284" height="210" rx="14"/>
<rect id="subWash" class="enz-wash" x="34" y="110" width="264" height="174" rx="12" opacity="0.18"/>
<ellipse id="rateGlow" class="enz-glow" cx="112" cy="182" rx="64" ry="56" opacity="0.15"/>
<rect class="enz-box" x="28" y="306" width="904" height="124" rx="14"/>
<text class="sc-zone" x="42" y="103">AT WORK</text>
<text class="sc-zone" x="336" y="103">MICHAELIS-MENTEN</text>
<text class="sc-zone" x="662" y="103">LINEWEAVER-BURK</text>
<text id="capLine" class="enz-capline" x="34" y="327"></text>
<path class="enz-axis" d="M368 262L368 124M368 262L600 262"/>
<path id="mmFill" class="enz-fill" d="M368 262Z"/>
<path id="mmBase" class="enz-base" d="M368 262L600 180"/>
<path id="mmCur" class="enz-cur" d="M368 262L600 180"/>
<line id="mmVmax" class="enz-dash" x1="368" y1="143" x2="600" y2="143"/>
<circle id="mmKmDot" class="enz-dot" cx="442" cy="203" r="4.5"/>
<circle id="mmOpDot" class="enz-opdot" cx="456" cy="200" r="5"/>
<text class="enz-ax" x="484" y="284" text-anchor="middle">substrate</text>
<text class="enz-ax" x="358" y="196" text-anchor="middle" transform="rotate(-90 358 196)">rate</text>
<path class="enz-axis" d="M692 262L692 124M692 262L900 262"/>
<path id="lbBase" class="enz-base" d="M692 190L900 150"/>
<path id="lbCur" class="enz-lb" d="M692 190L900 150"/>
<circle id="lbInt" class="enz-dot" cx="692" cy="190" r="4.5"/>
<text class="enz-ax" x="796" y="284" text-anchor="middle">1 / substrate</text>
<text class="enz-ax" x="682" y="196" text-anchor="middle" transform="rotate(-90 682 196)">1 / rate</text>
<g id="enzMain"></g>
<g id="vig0"><rect class="enz-vigf" x="140" y="336" width="280" height="58" rx="10"/><circle class="enz-mini" cx="250" cy="365" r="19"/><rect class="enz-inhS" x="257" y="349" width="20" height="12" rx="6"/><circle class="enz-subS" cx="312" cy="365" r="6"/><text class="enz-cap" x="280" y="410" text-anchor="middle">Competitive</text><text class="enz-cap2" x="280" y="423" text-anchor="middle">higher Km, same max rate</text></g>
<g id="vig1"><rect class="enz-vigf" x="540" y="336" width="280" height="58" rx="10"/><circle class="enz-mini" cx="650" cy="365" r="19"/><circle class="enz-subS" cx="650" cy="355" r="6"/><rect class="enz-inhS" x="640" y="376" width="20" height="12" rx="6"/><text class="enz-cap" x="680" y="410" text-anchor="middle">Non-competitive</text><text class="enz-cap2" x="680" y="423" text-anchor="middle">lower max rate, same Km</text></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "enzyme-kinetics-inhibition", fig: "Fig 1", title: "Enzyme kinetics: inhibition and the two plots", W, H, body,
  label: "An animated enzyme converting substrate to product, with a Michaelis-Menten plot and a Lineweaver-Burk reciprocal plot beside it. Without inhibitor the rate rises with substrate to a maximum rate, Vmax, and Km is the substrate level at half that maximum. A competitive inhibitor competes for the active site, so Km rises and Vmax stays the same. A non-competitive inhibitor binds elsewhere, so Vmax falls and Km stays the same. More substrate overcomes competitive inhibition but not non-competitive inhibition. A modulator boosts the enzyme from its own site and raises the maximum rate again. Gauges show max rate, Km, rate now and substrate. A one-line summary inside the figure states what each choice does.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "enzyme.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With modulator",
  sourcesLis: [
    "<strong>How the plots work.</strong> In Michaelis-Menten kinetics the reaction rate rises with substrate and levels off at a maximum rate (Vmax) when the enzyme is saturated. Km is the substrate level that gives half the maximum rate, so a higher Km means more substrate is needed to reach the same rate. The Lineweaver-Burk plot draws the reciprocals (1/rate against 1/substrate) as a straight line, which makes changes in Vmax and Km easier to compare: the line meets the vertical axis at 1/Vmax and its steepness reflects Km. This is standard teaching in biochemistry and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>How inhibitors differ.</strong> A competitive inhibitor resembles the substrate and competes for the active site, so it raises Km and leaves Vmax unchanged, and adding more substrate can overcome it. A non-competitive inhibitor binds at a separate (allosteric) site and distorts the enzyme, so it lowers Vmax and leaves Km unchanged, and more substrate cannot restore the maximum. The modulator toggle is shown as a positive allosteric modulator that raises the maximum rate and lowers Km, helping against either inhibitor. These are teaching toggles only.",
  ],
  simplified: "Uncompetitive inhibition is not shown. Multi-substrate reactions, cooperativity and sigmoidal kinetics, reversible binding steps in detail, enzyme concentration effects, and all doses and assay conditions are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
body{--enz:#e9b84a;--enzsub:#f08a4b;--enzprod:#38b8a8;--enzinh:#e5484d;--enzmod:#3ddc97;--enzcur:#38b8a8;--enzlb:#7fc4e8}
body[data-theme="light"]{--enz:#d99a1f;--enzsub:#e06a25;--enzprod:#0f8f7a;--enzinh:#c42a3d;--enzmod:#0f9f76;--enzcur:#0f8f7a;--enzlb:#3a86b8}
.enz-box{fill:color-mix(in srgb,var(--anatomy-paper) 72%,transparent);stroke:var(--anatomy-faint);stroke-width:1}
.enz-ax{fill:var(--anatomy-text);font-size:11px;pointer-events:none}
.enz-cap{fill:var(--anatomy-strong);font-size:11px;font-weight:600;pointer-events:none}
.enz-cap2{fill:var(--anatomy-text);font-size:11px;pointer-events:none}
.enz-capline{fill:var(--anatomy-strong);font-size:12.5px;font-weight:600;pointer-events:none}
.enz-wash{fill:var(--enzsub);stroke:none}
.enz-glow{fill:var(--enzprod);stroke:none}
.enz-fill{fill:color-mix(in srgb,var(--enzcur) 20%,transparent);stroke:none}
.enz-axis{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.enz-base{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:4 4;opacity:.55}
.enz-cur{fill:none;stroke:var(--enzcur);stroke-width:2.6;stroke-linecap:round}
.enz-lb{fill:none;stroke:var(--enzlb);stroke-width:2.6;stroke-linecap:round}
.enz-dash{stroke:var(--enzcur);stroke-width:1.1;stroke-dasharray:5 4;opacity:.8}
.enz-dot{fill:var(--enzcur);stroke:var(--anatomy-paper);stroke-width:1}
.enz-opdot{fill:var(--enzsub);stroke:var(--anatomy-paper);stroke-width:1}
.cl-enz{--cc:var(--enz)}
.enz-act{fill:var(--anatomy-paper);stroke:color-mix(in srgb,var(--enz) 55%,#000);stroke-width:1}
.enz-site{fill:color-mix(in srgb,var(--enz) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--enz) 55%,#000);stroke-width:.8}
.enz-mini{fill:var(--enz);stroke:color-mix(in srgb,var(--enz) 55%,#000);stroke-width:1}
.enz-subS{fill:var(--enzsub);stroke:color-mix(in srgb,var(--enzsub) 50%,#000);stroke-width:.6}
.enz-inhS{fill:var(--enzinh);stroke:color-mix(in srgb,var(--enzinh) 55%,#000);stroke-width:.6}
.enz-vigf{fill:none;stroke:var(--enzinh);stroke-width:1.6;opacity:0}
.p-sub{--cc:var(--enzsub)}.p-prod{--cc:var(--enzprod)}.p-inhp{--cc:var(--enzinh)}.p-modp{--cc:var(--enzmod)}
.dr-g-fill.g-vmax{fill:var(--enzcur)}.dr-g-fill.g-km{fill:var(--enzlb)}.dr-g-fill.g-rate{fill:var(--enzsub)}.dr-g-fill.g-sub{fill:var(--enz)}
`,
});
