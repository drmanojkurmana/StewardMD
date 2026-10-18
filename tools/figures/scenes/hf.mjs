/* Heart failure pathophysiology as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hf.mjs [--print-model]
 * The failing heart, the neurohormonal loop (sympathetic, renin-angiotensin, aldosterone), fluid retention and congestion.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the failure", a: [0.35, 0.65, 1], names: ["compensated", "symptomatic", "decompensated"], ticks: ["compensated", "symptomatic", "decompensated"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "diuretic only (loop diuretic)" },
    { label: "ACE inhibitor or ARNI only" },
    { label: "beta-blocker only" },
    { label: "mineralocorticoid antagonist only (spironolactone)" },
    { label: "SGLT2 inhibitor only" },
    { label: "four-drug combination (ARNI, beta-blocker, MRA, SGLT2 inhibitor)" },
  ],
  status: "Failure: {level} · {drug} ·",
  drugNames: ["no treatment", "diuretic only", "ACE inhibitor or ARNI only", "beta-blocker only", "MRA only", "SGLT2 inhibitor only", "four-drug combination"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const diu = drug === 1 ? 1 : 0, acei = drug === 2 || drug === 6 ? 1 : 0, bb = drug === 3 || drug === 6 ? 1 : 0, mra = drug === 4 || drug === 6 ? 1 : 0, sg = drug === 5 || drug === 6 ? 1 : 0;
  const sym = cl((0.1 + 0.85 * a) * (bb ? 0.45 : 1));
  const raas = cl((0.1 + 0.85 * a) * (acei ? 0.4 : 1) + (diu ? 0.12 : 0));
  const ald = cl(raas * (mra ? 0.45 : 1));
  const vc = cl(0.5 * sym + 0.5 * raas);
  const vol = cl(0.08 + 0.9 * a * (0.4 + 0.6 * ald)) * (diu ? 0.45 : 1) * (mra ? 0.72 : 1) * (sg ? 0.8 : 1);
  const rem = cl((0.06 + 0.85 * a * (0.3 + 0.35 * sym + 0.35 * raas)) * (mra ? 0.9 : 1) * (sg ? 0.8 : 1));
  const co = cl(0.92 - 0.55 * a - 0.15 * rem + 0.12 * acei + 0.06 * bb + 0.04 * sg);
  const sx = cl(0.55 * vol + 0.45 * (1 - co));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(vol, 0.25, 0.5, ["minimal", "mild", "marked"]), w(1 - co, 0.3, 0.5, ["adequate", "reduced", "low"]), w(rem, 0.3, 0.75, ["limited", "progressing", "advanced"])];
  return { a, diu, acei, bb, mra, sg, sym, raas, ald, vc, vol, rem, co, sx, nh: cl((sym + raas) / 2), words, readout: "congestion " + words[0] + " · output " + words[1] + " · remodelling " + words[2] };
}
const TESTS = [
  [1, 0, "congestion marked · output low · remodelling progressing"],
  [1, 1, "congestion mild · output low · remodelling progressing"],
  [1, 6, "congestion minimal · output adequate · remodelling limited"],
  [0, 0, "congestion mild · output reduced · remodelling limited"],
  [2, 0, "congestion marked · output low · remodelling advanced"],
  [2, 1, "congestion mild · output low · remodelling advanced"],
  [2, 2, "congestion marked · output low · remodelling progressing"],
  [2, 3, "congestion marked · output low · remodelling progressing"],
  [2, 4, "congestion mild · output low · remodelling advanced"],
  [2, 5, "congestion marked · output low · remodelling progressing"],
  [2, 6, "congestion mild · output reduced · remodelling progressing"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="318" height="396" rx="18"/>
<rect class="sc-tissue sc-loop" x="344" y="44" width="602" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">THE HEART</text>
<text class="sc-zone" x="364" y="68">THE BODY'S RESPONSE (A VICIOUS CIRCLE)</text>
<g id="loop"></g><g id="heartSlot"></g><g id="kidneySlot"></g><g id="lungSlot"></g><g id="cong"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "heart-failure-pathophysiology", fig: "Fig 1", title: "Heart failure: the failing pump and its loop", W, H, body,
  label: "An animated failing heart that pumps too little. The kidneys and the sympathetic nervous system react, releasing renin, angiotensin II and aldosterone, which tighten vessels and hold salt and water. That adds load to the heart, which dilates and remodels, in a vicious circle. Fluid backs up into the lungs, neck veins and legs. Five gauges show congestion, output, neurohormonal activation, remodelling and symptoms. Treatments shown include a diuretic, ACE inhibitor or ARNI, beta-blocker, mineralocorticoid antagonist, SGLT2 inhibitor and the four-drug combination.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hf.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With four-drug combination",
  sourcesLis: [
    "<strong>The disease loop.</strong> A heart that cannot pump or fill well lowers the blood flow reaching the kidneys and the baroreceptors. The body answers with sympathetic drive and the renin-angiotensin-aldosterone system. These tighten vessels (more afterload) and hold salt and water (more preload and congestion). The extra load, with the direct toxic effect of the hormones, makes the ventricle dilate and remodel, which weakens pumping further. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Where treatments act.</strong> Diuretics remove salt and water. ACE inhibitors and ARNI reduce angiotensin II effects. Beta-blockers blunt sympathetic drive. Mineralocorticoid antagonists block aldosterone. SGLT2 inhibitors add a mild diuresis and other benefits. These are teaching toggles for the mechanism only.",
  ],
  simplified: "Preserved versus reduced ejection fraction, right-sided failure, valve disease, ischaemia, arrhythmia triggers, vasodilators, device therapy, natriuretic peptides, kidney and potassium monitoring, and every dose and target are left out. Sizes, speeds and levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.hf-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.hf-node-t{fill:var(--anatomy-strong);font:600 11px var(--anatomy-mono);pointer-events:none}
.hf-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hf-head{fill:var(--anatomy-mid)}
.hf-dot{fill:var(--c-cyt)}.hf-dot.v{fill:var(--c-fl)}.hf-dot.s{fill:var(--c-neut)}
.hf-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.hf-drug{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.4}
.hf-drug2{fill:var(--c-bad);stroke:none}
.hf-fluid{fill:var(--c-fl);opacity:.75}
.hf-vein{fill:color-mix(in srgb,var(--c-cyt2) 35%,var(--anatomy-paper));stroke:var(--c-cyt2);stroke-width:1.2}
.hf-leg{fill:color-mix(in srgb,var(--c-skin,#d9a77f) 70%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.hf-salt{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.5}
.hf-glu{fill:color-mix(in srgb,var(--c-plt) 45%,#fff);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.5}
.p-drop{fill:var(--c-fl)}.p-hf{fill:var(--c-rbc)}
.sc-loop{opacity:.9}`,
});
