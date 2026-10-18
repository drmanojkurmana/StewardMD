/* Chronic kidney disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/ckd.mjs [--print-model]
 * Static layout here; kidney and gut use organ() art, nephrons, solutes, hormones, bone, marrow,
 * washes and gauges move in ckd.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Chronic kidney disease stage", a: [0.12, 0.42, 0.72, 1], names: ["early", "moderate", "advanced", "kidney failure"], ticks: ["early", "moderate", "advanced", "failure"], start: 2 },
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
  const baseU = cl(0.06 + 0.92 * (1 - GFR));
  const baseK = cl(0.08 + 0.85 * (1 - GFR));
  const baseAc = cl(0.07 + 0.85 * (1 - GFR));
  const basePh = cl(0.08 + 0.88 * (1 - GFR));
  const basePTH = cl(0.06 + 0.92 * basePh);
  const baseHb = cl(0.18 + 0.78 * N);
  const baseBP = cl(0.25 + 0.65 * s);
  const U = dial ? cl(baseU * 0.35) : baseU;
  const K = dial ? cl(baseK * 0.4) : baseK;
  const Ac = dial ? cl(baseAc * 0.4) : baseAc;
  const Ph = binder || dial ? cl(basePh * 0.45) : basePh;
  const PTH = binder ? cl(basePTH * 0.35) : dial ? cl(basePTH * 0.6) : basePTH;
  const Hb = epoRx ? cl(baseHb + 0.5) : baseHb;
  const BP = bpRx ? cl(baseBP * 0.42) : dial ? cl(baseBP * 0.7) : baseBP;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(GFR, 0.35, 0.75, ["very low", "reduced", "near normal"]), w(U, 0.3, 0.6, ["normal", "raised", "high"]), w(Ph, 0.3, 0.6, ["normal", "raised", "high"]), w(Hb, 0.45, 0.75, ["low", "reduced", "normal"]), w(BP, 0.35, 0.6, ["controlled", "raised", "high"])];
  return { s, N, Hf, GFR, U, K, Ac, Ph, PTH, BP, Hb, bpRx, binder, epoRx, dial, words, readout: "filtration " + words[0] + " · urea " + words[1] + " · phosphate " + words[2] + " · haemoglobin " + words[3] + " · pressure " + words[4] };
}
const TESTS = [
  [3, 0, "filtration very low · urea high · phosphate high · haemoglobin low · pressure high"],
  [2, 0, "filtration reduced · urea raised · phosphate raised · haemoglobin reduced · pressure high"],
  [2, 1, "filtration reduced · urea raised · phosphate raised · haemoglobin reduced · pressure controlled"],
  [2, 4, "filtration reduced · urea normal · phosphate normal · haemoglobin reduced · pressure raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="kidSlot"></g>
<g id="gutSlot"></g>
<rect id="vessel" class="ck-vess" x="290" y="118" width="620" height="54" rx="27"/>
<rect id="bpWash" class="ck-washbp" x="290" y="118" width="620" height="54" rx="27" opacity="0"/>
<rect id="dialWash" class="ck-washdial" x="600" y="118" width="310" height="54" rx="27" opacity="0"/>
<rect id="bpStrain" class="ck-strain" x="290" y="118" width="620" height="54" rx="27" opacity="0"/>
<ellipse id="ringA" class="ck-ring" cx="300" cy="145" rx="12" ry="20" opacity="0"/>
<ellipse id="ringB" class="ck-ring" cx="600" cy="145" rx="12" ry="20" opacity="0"/>
<path id="artV" class="ck-route" d="M290 156 L200 190"/>
<path id="veinV" class="ck-route" d="M290 174 L200 210"/>
<path id="gutBlood" class="ck-route" d="M433 340 L433 178"/>
<path id="epoPath" class="ck-route" d="M150 320 L738 322"/>
<path id="pthPath" class="ck-route" d="M621 293 L712 326"/>
<path id="ureter" class="ck-ureter" d="M115 227 C125 285 132 350 140 425"/>
<g id="neph"></g>
<g id="glands">
<circle id="glandA" class="ck-gland" cx="612" cy="296" r="5"/>
<circle id="glandB" class="ck-gland" cx="630" cy="296" r="5"/>
<path id="sensor" class="ck-sensor" d="M604 288 C612 281 630 281 638 288"/>
</g>
<g id="boneG">
<circle class="ck-bone" cx="712" cy="329" r="12"/>
<circle class="ck-bone" cx="838" cy="329" r="12"/>
<rect id="boneShaft" class="ck-bone" x="712" y="320" width="126" height="18"/>
<g id="trabs" class="ck-trab"><path d="M730 324 L800 324 M740 331 L820 331 M760 324 L760 331"/></g>
<ellipse id="marrow" class="ck-marrow" cx="775" cy="329" rx="40" ry="5.5"/>
</g>
<ellipse id="marrowWash" class="ck-washmar" cx="775" cy="329" rx="70" ry="30" opacity="0"/>
<ellipse id="gutWash" class="ck-washgut" cx="430" cy="355" rx="88" ry="76" opacity="0"/>
<g id="mach" class="hot" tabindex="0" data-info="Dialysis. Blood loops through an artificial filter that clears wastes and extra fluid.">
<path id="tubeOut" class="ck-tube" d="M884 164 C876 178 878 190 884 200"/>
<path id="tubeBack" class="ck-tube" d="M884 290 C876 270 872 220 878 170"/>
<rect id="machBox" class="ck-mach" x="872" y="200" width="58" height="90" rx="8"/>
<rect id="chamber" class="ck-chamber" x="880" y="214" width="42" height="42" rx="4"/>
<rect id="jug" class="ck-jug" x="880" y="262" width="42" height="20" rx="3"/>
<rect id="jugFill" class="ck-jugfill" x="883" y="278" width="36" height="1"/>
<circle class="ck-lightbase" cx="901" cy="207" r="3.5"/>
<circle id="machLight" class="ck-light" cx="901" cy="207" r="3.5" opacity="0"/>
</g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-urea:#c98a3d;--c-pot:#9a6ae0;--c-acid:#3fbfae;--c-phos:#f08a4b;--c-pth:#e9b84a;--c-epo:#5ec1a0;--c-bind:#8fa3b8;--c-bound:#9aa3ab;--c-bone:#e8dcc0}
body[data-theme="light"]{--c-urea:#a86e28;--c-pot:#7c4fc4;--c-acid:#1f8f83;--c-phos:#d96a25;--c-pth:#b8860b;--c-epo:#2f8f6e;--c-bind:#6b7d90;--c-bound:#7c868e;--c-bone:#cbb98f}
.cl-neph{--cc:#e58aa5}
.ck-vess{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,var(--anatomy-mid));stroke-width:1.6}
.ck-route{fill:none;stroke:color-mix(in srgb,var(--c-fl) 60%,var(--anatomy-mid));stroke-width:2;stroke-linecap:round;stroke-dasharray:2 5;opacity:.55}
.ck-ureter{fill:none;stroke:color-mix(in srgb,var(--c-fl) 60%,var(--anatomy-mid));stroke-width:5;stroke-linecap:round}
.ck-tube{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-mid));stroke-width:4;stroke-linecap:round}
.ck-mach{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.6}
.ck-chamber{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ck-jug{fill:color-mix(in srgb,var(--c-urea) 25%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ck-jugfill{fill:var(--c-urea);stroke:none}
.ck-lightbase{fill:var(--anatomy-mid);stroke:none}
.ck-light{fill:var(--c-good);stroke:none}
.ck-gland{fill:var(--c-pth);stroke:color-mix(in srgb,var(--c-pth) 50%,#000);stroke-width:.8}
.ck-sensor{fill:none;stroke:var(--c-fl);stroke-width:1.8;stroke-linecap:round}
.ck-bone{fill:var(--c-bone);stroke:color-mix(in srgb,var(--c-bone) 55%,#000);stroke-width:1}
.ck-marrow{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:1}
.ck-trab path{fill:none;stroke:color-mix(in srgb,var(--c-bone) 45%,#000);stroke-width:1}
.ck-scarx{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round}
.ck-washbp{fill:var(--c-fl);stroke:none}
.ck-washgut{fill:var(--c-bind);stroke:none}
.ck-washmar{fill:var(--c-epo);stroke:none}
.ck-washdial{fill:var(--c-epo);stroke:none}
.ck-strain{fill:none;stroke:var(--c-bad);stroke-width:2.5}
.ck-ring{fill:none;stroke:var(--c-fl);stroke-width:2}
.ck-cap{fill:var(--anatomy-strong);font-size:12px}
.p-urea{--cc:var(--c-urea)}.p-pot{--cc:var(--c-pot)}.p-acid{--cc:var(--c-acid)}.p-phos{--cc:var(--c-phos)}.p-pth{--cc:var(--c-pth)}.p-epo{--cc:var(--c-epo)}.p-bind{--cc:var(--c-bind)}
.p-bound{fill:var(--c-bound);stroke:color-mix(in srgb,var(--c-bound) 50%,#000);stroke-width:.5}
.p-filt{fill:var(--c-fl)}
.dr-g-fill.g-urea{fill:var(--c-urea)}.dr-g-fill.g-phos{fill:var(--c-phos)}.dr-g-fill.g-pth{fill:var(--c-pth)}
`;

buildScene({
  id: "chronic-kidney-disease", fig: "Fig 1", title: "Chronic kidney disease: nephron loss and its body-wide effects", W, H, body, extraCss,
  label: "An animated kidney story told left to right. The kidney loses its filters one by one while survivors swell and work harder, urine output falls, wastes stay in the blood, pressure climbs, glands release more signal and bone thins while the marrow runs short of its kidney signal and red cells fall. A slider sets the stage. Pressure control relaxes the vessels, binder traps phosphate in the gut, erythropoietin drives the marrow, and dialysis filters the blood in place of the kidney.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "ckd.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With dialysis",
  sourcesLis: [
    "<strong>How chronic kidney disease develops.</strong> Nephrons are lost over time from causes such as diabetes, high blood pressure, glomerular disease and ageing. The nephrons that remain adapt by filtering more each (hyperfiltration and enlargement), which holds total filtration up for a while but adds strain. As loss continues, total filtration (GFR) falls and waste products that the kidney normally clears, including urea, potassium, hydrogen ions (acid) and phosphate, are retained. This is standard teaching in medicine and nephrology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Blood, mineral and pressure effects.</strong> The healthy kidney makes erythropoietin, the hormone that tells the bone marrow to make red cells; when it falls, anaemia follows. Retained phosphate, together with disturbed vitamin D and calcium, drives the parathyroid glands to release more parathyroid hormone (secondary hyperparathyroidism), which draws calcium from bone and thins it. Retained salt and water, with activation of pressure-raising systems, causes hypertension, which in turn speeds further nephron loss. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Blood pressure control protects the remaining nephrons and the circulation. A phosphate binder in the gut plus active vitamin D lowers phosphate and parathyroid hormone. Erythropoietin replaces the missing hormone and raises haemoglobin. Dialysis is an artificial filter that clears retained urea, potassium, acid and phosphate when the kidney can no longer do so. These are teaching toggles only.",
  ],
  simplified: "The many causes and stages of chronic kidney disease, the exact stage thresholds, protein in the urine as an early marker, cardiovascular disease, drug dose adjustment, transplant, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
