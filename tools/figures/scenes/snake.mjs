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
    { label: "anti-snake venom" },
    { label: "ventilation and blood products" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["immobilise and reassure", "anti-snake venom", "ventilation and blood products"],
};
function modelOf(S, level, drug) {
  const PROFILES = [
    { L: 0.9, N: 0.06, H: 0.06 },
    { L: 0.28, N: 0.95, H: 0.08 },
    { L: 0.22, N: 0.08, H: 0.95 },
  ];
  const WORDS = {
    local: ["mild", "moderate", "severe"],
    breath: ["steady", "laboured", "failing"],
    bleed: ["none", "some", "heavy"],
  };
  const cl = (v) => Math.max(0, Math.min(1, v));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const p = PROFILES[level];
  const imm = drug === 0 ? 1 : 0, asv = drug === 1 ? 1 : 0, sup = drug === 2 ? 1 : 0;
  const spreadBase = cl(0.55 * p.L + 0.85 * Math.max(p.N, p.H));
  const Spread = cl(spreadBase * (imm ? 0.48 : asv ? 0.55 : 1));
  const Local = cl(p.L * (imm ? 0.75 : asv ? 0.65 : 0.95) + 0.1 * Spread * p.L);
  const NeuroBlock = cl(p.N * (imm ? 0.55 : asv ? 0.38 : 0.92));
  const Muscle = cl(1 - NeuroBlock);
  const Breath = cl(1 - NeuroBlock * 0.9 + (sup ? NeuroBlock * 0.85 : 0));
  const ClotAct = cl(p.H * (imm ? 0.55 : asv ? 0.32 : 0.92));
  const Consume = cl(ClotAct * 0.92);
  const Bleed = cl(Consume * 0.85 - (sup ? 0.55 * Consume : 0));
  const words = [w(Local, 0.3, 0.6, WORDS.local), w(1 - Breath, 0.25, 0.55, WORDS.breath), w(Bleed, 0.15, 0.4, WORDS.bleed)];
  return { imm, asv, sup, Spread, Local, NeuroBlock, Muscle, Breath, ClotAct, Consume, Bleed, words, readout: "local damage " + words[0] + " · breathing " + words[1] + " · bleeding " + words[2] };
}
const TESTS = [
  [0, 0, "local damage severe · breathing steady · bleeding none"],
  [1, 0, "local damage mild · breathing laboured · bleeding none"],
  [1, 2, "local damage mild · breathing steady · bleeding none"],
  [2, 0, "local damage mild · breathing steady · bleeding heavy"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BITE SITE</text>
<text class="sc-zone" x="330" y="68">NEUROMUSCULAR JUNCTION</text>
<text class="sc-zone" x="650" y="68">BLOOD AND CLOTTING</text>
<path class="sn-divider" d="M312 84V424M632 84V424"/>
<g id="snakeG">
  <path class="sn-snakeBody" d="M34 168C58 118 96 102 132 132"/>
  <ellipse class="sn-snakeHead" cx="142" cy="148" rx="26" ry="18" transform="rotate(28 142 148)"/>
  <circle class="sn-eye" cx="150" cy="142" r="3"/>
  <path class="sn-fang" d="M158 162L152 194M170 158L168 192"/>
  <path class="sn-tongue" d="M164 150L184 142M184 142L190 136M184 142L191 146"/>
</g>
<rect class="sn-splint" id="splintTop" x="48" y="184" width="204" height="11" rx="5"/>
<rect class="sn-skin" x="55" y="195" width="190" height="95" rx="47"/>
<rect class="sn-splint" id="splintBot" x="48" y="290" width="204" height="11" rx="5"/>
<ellipse id="swell" class="sn-swell" cx="155" cy="242" rx="86" ry="52"/>
<ellipse id="necrosis" class="sn-nec" cx="155" cy="242" rx="30" ry="22"/>
<circle class="sn-fangMark" cx="150" cy="200" r="3.4"/><circle class="sn-fangMark" cx="166" cy="200" r="3.4"/>
<g id="nmjG">
  <rect class="sn-axon" x="452" y="78" width="16" height="48" rx="7"/>
  <ellipse class="sn-nerve" cx="460" cy="168" rx="78" ry="46"/>
  <ellipse class="sn-nerveIn" cx="446" cy="154" rx="42" ry="22"/>
  <g id="recs"></g>
  <g id="blockMarks"></g>
  <g id="muscleG">
    <rect id="muscleRect" class="sn-muscle" x="358" y="288" width="204" height="68" rx="18"/>
    <path class="sn-stri" d="M382 292V352M412 292V352M442 292V352M472 292V352M502 292V352M532 292V352"/>
  </g>
</g>
<g id="vesselG">
  <rect class="sn-lumen" x="650" y="182" width="272" height="78" rx="39"/>
  <path class="sn-wall" d="M658 190H914M658 252H914"/>
  <g id="platelets"></g>
  <g id="clotG"></g>
  <g id="rbcs2"></g>
</g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "snake-bite-envenomation", fig: "Fig 1", title: "Snake envenomation: local, nerve and blood effects", W, H, body,
  label: "An animated scene of snake envenomation. Venom at the bite site injures local tissue. Neurotoxic venom reaches the neuromuscular junction and blocks signalling to muscle, causing descending paralysis and breathing failure. Haemotoxic venom activates clotting, uses up clotting factors and platelets, and then causes bleeding. Gauges show local damage, venom spread, muscle power, breathing, factor use and bleeding. Treatments are immobilisation, anti-snake venom, and ventilation with blood products.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or product names are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "snake.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Immobilise and reassure", withLabel: "Ventilation and blood products",
  sourcesLis: [
    "<strong>How snake venom acts.</strong> Elapid venoms rich in neurotoxins block the neuromuscular junction, at the nerve ending or at the acetylcholine receptor, so signals fail and weakness descends from the eyes and bulbar muscles to the breathing muscles. Viper venoms rich in procoagulant enzymes switch on clotting, fibrin forms and factors and platelets are consumed, so blood can then fail to clot and bleeding follows. Many venoms also injure tissue at the bite, causing swelling, blistering and necrosis. This is standard teaching in toxinology and emergency medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Immobilising the limb and reassuring the patient slows venom spread. Anti-snake venom neutralises circulating venom but does not undo established tissue necrosis or all established paralysis. Ventilation supports breathing while paralysis recovers, and blood products replace consumed clotting factors and platelets. These are teaching toggles only.",
  ],
  simplified: "Venom variation between species, dry bites, first aid pressure bandaging detail, wound care and surgery, kidney and muscle breakdown complications, repeat dosing and product choice, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sn-divider{stroke:var(--anatomy-mid);stroke-width:1;opacity:.35}
.sn-snakeBody{fill:none;stroke:#5da24a;stroke-width:15;stroke-linecap:round}
.sn-snakeHead{fill:#5da24a;stroke:#3f7a32;stroke-width:1}
.sn-eye{fill:#17240f}
.sn-fang{stroke:var(--anatomy-strong);stroke-width:2.2;stroke-linecap:round}
.sn-tongue{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.sn-skin{fill:color-mix(in srgb,var(--c-donor) 58%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-donor) 55%,#000);stroke-width:1}
.sn-splint{fill:var(--c-fl);opacity:.3}
.sn-swell{fill:none;stroke:var(--c-bad);stroke-width:2;opacity:0}
.sn-nec{fill:#4a1f2e;stroke:#2b1019;stroke-width:1;opacity:0}
.sn-fangMark{fill:#3a1414}
.sn-axon{fill:var(--c-lymph)}
.sn-nerve{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:1}
.sn-nerveIn{fill:color-mix(in srgb,var(--c-lymph) 45%,#fff);opacity:.55}
.sn-muscle{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1;opacity:.75}
.sn-stri{stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1;opacity:.4}
.sn-rec{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.7}
.sn-block{stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.sn-lumen{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:1}
.sn-wall{stroke:var(--c-endo);stroke-width:3;opacity:.7}
.sn-venom{--cc:#f59e0b}
.sn-ach{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 50%,#000);stroke-width:.5}
.sn-asvP{fill:none;stroke:var(--c-ab);stroke-width:1.8;stroke-linecap:round}
.sn-airP{fill:none;stroke:var(--c-fl);stroke-width:1.4}
`,
});
