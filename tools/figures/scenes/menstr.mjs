/* Menstrual cycle and contraception as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/menstr.mjs [--print-model]
 * Static layout here; hormones, follicle, endometrium and gauges move in menstr.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Phase of the cycle", a: [0, 0.25, 0.5, 0.75, 1], names: ["menses", "follicular", "late follicular", "ovulation", "luteal"], ticks: ["menses", "follicular", "late follicular", "ovulation", "luteal"], start: 1 },
  drugLabel: "Hormone treatment",
  settings: [
    { label: "no hormone treatment" },
    { label: "combined pill" },
    { label: "progestogen only" },
  ],
  status: "Cycle phase: {level} · {drug} ·",
  drugNames: ["no hormone treatment", "combined pill", "progestogen only method"],
};
function modelOf(S, level, drug) {
  const TAB = {
    gnrh: [0.48, 0.58, 0.78, 0.86, 0.34],
    fsh: [0.66, 0.6, 0.44, 0.52, 0.28],
    lh: [0.3, 0.36, 0.66, 1, 0.24],
    e2: [0.14, 0.46, 0.96, 0.68, 0.44],
    p4: [0.05, 0.08, 0.12, 0.26, 0.96],
    foll: [0.18, 0.52, 0.94, 0.86, 0.14],
    clu: [0, 0, 0.06, 0.34, 1],
    endo: [0.14, 0.46, 0.72, 0.78, 0.96],
    ov: [0, 0, 0.08, 1, 0],
    bleed: [1, 0.08, 0, 0, 0.04],
    muc: [0.55, 0.35, 0.12, 0.05, 0.65],
  };
  const cl = (v) => Math.max(0, Math.min(1, v));
  let GnRH = TAB.gnrh[level], FSH = TAB.fsh[level], LH = TAB.lh[level], E2 = TAB.e2[level], P4 = TAB.p4[level];
  let Foll = TAB.foll[level], CLu = TAB.clu[level], Endo = TAB.endo[level], Ov = TAB.ov[level], Bleed = TAB.bleed[level], Muc = TAB.muc[level];
  if (drug === 1) {
    GnRH = cl(GnRH * 0.22); FSH = cl(FSH * 0.2); LH = cl(Math.min(LH * 0.16, 0.18)); E2 = cl(E2 * 0.18); P4 = cl(Math.min(P4, 0.1));
    Foll = cl(Math.min(Foll * 0.15, 0.12)); CLu = 0; Ov = 0; Endo = cl(Math.min(Endo, 0.2)); Bleed = level === 0 ? 0.3 : 0.03; Muc = 0.85;
  } else if (drug === 2) {
    GnRH = cl(GnRH * 0.62); FSH = cl(FSH * 0.66); LH = cl(Math.min(LH * 0.42, 0.42)); E2 = cl(E2 * 0.58); P4 = cl(Math.min(P4 * 0.35, 0.28));
    Foll = cl(Foll * 0.55); CLu = cl(CLu * 0.4); Ov = cl(Ov * 0.62); Endo = cl(Math.min(Endo, 0.3)); Bleed = level === 0 ? 0.45 : 0.12; Muc = 0.95;
  }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(LH, 0.4, 0.75, ["low", "rising", "surge"]), w(E2, 0.32, 0.65, ["low", "rising", "high"]), w(P4, 0.3, 0.65, ["low", "rising", "high"]), w(Endo, 0.35, 0.68, ["thin", "growing", "thick"])];
  const ovWord = Ov > 0.5 ? "ovulation" : "no ovulation";
  return { GnRH, FSH, LH, E2, P4, Foll, CLu, Endo, Ov, Bleed, Muc, comb: drug === 1 ? 1 : 0, pop: drug === 2 ? 1 : 0, words, readout: "LH " + words[0] + " · oestradiol " + words[1] + " · progesterone " + words[2] + " · " + ovWord + " · endometrium " + words[3] };
}
const TESTS = [
  [0, 0, "LH low · oestradiol low · progesterone low · no ovulation · endometrium thin"],
  [2, 0, "LH rising · oestradiol high · progesterone low · no ovulation · endometrium thick"],
  [3, 0, "LH surge · oestradiol high · progesterone low · ovulation · endometrium thick"],
  [3, 1, "LH low · oestradiol low · progesterone low · no ovulation · endometrium thin"],
  [3, 2, "LH rising · oestradiol rising · progesterone low · ovulation · endometrium thin"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BRAIN</text>
<text class="sc-zone" x="400" y="68">OVARY</text>
<text class="sc-zone" x="700" y="68">WOMB</text>
<g id="brainSlot"></g>
<g id="ovarySlot"></g>
<g id="uterSlot"></g>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "menstrual-cycle-axis", fig: "Fig 1", title: "Menstrual cycle and contraception: the hormone axis", W, H, body,
  label: "An animated hormone axis for the menstrual cycle. GnRH pulses from the brain drive FSH and LH, FSH grows an ovarian follicle, the follicle makes oestradiol, an LH surge releases an egg at ovulation, and the remaining corpus luteum makes progesterone. Oestradiol builds the womb lining and progesterone matures it, then hormone fall brings menses. A slider moves through the cycle phases, and treatment choices are a combined pill that switches off the brain signals and a progestogen only method that mainly thickens the mucus gate.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "menstr.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without hormone treatment", withLabel: "With combined pill",
  sourcesLis: [
    "<strong>How the cycle works.</strong> The hypothalamus releases gonadotropin releasing hormone (GnRH) in pulses. GnRH drives the pituitary to release follicle stimulating hormone (FSH) and luteinising hormone (LH). FSH grows a follicle in the ovary, and the growing follicle makes oestradiol. A sustained high oestradiol switches feedback from negative to positive and triggers the LH surge, which causes ovulation. The ruptured follicle becomes the corpus luteum and makes progesterone. Oestradiol makes the endometrium proliferate, progesterone makes it secretory and ready for implantation, and when hormone levels fall the lining sheds as menses. This is standard teaching in physiology, gynaecology and reproductive medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Contraception ideas shown.</strong> A combined pill provides oestrogen and progestogen feedback that suppresses GnRH, FSH and the LH surge, so follicle growth and ovulation are prevented and the endometrium stays thin. A progestogen only method mainly thickens cervical mucus so sperm cannot pass and thins the endometrium, while ovulation can still occur in many cycles. These are teaching toggles only.",
  ],
  simplified: "Fertilisation, implantation and pregnancy, the detailed pulse frequency change across the cycle, inhibin and other ovarian signals, polycystic ovary syndrome and other cycle disorders, perimenopause, bleeding pattern detail for each contraceptive product, and all doses, timings and product names are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
  extraCss: `
body{--c-gnrh:#3ddc97;--c-fsh:#38d1ff;--c-lh:#ff9a3d;--c-e2:#c084fc;--c-p4:#f2c94c;--c-fol:#f2d27a;--c-clu:#e8a13a}
body[data-theme="light"]{--c-gnrh:#0f9f76;--c-fsh:#0a7fd1;--c-lh:#d96a1e;--c-e2:#7c3aed;--c-p4:#b8962f;--c-fol:#d9a92c;--c-clu:#c9852f}
.mn-route{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:5 4;opacity:.5}
.mn-tube{fill:none;stroke:var(--c-plt);stroke-width:9;stroke-linecap:round;opacity:.55}
.mn-rec{fill:none;stroke:var(--anatomy-hi);stroke-width:1.6;stroke-linecap:round}
.mn-block{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.mn-glow{fill:var(--c-gnrh);stroke:none}
.mn-ring{fill:none;stroke:var(--c-lh);stroke-width:1.6}
.mn-endo{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:.8}
.mn-gland{fill:none;stroke:color-mix(in srgb,var(--c-endo) 45%,#000);stroke-width:1.4;stroke-linecap:round}
.mn-mucus{fill:var(--c-fsh);stroke:color-mix(in srgb,var(--c-fsh) 55%,#000);stroke-width:.6}
.mn-egg{fill:#fff2b8;stroke:#b8962f;stroke-width:1}
.mn-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-hypo{--cc:var(--c-gnrh)}.cl-pit{--cc:var(--c-lh)}.cl-fol{--cc:var(--c-fol)}.cl-clu{--cc:var(--c-clu)}
.p-gnrh{--cc:var(--c-gnrh)}.p-fsh{--cc:var(--c-fsh)}.p-lh{--cc:var(--c-lh)}.p-e2{--cc:var(--c-e2)}.p-p4{--cc:var(--c-p4)}
.p-bleed{fill:var(--c-rbc)}
.dr-g-fill.g-gnrh{fill:var(--c-gnrh)}.dr-g-fill.g-fsh{fill:var(--c-fsh)}.dr-g-fill.g-lh{fill:var(--c-lh)}.dr-g-fill.g-e2{fill:var(--c-e2)}.dr-g-fill.g-p4{fill:var(--c-p4)}.dr-g-fill.g-endo{fill:var(--c-endo)}
`,
});
