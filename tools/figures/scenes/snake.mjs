/* Snake envenomation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/snake.mjs [--print-model]
 * Static layout here; venom, signals and gauges move in snake.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Main pattern of envenomation", a: [0.3, 0.7, 1], names: ["local", "neurotoxic", "haemotoxic"], ticks: ["local", "neurotoxic", "haemotoxic"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "immobilise and reassure" },
    { label: "ventilation and blood products" },
    { label: "anti-snake venom" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["immobilise and reassure", "ventilation and blood products", "anti-snake venom"],
};
function modelOf(S, level, drug) {
  const LUT = {
    loc: [0.9, 0.28, 0.22],
    neu: [0.06, 0.95, 0.08],
    haem: [0.06, 0.08, 0.95],
    spreadF: [0.48, 0.62, 0.38],
    locF: [0.8, 0.95, 0.55],
    centreF: [0.6, 0.92, 0.25],
  };
  const WORDS = {
    local: ["mild", "moderate", "severe"],
    breath: ["steady", "laboured", "failing"],
    bleed: ["none", "some", "heavy"],
  };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const loc = LUT.loc[level], neu = LUT.neu[level], haem = LUT.haem[level];
  const imm = drug === 0 ? 1 : 0, sup = drug === 1 ? 1 : 0, asv = drug === 2 ? 1 : 0;
  const Spread = cl((0.55 * loc + 0.85 * Math.max(neu, haem)) * LUT.spreadF[drug]);
  const Local = cl(loc * LUT.locF[drug] + 0.1 * Spread * loc);
  const NeuroBlock = cl(neu * LUT.centreF[drug]);
  const Muscle = cl(1 - NeuroBlock);
  const Breath = cl(1 - NeuroBlock * 0.9 + (sup ? NeuroBlock * 0.85 : 0));
  const ClotAct = cl(haem * LUT.centreF[drug]);
  const Consume = cl(ClotAct * 0.92);
  const Bleed = cl(Consume * (sup ? 0.3 : 0.85));
  const words = [w(Local, 0.3, 0.6, WORDS.local), w(1 - Breath, 0.25, 0.55, WORDS.breath), w(Bleed, 0.15, 0.4, WORDS.bleed)];
  return { imm, sup, asv, Spread, Local, NeuroBlock, Muscle, Breath, ClotAct, Consume, Bleed, words, readout: "local damage " + words[0] + " · breathing " + words[1] + " · bleeding " + words[2] };
}
const TESTS = [
  [0, 0, "local damage severe · breathing steady · bleeding none"],
  [1, 0, "local damage mild · breathing laboured · bleeding none"],
  [2, 0, "local damage mild · breathing steady · bleeding heavy"],
  [2, 2, "local damage mild · breathing steady · bleeding some"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BITE SITE</text>
<text class="sc-zone" x="330" y="68">NERVE AND MUSCLE</text>
<text class="sc-zone" x="650" y="68">BLOOD AND CLOTTING</text>
<path class="sn-divider" d="M312 84V424M632 84V424"/>
<path id="nervePath" class="sn-guide" d="M210 285 C270 270 330 220 408 168"/>
<g id="skinSlot"></g>
<g id="gangSlot"></g>
<g id="muscleSlot"></g>
<g id="vesselSlot"></g>
<g id="snakeG">
  <path class="sn-snakeBody" d="M30 150 C55 115 95 105 130 128"/>
  <ellipse class="sn-snakeHead" cx="160" cy="150" rx="26" ry="18" transform="rotate(20 160 150)"/>
  <circle class="sn-eye" cx="168" cy="144" r="3"/>
  <path class="sn-fang" d="M150 164L146 200M164 162L163 200"/>
  <path class="sn-tongue" d="M184 152L202 146M202 146L208 140M202 146L209 150"/>
</g>
<rect class="sn-splint" id="splintTop" x="55" y="170" width="210" height="11" rx="5"/>
<rect class="sn-splint" id="splintBot" x="55" y="354" width="210" height="11" rx="5"/>
<ellipse id="swell" class="sn-swell" cx="157" cy="270" rx="62" ry="42"/>
<ellipse id="necrosis" class="sn-nec" cx="157" cy="270" rx="30" ry="22"/>
<circle class="sn-fangMark" cx="152" cy="207" r="3.4"/><circle class="sn-fangMark" cx="168" cy="207" r="3.4"/>
<rect id="cleft" class="sn-cleft" x="392" y="284" width="166" height="18" rx="9"/>
<path id="ventTube" class="sn-tube" d="M946 392 L585 380"/>
<g id="dyn"></g>
<g id="recs"></g>
<g id="blockMarks"></g>
<g id="stuckV"></g>
<g id="platelets"></g>
<g id="clotG"></g>
<g id="rbcs2"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "snake-bite-envenomation", fig: "Fig 1", title: "Snake envenomation: local, nerve and blood effects", W, H, body,
  label: "An animated scene of snake envenomation. Venom at the bite site injures local tissue. Neurotoxic venom reaches the nerve ending and blocks signalling to muscle, causing limp paralysis and breathing failure. Haemotoxic venom activates clotting, uses up clotting factors and platelets, and then causes bleeding. Gauges show local damage, venom spread, muscle power, breathing, factor use and bleeding. Treatments are immobilisation, ventilation with blood products, and anti-snake venom.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or product names are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "snake.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Immobilise and reassure", withLabel: "With anti-snake venom",
  sourcesLis: [
    "<strong>How snake venom acts.</strong> Elapid venoms rich in neurotoxins block the neuromuscular junction, at the nerve ending or at the acetylcholine receptor, so signals fail and weakness descends from the eyes and bulbar muscles to the breathing muscles. Viper venoms rich in procoagulant enzymes switch on clotting, fibrin forms and factors and platelets are consumed, so blood can then fail to clot and bleeding follows. Many venoms also injure tissue at the bite, causing swelling, blistering and necrosis. This is standard teaching in toxinology and emergency medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Immobilising the limb and reassuring the patient slows venom spread. Anti-snake venom neutralises circulating venom but does not undo established tissue necrosis. Ventilation supports breathing while paralysis recovers, and blood products replace consumed clotting factors and platelets. These are teaching toggles only.",
  ],
  simplified: "Venom variation between species, dry bites, first aid pressure bandaging detail, wound care and surgery, kidney and muscle breakdown complications, repeat dosing and product choice, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sn-divider{stroke:var(--anatomy-mid);stroke-width:1;opacity:.35}
.sn-guide{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 5;opacity:.35}
.sn-snakeBody{fill:none;stroke:#5da24a;stroke-width:15;stroke-linecap:round}
.sn-snakeHead{fill:#5da24a;stroke:#3f7a32;stroke-width:1}
.sn-eye{fill:#17240f;stroke:none}
.sn-fang{fill:none;stroke:var(--anatomy-strong);stroke-width:2.2;stroke-linecap:round}
.sn-tongue{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.sn-splint{fill:var(--c-fl);stroke:none}
.sn-swell{fill:color-mix(in srgb,var(--c-bad) 14%,transparent);stroke:var(--c-bad);stroke-width:2}
.sn-nec{fill:#4a1f2e;stroke:#2b1019;stroke-width:1}
.sn-fangMark{fill:#3a1414;stroke:none}
.sn-cleft{fill:color-mix(in srgb,var(--c-lymph) 16%,transparent);stroke:none}
.sn-tube{fill:none;stroke:var(--c-fl);stroke-width:3;stroke-linecap:round}
.sn-shield{fill:color-mix(in srgb,var(--c-good) 12%,transparent);stroke:var(--c-good);stroke-width:2.5}
.sn-mglow{fill:var(--c-fl);stroke:none}
.sn-rec{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.7}
.sn-block{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.sn-venom{--cc:#f59e0b}
.sn-ach{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 50%,#000);stroke-width:.5}
.sn-asvP{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}
.sn-airP{fill:none;stroke:var(--c-fl);stroke-width:1.4}
.sn-trans{--cc:var(--c-plt)}
.sn-cap{fill:var(--anatomy-strong);font-size:12px}
`,
});
