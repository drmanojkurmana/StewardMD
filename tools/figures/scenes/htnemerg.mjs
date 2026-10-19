/* Hypertensive emergency as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/htnemerg.mjs [--print-model]
 * Static layout here; flow, wall injury and organ damage move in htnemerg.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How severe the pressure rise is", a: [0.4, 0.75, 1], names: ["urgency", "emergency", "malignant"], ticks: ["urgency", "emergency", "malignant"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "beta blocker" },
    { label: "water tablet" },
    { label: "vessel relaxer drip" },
  ],
  status: "Severity: {level} · {drug} ·",
  drugNames: ["no treatment", "beta blocker", "water tablet", "vessel relaxer drip"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const bb = drug === 1 ? 1 : 0, vaso = drug === 3 ? 1 : 0;
  const diur = drug === 2 ? [0.75, 0.2, 0.08][level] : 0;
  const P = cl(a * (1 - 0.52 * vaso - 0.18 * bb - 0.55 * diur));
  const B = cl((P - 0.32) * 1.55);
  const E = cl(B * 1.05 - 0.10 * vaso - 0.02 * bb);
  const F = cl((E - 0.3) * 1.7 - 0.05 * vaso);
  const O = cl(0.08 + 0.55 * F + 0.4 * B - 0.40 * vaso - 0.12 * bb - 0.15 * diur);
  const Perf = cl(1 - 0.85 * O);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.35, 0.65, ["lower", "high", "very high"]), w(F, 0.2, 0.5, ["intact", "injured", "necrotic"]), w(O, 0.25, 0.55, ["settled", "threatened", "damaged"])];
  return { a, bb, vaso, diur, P, B, E, F, O, Perf, words, readout: "pressure " + words[0] + " · vessel wall " + words[1] + " · organs " + words[2] };
}
const TESTS = [
  [1, 0, "pressure very high · vessel wall necrotic · organs damaged"],
  [1, 3, "pressure high · vessel wall intact · organs settled"],
  [1, 1, "pressure high · vessel wall injured · organs threatened"],
  [0, 2, "pressure lower · vessel wall intact · organs settled"],
];

/* ---------------- static layout ---------------- */
const CY = 200;
const body = `
<rect class="sc-tissue" x="14" y="44" width="540" height="396" rx="18"/>
<rect class="sc-tissue" x="566" y="44" width="380" height="396" rx="18"/>
<ellipse id="oedema" class="htn-oed" cx="280" cy="${CY}" rx="255" ry="95"/>
<ellipse id="haloBrain" class="htn-halo" cx="660" cy="150" rx="80" ry="62"/>
<ellipse id="haloHeart" class="htn-halo" cx="855" cy="150" rx="66" ry="70"/>
<ellipse id="haloKidney" class="htn-halo" cx="655" cy="325" rx="60" ry="75"/>
<ellipse id="haloEye" class="htn-halo" cx="855" cy="325" rx="72" ry="48"/>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 38}" width="540" height="76"/>
<g id="rbcs"></g><g id="endo"></g><g id="fib"></g>
<g id="brainSlot"></g><g id="heartSlot"></g><g id="kidneySlot"></g><g id="eyeSlot"></g>
<g id="parts"></g><g id="rings"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "hypertensive-emergency", fig: "Fig 1", title: "Hypertensive emergency: pressure overwhelms autoregulation", W, H, body,
  label: "An animated arteriole and target organs in severe hypertension. Rising pressure narrows the arteriole, then breaks through: the lining is injured, fibrin enters dying wall muscle, plasma leaks into the tissue, and the brain, heart, kidney and eye are damaged. A slider sets the severity. A vessel relaxer drip opens the wall, a beta blocker parks on the heart and slows it, and a water tablet makes the kidney pass urine.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "htnemerg.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With vessel relaxer drip",
  sourcesLis: [
    "<strong>How a hypertensive emergency develops.</strong> When pressure rises, small arteries narrow to protect the tissue beyond them (autoregulation). If pressure rises too far or too fast, that protection is overwhelmed: the vessel is forced open, flow and pressure break through to fragile small vessels, the endothelium is injured, plasma proteins and fibrin enter the wall (fibrinoid necrosis), and the wall weakens and leaks. Target organs then suffer: brain swelling (encephalopathy), heart strain and failure, acute kidney injury, and retinal damage with a swollen optic disc. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> In an emergency the pressure is lowered in a controlled, gradual way with a vessel relaxer drip so organ perfusion is not lost, alongside a beta blocker that slows the heart. A water tablet helps only when the rise is mild with no organ damage. These are teaching toggles only.",
  ],
  simplified: "Secondary causes of hypertension, large artery tears such as aortic dissection, drug choice, exact reduction targets and timing, pregnancy, and organ-specific procedures are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.htn-oed{fill:var(--c-fl);stroke:none}
.htn-halo{fill:var(--c-bad);stroke:none}
.htn-story{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.htn-fibp{fill:var(--c-bad);stroke:#7a161c;stroke-width:.8}
.htn-dmg{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.htn-ring{fill:none;stroke:var(--c-bad);stroke-width:1.6}
.htn-disc{fill:#f6c453;stroke:#b98a1f;stroke-width:1}
.htn-flame{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.p-surge{fill:none;stroke:var(--c-bad);stroke-width:1.6}
.p-leak2{fill:var(--c-fl)}
.p-vaso{--cc:var(--c-no)}.p-block{--cc:var(--c-cyt)}.p-urine{--cc:var(--c-fl)}
.dr-g-fill.g-break{fill:var(--c-fl)}
.dr-g-fill.g-wall{fill:var(--c-cyt)}
.dr-g-fill.g-fib{fill:var(--c-plt)}
`,
});
