/* Protein-energy malnutrition as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/kwash.mjs [--print-model]
 * Static layout here; body, stores and gauges move in kwash.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Malnutrition pattern", a: [0.5, 0.75, 1], names: ["marasmus", "kwashiorkor", "marasmic kwashiorkor"], ticks: ["marasmus", "kwashiorkor", "mixed"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "careful refeeding" },
    { label: "treat infection" },
    { label: "micronutrients" },
    { label: "careful refeeding, infection care and micronutrients" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "careful refeeding", "treat infection", "micronutrients", "combined care"],
};
function modelOf(S, level, drug) {
  const T = [
    { waste: 0.95, alb: 0.66, oed: 0.05, fat: 0.08, immLoss: 0.55, adapt: 0.78, belly: 0.08 },
    { waste: 0.42, alb: 0.22, oed: 0.88, fat: 0.88, immLoss: 0.72, adapt: 0.24, belly: 0.72 },
    { waste: 0.92, alb: 0.17, oed: 0.82, fat: 0.8, immLoss: 0.92, adapt: 0.14, belly: 0.6 },
  ];
  const b = T[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const refeed = drug === 1 || drug === 4 ? 1 : 0;
  const antiInf = drug === 2 || drug === 4 ? 1 : 0;
  const micro = drug === 3 || drug === 4 ? 1 : 0;
  const Waste = cl(b.waste - 0.34 * refeed - 0.08 * antiInf - 0.05 * micro);
  const Alb = cl(b.alb + 0.26 * refeed + 0.1 * antiInf + 0.06 * micro);
  const Oed = cl(b.oed - 0.28 * refeed - 0.06 * antiInf - 0.04 * micro);
  const Fat = cl(b.fat - 0.34 * refeed - 0.05 * micro);
  const ImmLoss = cl(b.immLoss - 0.14 * refeed - 0.24 * antiInf - 0.26 * micro);
  const Inf = cl(0.12 + 0.78 * ImmLoss - 0.34 * antiInf - 0.08 * micro);
  const Adapt = cl(b.adapt + 0.12 * refeed + 0.3 * micro);
  const Belly = cl(b.belly - 0.3 * refeed);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(Waste, 0.35, 0.7, ["mild", "moderate", "severe"]),
    w(1 - Alb, 0.35, 0.65, ["preserved", "low", "very low"]),
    w(Oed, 0.2, 0.55, ["absent", "present", "marked"]),
    w(Fat, 0.2, 0.55, ["absent", "present", "marked"]),
  ];
  return { Waste, Alb, Oed, Fat, ImmLoss, Inf, Adapt, Belly, refeed, antiInf, micro, words, readout: "wasting " + words[0] + " · albumin " + words[1] + " · oedema " + words[2] + " · fatty liver " + words[3] };
}
const TESTS = [
  [0, 0, "wasting severe · albumin preserved · oedema absent · fatty liver absent"],
  [1, 0, "wasting moderate · albumin very low · oedema marked · fatty liver marked"],
  [2, 0, "wasting severe · albumin very low · oedema marked · fatty liver marked"],
  [1, 4, "wasting mild · albumin low · oedema present · fatty liver present"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="kw-node kw-n1" x="40" y="84" width="190" height="76" rx="12"/>
<rect class="kw-node kw-n2" x="40" y="184" width="190" height="190" rx="12"/>
<rect class="kw-node kw-n7" x="270" y="394" width="420" height="36" rx="10"/>
<path class="kw-arrow" d="M440 406 C 470 392, 490 392, 520 406"/>
<path class="kw-arrow" d="M520 424 C 490 438, 470 438, 440 424"/>
<polygon class="kw-head" points="520,406 508,402 510,414"/>
<polygon class="kw-head" points="440,424 452,428 450,416"/>
<path id="feedLine" class="kw-feed" d="M135 152 C 240 152, 340 140, 468 140" opacity="0"/>
<path id="leakLine" class="kw-leak" d="M825 252 L825 317" opacity="0"/>
<g id="liverSlot"></g>
<g id="intakeIn"></g>
<g id="muscleIn"></g>
<g id="fatIn"></g>
<g id="liverIn"></g>
<g id="albIn"></g>
<g id="oedIn"></g>
<g id="child"></g>
<g id="immuneIn"></g>
<g id="infIn"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "malnutrition-kwashiorkor-marasmus", fig: "Fig 1", title: "Protein-energy malnutrition: marasmus and kwashiorkor", W, H, body,
  label: "An animated child figure with food intake, muscle and fat stores, liver, blood albumin, tissue oedema, immunity and infection. Marasmus shows severe wasting with albumin relatively preserved and no oedema. Kwashiorkor shows low albumin, oedema, fatty liver, belly swelling, hair and skin change with less wasting. The mixed form shows both. Gauges show wasting, albumin, oedema, fatty liver, immunity and infection. Treatment choices include careful refeeding, treating infection and micronutrients.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "kwash.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With combined care",
  extraCss: `
.kw-node{stroke:var(--anatomy-mid);stroke-width:1}
.kw-n1{fill:color-mix(in srgb,var(--c-b) 22%,var(--anatomy-paper))}
.kw-n2{fill:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-paper))}
.kw-n7{fill:color-mix(in srgb,var(--c-good) 14%,var(--anatomy-paper))}
.kw-cap{fill:var(--anatomy-strong);font-size:12px}
.kw-feed{fill:none;stroke:var(--c-b);stroke-width:3;stroke-linecap:round;stroke-dasharray:6 5}
.kw-leak{fill:none;stroke:var(--c-fl);stroke-width:3;stroke-linecap:round;stroke-dasharray:5 4}
.kw-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.kw-head{fill:var(--anatomy-mid)}
.kw-skin{fill:color-mix(in srgb,var(--c-donor) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-donor) 60%,#000);stroke-width:1}
.kw-limb{fill:color-mix(in srgb,var(--c-donor) 48%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-donor) 55%,#000);stroke-width:.8}
.kw-hair{fill:color-mix(in srgb,var(--c-bad) 35%,#3a2418)}
.kw-hairpale{fill:#d9a05a}
.kw-belly{fill:color-mix(in srgb,var(--c-donor) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-donor) 50%,#000);stroke-width:.8}
.kw-oed{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:.7}
.kw-flake{fill:color-mix(in srgb,var(--c-bad) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 50%,#000);stroke-width:.5}
.kw-bowl{fill:color-mix(in srgb,var(--c-th2) 35%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:1}
.kw-food{fill:var(--c-b)}
.kw-fibre{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.7}
.kw-adip{fill:color-mix(in srgb,var(--c-plt) 65%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.8}
.kw-fatdrop{fill:#f5d76a;stroke:#a8842a;stroke-width:.6}
.kw-fatglow{fill:#f5d76a;stroke:none}
.kw-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:.8}
.kw-tis{fill:color-mix(in srgb,var(--c-fl) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8}
.kw-paths{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.p-food{fill:var(--c-b)}.p-alb{fill:var(--c-lymph)}.p-oedp{fill:var(--c-fl)}.p-path{fill:var(--c-bad)}.p-abx{fill:var(--c-good)}.p-mic{fill:#ffd97a}
.dr-g-fill.g-waste{fill:var(--c-rbc)}.dr-g-fill.g-alb{fill:var(--c-lymph)}.dr-g-fill.g-oedg{fill:var(--c-fl)}.dr-g-fill.g-fatg{fill:var(--c-plt)}.dr-g-fill.g-imm{fill:var(--c-good)}.dr-g-fill.g-inf{fill:var(--c-bad)}
`,
  sourcesLis: [
    "<strong>How protein-energy malnutrition develops.</strong> Too little food overall gives marasmus: fat and muscle are broken down for energy, growth stops and the child is severely wasted, while blood albumin is relatively preserved and oedema is absent because adaptation still protects visceral protein. Too little protein with relatively more carbohydrate, often after weaning or during infection, gives kwashiorkor: albumin and other visceral proteins fall, fluid leaks into tissues as oedema, fat cannot be exported from the liver so the liver becomes fatty and enlarged, and hair, skin and mood change. The mixed form, marasmic kwashiorkor, has severe wasting with oedema. In all forms immunity is weakened, so infection is more likely and more severe, and infection in turn reduces appetite and increases losses, closing a vicious cycle. This is standard teaching in nutrition and paediatrics texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Careful gradual refeeding (abrupt full feeding can be dangerous), prompt treatment of infection, and replacing missing micronutrients. These are teaching toggles only, with no feeds, products or doses shown.",
  ],
  simplified: "Hormonal adaptation in detail (insulin, cortisol, growth hormone), refeeding syndrome electrolytes, specific micronutrient deficiencies, HIV and tuberculosis associations, appetite stimulants, ready-to-use therapeutic food composition, and all admission criteria, feed volumes and doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
