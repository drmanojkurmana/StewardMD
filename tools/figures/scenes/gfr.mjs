/* Renal filtration and the glomerular filtration rate as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gfr.mjs [--print-model]
 * Static layout here; blood, filtrate, pressure arrows and gauges move in gfr.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Arteriole tone", a: [0, 1, 2], names: ["afferent constricted", "normal", "efferent constricted"], ticks: ["afferent tight", "normal", "efferent tight"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "NSAID (blocks prostaglandins)" },
    { label: "ACE inhibitor (blocks angiotensin II)" },
  ],
  status: "Arteriole tone: {level} · {drug} ·",
  drugNames: ["no treatment", "an NSAID", "an ACE inhibitor"],
};
function modelOf(S, level, drug) {
  const cl = (v, a, b) => Math.max(a === undefined ? 0 : a, Math.min(b === undefined ? 1 : b, v));
  const aBase = [0.85, 0.45, 0.45][level], eBase = [0.45, 0.45, 0.85][level];
  const nsaid = drug === 1 ? 1 : 0, acei = drug === 2 ? 1 : 0;
  const aRes = cl(aBase + 0.25 * nsaid, 0.12, 1.05), eRes = cl(eBase - 0.28 * acei, 0.12, 1.05);
  const RPF = cl(1.05 - 0.35 * (aRes + eRes));
  const Pgc = cl(0.55 + 0.30 * (eRes - 0.45) - 0.32 * (aRes - 0.45));
  const Pbc = cl(0.34 + 0.05 * (1 - RPF));
  const Onc = cl(0.36 + 0.18 * (1 - RPF));
  const GFR = cl(1.8 * (Pgc - 0.15) * (0.45 + 0.55 * RPF));
  const FF = cl(GFR / (RPF * 1.35 + 0.05));
  const TGF = cl(GFR);
  const affCal = cl(1.08 - aRes), effCal = cl(1.08 - eRes);
  const PG = nsaid ? 0.08 : 0.75, Ang = acei ? 0.1 : level === 2 ? 0.85 : 0.5;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Pgc, 0.48, 0.60, ["low", "normal", "high"]), w(GFR, 0.42, 0.62, ["low", "normal", "high"]), w(RPF, 0.60, 0.78, ["low", "normal", "high"]), w(FF, 0.52, 0.72, ["low", "normal", "high"])];
  return { aRes, eRes, RPF, Pgc, Pbc, Onc, GFR, FF, TGF, affCal, effCal, PG, Ang, nsaid, acei, words, readout: "glomerular pressure " + words[0] + " · filtration " + words[1] + " · plasma flow " + words[2] + " · filtration fraction " + words[3] };
}
const TESTS = [
  [1, 0, "glomerular pressure normal · filtration normal · plasma flow normal · filtration fraction normal"],
  [0, 0, "glomerular pressure low · filtration low · plasma flow low · filtration fraction low"],
  [2, 0, "glomerular pressure high · filtration high · plasma flow low · filtration fraction high"],
  [0, 1, "glomerular pressure low · filtration low · plasma flow low · filtration fraction low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">RENAL CORPUSCLE AND TUBULE</text>
<g id="vess"></g><g id="caps"></g><g id="tub"></g><g id="arrows"></g>
<g id="rbcs"></g><g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-pgc:#e5484d;--c-onc:#9a6ae0;--c-pbc:#3fa0d4;--c-tub:#e9a2b3;--c-md:#e9b84a;--c-pg:#3ddc97;--c-ang:#f08a4b}
body[data-theme="light"]{--c-pgc:#c42a3d;--c-onc:#7c4fc4;--c-pbc:#2f7ad8;--c-tub:#d9788f;--c-md:#b8860b;--c-pg:#0f9f76;--c-ang:#d96a25}
.gf-vess{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 62%,var(--anatomy-mid));stroke-linecap:round}
.gf-vessin{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 18%,var(--anatomy-paper));stroke-linecap:round}
.gf-caps{fill:color-mix(in srgb,var(--c-fl) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 60%,var(--anatomy-mid));stroke-width:2.4}
.gf-tuft{fill:color-mix(in srgb,var(--c-rbc) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-mid));stroke-width:1.6}
.gf-coil{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 48%,var(--anatomy-paper));stroke-width:5;stroke-linecap:round;opacity:.7}
.gf-bar1{fill:none;stroke:var(--c-endo);stroke-width:3;stroke-linecap:round}
.gf-bar2{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.gf-bar3{fill:none;stroke:var(--c-md);stroke-width:3;stroke-linecap:round}
.gf-tubw{fill:none;stroke:color-mix(in srgb,var(--c-tub) 65%,var(--anatomy-mid));stroke-linecap:round;stroke-linejoin:round}
.gf-tubl{fill:none;stroke:color-mix(in srgb,var(--c-fl) 22%,var(--anatomy-paper));stroke-linecap:round;stroke-linejoin:round}
.gf-mdot{fill:var(--c-md);stroke:color-mix(in srgb,var(--c-md) 50%,#000);stroke-width:.6}
.gf-arr-pgc{fill:none;stroke:var(--c-pgc);stroke-width:2.4}
.gf-arr-onc{fill:none;stroke:var(--c-onc);stroke-width:2.4}
.gf-arr-pbc{fill:none;stroke:var(--c-pbc);stroke-width:2.4}
.gf-fb{fill:none;stroke:var(--c-md);stroke-width:1.8;stroke-dasharray:5 4}
.p-filt2{fill:var(--c-fl)}
.p-pg{fill:var(--c-pg);stroke:color-mix(in srgb,var(--c-pg) 50%,#000);stroke-width:.5}
.p-ang{fill:var(--c-ang);stroke:color-mix(in srgb,var(--c-ang) 50%,#000);stroke-width:.5}
.dr-g-fill.g-pgc{fill:var(--c-pgc)}.dr-g-fill.g-onc{fill:var(--c-onc)}.dr-g-fill.g-pbc{fill:var(--c-pbc)}
`;

buildScene({
  id: "renal-filtration-gfr", fig: "Fig 1", title: "Renal filtration: what sets the glomerular filtration rate", W, H, body, extraCss,
  label: "An animated renal corpuscle. Blood enters the glomerular tuft through the afferent arteriole and leaves through the efferent arteriole. Glomerular capillary hydrostatic pressure pushes filtrate across the filtration barrier into Bowman space, while plasma oncotic pressure and Bowman capsule pressure oppose it. Filtrate then flows along the tubule. The distal tubule passes the arteriole pole as the macula densa, sending a tubuloglomerular feedback signal that adjusts afferent tone. Tightening the afferent arteriole lowers glomerular pressure and filtration, while tightening the efferent arteriole raises glomerular pressure and filtration fraction but lowers plasma flow. An NSAID removes prostaglandin support of the afferent arteriole, and an ACE inhibitor removes angiotensin II tightening of the efferent arteriole. Gauges show glomerular pressure, Bowman pressure, oncotic pressure, filtration, plasma flow and filtration fraction.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "gfr.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "No treatment", withLabel: "With ACE inhibitor",
  sourcesLis: [
    "<strong>How filtration is set.</strong> The glomerulus is a tuft of capillaries between two arterioles. Filtration across its barrier (capillary endothelium, basement membrane and podocytes) is driven by the balance of pressures: glomerular capillary hydrostatic pressure favours filtration, while Bowman capsule pressure and the oncotic pressure of plasma proteins oppose it. The net filtration pressure, the area and permeability of the barrier, and the plasma flow together set the glomerular filtration rate (GFR). This is standard physiology teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Autoregulation and tubuloglomerular feedback.</strong> Across a range of arterial pressures the kidney holds renal blood flow and GFR nearly steady: the afferent arteriole responds directly to stretch (the myogenic response), and the macula densa, a plaque of distal tubule cells at the vascular pole, senses sodium chloride delivery. When delivery rises it signals the afferent arteriole to tighten and filtration to fall; when delivery falls the afferent arteriole relaxes and renin release supports efferent tone. Prostaglandins help keep the afferent arteriole open when perfusion is threatened, and angiotensin II preferentially tightens the efferent arteriole to hold glomerular pressure up. Flagged for review.",
    "<strong>Afferent versus efferent tightening, and the two drug classes.</strong> Afferent constriction lowers glomerular pressure, plasma flow and GFR. Efferent constriction raises glomerular pressure and GFR for a while but lowers plasma flow, so the filtration fraction rises. An NSAID blocks prostaglandin production and so removes afferent dilation, which can drop GFR sharply when perfusion already depends on it. An ACE inhibitor blocks angiotensin II formation and so releases efferent tightening, lowering glomerular pressure and GFR, an effect that protects an overloaded glomerulus but can drop filtration when afferent inflow is poor. These are teaching toggles only.",
  ],
  simplified: "Changes in barrier area and permeability, glomerular disease, the full renin and angiotensin cascade, sympathetic and hormonal control, the differing effects along the length of the capillary as oncotic pressure rises, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
