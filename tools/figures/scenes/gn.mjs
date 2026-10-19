/* Glomerulonephritis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/gn.mjs [--print-model]
 * Static layout here; deposits, complement, neutrophils, leak and gauges move in gn.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;
const CX = 320, CY = 238;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pattern of glomerular injury", a: [0.7, 0.55, 1, 0.15], names: ["post-infectious", "IgA", "crescentic", "nephrotic"], ticks: ["post-infectious", "IgA", "crescentic", "nephrotic"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "supportive only" },
    { label: "steroid" },
    { label: "steroid plus immunosuppression" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["supportive only", "steroid", "steroid plus immunosuppression"],
};
function modelOf(S, level, drug) {
  const P = [
    { dep: 0.78, comp: 0.85, neut: 0.8, inj: 0.7, cres: 0.14, pod: 0.28 },
    { dep: 0.66, comp: 0.45, neut: 0.35, inj: 0.5, cres: 0.05, pod: 0.32 },
    { dep: 0.55, comp: 0.6, neut: 0.9, inj: 1, cres: 0.95, pod: 0.35 },
    { dep: 0.05, comp: 0.05, neut: 0.05, inj: 0.1, cres: 0, pod: 1 },
  ][level];
  const IMM = [1, 0.55, 0.28][drug];
  const DEPF = [1, 0.85, 0.62][drug];
  const CRESF = [1, 0.68, 0.36][drug];
  const PODF = [1, 0.6, 0.38][drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Dep = cl(P.dep * DEPF);
  const Comp = cl(P.comp * IMM);
  const Neut = cl(P.neut * IMM);
  const Inj = cl(P.inj * IMM);
  const Cres = cl(P.cres * CRESF);
  const Pod = cl(P.pod * (level === 3 ? PODF : 1) + (level === 3 ? 0 : 0.25 * Inj));
  const Prot = cl(0.78 * Pod + 0.3 * Inj);
  const Haem = cl(0.82 * Inj + 0.28 * Neut);
  const GFR = cl(1 - 0.52 * Inj - 0.38 * Cres - 0.12 * Prot);
  const BP = cl(0.34 + 0.42 * Inj + 0.34 * (1 - GFR));
  const Oed = cl(0.22 + 0.52 * Prot + 0.38 * (1 - GFR));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Inj, 0.25, 0.6, ["low", "raised", "high"]), w(Prot, 0.3, 0.65, ["small", "moderate", "heavy"]), w(Haem, 0.25, 0.6, ["absent", "present", "marked"]), w(GFR, 0.4, 0.68, ["low", "reduced", "preserved"])];
  return { Dep, Comp, Neut, Inj, Cres, Pod, Prot, Haem, GFR, BP, Oed, words, readout: "inflammation " + words[0] + " · protein leak " + words[1] + " · blood in urine " + words[2] + " · filtration " + words[3] };
}
const TESTS = [
  [0, 0, "inflammation high · protein leak moderate · blood in urine marked · filtration reduced"],
  [2, 0, "inflammation high · protein leak heavy · blood in urine marked · filtration low"],
  [3, 0, "inflammation low · protein leak heavy · blood in urine absent · filtration preserved"],
  [2, 2, "inflammation raised · protein leak moderate · blood in urine present · filtration reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">GLOMERULUS AND BOWMAN CAPSULE</text>
<text class="sc-zone sc-dim" x="560" y="68">TUBULE, URINE AND BODY EFFECTS</text>
<g id="kidneySlot"></g>
<g id="vess"></g>
<g id="caps"></g>
<g id="tuft"></g>
<g id="deps"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="urine"></g>
<g id="boxes"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-dep:#f2b84a;--c-comp:#ff9a3d;--c-iga:#e86a92;--c-gbm:#8a5a2b;--c-pod:#7fc4e8;--c-mes:#b7a1e6;--c-par:#e9a2b3;--c-prot:#3ddc97;--c-fib:#e5484d}
body[data-theme="light"]{--c-dep:#c99612;--c-comp:#d96a25;--c-iga:#c44a74;--c-gbm:#7a4a1f;--c-pod:#2f86b8;--c-mes:#7c5fc4;--c-par:#c4627c;--c-prot:#0f9f76;--c-fib:#c42a3d}
.gn-vess{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 62%,var(--anatomy-mid));stroke-linecap:round}
.gn-vessin{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 20%,var(--anatomy-paper));stroke-linecap:round}
.gn-caps{fill:color-mix(in srgb,var(--c-fl) 13%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-par) 65%,var(--anatomy-mid));stroke-width:2.4}
.gn-space{fill:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper));stroke:none}
.gn-coil{fill:color-mix(in srgb,var(--c-rbc) 24%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-mid));stroke-width:1.6}
.gn-gbm{fill:none;stroke:var(--c-gbm);stroke-width:2.2;stroke-linecap:round}
.gn-depdot{fill:var(--c-dep);stroke:color-mix(in srgb,var(--c-dep) 50%,#000);stroke-width:.7}
.gn-igadot{fill:var(--c-iga);stroke:color-mix(in srgb,var(--c-iga) 50%,#000);stroke-width:.7}
.gn-gbmline{fill:none;stroke:var(--c-fib);stroke-width:3.4;stroke-linecap:round}
.gn-cres{fill:color-mix(in srgb,var(--c-fib) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fib) 60%,#000);stroke-width:1.2}
.gn-fibrin{stroke:var(--c-fib);stroke-width:1.1;opacity:.85}
.cl-pod{--cc:var(--c-pod)}.cl-mes{--cc:var(--c-mes)}.cl-par{--cc:var(--c-par)}
.gn-tubew{fill:none;stroke:color-mix(in srgb,var(--c-par) 65%,var(--anatomy-mid));stroke-linecap:round;stroke-linejoin:round}
.gn-tubel{fill:none;stroke:color-mix(in srgb,var(--c-fl) 24%,var(--anatomy-paper));stroke-linecap:round;stroke-linejoin:round}
.gn-cup{fill:color-mix(in srgb,var(--c-fl) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.6}
.gn-urinefill{fill:color-mix(in srgb,var(--c-dep) 45%,var(--anatomy-paper))}
.gn-box{fill:color-mix(in srgb,var(--anatomy-paper) 72%,var(--c-tis));stroke:var(--anatomy-mid);stroke-width:1.2}
.gn-fluid{fill:var(--c-fl);opacity:.55}
.gn-arrow{fill:none;stroke:var(--c-fib);stroke-width:2.6;stroke-linecap:round}
.gn-drop{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 50%,#000);stroke-width:.6}
.p-comp{--cc:var(--c-comp)}.p-prot{--cc:var(--c-prot)}
.p-drug{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:.8}
.gn-cap{fill:var(--anatomy-strong);font-size:13px}
.dr-g-fill.g-dep{fill:var(--c-dep)}.dr-g-fill.g-comp{fill:var(--c-comp)}.dr-g-fill.g-prot{fill:var(--c-prot)}
`;

buildScene({
  id: "glomerulonephritis", fig: "Fig 1", title: "Glomerulonephritis: immune injury of the glomerulus", W, H, body, extraCss,
  label: "An animated glomerulus inside Bowman capsule, with a tubule leading to urine. A small kidney at the top right shows where the magnified glomerulus sits. Immune complexes, mesangial IgA, antibody along the glomerular basement membrane, or pauci-immune injury activate complement and neutrophils. The capillary wall is damaged, so red cells and some protein escape into Bowman space and the tubule, filtration falls, and salt and water are retained. A crescent of proliferating cells and fibrin can fill Bowman space in rapidly progressive disease. In contrast, nephrotic podocyte injury causes heavy protein leak with little inflammation or blood. With treatment, steroid tablets stream in through the arteriole, sit on deposits and immune cells, and inflammation visibly fades. Gauges show immune deposit, complement, neutrophils, protein leak, blood in urine and filtration.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { CX, CY, W, H }, pageJs: readFileSync(join(HERE, "gn.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Supportive only", withLabel: "With steroid plus immunosuppression",
  sourcesLis: [
    "<strong>How the glomerulus is injured.</strong> In glomerulonephritis the filter is attacked by the immune system: immune complexes deposit in the capillary wall (as after some streptococcal infections), IgA deposits in the mesangium in IgA nephropathy, antibody binds along the glomerular basement membrane in anti-GBM disease, or small vessel inflammation injures the tuft with few deposits (pauci-immune disease). Complement is activated and neutrophils are recruited. The damaged wall lets red cells and protein through, giving a nephritic picture of haematuria, hypertension, oedema and falling filtration. This is standard teaching in medicine and nephrology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Patterns and the nephrotic contrast.</strong> Post-infectious disease follows an infection and often settles; IgA disease tends to smoulder with episodes of visible blood; crescentic disease fills Bowman space with a crescent of cells and fibrin and destroys filtration rapidly, so it is called rapidly progressive. Nephrotic injury is different: the podocyte and its slit diaphragm fail, protein leaks heavily, but there is little inflammation and little blood. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Supportive care alone (salt, fluid and blood pressure control), a steroid, or a steroid plus broader immunosuppression, which damp complement, neutrophils and crescent formation. In podocyte disease steroids can also reduce protein leak. These are teaching toggles only.",
  ],
  simplified: "The many named diseases, biopsy patterns and stains, complement genetics, infection treatment, plasma exchange, dialysis, relapses, and all doses and targets are left out. Pauci-immune and anti-GBM injury are shown together at the severe end. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
