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
  level: { label: "Paracetamol load and stage", a: [0.25, 0.8, 1], names: ["therapeutic", "overdose", "late liver failure"], ticks: ["therapeutic", "overdose", "late failure"], start: 1 },
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
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  let gsh, freeN, nec, fun;
  if (txp) {
    /* a transplanted liver brings a full glutathione store and no dead cells, but the drug load remains */
    gsh = 0.9;
    freeN = cl(prod - 0.45 * gsh);
    nec = cl(freeN * 0.3);
    fun = cl(1 - nec * 1.2);
  } else {
    gsh = cl(1 - 1.15 * prod - (level === 2 ? 0.2 : 0) + (nac ? (level === 2 ? 0.3 : 0.6) : 0));
    freeN = cl(prod - 0.45 * gsh);
    nec = cl(freeN * 1.35 + (level === 2 ? 0.28 : 0));
    fun = cl(1 - nec * 1.2 - (level === 2 ? 0.18 : 0));
  }
  const words = [w(freeN, 0.12, 0.38, ["none", "some", "high"]), w(gsh, 0.3, 0.65, ["depleted", "low", "ample"]), w(nec, 0.2, 0.55, ["none", "some", "widespread"]), w(fun, 0.35, 0.7, ["failed", "impaired", "normal"])];
  return { a, chr, nac, txp, D, sat, prod, gsh, freeN, nec, fun, words, readout: "free NAPQI " + words[0] + " · glutathione " + words[1] + " · necrosis " + words[2] + " · liver function " + words[3] };
}
const TESTS = [
  [0, 0, "free NAPQI none · glutathione ample · necrosis none · liver function normal"],
  [1, 0, "free NAPQI some · glutathione low · necrosis some · liver function impaired"],
  [1, 2, "free NAPQI none · glutathione ample · necrosis none · liver function normal"],
  [2, 3, "free NAPQI some · glutathione ample · necrosis none · liver function normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path id="vesselDrug" class="pc-vessel" d="M190 337 L421 319"/>
<path id="vesselSafe" class="pc-vessel" d="M432 144 C522 136 665 186 755 194"/>
<g id="gutSlot"></g>
<g id="liverSlot"></g>
<g id="kidneySlot"></g>
<ellipse id="injTint" class="pc-tint" cx="455" cy="250" rx="108" ry="80" opacity="0"/>
<ellipse id="txGlow" class="pc-txglow" cx="455" cy="235" rx="116" ry="94" opacity="0"/>
<g id="cypG"><circle id="cyp" class="pc-cyp" cx="505" cy="285" r="9"/></g>
<g id="napqiG"><polygon id="napqiNode" class="pc-napqinode" points="555,276 569,290 555,304 541,290"/></g>
<g id="nacG"><circle id="nacNode" class="pc-nacnode" cx="600" cy="255" r="16"/></g>
<rect id="tank" class="pc-tank" x="600" y="296" width="130" height="34" rx="9"/>
<rect id="tankFill" class="pc-tankFill" x="606" y="302" width="118" height="22" rx="6"/>
<g id="gutCells"></g>
<g id="hepG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "paracetamol-toxicity", fig: "Fig 1", title: "Paracetamol toxicity: safe pathways, NAPQI and liver necrosis", W, H, body,
  label: "An animated liver pathway for paracetamol. Tablets dissolve in the gut and the drug travels in blood to the liver. Most leaves by safe routes that the kidneys pass out in urine. A small fraction becomes NAPQI, normally cleared by glutathione. In overdose the safe routes fill up, glutathione runs out, free NAPQI kills liver cells around the central vein, and the liver fails. A slider moves from therapeutic use to overdose to late liver failure, and treatments are activated charcoal given early, N-acetylcysteine and liver transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "paracet.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With N-acetylcysteine",
  sourcesLis: [
    "<strong>How paracetamol is handled.</strong> At therapeutic intakes most paracetamol is conjugated in the liver by glucuronidation and sulphation and excreted. A small fraction is oxidised by cytochrome P450 enzymes to the reactive product NAPQI, which is normally joined to glutathione and made harmless. This is standard teaching in pharmacology and medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What happens in overdose.</strong> The sulphation and glucuronidation pathways saturate, more paracetamol is diverted to NAPQI, and glutathione stores are used up. Free NAPQI then binds to hepatocyte proteins, causing centrilobular (around the central vein) hepatocyte necrosis, which can progress to acute liver failure. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Activated charcoal in the gut, given early, reduces absorption. N-acetylcysteine provides cysteine to rebuild glutathione and detoxify NAPQI. Liver transplant replaces a liver that has failed and cannot recover. These are teaching toggles only.",
  ],
  simplified: "Absorption timing, blood level measurement and risk assessment, other causes of glutathione depletion, kidney injury, acid base and clotting detail in liver failure, transplant selection, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pc-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:15;stroke-linecap:round;opacity:.8}
.pc-tint{fill:#e5484d;stroke:none}
.pc-txglow{fill:color-mix(in srgb,#3ddc97 14%,transparent);stroke:#3ddc97;stroke-width:3}
.pc-tank{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.1}
.pc-tankFill{fill:#3ddc97}
.pc-cyp{fill:#7fc4e8;stroke:color-mix(in srgb,#7fc4e8 55%,#000);stroke-width:1.2}
.pc-napqinode{fill:#e07a2e;stroke:#9a4d12;stroke-width:1.2}
.pc-nacnode{fill:#5ec1a0;stroke:color-mix(in srgb,#5ec1a0 55%,#000);stroke-width:1.2}
.pc-vein{fill:#7ab8ff;stroke:#3a6b9a;stroke-width:1}
.pc-nec{fill:#7a1220}
.pc-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.cl-hep{--cc:#d99a6c}
.p-para{--cc:#e8d36a}.p-safe{--cc:#5f9e6e}.p-napqi{--cc:#e07a2e}.p-nac{--cc:#5ec1a0}.p-charp{--cc:#2b2b30}
.dr-g-fill.g-safe{fill:#5f9e6e}.dr-g-fill.g-nap{fill:#e07a2e}.dr-g-fill.g-gsh{fill:#3ddc97}.dr-g-fill.g-nec{fill:var(--c-bad)}.dr-g-fill.g-fun{fill:var(--c-good)}
`,
});
