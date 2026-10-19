/* Gallstone disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gallstone.mjs [--print-model]
 * Static layout here; bile, crystals, stones and gauges move in gallstone.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of gallstone disease", a: [0.4, 0.65, 0.85, 1], names: ["stone formation", "biliary colic", "cholecystitis", "duct stone"], ticks: ["formation", "colic", "cholecystitis", "duct stone"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "analgesia (pain relief only)" },
    { label: "cholecystectomy (remove gallbladder)" },
    { label: "ERCP (clear the duct stone)" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "analgesia", "cholecystectomy", "ERCP"],
};
function modelOf(S, level, drug) {
  const stages = [
    { sat: 0.85, stone: 0.55, cyst: 0, cbd: 0, inf: 0.08, pain: 0.12 },
    { sat: 0.8, stone: 0.75, cyst: 0.9, cbd: 0, inf: 0.35, pain: 0.92 },
    { sat: 0.8, stone: 0.8, cyst: 0.95, cbd: 0, inf: 0.92, pain: 0.7 },
    { sat: 0.75, stone: 0.85, cyst: 0.15, cbd: 0.95, inf: 0.5, pain: 0.55 },
  ];
  const st = stages[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const analg = drug === 1 ? 1 : 0, chole = drug === 2 ? 1 : 0, ercp = drug === 3 ? 1 : 0;
  const Sat = cl(st.sat * (chole ? 0.25 : 1));
  const StoneGB = cl(st.stone * (chole ? 0 : 1));
  const StoneDuct = cl((level === 3 ? 0.85 : 0) * (ercp ? 0.05 : 1));
  const Cyst = cl(st.cyst * (chole ? 0 : 1));
  const Cbd = cl(st.cbd * (ercp ? 0.05 : 1));
  const Chol = cl(level === 3 ? Cbd * 0.9 * (ercp ? 0.1 : 1) : 0);
  const Inf = cl(st.inf * (chole ? 0.1 : 1) * (level === 3 && ercp ? 0.4 : 1));
  const InfAll = cl(Math.max(Inf, Chol));
  const Jaund = cl(Cbd);
  const Pain = cl(st.pain * (analg ? 0.25 : 1) * (chole ? (level === 3 ? 0.6 : 0.15) : 1) * (level === 3 && ercp ? 0.35 : 1));
  const Flow = cl(1 - Cbd * 0.9 - Cyst * 0.12);
  const burden = Math.max(StoneGB, StoneDuct);
  const block = Math.max(Cyst, Cbd);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(burden, 0.3, 0.7, ["none", "small", "large"]), w(block, 0.25, 0.6, ["none", "partial", "blocked"]), w(InfAll, 0.3, 0.6, ["calm", "sore", "inflamed"]), w(Jaund, 0.3, 0.6, ["none", "mild", "marked"])];
  return { Sat, StoneGB, StoneDuct, Cyst, Cbd, Chol, Inf, InfAll, Jaund, Pain, Flow, analg, chole, ercp, words, readout: "stones " + words[0] + " · blockage " + words[1] + " · inflammation " + words[2] + " · jaundice " + words[3] };
}
const TESTS = [
  [0, 0, "stones small · blockage none · inflammation calm · jaundice none"],
  [1, 0, "stones large · blockage blocked · inflammation sore · jaundice none"],
  [2, 0, "stones large · blockage blocked · inflammation inflamed · jaundice none"],
  [3, 0, "stones large · blockage blocked · inflammation inflamed · jaundice marked"],
  [2, 2, "stones none · blockage none · inflammation calm · jaundice none"],
  [3, 3, "stones large · blockage none · inflammation calm · jaundice none"],
];

/* ---------------- static layout ---------------- */
const GB_D = "M355 180C395 195 415 235 405 285C395 340 355 365 305 360C255 355 225 320 230 270C235 225 260 195 295 182C315 175 335 175 355 180Z";
const GB_BILE = "M348 192C380 205 396 238 388 280C380 325 350 346 308 342C268 338 244 312 248 272C252 232 272 208 300 196C316 189 332 188 348 192Z";
const CBD_D = "M382 190L470 193L538 202L546 262L578 326L645 350L725 350";
const HEP_D = "M330 178L438 187L538 202";
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="gs-duct" d="${HEP_D}"/>
<path class="gs-duct-in" d="${HEP_D}"/>
<path class="gs-duct" d="${CBD_D}"/>
<path class="gs-duct-in" d="${CBD_D}"/>
<ellipse class="gs-duo" cx="725" cy="320" rx="108" ry="78"/>
<ellipse class="gs-duo-in" cx="725" cy="320" rx="72" ry="48"/>
<g id="liverSlot"></g>
<g id="gbWrap">
<path id="gbWall" class="gs-gb" d="${GB_D}"/>
<path id="gbBile" class="gs-bile" d="${GB_BILE}"/>
</g>
<path id="gbGhost" class="gs-ghost" d="${GB_D}" opacity="0"/>
<g id="bileFlow"></g>
<g id="crystals"></g>
<g id="stonesG"></g>
<g id="bilirubin"></g>
<g id="bugs"></g>
<g id="neuts"></g>
<g id="parts"></g>
<g id="scopeG"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "gallstone-formation-cholecystitis", fig: "Fig 1", title: "Gallstones: from supersaturated bile to duct blockage", W, H, body,
  label: "An animated gallbladder, bile ducts and duodenum. Bile supersaturated with cholesterol compared with bile salts and lecithin forms crystals that nucleate and grow in a sluggish gallbladder into cholesterol stones, while pigment stones form from bilirubin in haemolysis. A stone stuck in the cystic duct causes biliary colic, ongoing blockage inflames the gallbladder as cholecystitis, and a stone in the common bile duct causes jaundice and cholangitis. Gauges show saturation, stones, blockage, inflammation, jaundice and pain. Treatments are analgesia, cholecystectomy and ERCP.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, sizes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "gallstone.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With cholecystectomy",
  sourcesLis: [
    "<strong>How gallstones form.</strong> The liver makes bile carrying cholesterol held in solution by bile salts and lecithin (phospholipid) in tiny micelles. When bile is supersaturated with cholesterol compared with bile salts and lecithin, cholesterol crystals can nucleate, helped by gallbladder stasis when the gallbladder empties poorly, and grow into cholesterol stones. Pigment stones are different: they are dark stones of calcium bilirubinate that form when excess bilirubin reaches bile, for example in haemolysis where red cells break down faster. A stone that sticks in the cystic duct while the gallbladder squeezes gives biliary colic. If the cystic duct stays blocked the trapped bile and pressure inflame the gallbladder wall as acute cholecystitis. A stone that passes into or forms in the common bile duct blocks bile reaching the gut, so bilirubin backs up and causes obstructive jaundice, and bacteria ascending from the duodenum can infect the held back bile as cholangitis. This is standard teaching in medicine and surgery texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Analgesia eases the pain of colic but does not move the stone. Cholecystectomy removes the gallbladder and its stones and so cures gallbladder colic and cholecystitis, but it does not by itself clear a stone already in the common bile duct. ERCP passes a scope through the duodenum to open the duct opening and clear a duct stone, relieving jaundice and cholangitis, while gallbladder stones can remain. These are teaching toggles only.",
  ],
  simplified: "Gallbladder polyps and cancer, sludge without stones, acalculous cholecystitis, Mirizzi syndrome, gallstone ileus and pancreatitis from a duct stone, imaging, antibiotics and drainage details, surgical risks and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.gs-liver{fill:color-mix(in srgb,#b85c48 58%,var(--c-tis));stroke:color-mix(in srgb,#b85c48 55%,#000);stroke-width:1.2}
.gs-gb{fill:color-mix(in srgb,#6fa860 52%,var(--anatomy-paper));stroke:color-mix(in srgb,#4a7a3a 60%,#000);stroke-width:1.4}
.gs-gb-hot{fill:color-mix(in srgb,var(--c-bad) 55%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:2.6}
.gs-ghost{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:7 5}
.gs-cap{fill:var(--anatomy-strong);font-size:12px}
.gs-bile{fill:color-mix(in srgb,#9bc53d 34%,var(--anatomy-paper));stroke:none}
.gs-duct{fill:none;stroke:color-mix(in srgb,#6fa860 55%,var(--anatomy-mid));stroke-width:14;stroke-linecap:round;stroke-linejoin:round}
.gs-duct-in{fill:none;stroke:color-mix(in srgb,#9bc53d 30%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
.gs-duo{fill:color-mix(in srgb,var(--c-endo) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid));stroke-width:1.4}
.gs-duo-in{fill:color-mix(in srgb,var(--c-fl) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 40%,var(--anatomy-mid));stroke-width:1}
.gs-stone-c{fill:#e9c84a;stroke:#8a5f14;stroke-width:1.2}
.gs-stone-p{fill:#5a3a2a;stroke:#2e1a10;stroke-width:1}
.gs-facet{fill:none;stroke:#8a5f14;stroke-width:.8;opacity:.7}
.gs-pain{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.gs-scope{fill:none;stroke:var(--anatomy-strong);stroke-width:3;stroke-linecap:round}
.gs-clip{fill:var(--anatomy-strong)}
.p-bile{fill:#7ac74f;stroke:#4a7a3a;stroke-width:.5}
.p-chol{fill:#e9c84a;stroke:#8a5f14;stroke-width:.5}
.p-bili{fill:#ffcf3f;stroke:#b8962f;stroke-width:.5}
.p-frag2{fill:#e9c84a;stroke:#8a5f14;stroke-width:.5}
.cl-bug2{--cc:#7fcf6a}
.dr-g-fill.g-sat{fill:#e9c84a}.dr-g-fill.g-stone{fill:#c98a2e}.dr-g-fill.g-block{fill:var(--c-bad)}.dr-g-fill.g-jaund{fill:#ffcf3f}
`,
});
