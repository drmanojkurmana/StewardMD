/* Acute pancreatitis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/panc.mjs [--print-model]
 * Static layout here; acinar cells, enzymes and gauges move in panc.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the pancreatitis", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "fluids (support the circulation)" },
    { label: "analgesia (pain relief)" },
    { label: "remove the stone (relieve the block)" },
    { label: "nutrition support (feeding)" },
  ],
  status: "Pancreatitis: {level} · {drug} ·",
  drugNames: ["no treatment", "fluids", "analgesia", "stone removal", "nutrition support"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], stone = drug === 3 ? 1 : 0, fluids = drug === 1 ? 1 : 0, analg = drug === 2 ? 1 : 0, nutr = drug === 4 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const A = cl(a * (stone ? 0.3 : 1));
  const D = cl(1.12 * A - 0.16);
  const F = cl((D - 0.08) * 1.05);
  const I = cl(0.06 + 0.9 * D - (nutr ? 0.08 : 0));
  const Leak = cl(0.9 * I);
  const Perf = cl(0.94 - 0.55 * Leak - 0.22 * I + (fluids ? 0.48 : 0) + (nutr ? 0.1 : 0));
  const Pain = cl(0.12 + 0.72 * D + 0.22 * I - (analg ? 0.55 : 0) - (fluids ? 0.07 : 0));
  const Comp = cl(I * (0.35 + 0.65 * a) - (fluids ? 0.14 : 0) - (nutr ? 0.16 : 0) - (stone ? 0.1 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(A, 0.3, 0.6, ["low", "raised", "high"]), w(D, 0.25, 0.55, ["mostly intact", "injured", "badly injured"]), w(Pain, 0.3, 0.6, ["mild", "moderate", "severe"])];
  return { a, stone, fluids, analg, nutr, A, D, F, I, Leak, Perf, Pain, Comp, words, readout: "trypsin " + words[0] + " · pancreas " + words[1] + " · pain " + words[2] };
}
const TESTS = [
  [0, 0, "trypsin raised · pancreas mostly intact · pain moderate"],
  [1, 0, "trypsin high · pancreas badly injured · pain severe"],
  [1, 3, "trypsin low · pancreas mostly intact · pain mild"],
  [2, 2, "trypsin high · pancreas badly injured · pain moderate"],
];

/* ---------------- static layout ---------------- */
const FAT = [];
for (let i = 0; i < 9; i++) FAT.push([245 + i * 55, 166]);
for (let i = 0; i < 9; i++) FAT.push([272 + i * 55, 350]);
let fat = "";
for (const [x, y] of FAT) fat += `<circle class="pc-fat" cx="${x}" cy="${y}" r="16"/>`;
const ORGAN = "M185 258C185 214 232 186 322 184L618 184C692 184 736 216 736 258C736 300 692 330 618 332L322 332C232 330 185 300 185 258Z";
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="108">TRIGGERS</text>
<text class="sc-zone" x="34" y="212">PANCREAS</text>
<text class="sc-zone" x="815" y="212">VESSEL</text>
<g id="fatg">${fat}</g>
<path class="pc-duo" d="M750 182C802 204 806 292 754 330"/>
<path class="pc-organ" d="${ORGAN}"/>
<path id="inj" class="pc-inj" d="${ORGAN}" opacity="0"/>
<ellipse id="painHalo" class="pc-pain" cx="460" cy="258" rx="282" ry="84" opacity="0"/>
<path class="pc-duct" d="M222 258L702 258M300 258L282 224M390 258L374 292M480 258L464 224M570 258L554 292M650 258L636 226"/>
<path class="pc-bile" d="M705 150C710 176 714 198 722 230"/>
<ellipse class="pc-gall" cx="705" cy="126" rx="32" ry="24" transform="rotate(-18 705 126)"/>
<g id="stone"><circle class="pc-stone" r="10"/><circle class="pc-stone-h" cx="-3" cy="-3" r="3"/></g>
<path class="p-alcs" d="M132 132C140 144 143 150 143 156A11 11 0 0 1 121 156C121 150 124 144 132 132Z"/>
<path class="p-alcs" d="M160 152C167 162 169 167 169 172A9 9 0 0 1 151 172C151 167 153 162 160 152Z"/>
<path class="p-alcs" d="M108 158C115 168 117 173 117 178A9 9 0 0 1 99 178C99 173 101 168 108 158Z"/>
<path class="pc-arrow" d="M168 196C180 218 192 236 208 250"/>
<rect id="vessel" class="sc-lumen" x="815" y="238" width="122" height="48" rx="8"/>
<rect class="pc-vwall" x="815" y="232" width="122" height="6" rx="3"/>
<rect class="pc-vwall" x="815" y="286" width="122" height="6" rx="3"/>
<g id="cells"></g><g id="spots"></g><g id="rbcs2"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "acute-pancreatitis", fig: "Fig 1", title: "Acute pancreatitis: enzymes turned on too early", W, H, body,
  label: "An animated pancreas. A gallstone blocking the outlet or alcohol injures acinar cells, so trypsin is switched on inside the cells instead of in the gut. The active enzymes digest the pancreas itself, damage nearby fat, and drive inflammation that leaks into the circulation and can affect other organs. Gauges show trypsin activation, pancreatic injury, fat necrosis, inflammation, pain and perfusion. Treatment choices include fluids, analgesia, removing the stone and nutrition support.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H, FAT }, pageJs: readFileSync(join(HERE, "panc.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How acute pancreatitis develops.</strong> The common triggers are a gallstone that blocks the pancreatic outlet and alcohol. Inside acinar cells, digestive enzymes that should only be activated in the duodenum are switched on early: trypsinogen becomes trypsin inside the cell. Trypsin activates more enzymes, which digest cell membranes and pancreatic tissue (autodigestion), injure blood vessels, and damage surrounding fat (fat necrosis, where enzymes split fat and chalky deposits form). Inflammatory signals then spread through the body, making vessels leaky; in severe disease other organs can fail. This is standard teaching in medicine and gastroenterology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Fluids support the circulation while vessels leak, analgesia eases the severe pain, removing a blocking stone relieves the obstruction, and nutrition support by feeding helps recovery. Definitive care also looks for the cause and treats complications. These are teaching toggles only.",
  ],
  simplified: "The two triggers are shown together for teaching, although usually one cause is found; gallstone removal in real care depends on where the stone sits and on specialist procedures. Enzyme cascades beyond trypsin, infected necrosis, collections around the pancreas, organ failure scoring, antibiotics, surgery and all doses and targets are left out. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-acinar:#e8a2c0;--c-fat:#e6c85a;--c-tryp:#ff7a3d;--c-enz:#ffb03d}
body[data-theme="light"]{--c-acinar:#cf779e;--c-fat:#c9a52e;--c-tryp:#d6531a;--c-enz:#c47f16}
.cl-acinar{--cc:var(--c-acinar)}
.pc-organ{fill:color-mix(in srgb,var(--c-acinar) 34%,var(--c-tis));stroke:color-mix(in srgb,var(--c-acinar) 60%,#000);stroke-width:1.2}
.pc-inj{fill:var(--c-bad)}
.pc-pain{fill:var(--c-bad)}
.pc-duct{fill:none;stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round;opacity:.65}
.pc-bile{fill:none;stroke:#6aa84f;stroke-width:7;stroke-linecap:round;opacity:.8}
.pc-gall{fill:#7fbf5f;stroke:color-mix(in srgb,#7fbf5f 55%,#000);stroke-width:1}
.pc-stone{fill:#d9d2c2;stroke:#8a8172;stroke-width:1.2}.pc-stone-h{fill:#fff;opacity:.7}
.p-alcs{fill:var(--c-tryp);stroke:color-mix(in srgb,var(--c-tryp) 55%,#000);stroke-width:.8}
.p-alc{fill:var(--c-tryp)}
.pc-arrow{fill:none;stroke:var(--c-tryp);stroke-width:2;stroke-dasharray:5 4;opacity:.8}
.pc-duo{fill:none;stroke:color-mix(in srgb,var(--c-fat) 55%,var(--anatomy-mid));stroke-width:16;stroke-linecap:round;opacity:.55}
.pc-fat{fill:var(--c-fat);stroke:color-mix(in srgb,var(--c-fat) 55%,#000);stroke-width:.8;opacity:.85}
.pc-chalk{fill:#f7f2df;stroke:#cfc4a4;stroke-width:.7}
.pc-vwall{fill:var(--c-endo)}
.pc-gran{fill:var(--anatomy-paper);opacity:.75}
.p-tryp{--cc:var(--c-tryp)}.p-enz{--cc:var(--c-enz)}.p-nut{--cc:var(--c-good)}.p-juice{--cc:var(--anatomy-mid)}
.dr-g-fill.g-tryp{fill:var(--c-tryp)}.dr-g-fill.g-fat{fill:var(--c-fat)}.dr-g-fill.g-pain{fill:var(--c-neut)}
`,
});
