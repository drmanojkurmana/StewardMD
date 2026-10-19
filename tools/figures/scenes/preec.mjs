/* Pre-eclampsia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/preec.mjs [--print-model]
 * Abnormal placental implantation leaves the placenta ischaemic. It releases anti-angiogenic factors
 * into the maternal blood, injuring endothelium everywhere: vessels tighten (hypertension), the kidney
 * filter leaks protein, and liver, kidney and brain are involved; seizures define eclampsia.
 * Static layout here; placenta, vessel, organs and gauges move in preec.page.js.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of the syndrome", a: [0.3, 0.65, 1], names: ["mild", "severe", "eclampsia"], ticks: ["mild", "severe", "eclampsia"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antihypertensive (vessels relaxed, pressure lowered)" },
    { label: "magnesium sulphate (seizures prevented)" },
    { label: "delivery (placenta delivered, cause removed)" },
  ],
  status: "Pre-eclampsia: {level} · {drug} ·",
  drugNames: ["no treatment", "an antihypertensive", "magnesium sulphate", "delivery"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const ah = drug === 1 ? 1 : 0, mg = drug === 2 ? 1 : 0, del = drug === 3 ? 1 : 0;
  const isch = cl(a * (del ? 0.1 : 1));
  const ang = cl((0.06 + 0.92 * isch) * (del ? 0.35 : 1));
  const endo = cl(0.05 + 0.92 * ang);
  const bp = cl(0.06 + 0.86 * endo - ah * 0.38 - del * 0.22);
  const prot = cl((0.04 + 0.88 * endo) * (del ? 0.35 : 1) * (ah ? 0.92 : 1));
  const org = cl((0.04 + 0.86 * endo * (0.35 + 0.65 * a)) * (del ? 0.45 : 1) * (ah ? 0.9 : 1));
  const seiz = cl((level === 2 ? 0.12 + 0.86 * endo : 0.03 + 0.22 * endo * a) * (mg ? 0.14 : 1) * (del ? 0.3 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(bp, 0.35, 0.65, ["controlled", "raised", "high"]), w(prot, 0.3, 0.6, ["none", "present", "heavy"]), w(org, 0.3, 0.6, ["quiet", "stressed", "involved"]), w(seiz, 0.2, 0.5, ["unlikely", "possible", "likely"])];
  return { a, ah, mg, del, isch, ang, endo, bp, prot, org, seiz, words, readout: "pressure " + words[0] + " · protein " + words[1] + " · organs " + words[2] + " · seizures " + words[3] };
}
const TESTS = [
  [0, 0, "pressure raised · protein present · organs quiet · seizures unlikely"],
  [2, 0, "pressure high · protein heavy · organs involved · seizures likely"],
  [2, 2, "pressure high · protein heavy · organs involved · seizures unlikely"],
  [1, 3, "pressure controlled · protein none · organs quiet · seizures unlikely"],
];

/* ---------------- static layout ---------------- */
const CY = 230;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<ellipse id="placGlow" class="pre-glow" cx="140" cy="225" rx="54" ry="50"/>
<g id="uterusSlot"></g>
<g id="placenta"></g>
<rect id="vLum" class="pre-lum" x="260" y="208" width="670" height="44"/>
<rect id="vWallT" class="pre-wall" x="260" y="188" width="670" height="20" rx="8"/>
<rect id="vWallB" class="pre-wall" x="260" y="252" width="670" height="20" rx="8"/>
<g id="vessel"></g>
<ellipse id="haloKidney" class="pre-halo" cx="380" cy="345" rx="72" ry="68"/>
<ellipse id="haloLiver" class="pre-halo" cx="570" cy="352" rx="88" ry="72"/>
<ellipse id="haloBrain" class="pre-halo" cx="770" cy="352" rx="88" ry="70"/>
<g id="kidneySlot"></g><g id="liverSlot"></g><g id="brainSlot"></g>
<g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "pre-eclampsia", fig: "Fig 1", title: "Pre-eclampsia: placenta to maternal syndrome", W, H, body,
  label: "An animated map of pre-eclampsia, read left to right. A shallowly implanted placenta inside the uterus (left) releases harmful factors that travel in maternal blood and tighten a vessel (middle), injuring the kidney, liver and brain (right). An antihypertensive parks on the vessel wall and opens it, magnesium parks on the brain and blocks seizures, and delivery removes the placenta so the whole syndrome settles. A slider sets the stage, and a one-line caption narrates the state.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H, CY }, pageJs: readFileSync(join(HERE, "preec.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With delivery",
  sourcesLis: [
    "<strong>How pre-eclampsia develops.</strong> In normal pregnancy the placenta implants deeply and remodels the uterine spiral arteries into wide, low resistance vessels. In pre-eclampsia that remodelling is shallow, so the placenta is relatively ischaemic. The stressed placenta releases excess anti-angiogenic factors (such as soluble fms-like tyrosine kinase 1 and soluble endoglin) and less pro-angiogenic placental growth factor. In the maternal blood these injure endothelium, the single-cell lining of vessels, reducing relaxing signals and making vessels tighten and leak. The result is hypertension and proteinuria, with involvement of liver, kidney, brain and other organs; seizures define eclampsia. This is standard teaching in obstetrics and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An antihypertensive lowers pressure but does not remove the placental cause. Magnesium sulphate prevents and treats seizures. Delivery of the baby and placenta is the definitive step that removes the source of the factors, after which the syndrome settles over days. These are teaching toggles only.",
  ],
  simplified: "Diagnostic thresholds and timing, fetal growth restriction and fetal monitoring, HELLP as a named variant, blood tests and their cut-offs, choice and dosing of individual drugs, timing and mode of delivery, and care after birth are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.pre-glow{fill:var(--c-bad);stroke:none}
.pre-halo{fill:var(--c-bad);stroke:none}
.pre-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.pre-plac{fill:color-mix(in srgb,var(--c-bad) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 65%,#000);stroke-width:1.2}
.pre-spiral{fill:none;stroke:var(--c-rbc);stroke-width:2;stroke-linecap:round}
.pre-wall{fill:color-mix(in srgb,var(--c-sm) 50%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-sm) 62%,#000);stroke-width:1}
.pre-lum{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper))}
.pre-dmg{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.pre-bolt{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 60%,#000);stroke-width:.8}
.p-ang{--cc:var(--c-bad)}
.p-ah{--cc:var(--c-no)}
.p-mg{--cc:var(--c-cyt)}
.p-prot{--cc:var(--c-neut)}
.dr-g-fill.g-endo{fill:var(--c-endo)}.dr-g-fill.g-org{fill:var(--c-bad)}.dr-g-fill.g-seiz{fill:var(--c-neut)}
`,
});
