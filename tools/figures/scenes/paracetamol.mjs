/* Paracetamol and N-acetylcysteine as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/paracetamol.mjs [--print-model]
 * Static layout here; particles, thermostat and gauges move in paracetamol.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Use and stage", a: [0.45, 1, 1], names: ["therapeutic use", "overdose", "treated overdose"], ticks: ["therapeutic", "overdose", "treated overdose"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "N-acetylcysteine" },
    { label: "charcoal early" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "N-acetylcysteine", "charcoal early"],
};
function modelOf(S, level, drug) {
  const LOOKUP = { charF: [0.5, 0.5, 0.9], nacBoost: [0.65, 0.65, 0.65], late: [0, 0, 0.1] };
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const nac = drug === 1 ? 1 : 0, chr = drug === 2 ? 1 : 0;
  const D = cl(a * (chr ? LOOKUP.charF[level] : 1));
  const cent = cl(D * 2);
  const periph = cl(cent * 0.3);
  const pain = cl(0.92 - 0.68 * cent);
  const fever = cl(0.85 - 0.62 * cent);
  const inflam = cl(0.78 - 0.2 * periph);
  const prod = cl(0.14 * D + 1.09 * Math.max(0, D - 0.55));
  const gsh = cl(1 - 1.05 * prod - LOOKUP.late[level] + (nac ? LOOKUP.nacBoost[level] : 0));
  const freeN = cl(prod - 0.62 * gsh);
  const inj = cl(freeN * 1.45 + (level === 2 ? freeN * 0.35 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(pain, 0.35, 0.62, ["eased", "partly eased", "still present"]), w(freeN, 0.12, 0.38, ["none", "some", "high"]), w(gsh, 0.3, 0.65, ["depleted", "low", "ample"]), w(inj, 0.2, 0.55, ["none", "some", "widespread"])];
  return { a, nac, chr, D, cent, periph, pain, fever, inflam, prod, gsh, freeN, inj, words, readout: "pain " + words[0] + " · free NAPQI " + words[1] + " · glutathione " + words[2] + " · liver injury " + words[3] };
}
const TESTS = [
  [0, 0, "pain eased · free NAPQI none · glutathione ample · liver injury none"],
  [1, 0, "pain eased · free NAPQI high · glutathione low · liver injury widespread"],
  [1, 1, "pain eased · free NAPQI none · glutathione ample · liver injury none"],
  [2, 1, "pain eased · free NAPQI none · glutathione ample · liver injury none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="pm-panel" x="30" y="76" width="400" height="180" rx="14"/>
<rect class="pm-panel" x="450" y="76" width="480" height="180" rx="14"/>
<rect class="pm-panel" x="30" y="290" width="900" height="150" rx="14"/>
<text class="sc-zone" x="34" y="68">CENTRAL ACTION</text>
<text class="sc-zone" x="470" y="68">PERIPHERY</text>
<text class="sc-zone" x="34" y="282">LIVER AND RESCUE</text>
<circle class="pm-hypo" cx="115" cy="150" r="36"/>
<path class="pm-arc" d="M92 138 A26 26 0 0 1 138 138"/>
<line id="thermoNeedle" x1="115" y1="150" x2="115" y2="128" class="pm-needle"/>
<circle class="pm-hub" cx="115" cy="150" r="4"/>
<circle id="hypoGlow" class="pm-glow" cx="115" cy="150" r="42" opacity="0"/>
<circle class="pm-enz" cx="250" cy="140" r="24"/>
<text class="sc-lab" x="250" y="144" text-anchor="middle">COX</text>
<circle id="am404Glow" class="pm-glow2" cx="250" cy="215" r="24" opacity="0"/>
<circle class="pm-am" cx="250" cy="215" r="18"/>
<text class="sc-lab" x="250" y="219" text-anchor="middle">AM404</text>
<path id="descPath" class="pm-desc" d="M350 172 L350 226"/>
<polygon class="pm-arrow" points="350,238 344,226 356,226"/>
<rect id="painGate" class="pm-gate" x="312" y="238" width="76" height="14" rx="7"/>
<circle class="pm-neuron" cx="350" cy="150" r="22"/>
<circle class="pm-nuc" cx="350" cy="150" r="8"/>
<ellipse class="pm-tiss" cx="580" cy="165" rx="72" ry="48"/>
<ellipse class="pm-tissIn" cx="580" cy="165" rx="44" ry="28"/>
<circle class="pm-enz" cx="730" cy="140" r="24"/>
<text class="sc-lab" x="730" y="144" text-anchor="middle">COX</text>
<path class="pm-nerve" d="M652 180 C730 205 790 200 838 192"/>
<circle class="pm-nerveEnd" cx="845" cy="190" r="12"/>
<circle class="pm-gut" cx="80" cy="365" r="28"/>
<g id="charDots" opacity="0"><circle class="pm-char" cx="68" cy="355" r="5"/><circle class="pm-char" cx="84" cy="362" r="6"/><circle class="pm-char" cx="74" cy="376" r="5"/><circle class="pm-char" cx="92" cy="378" r="4"/></g>
<circle class="pm-para" cx="170" cy="365" r="24"/>
<text class="sc-lab" x="170" y="369" text-anchor="middle">drug</text>
<path class="pm-lane" d="M194 352 L276 336"/>
<path class="pm-lane" d="M194 378 L276 392"/>
<circle class="pm-safe" cx="300" cy="332" r="20"/>
<text class="sc-lab" x="300" y="336" text-anchor="middle">safe</text>
<circle class="pm-enz" cx="300" cy="395" r="19"/>
<text class="sc-lab" x="300" y="399" text-anchor="middle">CYP</text>
<polygon id="napqiNode" class="pm-napqi" points="430,372 452,395 430,418 408,395"/>
<text class="sc-lab" x="430" y="399" text-anchor="middle">N</text>
<rect class="pm-tank" x="640" y="308" width="190" height="34" rx="9"/>
<rect id="gshFill" class="pm-tankFill" x="646" y="314" width="178" height="22" rx="6"/>
<g id="nacNode"><circle class="pm-nac" cx="720" cy="395" r="22"/><text class="sc-lab" x="720" y="399" text-anchor="middle">NAC</text></g>
<rect id="liverGlow" class="pm-liverGlow" x="500" y="318" width="110" height="94" rx="12" opacity="0"/>
<g id="heps"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "paracetamol-mechanism-nac-rescue", fig: "Fig 1", title: "Paracetamol: central action, NAPQI and N-acetylcysteine rescue", W, H, body,
  label: "An animated scene for paracetamol and N-acetylcysteine. In the brain, weak central cyclo-oxygenase inhibition, serotonergic descending pathways and the cannabinoid related product AM404 ease pain, and hypothalamic action lowers the temperature set point, while peripheral anti-inflammatory action stays minimal. In the liver a small fraction becomes NAPQI. In overdose glutathione is depleted and free NAPQI injures hepatocytes. N-acetylcysteine restores glutathione and detoxifies NAPQI, and charcoal early reduces absorption from the gut.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "paracetamol.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How paracetamol eases pain and fever.</strong> Paracetamol is a central analgesic and antipyretic with weak peripheral cyclo-oxygenase effect. Teaching describes central cyclo-oxygenase inhibition, activation of serotonergic descending inhibitory pathways, and action through the cannabinoid system by its product AM404. Action in the hypothalamus lowers the raised temperature set point in fever. Peripheral anti-inflammatory effect is minimal, so swelling at an inflamed site changes little. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Overdose and rescue.</strong> A small fraction of paracetamol is converted to the reactive product NAPQI, normally detoxified by glutathione. In overdose glutathione is depleted, free NAPQI accumulates and injures hepatocytes. N-acetylcysteine restores glutathione and helps detoxify NAPQI. Activated charcoal in the gut, given early, reduces absorption. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
  ],
  simplified: "Exact enzyme isoforms and brain sites, other metabolic pathways, absorption and blood level timing, risk assessment, kidney injury and liver failure management, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pm-panel{fill:color-mix(in srgb,var(--anatomy-paper) 55%,transparent);stroke:var(--anatomy-faint);stroke-width:1}
.pm-hypo{fill:#e8a33d;stroke:color-mix(in srgb,#e8a33d 55%,#000);stroke-width:1.2}
.pm-arc{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.pm-needle{stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.pm-hub{fill:var(--anatomy-strong)}
.pm-glow{fill:none;stroke:#3ddc97;stroke-width:3}
.pm-glow2{fill:none;stroke:#38d1ff;stroke-width:3}
.pm-enz{fill:#7fc4e8;stroke:color-mix(in srgb,#7fc4e8 55%,#000);stroke-width:1.2}
.pm-am{fill:#38d1ff;stroke:color-mix(in srgb,#38d1ff 55%,#000);stroke-width:1.2}
.pm-desc{fill:none;stroke:#b7a1e6;stroke-width:3;stroke-linecap:round}
.pm-arrow{fill:#b7a1e6}
.pm-gate{fill:#b7a1e6;stroke:color-mix(in srgb,#b7a1e6 55%,#000);stroke-width:1}
.pm-neuron{fill:#b7a1e6;stroke:color-mix(in srgb,#b7a1e6 55%,#000);stroke-width:1.2}
.pm-nuc{fill:color-mix(in srgb,#b7a1e6 45%,#1a1030)}
.pm-tiss{fill:#e59a88;stroke:color-mix(in srgb,#e59a88 55%,#000);stroke-width:1.2}
.pm-tissIn{fill:color-mix(in srgb,#e59a88 65%,#fff);stroke:none}
.pm-nerve{fill:none;stroke:#e9b84a;stroke-width:2.5;stroke-linecap:round}
.pm-nerveEnd{fill:#e9b84a;stroke:color-mix(in srgb,#e9b84a 55%,#000);stroke-width:1}
.pm-gut{fill:#f08a4b;stroke:color-mix(in srgb,#f08a4b 55%,#000);stroke-width:1.2}
.pm-char{fill:#2b2b30;stroke:#000;stroke-width:.6}
.pm-para{fill:#f2d27a;stroke:color-mix(in srgb,#f2d27a 55%,#000);stroke-width:1.2}
.pm-lane{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.pm-safe{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 55%,#000);stroke-width:1.2}
.pm-napqi{fill:#e5484d;stroke:color-mix(in srgb,#e5484d 55%,#000);stroke-width:1.2}
.pm-tank{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.1}
.pm-tankFill{fill:#3ddc97}
.pm-nac{fill:#5ec1a0;stroke:color-mix(in srgb,#5ec1a0 55%,#000);stroke-width:1.2}
.pm-liverGlow{fill:none;stroke:#e5484d;stroke-width:3}
.cl-hep{--cc:#d97a68}
.p-para{--cc:#f2d27a}.p-pg{--cc:#ff9a3d}.p-sero{--cc:#b7a1e6}.p-nap{--cc:#e5484d}.p-gsh{--cc:#3ddc97}.p-nacp{--cc:#5ec1a0}.p-charp{--cc:#2b2b30}
.pm-inj{fill:#e5484d;stroke:none}
.dr-g-fill.g-pain{fill:#e5484d}.dr-g-fill.g-fever{fill:#ff9a3d}.dr-g-fill.g-sw{fill:#e59a88}.dr-g-fill.g-nap{fill:#e5484d}.dr-g-fill.g-gsh{fill:#3ddc97}.dr-g-fill.g-inj{fill:#e5484d}
`,
});
