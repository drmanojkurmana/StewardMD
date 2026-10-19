/* Pelvic inflammatory disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pid.mjs [--print-model]
 * Static layout here; organisms, cells and gauges move in pid.page.js. Qualitative: no doses, no numbers.
 * Read bottom to top: vagina, cervix, uterus, tubes and ovaries, with the liver capsule top right. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Highest site reached", a: [0.35, 0.65, 1], names: ["cervicitis", "salpingitis", "tubo-ovarian abscess"], ticks: ["cervicitis", "salpingitis", "abscess"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotics" },
    { label: "drainage of abscess" },
    { label: "antibiotics with drainage and partner treatment" },
  ],
  status: "Extent: {level} · {drug} ·",
  drugNames: ["no treatment", "antibiotics", "drainage of abscess", "antibiotics with drainage and partner treatment"],
};
function modelOf(S, level, drug) {
  const fx = [
    { abx: 0, drain: 0, partner: 0 },
    { abx: 1, drain: 0, partner: 0 },
    { abx: 0, drain: 1, partner: 0 },
    { abx: 1, drain: 1, partner: 1 },
  ][drug];
  const reach = [0.3, 0.78, 1][level];
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const B = cl(a * (0.55 + 0.45 * a) * (fx.abx ? 0.14 : 1) * (fx.partner ? 0.8 : 1));
  const I = cl(0.08 + 0.88 * B + 0.25 * a * (fx.abx ? 0.4 : 1));
  const Abs = cl((level === 2 ? 0.25 + 0.75 * a : level === 1 ? 0.12 * a : 0) * (fx.drain ? 0.22 : fx.abx ? 0.62 : 1));
  const D = cl(0.06 + 0.78 * a * a * (fx.abx ? 0.55 : fx.drain ? 0.75 : 1) + 0.35 * Abs);
  const Ect = cl(0.05 + 0.85 * D);
  const Peri = cl(level === 2 ? 0.15 + 0.75 * I : level === 1 ? 0.3 * I : 0.05 * I);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.5, ["controlled", "present", "spreading"]), w(Abs, 0.18, 0.45, ["none", "forming", "large"]), w(D, 0.28, 0.55, ["little", "some", "marked"])];
  return { a, level, drug, reach, abx: fx.abx, drain: fx.drain, partner: fx.partner, B, I, Abs, D, Ect, Peri, words, readout: "infection " + words[0] + " · abscess " + words[1] + " · tubal damage " + words[2] };
}
const TESTS = [
  [1, 0, "infection spreading · abscess none · tubal damage some"],
  [1, 1, "infection controlled · abscess none · tubal damage little"],
  [2, 2, "infection spreading · abscess forming · tubal damage marked"],
  [2, 3, "infection controlled · abscess forming · tubal damage marked"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">PELVIC ORGANS, READ BOTTOM TO TOP</text>
<rect id="insetBox" class="pid-inset" x="748" y="52" width="188" height="100" rx="12"/>
<path id="diaph" class="pid-diaph" d="M758 76 C810 60 880 60 926 76"/>
<g id="uterSlot"></g>
<g id="liverSlot"></g>
<g id="cells"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
body{--c-pidut:#e59a88;--c-pidov:#b7a1e6;--c-pidabs:#f08a4b;--c-pidliver:#d63a4a;--c-pidinf:#e5484d}
body[data-theme="light"]{--c-pidut:#d97a68;--c-pidov:#8f72d0;--c-pidabs:#e06a25;--c-pidliver:#c42a3d;--c-pidinf:#c42a3d}
.pid-inset{fill:color-mix(in srgb,var(--anatomy-paper) 82%,var(--c-pidliver));stroke:var(--anatomy-mid);stroke-width:1.2}
.pid-diaph{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4;stroke-linecap:round}
.pid-string{fill:none;stroke:var(--c-pidabs);stroke-width:1.6}
.pid-inflam{fill:var(--c-pidinf);stroke:none}
.pid-inflamT{fill:none;stroke:var(--c-pidinf);stroke-width:20;stroke-linecap:round}
.pid-halo{fill:var(--c-pidinf);stroke:none}
.pid-vag{fill:color-mix(in srgb,var(--c-pidut) 30%,var(--anatomy-paper));stroke:var(--c-pidut);stroke-width:1.4}
.pid-cervix{fill:color-mix(in srgb,var(--c-pidut) 58%,var(--anatomy-paper));stroke:var(--c-pidut);stroke-width:1.4}
.pid-adh{fill:none;stroke:var(--c-pidabs);stroke-width:2.6;stroke-dasharray:5 3}
.pid-abs{fill:color-mix(in srgb,var(--c-pidabs) 62%,var(--anatomy-paper));stroke:var(--c-pidabs);stroke-width:1.6}
.pid-absIn{fill:color-mix(in srgb,var(--c-pidabs) 38%,#fff);stroke:none}
.pid-drain{fill:none;stroke:var(--c-fl);stroke-width:4;stroke-linecap:round}
.pid-bag{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.6}
.pid-person{fill:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.4}
.pid-shield{fill:none;stroke:var(--c-good);stroke-width:2.6}
.pid-rec{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.pid-dock{fill:var(--anatomy-card);stroke:var(--c-bac);stroke-width:1.4}
.pid-cap{fill:var(--anatomy-strong);font-size:12px}
.p-org{--cc:var(--c-bac)}.p-org2{--cc:#ff9a3d}.p-neu2{--cc:var(--c-neut)}
.dr-g-fill.g-inf2{fill:var(--c-pidinf)}.dr-g-fill.g-abs2{fill:var(--c-pidabs)}.dr-g-fill.g-dam{fill:var(--c-bad)}.dr-g-fill.g-ect{fill:var(--c-eos)}.dr-g-fill.g-peri{fill:var(--c-pidabs)}
`;

buildScene({
  id: "pelvic-inflammatory-disease", fig: "Fig 1", title: "Pelvic inflammatory disease: ascent, tubal damage and abscess", W, H, body, extraCss,
  label: "An animated pelvis, read bottom to top. Chlamydia and gonorrhoea enter through the vagina and start at the cervix, then ascend through the womb to the fallopian tubes and ovaries. Cervicitis can become salpingitis and then a tubo-ovarian abscess, with adhesions and tubal damage that raise infertility and ectopic pregnancy risk. Spread along the liver capsule gives Fitz-Hugh-Curtis perihepatitis. A slider sets the highest site reached, and treatments are antibiotics, drainage and partner treatment.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pid.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With combined treatment",
  sourcesLis: [
    "<strong>How pelvic inflammatory disease develops.</strong> Sexually transmitted organisms, most often chlamydia and gonorrhoea, infect the cervix and ascend through the endometrium to the fallopian tubes and ovaries. Inflammation of the tube (salpingitis) can form a tubo-ovarian abscess and leave adhesions and tubal scarring, which raise the risk of infertility and ectopic pregnancy. Infection tracking to the liver capsule causes Fitz-Hugh-Curtis perihepatitis with violin string adhesions. Many infections are silent, so damage can occur before symptoms. This is standard teaching in gynaecology and sexual health texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antibiotics treat the infection, drainage helps a tubo-ovarian abscess that needs it, and treating partners and avoiding reinfection protect against recurrence. They are teaching toggles only and the figure does not choose for any person.",
  ],
  simplified: "Other causative organisms, testing and examination findings, pregnancy and fertility care in detail, surgical choices beyond drainage, antibiotic choice and duration, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
