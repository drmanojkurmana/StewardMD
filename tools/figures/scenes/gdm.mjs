/* Gestational diabetes as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gdm.mjs [--print-model]
 * Static layout here; hormones, glucose, insulin and gauges move in gdm.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Trimester", a: [0.3, 0.65, 1], names: ["first trimester", "second trimester", "third trimester"], ticks: ["first", "second", "third"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "diet and exercise" },
    { label: "metformin" },
    { label: "insulin" },
  ],
  status: "Pregnancy: {level} · {drug} ·",
  drugNames: ["no treatment", "diet and exercise", "metformin", "insulin"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const RES = [0, 0.06, 0.16, 0.02];
  const LOAD = [1, 0.82, 0.9, 0.96];
  const TX = [0, 0.08, 0.14, 0.38];
  const EXO = [0, 0, 0, 0.55];
  const R = cl(0.1 + 0.8 * a - RES[drug]);
  const Beta = cl(0.28 + 0.58 * a);
  const BetaEff = cl(Beta * (1 - 0.6 * R));
  const G = cl((0.12 + 0.62 * R + 0.16 * a) * LOAD[drug] - 0.22 * BetaEff - TX[drug]);
  const T = cl(G * 0.96);
  const F = cl(0.08 + 0.88 * T);
  const Gr = cl(0.06 + 0.9 * F);
  const N = cl(0.04 + 0.92 * F);
  const exo = EXO[drug];
  const tx = drug === 0 ? 0 : 1;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(G, 0.38, 0.62, ["controlled", "raised", "high"]), w(F, 0.38, 0.62, ["low", "raised", "high"]), w(Gr, 0.38, 0.65, ["typical", "increased", "marked"])];
  return { a, R, Beta, BetaEff, G, T, F, Gr, N, exo, tx, drug, words, readout: "maternal glucose " + words[0] + " · fetal insulin " + words[1] + " · baby growth " + words[2] };
}
const TESTS = [
  [0, 0, "maternal glucose controlled · fetal insulin low · baby growth typical"],
  [2, 0, "maternal glucose high · fetal insulin high · baby growth marked"],
  [2, 2, "maternal glucose raised · fetal insulin raised · baby growth increased"],
  [2, 3, "maternal glucose controlled · fetal insulin low · baby growth typical"],
];

/* ---------------- static layout ---------------- */
const CY = 345;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<line class="gdm-div" x1="320" y1="52" x2="320" y2="300"/>
<line class="gdm-div" x1="640" y1="52" x2="640" y2="300"/>
<text class="sc-zone" x="34" y="68">PLACENTA</text>
<text class="sc-zone" x="340" y="68">MOTHER</text>
<text class="sc-zone" x="660" y="68">FETUS</text>
<g id="placenta">
  <ellipse class="gdm-plac" cx="155" cy="200" rx="80" ry="64"/>
  <ellipse class="gdm-pool" cx="155" cy="200" rx="62" ry="48"/>
  <circle class="gdm-villi" cx="120" cy="176" r="16"/><circle class="gdm-villi" cx="160" cy="166" r="13"/>
  <circle class="gdm-villi" cx="190" cy="190" r="15"/><circle class="gdm-villi" cx="135" cy="220" r="14"/>
  <circle class="gdm-villi" cx="175" cy="230" r="12"/>
  <path class="gdm-plate" d="M205 156 C225 180 225 220 205 244"/>
</g>
<path id="cord" class="gdm-cord" d="M232 220 C400 252 560 252 748 222"/>
<g id="muscleSlot"></g>
<g id="pancSlot"></g>
<g id="recSlot"></g>
<ellipse id="halo" class="gdm-halo" cx="810" cy="200" rx="95" ry="75" opacity="0"/>
<g id="fetusG">
  <ellipse class="gdm-fetus" cx="0" cy="18" rx="46" ry="36"/>
  <circle class="gdm-fetus" cx="-28" cy="-28" r="27"/>
  <ellipse class="gdm-fat" cx="0" cy="18" rx="46" ry="36" opacity="0"/>
  <circle class="gdm-fat" cx="-28" cy="-28" r="27" opacity="0"/>
  <circle class="gdm-eye" cx="-36" cy="-32" r="3"/>
  <path class="gdm-limb" d="M18 42 Q34 58 48 48M-8 50 Q4 64 20 58"/>
  <circle class="gdm-fpan" cx="8" cy="18" r="8"/>
</g>
<rect id="lumen" class="gdm-vessel" x="14" y="${CY - 35}" width="${W - 28}" height="70"/>
<rect id="wash" class="gdm-wash" x="14" y="${CY - 35}" width="${W - 28}" height="70" opacity="0"/>
<rect class="gdm-barrier" x="632" y="${CY - 35}" width="16" height="70"/>
<path id="exoPath" class="gdm-exo" d="M480 62 C480 140 478 220 470 300" opacity="0.25"/>
<g id="flow"></g><g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
body{--c-plac:#c978c9;--c-horm:#f08a4b;--c-gluc:#e8d36a;--c-ins:#38d1ff;--c-fins:#3ddc97}
body[data-theme="light"]{--c-plac:#a84fa8;--c-horm:#d96a25;--c-gluc:#b89a1e;--c-ins:#0a7fd1;--c-fins:#0f9f76}
.gdm-div{stroke:var(--anatomy-faint);stroke-width:1;stroke-dasharray:4 5;opacity:.6}
.gdm-plac{fill:var(--c-plac);stroke:color-mix(in srgb,var(--c-plac) 55%,#000);stroke-width:1.4;opacity:.92}
.gdm-pool{fill:color-mix(in srgb,var(--c-plac) 45%,#fff);stroke:none;opacity:.55}
.gdm-villi{fill:color-mix(in srgb,var(--c-plac) 62%,#fff);stroke:color-mix(in srgb,var(--c-plac) 55%,#000);stroke-width:.8;opacity:.9}
.gdm-plate{fill:none;stroke:color-mix(in srgb,var(--c-plac) 55%,#000);stroke-width:2;stroke-linecap:round;opacity:.7}
.gdm-cord{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round;opacity:.85}
.gdm-fetus{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1.3;opacity:.97}
.gdm-fat{fill:var(--c-donor);stroke:none}
.gdm-eye{fill:var(--anatomy-strong);stroke:none}
.gdm-limb{fill:none;stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:5;stroke-linecap:round}
.gdm-fpan{fill:var(--c-fins);stroke:color-mix(in srgb,var(--c-fins) 50%,#000);stroke-width:.8}
.gdm-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-mid));stroke-width:1.2}
.gdm-wash{fill:var(--c-gluc);stroke:none}
.gdm-barrier{fill:var(--c-plac);stroke:color-mix(in srgb,var(--c-plac) 55%,#000);stroke-width:1;opacity:.85}
.gdm-exo{fill:none;stroke:var(--c-ins);stroke-width:3;stroke-linecap:round;stroke-dasharray:7 6}
.gdm-halo{fill:var(--c-donor);stroke:none}
.gdm-veil{fill:var(--c-horm);stroke:none}
.gdm-rec{fill:var(--anatomy-paper);stroke:var(--c-ins);stroke-width:1.2}
.gdm-tab{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}.gdm-tab2{fill:var(--c-bad);opacity:.7}
.gdm-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-horm{--cc:var(--c-horm)}.p-gluc{--cc:var(--c-gluc)}.p-ins{--cc:var(--c-ins)}.p-fins{--cc:var(--c-fins)}
.dr-g-fill.g-horm{fill:var(--c-horm)}.dr-g-fill.g-gluc{fill:var(--c-gluc)}.dr-g-fill.g-ins{fill:var(--c-ins)}.dr-g-fill.g-fins{fill:var(--c-fins)}.dr-g-fill.g-plac{fill:var(--c-plac)}
`;

buildScene({
  id: "gestational-diabetes", fig: "Fig 1", title: "Gestational diabetes: placenta to fetus", W, H, body, extraCss,
  label: "An animated placenta, mother and fetus. Placental hormones rise as pregnancy advances and make maternal tissues resist insulin. The beta cell makes more insulin but cannot fully compensate, so maternal glucose rises. Glucose crosses the placenta, the fetus makes extra insulin, and that drives extra growth and a risk of low glucose after birth. Gauges show insulin resistance, beta cell effort, maternal glucose, glucose crossing, fetal insulin and baby growth, with a note on newborn low glucose risk in the text. Treatment choices include diet and exercise, metformin and insulin.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "gdm.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With insulin",
  sourcesLis: [
    "<strong>How gestational diabetes develops.</strong> As the placenta grows it releases hormones including human placental lactogen and progesterone, with cortisol also contributing. These raise insulin resistance in maternal muscle, fat and liver, so glucose is taken up less readily and the liver releases more. The pancreatic beta cell normally compensates by making more insulin. When it cannot compensate enough, maternal glucose rises. This is standard teaching in medicine, obstetrics and endocrinology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Effects on the fetus.</strong> Maternal glucose crosses the placenta, but maternal insulin does not cross in the same way. The fetus responds with its own extra insulin (fetal hyperinsulinism). Fetal insulin is a growth signal, so extra growth and fat follow (macrosomia). After birth the maternal glucose supply stops at once while fetal insulin remains high for a time, so the newborn can develop low glucose (neonatal hypoglycaemia). Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Diet and exercise lower the glucose load and improve uptake. Metformin improves insulin sensitivity and reduces liver glucose release. Insulin replaces the shortfall in insulin action and lowers maternal glucose, which in turn lowers glucose crossing to the fetus. These are teaching toggles only.",
  ],
  simplified: "Screening and diagnosis, glucose targets, fetal monitoring, delivery timing, other medicines, maternal and fetal complications beyond extra growth and newborn low glucose, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
