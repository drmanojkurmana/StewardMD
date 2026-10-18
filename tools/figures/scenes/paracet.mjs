/* Paracetamol toxicity as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/paracet.mjs [--print-model]
 * Static layout here; tablets, particles, hepatocytes and gauges move in paracet.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Paracetamol load and stage", a: [0.25, 0.8, 1], names: ["therapeutic", "overdose", "late liver failure"], ticks: ["therapeutic", "overdose", "late failure"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "activated charcoal early" },
    { label: "N-acetylcysteine" },
    { label: "liver transplant" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "activated charcoal early", "N-acetylcysteine", "a liver transplant"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const chr = drug === 1 ? 1 : 0, nac = drug === 2 ? 1 : 0, txp = drug === 3 ? 1 : 0;
  const charF = chr ? (level === 2 ? 1 : level === 1 ? 0.45 : 0.6) : 1;
  const D = cl(a * charF);
  const sat = cl(D / 0.58);
  const prod = cl(0.12 * D + 1.1 * Math.max(0, D - 0.5));
  const gsh = cl(1 - 1.15 * prod - (level === 2 ? 0.2 : 0) + (nac ? (level === 2 ? 0.3 : 0.6) : 0));
  const freeN = cl(prod - 0.45 * gsh);
  const nec = cl(freeN * 1.35 + (level === 2 ? 0.28 : 0));
  const fun = cl(1 - nec * 1.2 - (level === 2 ? 0.18 : 0) + (txp ? 0.85 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(freeN, 0.12, 0.38, ["none", "some", "high"]), w(gsh, 0.3, 0.65, ["depleted", "low", "ample"]), w(nec, 0.2, 0.55, ["none", "some", "widespread"]), w(fun, 0.35, 0.7, ["failed", "impaired", "normal"])];
  return { a, chr, nac, txp, D, sat, prod, gsh, freeN, nec, fun, words, readout: "free NAPQI " + words[0] + " · glutathione " + words[1] + " · necrosis " + words[2] + " · liver function " + words[3] };
}
const TESTS = [
  [0, 0, "free NAPQI none · glutathione ample · necrosis none · liver function normal"],
  [1, 0, "free NAPQI some · glutathione low · necrosis some · liver function impaired"],
  [1, 2, "free NAPQI none · glutathione ample · necrosis none · liver function normal"],
  [2, 0, "free NAPQI high · glutathione depleted · necrosis widespread · liver function failed"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">IN THE GUT</text>
<text class="sc-zone" x="736" y="68">SAFE EXIT</text>
<ellipse class="pc-gut" cx="120" cy="210" rx="62" ry="58"/>
<polygon class="pc-arrow" points="232,210 218,203 218,217"/>
<path class="pc-link" d="M182 210 L224 210"/>
<rect class="pc-liver" x="240" y="84" width="470" height="316" rx="18"/>
<rect id="liverGlow" class="pc-glow" x="240" y="84" width="470" height="316" rx="18" opacity="0"/>
<text class="sc-zone" x="264" y="106">LIVER</text>
<path class="pc-lane" d="M270 138 L640 138"/>
<path class="pc-lane" d="M270 192 L640 192"/>
<path class="pc-lane" d="M270 252 L566 252"/>
<circle class="pc-enz" cx="380" cy="138" r="17"/>
<circle class="pc-enz" cx="380" cy="192" r="17"/>
<circle class="pc-enz" cx="500" cy="252" r="15"/>
<polygon class="pc-napqi" points="590,228 614,252 590,276 566,252"/>
<circle class="pc-safeNode" cx="810" cy="138" r="24"/>
<circle class="pc-safeNode" cx="810" cy="192" r="24"/>
<path class="pc-lane" d="M640 138 L786 138"/>
<path class="pc-lane" d="M640 192 L786 192"/>
<rect class="pc-tank" x="270" y="292" width="180" height="44" rx="10"/>
<rect id="gshFill" class="pc-tankFill" x="276" y="298" width="168" height="32" rx="7"/>
<rect class="pc-fail" x="750" y="272" width="130" height="64" rx="12"/>
<rect id="failGlow" class="pc-failGlow" x="750" y="272" width="130" height="64" rx="12" opacity="0"/>
<text class="sc-lab" x="815" y="308" text-anchor="middle">failure</text>
<text class="sc-lab" x="120" y="288" text-anchor="middle">tablets taken</text>
<text class="sc-lab" x="810" y="238" text-anchor="middle">to urine</text>
<text class="sc-lab" x="480" y="398" text-anchor="middle">hepatocyte row, central vein in the middle</text>
<g id="gutCells"></g>
<g id="liverCells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "paracetamol-toxicity", fig: "Fig 1", title: "Paracetamol toxicity: safe pathways, NAPQI and liver necrosis", W, H, body,
  label: "An animated liver pathway for paracetamol. Most paracetamol leaves by glucuronidation and sulphation. A small fraction becomes NAPQI, normally detoxified by glutathione. In overdose the safe pathways saturate, glutathione runs out, free NAPQI accumulates and hepatocytes die around the central vein, leading to liver failure. A slider moves from therapeutic use to overdose to late liver failure, and treatments include activated charcoal early, N-acetylcysteine and transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "paracet.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How paracetamol is handled.</strong> At therapeutic intakes most paracetamol is conjugated in the liver by glucuronidation and sulphation and excreted. A small fraction is oxidised by cytochrome P450 enzymes to the reactive product NAPQI, which is normally joined to glutathione and made harmless. This is standard teaching in pharmacology and medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What happens in overdose.</strong> The sulphation and glucuronidation pathways saturate, more paracetamol is diverted to NAPQI, and glutathione stores are used up. Free NAPQI then binds to hepatocyte proteins, causing centrilobular (around the central vein) hepatocyte necrosis, which can progress to acute liver failure. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Activated charcoal in the gut, given early, reduces absorption. N-acetylcysteine provides cysteine to rebuild glutathione and detoxify NAPQI. Liver transplant replaces a liver that has failed and cannot recover. These are teaching toggles only.",
  ],
  simplified: "Absorption timing, blood level measurement and risk assessment, other causes of glutathione depletion, kidney injury, acid base and clotting detail in liver failure, transplant selection, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pc-gut{fill:color-mix(in srgb,var(--c-eos) 30%,var(--c-tis));stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1.2}
.pc-liver{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.2}
.pc-glow{fill:none;stroke:var(--c-good);stroke-width:3}
.pc-link{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.pc-arrow{fill:var(--anatomy-mid)}
.pc-lane{fill:none;stroke:var(--anatomy-faint);stroke-width:2;stroke-dasharray:5 4}
.pc-enz{fill:#8a9a5b;stroke:#5d6d3a;stroke-width:1.1}
.pc-napqi{fill:#e07a2e;stroke:#9a4d12;stroke-width:1.2}
.pc-safeNode{fill:#5f9e6e;stroke:#3a6b47;stroke-width:1.2}
.pc-tank{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1.1}
.pc-tankFill{fill:#7fc4a8}
.pc-fail{fill:color-mix(in srgb,var(--c-bad) 22%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:1.1}
.pc-failGlow{fill:var(--c-bad)}
.pc-vein{fill:#7ab8ff;stroke:#3a6b9a;stroke-width:1}
.pc-nec{fill:#7a1220}
.cl-hep{--cc:#d99a6c}
.p-para{--cc:#e8d36a}.p-safe{--cc:#5f9e6e}.p-napqi{--cc:#e07a2e}.p-nac{--cc:#7fc4a8}.p-char{fill:#2b2b2b;stroke:#111;stroke-width:.5}
.dr-g-fill.g-safe{fill:#5f9e6e}.dr-g-fill.g-nap{fill:#e07a2e}.dr-g-fill.g-gsh{fill:#7fc4a8}.dr-g-fill.g-nec{fill:var(--c-bad)}.dr-g-fill.g-fun{fill:var(--c-good)}
`,
});
