/* Paracetamol and N-acetylcysteine as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/paracetamol.mjs [--print-model]
 * Static layout here; particles, receptor and gauges move in paracetamol.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Dose and timing", a: [0.45, 1, 1], names: ["therapeutic use", "overdose", "late overdose"], ticks: ["therapeutic", "overdose", "late overdose"], start: 0 },
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
<path id="vesselDrug" class="pm-vessel" d="M195 380 L421 330"/>
<path id="vesselBlood" class="pm-vessel" d="M470 185 C530 145 610 145 732 232"/>
<g id="gutSlot"></g>
<g id="liverSlot"></g>
<g id="brainSlot"></g>
<ellipse id="injTint" class="pm-tint" cx="455" cy="255" rx="108" ry="72" opacity="0"/>
<circle id="cyp" class="pm-cyp" cx="300" cy="375" r="10"/>
<rect class="pm-tank" x="365" y="352" width="190" height="34" rx="9"/>
<rect id="gshFill" class="pm-tankFill" x="371" y="358" width="178" height="22" rx="6"/>
<g id="nacNode"><circle class="pm-nac" cx="620" cy="369" r="20"/></g>
<g id="charDots" opacity="0"><circle class="pm-char" cx="130" cy="300" r="5"/><circle class="pm-char" cx="155" cy="312" r="6"/><circle class="pm-char" cx="140" cy="330" r="5"/><circle class="pm-char" cx="165" cy="295" r="4"/></g>
<g id="heps"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "paracetamol-mechanism-nac-rescue", fig: "Fig 1", title: "Paracetamol: central action, NAPQI and N-acetylcysteine rescue", W, H, body,
  label: "An animated scene for paracetamol and N-acetylcysteine. Drug absorbed from the gut travels in blood to the brain, where it blocks central signals so pain eases and fever falls, and to the liver, where a small part becomes NAPQI. In overdose glutathione runs out and free NAPQI injures liver cells. N-acetylcysteine restores glutathione and clears NAPQI, and charcoal given early traps drug in the gut.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "paracetamol.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With N-acetylcysteine",
  sourcesLis: [
    "<strong>How paracetamol eases pain and fever.</strong> Paracetamol is a central analgesic and antipyretic with weak peripheral effect. Teaching describes central action that blocks pain signalling, with descending pathways adding to relief, and action in the hypothalamus that lowers the raised temperature set point in fever. Peripheral anti-inflammatory effect is minimal, so swelling at an inflamed site changes little. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Overdose and rescue.</strong> A small fraction of paracetamol is converted to the reactive product NAPQI, normally cleared by glutathione. In overdose glutathione runs out, free NAPQI accumulates and injures liver cells. N-acetylcysteine restores glutathione and helps clear NAPQI. Activated charcoal in the gut, given early, traps drug and reduces absorption. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
  ],
  simplified: "Exact enzymes and brain sites, other metabolic pathways, absorption and blood level timing, risk assessment, kidney injury and liver failure management, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pm-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:15;stroke-linecap:round;opacity:.8}
.pm-tint{fill:#e5484d;stroke:none}
.pm-tank{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.1}
.pm-tankFill{fill:#3ddc97}
.pm-nac{fill:#5ec1a0;stroke:color-mix(in srgb,#5ec1a0 55%,#000);stroke-width:1.2}
.pm-cyp{fill:#7fc4e8;stroke:color-mix(in srgb,#7fc4e8 55%,#000);stroke-width:1.2}
.pm-char{fill:#2b2b30;stroke:#000;stroke-width:.6}
.pm-recep{fill:color-mix(in srgb,#f2d27a 30%,transparent);stroke:#f2d27a;stroke-width:2}
.pm-dock{fill:#f2d27a;stroke:color-mix(in srgb,#f2d27a 55%,#000);stroke-width:.6}
.pm-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.cl-hep{--cc:#d97a68}
.p-para{--cc:#f2d27a}.p-pain{--cc:#ff9a3d}.p-nap{--cc:#e5484d}.p-gsh{--cc:#3ddc97}.p-nacp{--cc:#5ec1a0}.p-charp{--cc:#2b2b30}
.pm-inj{fill:#e5484d;stroke:none}
.dr-g-fill.g-pain{fill:#e5484d}.dr-g-fill.g-fever{fill:#ff9a3d}.dr-g-fill.g-sw{fill:#e59a88}.dr-g-fill.g-nap{fill:#e5484d}.dr-g-fill.g-gsh{fill:#3ddc97}.dr-g-fill.g-inj{fill:#e5484d}
`,
});
