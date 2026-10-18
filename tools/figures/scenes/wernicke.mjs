/* Wernicke Korsakoff as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/wernicke.mjs [--print-model]
 * Static layout here; supply, gate, brain injury and gauges move in wernicke.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage", a: [0.3, 0.7, 1], names: ["deficiency", "Wernicke", "Korsakoff"], ticks: ["deficiency", "Wernicke", "Korsakoff"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "IV thiamine first" },
    { label: "glucose alone" },
    { label: "supportive care only" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "IV thiamine first", "glucose alone", "supportive care only"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], thi = drug === 1 ? 1 : 0, glu = drug === 2 ? 1 : 0, sup = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const memFloor = [0, 0.08, 0.62][level];
  const triFloor = [0, 0.35, 0.18][level];
  const Th = cl(1 - 0.8 * a + thi * 0.62 - glu * (0.1 + 0.28 * a) + sup * 0.04);
  const En = cl(0.08 + 0.92 * Th - glu * 0.06);
  const ATP = cl(0.1 + 0.84 * En);
  const Dmg = cl(0.06 + 0.78 * a * (1 - Th) + glu * 0.3 * a - thi * 0.32 * a + sup * 0.02);
  const Tri = cl(triFloor + 0.55 * a * (1 - Th * 0.45) + glu * 0.22 * a - thi * 0.28);
  const MemLoss = cl(memFloor + 0.32 * a * (1 - Th) + glu * 0.16 * a - thi * 0.06);
  const Mem = cl(1 - MemLoss);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Th, 0.35, 0.65, ["low", "reduced", "ok"]), w(ATP, 0.35, 0.65, ["low", "reduced", "ok"]), w(Dmg, 0.3, 0.6, ["little", "active", "severe"]), w(1 - Mem, 0.3, 0.6, ["preserved", "impaired", "lost"])];
  return { a, thi, glu, sup, Th, En, ATP, Dmg, Tri, MemLoss, Mem, words, readout: "thiamine " + words[0] + " · energy " + words[1] + " · brain injury " + words[2] + " · memory " + words[3] };
}
const TESTS = [
  [1, 0, "thiamine reduced · energy reduced · brain injury active · memory preserved"],
  [1, 1, "thiamine ok · energy ok · brain injury little · memory preserved"],
  [1, 2, "thiamine low · energy low · brain injury severe · memory impaired"],
  [2, 1, "thiamine ok · energy ok · brain injury little · memory lost"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="wk-sub" x="30" y="76" width="210" height="354" rx="12"/>
<rect class="wk-sub" x="246" y="76" width="300" height="354" rx="12"/>
<rect class="wk-sub" x="562" y="76" width="368" height="354" rx="12"/>
<text class="sc-zone" x="46" y="96">SUPPLY</text>
<text class="sc-zone" x="262" y="96">ENERGY GATE</text>
<text class="sc-zone" x="578" y="96">BRAIN AND SIGNS</text>
<path id="thiPipe" class="wk-pipe" d="M85 320 C160 320 250 280 330 250"/>
<path id="gluPipe" class="wk-pipe" d="M185 332 C220 338 250 346 278 350"/>
<path id="fuelVessel" class="wk-vessel" d="M508 250 C560 246 590 252 617 268"/>
<g id="causeG"></g>
<g id="gateG"></g>
<g id="brainSlot"></g>
<g id="injG"></g>
<g id="clinG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.wk-sub{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.65}
.wk-bottle{fill:#8a5a2a;stroke:color-mix(in srgb,#8a5a2a 55%,#000);stroke-width:1}
.wk-bottle2{fill:#c98a3d}
.wk-plate{fill:#d8dee6;stroke:var(--anatomy-mid);stroke-width:1}
.wk-plate2{fill:var(--anatomy-paper);stroke:var(--anatomy-faint);stroke-width:1}
.wk-bag{fill:#dfe9f2;stroke:var(--anatomy-mid);stroke-width:1.2}
.wk-fluid{fill:#7ab8ff;stroke:none}
.wk-line{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-linecap:round}
.wk-drop{fill:#e9b84a;stroke:none}
.wk-sugar{fill:#f4f6f8;stroke:var(--anatomy-mid);stroke-width:1}
.wk-pipe{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round;opacity:.6}
.wk-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:13;stroke-linecap:round;opacity:.8}
.wk-halo{fill:#e5484d;opacity:0}
.wk-spot{fill:#e5484d;stroke:color-mix(in srgb,#e5484d 55%,#000);stroke-width:1}
.wk-enz{fill:#3ec6b8;stroke:color-mix(in srgb,#3ec6b8 55%,#000);stroke-width:1}
.wk-cof{fill:#e9b84a;stroke:color-mix(in srgb,#e9b84a 55%,#000);stroke-width:1}
.wk-gluN{fill:#7ab8ff;stroke:color-mix(in srgb,#7ab8ff 55%,#000);stroke-width:1}
.wk-tca{fill:#f2d27a;stroke:color-mix(in srgb,#f2d27a 50%,#000);stroke-width:1}
.wk-box{fill:#c9b8e8;stroke:color-mix(in srgb,#c9b8e8 55%,#000);stroke-width:1}
.wk-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.wk-atp{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.wk-sup{fill:none;stroke:#7ab8ff;stroke-width:2.4;stroke-linecap:round}
.wk-eyeW{fill:#f4f6f8;stroke:var(--anatomy-mid);stroke-width:1.2}
.wk-iris{fill:#5fa8d3;stroke:color-mix(in srgb,#5fa8d3 55%,#000);stroke-width:.8}
.wk-pupil{fill:#1c2430}
.wk-cloud{fill:#c9ced6;stroke:var(--anatomy-mid);stroke-width:1}
.wk-fig{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.wk-head{fill:#e8c39a;stroke:color-mix(in srgb,#e8c39a 55%,#000);stroke-width:1}
.wk-book{fill:#7fc4e8;stroke:color-mix(in srgb,#7fc4e8 55%,#000);stroke-width:1}
.wk-book2{fill:#f4f6f8;stroke:var(--anatomy-mid);stroke-width:.8}
.wk-x{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.wk-cap{fill:var(--anatomy-strong);font-size:12px}
.p-thi{--cc:#e9b84a}.p-gluP{--cc:#7ab8ff}.p-atp{--cc:#3ddc97}
.g-thi{fill:#e9b84a}.g-enz{fill:#3ec6b8}.g-atp{fill:var(--c-good)}.g-dmg{fill:var(--c-bad)}.g-tri{fill:#f08a4b}.g-mem{fill:#7fc4e8}
`;

buildScene({
  id: "wernicke-korsakoff", fig: "Fig 1", title: "Wernicke Korsakoff: thiamine, energy and memory", W, H, body, extraCss,
  label: "An animated supply line from left to right. Poor supply lowers thiamine. At the energy gate two engines need thiamine as a helper, so without it sugar cannot become fuel. The starved brain shows injury spots, then the Wernicke triad and memory loss. Thiamine first docks the helper and restores fuel, while sugar alone burns the last helper and worsens injury. Gauges show thiamine, enzymes, energy, brain injury, the triad and memory.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "wernicke.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With IV thiamine",
  sourcesLis: [
    "<strong>Why thiamine matters.</strong> Thiamine (vitamin B1) is converted to thiamine pyrophosphate, a cofactor for pyruvate dehydrogenase and alpha-ketoglutarate dehydrogenase in and around the TCA cycle, and for transketolase in the pentose phosphate pathway. Stores are small, so alcohol use disorder, poor intake, vomiting and malabsorption can deplete it. Energy failure and related injury fall on periventricular structures: mammillary bodies, dorsomedial thalamus, periaqueductal grey, tectum and tissue around the third and fourth ventricles. This is standard teaching in neurology, medicine and biochemistry texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Features and the glucose point.</strong> Wernicke encephalopathy is taught as confusion, ataxia and ophthalmoplegia, though the full triad is often incomplete. Untreated or late disease can leave Korsakoff syndrome, with severe loss of new memory and confabulation. Giving glucose before thiamine can worsen the state because glucose metabolism consumes the remaining thiamine cofactor, so teaching is to give thiamine first or together. The treatment choices here are teaching toggles only.",
  ],
  simplified: "Other causes of deficiency, refeeding, dialysis and critical illness routes, the exact biochemistry of each enzyme step, eye sign detail, imaging and pathology appearances, confabulation detail, and all doses, routes beyond the class shown and timing are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
