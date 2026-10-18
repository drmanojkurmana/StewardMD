/* Chronic kidney disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ckd.mjs [--print-model]
 * Static layout here; nephrons, blood solutes, hormones and gauges move in ckd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Chronic kidney disease stage", a: [0.12, 0.42, 0.72, 1], names: ["early (stages 1 to 2)", "moderate (stage 3)", "advanced (stage 4)", "kidney failure (stage 5)"], ticks: ["early", "moderate", "advanced", "failure"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "blood pressure control" },
    { label: "phosphate binder and vitamin D" },
    { label: "erythropoietin" },
    { label: "dialysis" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "blood pressure control", "a phosphate binder and vitamin D", "erythropoietin", "dialysis"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const s = S.level.a[level];
  const bpRx = drug === 1 ? 1 : 0, binder = drug === 2 ? 1 : 0, epoRx = drug === 3 ? 1 : 0, dial = drug === 4 ? 1 : 0;
  const N = cl(1 - 0.82 * s);
  const Hf = cl(0.15 + 0.85 * s);
  const GFR = cl(N * (0.75 + 0.55 * Hf));
  let U = cl(0.06 + 0.92 * (1 - GFR));
  let K = cl(0.08 + 0.85 * (1 - GFR));
  let Ac = cl(0.07 + 0.85 * (1 - GFR));
  let Ph = cl(0.08 + 0.88 * (1 - GFR));
  let PTH = cl(0.06 + 0.92 * Ph);
  let BP = cl(0.25 + 0.65 * s);
  let Hb = cl(0.18 + 0.78 * N);
  if (bpRx) BP = cl(BP * 0.42);
  if (binder) { Ph = cl(Ph * 0.45); PTH = cl(PTH * 0.35); }
  if (epoRx) Hb = cl(Hb + 0.5);
  if (dial) { U = cl(U * 0.35); K = cl(K * 0.4); Ac = cl(Ac * 0.4); Ph = cl(Ph * 0.45); PTH = cl(PTH * 0.6); BP = cl(BP * 0.85); }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(GFR, 0.35, 0.75, ["very low", "reduced", "near normal"]), w(U, 0.3, 0.6, ["normal", "raised", "high"]), w(Hb, 0.45, 0.75, ["low", "reduced", "normal"]), w(BP, 0.35, 0.6, ["controlled", "raised", "high"])];
  return { s, N, Hf, GFR, U, K, Ac, Ph, PTH, BP, Hb, bpRx, binder, epoRx, dial, words, readout: "filtration " + words[0] + " · urea " + words[1] + " · haemoglobin " + words[2] + " · pressure " + words[3] };
}
const TESTS = [
  [2, 0, "filtration reduced · urea raised · haemoglobin reduced · pressure high"],
  [2, 1, "filtration reduced · urea raised · haemoglobin reduced · pressure controlled"],
  [2, 3, "filtration reduced · urea raised · haemoglobin normal · pressure high"],
  [2, 4, "filtration reduced · urea normal · haemoglobin reduced · pressure high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">KIDNEY</text>
<text class="sc-zone" x="380" y="68">CIRCULATION AND BODY EFFECTS</text>
<rect class="ck-comp" x="360" y="225" width="270" height="120" rx="12"/>
<rect class="ck-comp" x="645" y="225" width="285" height="120" rx="12"/>
<g id="kid"></g><g id="vess"></g><g id="parts"></g><g id="bonebox"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-urea:#c98a3d;--c-pot:#9a6ae0;--c-acid:#3fbfae;--c-phos:#f08a4b;--c-pth:#e9b84a;--c-epo:#5ec1a0;--c-bone:#e8dcc0}
body[data-theme="light"]{--c-urea:#a86e28;--c-pot:#7c4fc4;--c-acid:#1f8f83;--c-phos:#d96a25;--c-pth:#b8860b;--c-epo:#2f8f6e;--c-bone:#cbb98f}
.cl-neph{--cc:#e58aa5}.cl-scar{--cc:#8d8d96}
.ck-kid{fill:color-mix(in srgb,var(--c-endo) 20%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid));stroke-width:2.4}
.ck-comp{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.65}
.ck-vess{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,var(--anatomy-mid));stroke-width:1.6}
.ck-tub{fill:none;stroke:color-mix(in srgb,var(--c-endo) 60%,var(--anatomy-mid));stroke-width:2;stroke-linecap:round}
.ck-scarx{stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.ck-ureter{fill:none;stroke:color-mix(in srgb,var(--c-fl) 60%,var(--anatomy-mid));stroke-width:5;stroke-linecap:round}
.ck-bone{fill:var(--c-bone);stroke:color-mix(in srgb,var(--c-bone) 55%,#000);stroke-width:1}
.ck-marrow{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:1}
.ck-arrow{fill:none;stroke:var(--c-epo);stroke-width:1.6;stroke-dasharray:5 5;opacity:.55}
.ck-mach{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.6}
.ck-machin{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.p-urea{--cc:var(--c-urea)}.p-pot{--cc:var(--c-pot)}.p-acid{--cc:var(--c-acid)}.p-phos{--cc:var(--c-phos)}.p-pth{--cc:var(--c-pth)}.p-epo{--cc:var(--c-epo)}.p-filt{fill:var(--c-fl)}
.dr-g-fill.g-urea{fill:var(--c-urea)}.dr-g-fill.g-pot{fill:var(--c-pot)}.dr-g-fill.g-acid{fill:var(--c-acid)}.dr-g-fill.g-phos{fill:var(--c-phos)}
`;

buildScene({
  id: "chronic-kidney-disease", fig: "Fig 1", title: "Chronic kidney disease: nephron loss and its body-wide effects", W, H, body, extraCss,
  label: "An animated kidney beside a blood vessel and two body compartments. Nephrons are lost as the stage worsens and the nephrons that remain enlarge and filter more each (hyperfiltration), so overall filtration is held up early and then falls. When filtration falls, urea, potassium, acid and phosphate are retained in the blood. Low erythropoietin from the failing kidney lowers red cell production in the marrow and causes anaemia. Retained phosphate drives the parathyroid glands to release more parathyroid hormone, which thins bone. Salt and water retention raises blood pressure. Gauges show filtration, urea, potassium, acid load, phosphate, parathyroid hormone, haemoglobin and pressure. Treatment choices include blood pressure control, a phosphate binder with vitamin D, erythropoietin and dialysis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ckd.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With dialysis",
  sourcesLis: [
    "<strong>How chronic kidney disease develops.</strong> Nephrons are lost over time from causes such as diabetes, high blood pressure, glomerular disease and ageing. The nephrons that remain adapt by filtering more each (hyperfiltration and enlargement), which holds total filtration up for a while but adds strain. As loss continues, total filtration (GFR) falls and waste products that the kidney normally clears, including urea, potassium, hydrogen ions (acid) and phosphate, are retained. This is standard teaching in medicine and nephrology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Blood, mineral and pressure effects.</strong> The healthy kidney makes erythropoietin, the hormone that tells the bone marrow to make red cells; when it falls, anaemia follows. Retained phosphate, together with disturbed vitamin D and calcium, drives the parathyroid glands to release more parathyroid hormone (secondary hyperparathyroidism), which draws calcium from bone and thins it. Retained salt and water, with activation of pressure-raising systems, causes hypertension, which in turn speeds further nephron loss. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Blood pressure control protects the remaining nephrons and the circulation. A phosphate binder in the gut plus active vitamin D lowers phosphate and parathyroid hormone. Erythropoietin replaces the missing hormone and raises haemoglobin. Dialysis is an artificial filter that clears retained urea, potassium, acid and phosphate when the kidney can no longer do so. These are teaching toggles only.",
  ],
  simplified: "The many causes and stages of chronic kidney disease, the exact stage thresholds, protein in the urine as an early marker, cardiovascular disease, drug dose adjustment, transplant, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
