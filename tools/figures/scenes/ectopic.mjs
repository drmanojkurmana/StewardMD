/* Ectopic pregnancy as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ectopic.mjs [--print-model]
 * A fertilised egg implants outside the uterine cavity, most often in the ampulla of a fallopian tube
 * damaged by infection or surgery. Trophoblast invades the thin tube wall; the tube leaks or ruptures,
 * bleeding into the abdomen with pain and shock. hCG rises slowly. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of the ectopic pregnancy", a: [0.3, 0.65, 1], names: ["unruptured", "leaking", "ruptured"], ticks: ["unruptured", "leaking", "ruptured"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "expectant (watch and wait)" },
    { label: "methotrexate (stops growth)" },
    { label: "surgery (removes the ectopic)" },
  ],
  status: "Ectopic pregnancy: {level} · {drug} ·",
  drugNames: ["no treatment", "expectant care", "methotrexate", "surgery"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const INV_EFF = [[1, 1, 1], [0.5, 0.9, 1], [0.3, 0.4, 0.9], [0.05, 0.05, 0.08]];
  const BLEED_EFF = [[1, 1, 1], [0.5, 0.95, 1], [0.4, 0.6, 0.95], [0.08, 0.1, 0.12]];
  const HCG_EFF = [[1, 1, 1], [0.5, 0.92, 1], [0.35, 0.4, 0.85], [0.1, 0.1, 0.12]];
  const BLEED0 = [0.06, 0.52, 0.95];
  const HCG0 = [0.45, 0.55, 0.6];
  const inv = cl((0.15 + 0.8 * a) * INV_EFF[drug][level]);
  const bleed = cl(BLEED0[level] * BLEED_EFF[drug][level]);
  const wall = cl(0.12 + 0.85 * inv * (0.4 + 0.6 * a));
  const pain = cl((0.18 + 0.42 * inv + 0.45 * bleed) * (drug === 3 ? 0.55 : 1));
  const shock = cl(0.03 + 0.85 * bleed - (drug === 3 ? 0.18 : 0));
  const hcg = cl(HCG0[level] * HCG_EFF[drug][level]);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(inv, 0.28, 0.6, ["resolving", "growing", "invading"]), w(bleed, 0.18, 0.55, ["none", "leaking", "heavy"]), w(shock, 0.22, 0.5, ["absent", "threatened", "present"])];
  return { a, inv, bleed, wall, pain, shock, hcg, mtx: drug === 2 ? 1 : 0, surg: drug === 3 ? 1 : 0, exp: drug === 1 ? 1 : 0, words, readout: "mass " + words[0] + " · bleeding " + words[1] + " · shock " + words[2] };
}
const TESTS = [
  [0, 0, "mass growing · bleeding none · shock absent"],
  [2, 0, "mass invading · bleeding heavy · shock present"],
  [2, 3, "mass resolving · bleeding none · shock absent"],
  [0, 1, "mass resolving · bleeding none · shock absent"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path id="tube" class="ect-tube" d="M167 252C317 250 474 243 704 229"/>
<path id="tubeIn" class="ect-tube-in" d="M167 252C317 250 474 243 704 229"/>
<g id="ovSlot"></g><g id="uterSlot"></g>
<g id="cells"></g><g id="anatomy"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "ectopic-pregnancy", fig: "Fig 1", title: "Ectopic pregnancy: implantation in the tube", W, H, body,
  label: "An animated view of an ectopic pregnancy, read left to right. An egg leaves the ovary and travels down the fallopian tube toward the uterus, but scar tissue from infection or surgery traps it, so it implants in the tube instead of the uterine cavity, most often in the ampulla. Trophoblast invades the thin tube wall. The tube leaks or ruptures and blood collects in the abdomen, causing pain and shock. The uterus stays empty and hCG rises slowly. Gauges show growth, wall invasion, bleeding, pain, hCG and shock. Treatments are expectant care for a small fading pregnancy, methotrexate which stops growth, or surgery which removes the ectopic.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ectopic.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With surgery",
  sourcesLis: [
    "<strong>How an ectopic pregnancy develops.</strong> A fertilised egg normally travels down the fallopian tube and implants in the uterine cavity. If the tube is damaged, for example after infection or surgery, transport fails and the egg implants in the tube itself, most often in its wider ampullary part; implantation can also occur elsewhere outside the cavity. Trophoblast, the outer layer of the early pregnancy, invades the thin tube wall and its vessels. The tube cannot stretch like the uterus, so it leaks or ruptures, bleeding into the peritoneal cavity (haemoperitoneum) and causing abdominal pain and shock. Typical features are a missed period (amenorrhoea), pain and vaginal bleeding, with hCG rising more slowly than in a uterine pregnancy. This is standard teaching in obstetrics and gynaecology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Methotrexate stops trophoblast growing and can resolve an unruptured ectopic pregnancy. Surgery removes the ectopic pregnancy and stops bleeding, and is needed when the tube has ruptured. Expectant care, watching with repeat hCG checks, suits only a small ectopic pregnancy whose hCG is already falling. These are teaching toggles only.",
  ],
  simplified: "Implantation sites outside the tube, diagnostic cut-offs and scan criteria, choice between removing the tube or opening it, drug eligibility rules and dosing, fertility after treatment, and care of shock are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ect-tube{fill:none;stroke:color-mix(in srgb,var(--c-sm) 68%,var(--anatomy-paper));stroke-width:17;stroke-linecap:round}
.ect-tube-in{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke-width:7;stroke-linecap:round}
.ect-mass{fill:color-mix(in srgb,var(--c-bad) 48%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 68%,#000);stroke-width:1.3}
.ect-sac{fill:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1}
.ect-crack{fill:none;stroke:var(--c-bad);stroke-width:1.6;stroke-linecap:round}
.ect-pool{fill:color-mix(in srgb,var(--c-rbc) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.ect-suture{fill:none;stroke:var(--c-fl);stroke-width:2.4;stroke-linecap:round}
.ect-ring{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:6 5}
.ect-cap{font-size:12px;fill:var(--anatomy-strong)}
.p-troph{--cc:var(--c-bad)}.p-hcg{--cc:var(--c-cyt)}.p-drop{fill:var(--c-rbc)}.p-mtx{--cc:#c77ddb}.p-egg{--cc:var(--c-plt)}
.dr-g-fill.g-wall{fill:var(--c-endo)}.dr-g-fill.g-pain{fill:var(--c-neut)}.dr-g-fill.g-hcg{fill:var(--c-cyt)}
`,
});
