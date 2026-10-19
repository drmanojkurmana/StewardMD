/* Portal hypertension as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/portal.mjs [--print-model]
 * Static layout here; blood, ammonia, ascites fluid, varices and gauges move in portal.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How advanced", a: [0.4, 0.7, 1], names: ["compensated cirrhosis", "clinically significant portal hypertension", "decompensated cirrhosis"], ticks: ["compensated", "significant", "decompensated"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "non-selective beta-blocker" },
    { label: "endoscopic band ligation" },
    { label: "diuretics with salt restriction" },
    { label: "lactulose" },
    { label: "TIPS (shunt stent)" },
    { label: "beta-blocker plus band ligation" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "a beta-blocker", "band ligation", "diuretics with salt restriction", "lactulose", "a TIPS shunt", "a beta-blocker plus band ligation"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const bb = drug === 1 || drug === 6 ? 1 : 0, bl = drug === 2 || drug === 6 ? 1 : 0, di = drug === 3 ? 1 : 0, la = drug === 4 ? 1 : 0, ti = drug === 5 ? 1 : 0;
  const P0 = cl(0.2 + 0.75 * a);
  const P = cl(P0 * (bb ? 0.72 : 1) * (ti ? 0.45 : 1));
  const St = ti ? 0.7 : 0, Sc = Math.min(cl(0.9 * P - 0.1), 1 - St);
  const Vz = cl((1.2 * P - 0.34) * (bl ? 0.2 : 1));
  const Rk = cl(Vz * (0.5 + 0.6 * P));
  const As = cl((1.3 * P - 0.55 + 0.15 * a) * (di ? 0.25 : 1) * (ti ? 0.7 : 1));
  const Sp = cl(P - 0.05);
  const g = la ? 0.35 : 1, sh = Sc + St, Ld = 0.15 + 0.3 * a;
  const Am = cl(g * (sh + (1 - sh) * Ld) * (0.5 + 0.5 * a));
  const E = cl(1.15 * Am - 0.2);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.35, 0.7, ["lowered", "raised", "very high"]), w(Rk, 0.22, 0.45, ["low", "moderate", "high"]), w(As, 0.25, 0.6, ["little", "moderate", "large"]), w(E, 0.3, 0.6, ["minimal", "mild", "overt"]), w(Sp, 0.45, 0.75, ["normal", "enlarged", "very large"])];
  return { a, bb, bl, di, la, ti, P, Sc, St, Vz, Rk, As, Sp, g, Am, E, Ld, words, readout: "portal pressure " + words[0] + " · variceal bleeding risk " + words[1] + " · ascites " + words[2] + " · encephalopathy " + words[3] };
}
const TESTS = [
  [1, 0, "portal pressure very high · variceal bleeding risk high · ascites moderate · encephalopathy mild"],
  [1, 1, "portal pressure raised · variceal bleeding risk moderate · ascites little · encephalopathy mild"],
  [1, 2, "portal pressure very high · variceal bleeding risk low · ascites moderate · encephalopathy mild"],
  [1, 6, "portal pressure raised · variceal bleeding risk low · ascites little · encephalopathy mild"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="170" height="190" rx="16"/>
<rect class="sc-tissue" x="14" y="250" width="170" height="190" rx="16"/>
<rect class="sc-tissue" x="310" y="108" width="282" height="110" rx="16" opacity="0.7"/>
<rect class="sc-tissue" x="300" y="224" width="270" height="216" rx="16"/>
<rect class="sc-tissue" x="600" y="44" width="170" height="190" rx="16"/>
<rect class="sc-tissue" x="780" y="44" width="166" height="190" rx="16"/>
<rect class="sc-tissue" x="580" y="286" width="366" height="154" rx="16"/>
<text class="sc-zone" x="32" y="68">SPLEEN</text><text class="sc-zone" x="32" y="274">GUT</text><text class="sc-zone" x="322" y="128">TREATMENT, WHEN GIVEN</text>
<text class="sc-zone" x="318" y="244">LIVER</text><text class="sc-zone" x="614" y="68">OESOPHAGUS</text><text class="sc-zone" x="798" y="68">BRAIN</text><text class="sc-zone" x="598" y="308">ABDOMEN</text>
<text class="sc-lab" x="884" y="276">to heart</text>
<g id="fluid"></g>
<path id="v-portal" class="pv-v" d="M140 402L250 348L400 411"/>
<path id="v-spl" class="pv-v" d="M94 165L150 205L250 348"/>
<path id="v-coll" class="pv-v pv-coll" d="M250 348L258 300L262 200L262 110L300 96L610 96L700 57L700 232L879 250"/>
<path id="v-hep" class="pv-v" d="M412 225L590 250L940 250"/>
<path id="v-brain" class="pv-v" d="M879 250L879 193"/>
<g id="organs"></g><rect id="bleedtint" class="pv-bleed" x="668" y="80" width="64" height="146" rx="20" opacity="0"/><g id="vari"></g><g id="tr"></g>
<g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.pv-v{fill:none;stroke:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round;stroke-linejoin:round}
.pv-coll{stroke:color-mix(in srgb,#9a5fd0 38%,var(--anatomy-paper));stroke-width:3}
.pv-bleed{fill:var(--c-bad)}
.pv-brain{fill:color-mix(in srgb,#b8a0d8 35%,var(--anatomy-paper));stroke:#9a82c0;stroke-width:1.4}
.pv-brainl{fill:none;stroke:#9a82c0;stroke-width:1.1;opacity:.6}
.cl-cirr{--cc:#a8604f}.cl-spl{--cc:#8e5a8f}.cl-ast{--cc:#8fd0c0}
.pv-nod{fill:#c98168;stroke:#7a3e30;stroke-width:1}
.pv-fib{fill:none;stroke:#f1e4c8;stroke-width:2.2;stroke-linecap:round}
.pv-sin{fill:none;stroke:color-mix(in srgb,var(--c-fl) 45%,#a8604f);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
.pv-stent{fill:none;stroke:#2fc2a3;stroke-width:13;stroke-linecap:round}
.pv-mesh{fill:none;stroke:var(--anatomy-paper);stroke-width:11;stroke-dasharray:2 5}
.pv-vx{fill:#8a2f5e;stroke:#5a1a3c;stroke-width:1.2}
.pv-band{fill:none;stroke:#2fc2a3;stroke-width:2.4}
.pv-ic{fill:color-mix(in srgb,#2fc2a3 38%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.4}
.pv-ring{fill:none;stroke:#2fc2a3;stroke-width:1.8}
.pv-stop{fill:none;stroke:var(--c-bad);stroke-width:1.8}
.pv-plt{fill:#f2d27a;stroke:#b8902a;stroke-width:.6}
.pv-pool{fill:var(--c-fl)}.pv-surf{fill:none;stroke:var(--c-fl);stroke-width:2}
.p-bl{--cc:var(--c-rbc)}.p-am{--cc:#c9e04a}.p-blood{fill:var(--c-bad)}.p-nh4{--cc:#2fc2a3}.p-sig{--cc:#9a5fd0}
.pv-cap{fill:var(--anatomy-strong);font-size:12px}
.pv-rec{fill:color-mix(in srgb,#2fc2a3 45%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.4;opacity:.75}
.pv-block{fill:color-mix(in srgb,#2fc2a3 60%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.2}
.pv-vx.is-band{fill:#4a2436}
.dr-g-fill.g-pp{fill:#9a5fd0}.dr-g-fill.g-vx{fill:var(--c-bad)}.dr-g-fill.g-as{fill:var(--c-fl)}.dr-g-fill.g-spl{fill:#8e5a8f}.dr-g-fill.g-he{fill:#c9e04a}
`;

buildScene({
  id: "portal-hypertension", fig: "Fig 1", title: "Portal hypertension: what goes wrong", W, H, body, extraCss,
  label: "An animated map of portal hypertension in cirrhosis. A scarred, nodular liver resists blood coming from the gut and spleen through the portal vein, so pressure in the portal system rises. Blood finds detours, called portosystemic collaterals, including swollen veins in the lower oesophagus (varices) that can bleed. Fluid weeps into the abdomen as ascites, the spleen enlarges, and ammonia from the gut that bypasses the liver reaches the brain and causes hepatic encephalopathy. Treatment choices are a beta-blocker, band ligation, the two together, diuretics, lactulose or a TIPS shunt, with gauges for portal pressure, variceal bleeding risk, ascites, spleen size and encephalopathy.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H },
  pageJs: readFileSync(join(HERE, "portal.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With beta-blocker plus band ligation",
  sourcesLis: [
    "<strong>How portal hypertension develops.</strong> In cirrhosis, scarring and regenerating nodules narrow the liver's sinusoids and the liver's blood vessels also constrict, so resistance to portal flow rises. Widening of the splanchnic arteries then increases inflow, which keeps portal pressure high. Blood is diverted through portosystemic collaterals (for example gastro-oesophageal varices) that bypass the liver. Consequences shown: variceal bleeding, ascites (high pressure in the gut capillaries, low albumin, and renal sodium and water retention), splenic congestion with enlargement and low platelets (hypersplenism), and hepatic encephalopathy as ammonia and other gut-derived toxins reach the brain without being cleared. This is standard teaching in hepatology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A non-selective beta-blocker lowers portal inflow and so portal pressure, and is used to prevent first bleeding or rebleeding. Endoscopic band ligation strangles the varices but does not lower portal pressure. Diuretics with salt restriction clear ascites without treating the pressure itself. Lactulose reduces the gut's ammonia load and treats or prevents encephalopathy. A TIPS (transjugular intrahepatic portosystemic shunt) is a stent from portal to hepatic vein that lowers portal pressure and treats refractory ascites or bleeding that other measures do not control, but it sends more ammonia past the liver and can worsen encephalopathy. The figure shows the direction of each effect, not how much to give, when, or who qualifies.",
  ],
  simplified: "Causes of cirrhosis, pre-hepatic and post-hepatic portal hypertension, gastric varices, portal hypertensive gastropathy, vasoactive drugs and antibiotics in acute bleeding, hepatorenal syndrome, spontaneous bacterial peritonitis, hepatocellular carcinoma, albumin, rifaximin, liver transplantation and all doses, targets and measurements are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
