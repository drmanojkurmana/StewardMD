/* Endometriosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/endomet.mjs [--print-model]
 * Endometrial-like tissue grows outside the uterus. Retrograde menstruation is one route in.
 * The implants bleed with each cycle, causing inflammation, adhesions and an ovarian
 * endometrioma (chocolate cyst), with pain and subfertility. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Stage of endometriosis", a: [0.25, 0.5, 0.75, 1], names: ["stage I minimal", "stage II mild", "stage III moderate", "stage IV severe"], ticks: ["stage I", "stage II", "stage III", "stage IV"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "analgesia (pain relief only)" },
    { label: "hormonal suppression (stops cycling)" },
    { label: "surgery (removes implants and cyst)" },
  ],
  status: "Endometriosis: {level} · {drug} ·",
  drugNames: ["no treatment", "analgesia", "hormonal suppression", "surgery"],
};
function modelOf(S, level, drug) {
  const IMPL_F = [1, 1, 0.55, 0.15];
  const CYST_F = [1, 1, 0.6, 0.1];
  const ADH_F = [1, 1, 1, 0.35];
  const PAIN_F = [1, 0.35, 0.6, 0.55];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const impl = cl((0.15 + 0.8 * a) * IMPL_F[drug]);
  const infl = cl(impl * (0.65 + 0.4 * a) * (drug === 2 ? 0.65 : 1));
  const cyst = cl(Math.max(0, a - 0.18) * 1.15 * CYST_F[drug] * (0.4 + 0.6 * (impl > 0 ? 1 : 0)));
  const adh = cl((0.06 + 0.88 * a * a) * ADH_F[drug]);
  const pain = cl((0.12 + 0.5 * infl + 0.35 * impl + 0.15 * cyst) * PAIN_F[drug]);
  const fert = cl(0.08 + 0.45 * adh + 0.3 * cyst + 0.28 * impl);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(impl, 0.3, 0.62, ["few", "scattered", "extensive"]), w(pain, 0.28, 0.58, ["mild", "present", "severe"]), w(fert, 0.3, 0.6, ["preserved", "reduced", "markedly reduced"])];
  return { a, impl, infl, cyst, adh, pain, fert, analg: drug === 1 ? 1 : 0, horm: drug === 2 ? 1 : 0, surg: drug === 3 ? 1 : 0, words, readout: "implants " + words[0] + " · pain " + words[1] + " · fertility " + words[2] };
}
const TESTS = [
  [0, 0, "implants scattered · pain present · fertility preserved"],
  [3, 0, "implants extensive · pain severe · fertility markedly reduced"],
  [3, 3, "implants few · pain mild · fertility preserved"],
  [1, 1, "implants scattered · pain mild · fertility reduced"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">PELVIS: TISSUE OUTSIDE THE UTERUS</text>
<g id="drivers"></g><g id="anatomy"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "endometriosis", fig: "Fig 1", title: "Endometriosis: tissue outside the uterus", W, H, body,
  label: "An animated pelvis in front view. Endometrial-like tissue implants outside the uterus, on the peritoneum, ovaries and supporting tissues. Retrograde menstruation through the tubes is one route in. The implants respond to the cycle, bleed, and cause inflammation, adhesions and an ovarian endometrioma called a chocolate cyst. Pain includes dysmenorrhoea and dyspareunia, and fertility can fall. The stage slider changes how much disease is present. Treatments are analgesia, hormonal suppression and surgery. Gauges show implants, inflammation, adhesions, cyst, pain and subfertility.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "endomet.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How endometriosis develops.</strong> Endometriosis is endometrial-like tissue growing outside the uterine cavity, most often on the pelvic peritoneum, ovaries and the tissues behind the uterus. One route is retrograde menstruation, where menstrual tissue passes back through the fallopian tubes into the pelvis and implants; immune, hormonal and inherited factors also play a part, and retrograde flow alone does not explain every case. The implants respond to the hormonal cycle, bleed in place, and provoke inflammation. Repeated bleeding causes scarring and adhesions that can distort the tubes and ovaries. On an ovary, repeated bleeding can form an endometrioma, often called a chocolate cyst because of its old blood content. Typical features are dysmenorrhoea, dyspareunia, chronic pelvic pain and subfertility. This is standard teaching in gynaecology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Analgesia relieves pain without changing the implants. Hormonal suppression stops the cycling that drives bleeding and inflammation while it is used. Surgery removes or destroys implants, divides adhesions and can remove an endometrioma. These are teaching toggles only.",
  ],
  simplified: "Other proposed origins of implants, staging scores in detail, bowel and bladder disease, infertility investigation, recurrence after treatment, drug choices and dosing, and fertility treatment are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.end-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.end-node-t{fill:var(--anatomy-strong);pointer-events:none;font-size:11px;font-weight:600}
.end-node-s{fill:var(--anatomy-text);pointer-events:none;opacity:.85;font-size:9.5px}
.end-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.end-head{fill:var(--anatomy-mid)}
.end-ut{fill:color-mix(in srgb,var(--c-endo) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 62%,#000);stroke-width:1.4}
.end-cav{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:4 3}
.end-lining{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 60%,#000);stroke-width:1}
.end-tube{fill:none;stroke:color-mix(in srgb,var(--c-sm) 68%,var(--anatomy-paper));stroke-width:16;stroke-linecap:round}
.end-tube-in{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke-width:6;stroke-linecap:round}
.end-ovary{fill:color-mix(in srgb,var(--c-plt) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 62%,#000);stroke-width:1.2}
.end-foll{fill:color-mix(in srgb,var(--c-plt) 35%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.8}
.end-cyst{fill:color-mix(in srgb,var(--c-bad) 62%,#2a1408);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:1.3}
.end-cyst-in{fill:color-mix(in srgb,var(--c-bad) 38%,#1c0d05);stroke:none}
.end-implant{fill:color-mix(in srgb,var(--c-bad) 58%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 65%,#000);stroke-width:.9}
.end-adh{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round}
.end-peri{fill:color-mix(in srgb,var(--c-lymph) 12%,transparent);stroke:color-mix(in srgb,var(--c-lymph) 35%,var(--anatomy-mid));stroke-width:1;stroke-dasharray:5 4}
.end-x{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.end-xx{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.p-cell{--cc:var(--c-endo)}.p-med{--cc:#ff9a3d}.p-drop{fill:var(--c-rbc)}
.dr-g-fill.g-infl{fill:#ff9a3d}.dr-g-fill.g-adh{fill:var(--c-plt)}.dr-g-fill.g-cyst{fill:var(--c-bad)}.dr-g-fill.g-pain{fill:var(--c-neut)}.dr-g-fill.g-fert{fill:var(--c-lymph)}
`,
});
