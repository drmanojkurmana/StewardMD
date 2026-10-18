/* Pelvic inflammatory disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pid.mjs [--print-model]
 * Static layout here; organisms, cells and gauges move in pid.page.js. Qualitative: no doses, no numbers. */
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
<text class="sc-zone" x="34" y="68">PELVIC ORGANS</text>
<g id="links">
<path class="pid-tube" d="M398 185 C330 162 262 168 208 184"/>
<path class="pid-tube" d="M462 185 C530 162 598 168 652 184"/>
<path class="pid-ut" d="M430 148 C386 168 374 228 390 294 C402 336 458 336 470 294 C486 228 474 168 430 148Z"/>
<path class="pid-cavity" d="M430 178 C408 196 404 240 414 292 L446 292 C456 240 452 196 430 178Z"/>
<rect class="pid-vag" x="408" y="338" width="44" height="94" rx="12"/>
<ellipse class="pid-cervix" cx="430" cy="336" rx="34" ry="17"/>
<ellipse class="pid-ovary" cx="165" cy="190" rx="56" ry="35"/>
<ellipse class="pid-ovary" cx="695" cy="190" rx="56" ry="35"/>
<path class="pid-fimb" d="M208 184 l18 -10 M210 192 l20 -2 M206 176 l14 -14"/>
<path class="pid-fimb" d="M652 184 l-18 -10 M650 192 l-20 -2 M654 176 l-14 -14"/>
<rect class="pid-inset" x="748" y="52" width="188" height="92" rx="12"/>
<path class="pid-diaph" d="M758 78 C810 62 880 62 926 78"/>
<path class="pid-liver" d="M762 92 C800 78 880 78 922 92 C918 122 890 134 842 134 C798 134 770 122 762 92Z"/>
<g id="liverStrings" opacity="0">
<path class="pid-string" d="M790 76 L796 96"/><path class="pid-string" d="M830 70 L834 94"/><path class="pid-string" d="M870 70 L868 94"/><path class="pid-string" d="M905 76 L898 96"/>
</g>
<g id="infLayer">
<ellipse id="infC" class="pid-inflam" cx="430" cy="336" rx="38" ry="20" opacity="0"/>
<path id="infT" class="pid-inflamT" d="M398 185 C330 162 262 168 208 184 M462 185 C530 162 598 168 652 184" opacity="0"/>
<ellipse id="infO" class="pid-inflam" cx="695" cy="190" rx="60" ry="39" opacity="0"/>
<ellipse id="infU" class="pid-inflam" cx="430" cy="240" rx="48" ry="82" opacity="0"/>
</g>
<g id="adhesions" opacity="0">
<path class="pid-adh" d="M640 230 C610 270 640 300 600 330"/>
<path class="pid-adh" d="M700 228 C730 260 715 295 745 320"/>
<path class="pid-adh" d="M220 225 C250 260 235 295 265 322"/>
<path class="pid-adh" d="M480 300 C540 320 580 300 625 322"/>
</g>
<g id="abscessG"></g>
<path id="drainLine" class="pid-drain" d="M716 214 C790 250 830 270 862 292" opacity="0"/>
<rect id="drainBag" class="pid-bag" x="852" y="292" width="46" height="54" rx="8" opacity="0"/>
<g id="partnerG">
<circle class="pid-person" cx="98" cy="346" r="13"/>
<path class="pid-person" d="M98 359 C82 366 76 382 78 398 L118 398 C120 382 114 366 98 359Z"/>
</g>
</g>
<g id="nodes"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-pidut:#e59a88;--c-pidov:#b7a1e6;--c-pidabs:#f08a4b;--c-pidliver:#d63a4a;--c-pidinf:#e5484d}
body[data-theme="light"]{--c-pidut:#d97a68;--c-pidov:#8f72d0;--c-pidabs:#e06a25;--c-pidliver:#c42a3d;--c-pidinf:#c42a3d}
.pid-ut{fill:color-mix(in srgb,var(--c-pidut) 42%,var(--anatomy-paper));stroke:var(--c-pidut);stroke-width:1.6}
.pid-cavity{fill:color-mix(in srgb,var(--c-pidut) 62%,var(--anatomy-paper));stroke:none}
.pid-vag{fill:color-mix(in srgb,var(--c-pidut) 30%,var(--anatomy-paper));stroke:var(--c-pidut);stroke-width:1.4}
.pid-cervix{fill:color-mix(in srgb,var(--c-pidut) 58%,var(--anatomy-paper));stroke:var(--c-pidut);stroke-width:1.4}
.pid-tube{fill:none;stroke:var(--c-pidut);stroke-width:13;stroke-linecap:round}
.pid-fimb{fill:none;stroke:var(--c-pidut);stroke-width:3;stroke-linecap:round}
.pid-ovary{fill:color-mix(in srgb,var(--c-pidov) 48%,var(--anatomy-paper));stroke:var(--c-pidov);stroke-width:1.6}
.cl-ovum{--cc:var(--c-pidov)}
.pid-inset{fill:color-mix(in srgb,var(--anatomy-paper) 82%,var(--c-pidliver));stroke:var(--anatomy-mid);stroke-width:1.2}
.pid-liver{fill:color-mix(in srgb,var(--c-pidliver) 52%,var(--anatomy-paper));stroke:var(--c-pidliver);stroke-width:1.4}
.pid-diaph{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4;stroke-linecap:round}
.pid-string{fill:none;stroke:var(--c-pidabs);stroke-width:1.6}
.pid-inflam{fill:var(--c-pidinf);stroke:none}
.pid-inflamT{fill:none;stroke:var(--c-pidinf);stroke-width:17;stroke-linecap:round}
.pid-adh{fill:none;stroke:var(--c-pidabs);stroke-width:2.2;stroke-dasharray:5 3}
.pid-abs{fill:color-mix(in srgb,var(--c-pidabs) 62%,var(--anatomy-paper));stroke:var(--c-pidabs);stroke-width:1.6}
.pid-absIn{fill:color-mix(in srgb,var(--c-pidabs) 38%,#fff);stroke:none}
.pid-drain{fill:none;stroke:var(--c-fl);stroke-width:3;stroke-dasharray:6 4;stroke-linecap:round}
.pid-bag{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.4}
.pid-person{fill:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.4}
.p-org{--cc:var(--c-bac)}.p-org2{--cc:#ff9a3d}.p-neu2{--cc:var(--c-neut)}
.dr-g-fill.g-inf2{fill:var(--c-pidinf)}.dr-g-fill.g-abs2{fill:var(--c-pidabs)}.dr-g-fill.g-dam{fill:var(--c-bad)}.dr-g-fill.g-ect{fill:var(--c-eos)}.dr-g-fill.g-peri{fill:var(--c-pidabs)}
`;

buildScene({
  id: "pelvic-inflammatory-disease", fig: "Fig 1", title: "Pelvic inflammatory disease: ascent, tubal damage and abscess", W, H, body, extraCss,
  label: "An animated pelvis. Chlamydia and gonorrhoea start at the cervix and ascend through the womb to the fallopian tubes and ovaries. Cervicitis can become salpingitis and then a tubo-ovarian abscess, with adhesions and tubal damage that raise infertility and ectopic pregnancy risk. Spread along the liver capsule gives Fitz-Hugh-Curtis perihepatitis. Gauges show infection, inflammation, abscess, tubal damage, ectopic risk and perihepatitis. Treatments are antibiotics, drainage and partner treatment.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pid.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With combined treatment",
  sourcesLis: [
    "<strong>How pelvic inflammatory disease develops.</strong> Sexually transmitted organisms, most often chlamydia and gonorrhoea, infect the cervix and ascend through the endometrium to the fallopian tubes and ovaries. Inflammation of the tube (salpingitis) can form a tubo-ovarian abscess and leave adhesions and tubal scarring, which raise the risk of infertility and ectopic pregnancy. Infection tracking to the liver capsule causes Fitz-Hugh-Curtis perihepatitis with violin string adhesions. Many infections are silent, so damage can occur before symptoms. This is standard teaching in gynaecology and sexual health texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antibiotics treat the infection, drainage helps a tubo-ovarian abscess that needs it, and treating partners and avoiding reinfection protect against recurrence. They are teaching toggles only and the figure does not choose for any person.",
  ],
  simplified: "Other causative organisms, testing and examination findings, pregnancy and fertility care in detail, surgical choices beyond drainage, antibiotic choice and duration, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
