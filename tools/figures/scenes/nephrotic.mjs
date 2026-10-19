/* Nephrotic syndrome as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/nephrotic.mjs [--print-model]
 * Static layout here; kidney, filter barrier, particles and gauges move in nephrotic.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Glomerular lesion", a: [0.9, 0.8, 0.84], names: ["minimal change", "FSGS", "membranous"], ticks: ["minimal change", "FSGS", "membranous"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "steroid" },
    { label: "ACE inhibitor and diuretic" },
    { label: "immunosuppression" },
  ],
  status: "Lesion: {level} · {drug} ·",
  drugNames: ["no treatment", "a steroid", "an ACE inhibitor and diuretic", "immunosuppression"],
};
function modelOf(S, level, drug) {
  const baseLeak = [0.9, 0.8, 0.84][level];
  const effaceBase = [0.95, 0.72, 0.78][level];
  const steroidGain = [0.88, 0.34, 0.14][level];
  const immuneGain = [0.55, 0.52, 0.82][level];
  const deposits = [0.04, 0.1, 0.95][level];
  const sclerosis = [0.03, 0.92, 0.08][level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const steroid = drug === 1 ? 1 : 0, ace = drug === 2 ? 1 : 0, immuno = drug === 3 ? 1 : 0;
  const leak = cl(baseLeak * (1 - steroid * steroidGain - immuno * immuneGain - ace * 0.3));
  const efface = cl(effaceBase * (1 - steroid * steroidGain * 0.85 - immuno * immuneGain * 0.8 - ace * 0.12));
  const albumin = cl(1 - 0.8 * leak);
  const oedema = cl((0.06 + 0.88 * (1 - albumin)) * (ace ? 0.42 : 1));
  const lipids = cl(0.08 + 0.82 * (1 - albumin));
  const clot = cl(0.07 + 0.8 * leak);
  const infection = cl(0.07 + 0.76 * leak);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(leak, 0.3, 0.62, ["mild", "heavy", "very heavy"]), w(albumin, 0.4, 0.7, ["low", "reduced", "near normal"]), w(oedema, 0.3, 0.62, ["none", "present", "marked"]), w(lipids, 0.35, 0.65, ["normal", "raised", "high"])];
  return { leak, efface, albumin, oedema, lipids, clot, infection, deposits, sclerosis, steroid, ace, immuno, words, readout: "protein leak " + words[0] + " · albumin " + words[1] + " · oedema " + words[2] + " · lipids " + words[3] };
}
const TESTS = [
  [0, 0, "protein leak very heavy · albumin low · oedema marked · lipids high"],
  [0, 1, "protein leak mild · albumin near normal · oedema none · lipids normal"],
  [0, 2, "protein leak very heavy · albumin reduced · oedema none · lipids raised"],
  [2, 3, "protein leak mild · albumin near normal · oedema none · lipids normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="np-comp" x="430" y="82" width="500" height="66" rx="33"/>
<rect class="np-comp" x="430" y="186" width="500" height="104" rx="12"/>
<rect id="oedema" class="np-oed" x="430" y="186" width="500" height="104" rx="12" opacity="0"/>
<rect class="np-comp" x="430" y="316" width="500" height="108" rx="12"/>
<g id="kidneySlot"></g>
<path id="connVess" class="np-conn" d="M136 190 C220 142 320 94 430 113"/>
<path id="ureter" class="np-tub" d="M123 248 L123 302"/>
<path class="np-link" d="M168 132 C196 130 222 142 246 158"/>
<circle class="np-mag" cx="330" cy="215" r="88"/>
<path class="np-tub" d="M330 296 V398"/>
<g id="glom"></g><g id="vess"></g><g id="tiss"></g><g id="risk"></g><g id="parts"></g><g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-alb:#e8c84a;--c-lip:#f08a4b;--c-pod:#7fc4e8;--c-gbm:#e9a2b3;--c-dep:#c978c9;--c-scar:#9a9aa2}
body[data-theme="light"]{--c-alb:#b8921c;--c-lip:#d96a25;--c-pod:#2f86b8;--c-gbm:#d9788f;--c-dep:#a84fa8;--c-scar:#777780}
.cl-pod{--cc:var(--c-pod)}.cl-tuft{--cc:var(--c-rbc)}.cl-plt2{--cc:var(--c-plt)}
.np-comp{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.72}
.np-oed{fill:var(--c-fl)}
.np-tub{fill:none;stroke:color-mix(in srgb,var(--c-endo) 58%,var(--anatomy-mid));stroke-width:7;stroke-linecap:round;opacity:.85}
.np-mag{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.8;opacity:.92}
.np-link{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:5 4;opacity:.7}
.np-conn{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:12;stroke-linecap:round;opacity:.8}
.np-art{fill:none;stroke:var(--c-rbc);stroke-width:4.5;stroke-linecap:round;opacity:.9}
.np-gbm{fill:none;stroke:var(--c-gbm);stroke-width:5;opacity:.9}
.np-eff{fill:none;stroke:var(--c-pod);stroke-width:9;opacity:0}
.np-tooth{stroke:var(--c-pod);stroke-width:3;stroke-linecap:round}
.np-dep{fill:var(--c-dep);stroke:color-mix(in srgb,var(--c-dep) 55%,#000);stroke-width:.6}
.np-scar{fill:var(--c-scar);stroke:color-mix(in srgb,var(--c-scar) 55%,#000);stroke-width:1;opacity:0}
.np-capline{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.rx-a{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.p-alb{--cc:var(--c-alb)}.p-lip{--cc:var(--c-lip)}.p-prot{--cc:var(--c-alb)}.p-igg{--cc:var(--c-ab)}
.dr-g-fill.g-alb{fill:var(--c-alb)}.dr-g-fill.g-lip{fill:var(--c-lip)}.dr-g-fill.g-pod{fill:var(--c-pod)}.dr-g-fill.g-dep{fill:var(--c-dep)}
`;

buildScene({
  id: "nephrotic-syndrome", fig: "Fig 1", title: "Nephrotic syndrome: a leaky glomerular filter and its effects", W, H, body, extraCss,
  label: "An animated kidney beside one magnified glomerular filter, a blood vessel, tissue, and clot and infection risk areas. Podocyte foot processes are spread flat over the filter wall, most diffusely in minimal change disease. In FSGS part of the tuft is scarred. In membranous disease immune deposits sit under the podocytes. Albumin escapes through the leaky filter into the urine, blood albumin falls, fluid leaves the vessel and collects as oedema, the liver makes more lipid, and clotting and infection risk rise. Treatment capsules travel to their target: a steroid docks on podocytes, an ACE inhibitor on the arteriole while a diuretic drains oedema, and immune therapy on the deposits. Gauges show protein leak, blood albumin, oedema, lipids, clot risk and infection risk.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "nephrotic.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With steroid",
  sourcesLis: [
    "<strong>What nephrotic syndrome is.</strong> Heavy protein in the urine (heavy proteinuria) from a leaky glomerular filter, low blood albumin (hypoalbuminaemia), oedema from fluid leaving the circulation, and raised blood lipids (hyperlipidaemia) made by the liver in response to the protein loss. Loss of regulatory and defence proteins in the urine also raises the risk of blood clots (thrombosis) and of infection. This is standard teaching in medicine and nephrology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The three lesions on the slider.</strong> In minimal change disease the glomerulus looks near normal by light microscopy but podocyte foot processes are spread flat and fused (effaced) when seen closely, and it usually responds well to a steroid. In focal segmental glomerulosclerosis (FSGS) some glomeruli have a scarred segment of the tuft with podocyte loss, and the response to a steroid is often only partial. In membranous nephropathy immune deposits collect under the podocytes (subepithelial deposits), the basement membrane thickens around them, a steroid alone usually helps little, and broader immunosuppression is the teaching toggle that helps most. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> A steroid calms the podocyte injury, best in minimal change disease. An ACE inhibitor lowers pressure inside the glomerulus and cuts protein leak, and a diuretic removes oedema fluid, without repairing the filter itself. Immunosuppression dampens the immune injury, shown strongest in membranous disease. These are teaching toggles only.",
  ],
  simplified: "The many other causes of nephrotic syndrome, biopsy appearances in detail, complement and antibody testing, salt restriction, anticoagulation decisions, lipid treatment, relapse patterns, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
