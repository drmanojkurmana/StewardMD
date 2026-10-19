/* Autosomal dominant polycystic kidney disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pkd.mjs [--print-model]
 * Static layout here; cysts, fluid secretion, blood cells and gauges move in pkd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease stage", a: [0.15, 0.55, 1], names: ["early", "enlarged", "kidney failure"], ticks: ["early", "enlarged", "kidney failure"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "blood pressure control" },
    { label: "tolvaptan concept (slows cyst growth)" },
    { label: "dialysis or transplant" },
  ],
  status: "Disease stage: {level} · {drug} ·",
  drugNames: ["no treatment", "blood pressure control", "tolvaptan concept", "dialysis or transplant"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const s = S.level.a[level];
  const bpRx = drug === 1 ? 1 : 0, tolv = drug === 2 ? 1 : 0, repl = drug === 3 ? 1 : 0;
  const cyst = cl((0.1 + 0.9 * s) * (tolv ? 0.55 : 1));
  const size = cl((0.18 + 0.82 * s) * (tolv ? 0.78 : 1));
  const loss = cl(0.92 * s * (tolv ? 0.78 : 1));
  let filt = cl(1.02 - 0.95 * loss);
  if (tolv) filt = cl(filt + 0.1 * (1 - s));
  let waste = cl(0.05 + 0.92 * (1 - filt));
  let bp = cl(0.22 + 0.7 * s);
  if (bpRx) bp = cl(bp * 0.4);
  if (tolv) bp = cl(bp * 0.92);
  if (repl) { waste = cl(waste * 0.32); bp = cl(bp * 0.82); }
  const haem = cl(0.06 + 0.72 * s * (tolv ? 0.85 : 1));
  const pain = cl(0.08 + 0.8 * s * (tolv ? 0.85 : 1));
  const liver = cl(0.1 + 0.68 * s);
  const aneur = cl(0.18 + 0.5 * s);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(cyst, 0.35, 0.7, ["low", "raised", "high"]), w(filt, 0.35, 0.75, ["very low", "reduced", "near normal"]), w(bp, 0.35, 0.6, ["controlled", "raised", "high"]), w(waste, 0.3, 0.6, ["normal", "raised", "high"])];
  return { s, bpRx, tolv, repl, cyst, size, loss, filt, waste, bp, haem, pain, liver, aneur, words, readout: "cyst burden " + words[0] + " · filtration " + words[1] + " · pressure " + words[2] + " · waste " + words[3] };
}
const TESTS = [
  [1, 0, "cyst burden raised · filtration reduced · pressure high · waste raised"],
  [1, 1, "cyst burden raised · filtration reduced · pressure controlled · waste raised"],
  [1, 2, "cyst burden low · filtration reduced · pressure raised · waste raised"],
  [2, 3, "cyst burden high · filtration very low · pressure high · waste normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">KIDNEY</text>
<text class="sc-zone" x="360" y="68">TUBULE AND CYST</text>
<text class="sc-zone" x="650" y="68">BODY EFFECTS</text>
<g id="kid"></g><g id="tub"></g><g id="bodyfx"></g><g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-cyst:#e8a33d;--c-fluid:#5ec8e8;--c-epi:#e58aa5;--c-liver:#c96a5a;--c-berry:#e5484d}
body[data-theme="light"]{--c-cyst:#c47f1a;--c-fluid:#1f8fc4;--c-epi:#c95f83;--c-liver:#b05040;--c-berry:#c42a3d}
.cl-epi{--cc:var(--c-epi)}
.pk-cap{fill:var(--anatomy-strong);font-size:12px}
.pk-cyst{fill:color-mix(in srgb,var(--c-cyst) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyst) 65%,#000);stroke-width:1.2}
.pk-lumen{fill:color-mix(in srgb,var(--c-fluid) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fluid) 60%,var(--anatomy-mid));stroke-width:1.4}
.pk-glow{fill:var(--c-rbc);stroke:none}
.pk-rec{fill:var(--anatomy-paper);stroke:var(--c-berry);stroke-width:1.4}
.pk-filt{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.4}
.pk-mem{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.p-waste{fill:var(--c-cyst);stroke:color-mix(in srgb,var(--c-cyst) 55%,#000);stroke-width:.5}
.p-clean{fill:var(--c-fluid);stroke:color-mix(in srgb,var(--c-fluid) 50%,#000);stroke-width:.5}
.pk-berry{fill:var(--c-berry);stroke:color-mix(in srgb,var(--c-berry) 55%,#000);stroke-width:1}
.pk-ureter{fill:none;stroke:color-mix(in srgb,var(--c-fluid) 60%,var(--anatomy-mid));stroke-width:4;stroke-linecap:round}
.pk-dna{fill:none;stroke:var(--c-cyt);stroke-width:2;stroke-linecap:round}
.pk-rung{stroke:var(--anatomy-mid);stroke-width:1.2}
.pk-mut{fill:var(--c-berry);stroke:color-mix(in srgb,var(--c-berry) 55%,#000);stroke-width:.8}
.pk-cilia{fill:none;stroke:var(--c-fluid);stroke-width:2.4;stroke-linecap:round}
.pk-poly{fill:var(--c-berry);stroke:color-mix(in srgb,var(--c-berry) 55%,#000);stroke-width:.6}
.pk-tubule{fill:none;stroke:color-mix(in srgb,var(--c-epi) 65%,var(--anatomy-mid));stroke-width:7;stroke-linecap:round;opacity:.8}
.p-fluid{fill:var(--c-fluid);stroke:color-mix(in srgb,var(--c-fluid) 50%,#000);stroke-width:.5}
.p-urine{fill:var(--c-berry)}
.dr-g-fill.g-cyst{fill:var(--c-cyst)}.dr-g-fill.g-size{fill:var(--c-epi)}.dr-g-fill.g-fluid{fill:var(--c-fluid)}.dr-g-fill.g-pain{fill:var(--c-berry)}
`;

buildScene({
  id: "polycystic-kidney-disease", fig: "Fig 1", title: "Autosomal dominant polycystic kidney disease: cyst growth and kidney failure", W, H, body, extraCss,
  label: "An animated polycystic kidney beside a magnified tubule cyst and body effects. A PKD1 or PKD2 mutation makes defective polycystin, so the primary cilium on tubular epithelial cells signals poorly. The cells multiply and secrete fluid into the tubule wall, and a cyst buds off and grows. Many cysts enlarge both kidneys, crush working nephrons and lower filtration, and cause high blood pressure, blood in the urine and flank pain. Cysts in the liver and a berry aneurysm on a brain vessel are shown as associations. Gauges show cyst burden, kidney size, filtration, pressure, waste, blood in urine and pain. Treatment choices include blood pressure control, a tolvaptan concept that slows cyst growth, and dialysis or transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pkd.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With tolvaptan concept",
  sourcesLis: [
    "<strong>How autosomal dominant polycystic kidney disease develops.</strong> A mutation in PKD1 or PKD2 makes polycystin faulty. Polycystin sits on the primary cilium of tubular epithelial cells and helps the cilium sense flow and control cell growth and fluid movement. When signalling fails, tubular cells multiply and secrete fluid, a cyst forms from the tubule wall and grows, and over years many cysts enlarge the kidneys and replace working nephrons. This is standard teaching in medicine and nephrology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Effects in the body.</strong> Enlarging cysts cause flank pain and can bleed, giving blood in the urine. High blood pressure is common and speeds kidney damage. Filtration falls and waste is retained as nephrons are lost, ending in kidney failure. Cysts also occur in the liver, and there is an association with a berry aneurysm on a brain vessel, which is shown as a small sac on the vessel. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Blood pressure control protects the remaining nephrons and the circulation. A tolvaptan concept is shown slowing fluid secretion and cyst growth, which slows enlargement. Dialysis or transplant replaces kidney function when filtration is very low and waste is retained. These are teaching toggles only.",
  ],
  simplified: "The difference between PKD1 and PKD2 severity, cyst infection and stones, heart valve and bowel associations, screening of relatives, aneurysm screening, eligibility and side effects of tolvaptan, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
