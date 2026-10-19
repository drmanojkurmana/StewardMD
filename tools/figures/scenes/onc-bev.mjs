/* Bevacizumab as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-bev.mjs [--print-model]
 * Static layout here; VEGF mop-up, sprout stall and gauges move in onc-bev.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.3, 0.65, 1], names: ["early", "middle", "late"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "bevacizumab" },
    { label: "bevacizumab with BP control and surgery pause" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "bevacizumab", "bevacizumab with protection"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, mon = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.3 + 0.65 * a) : 0.04;
  const Grow = on ? cl(0.35 - 0.3 * a) : cl(0.55 + 0.4 * a);
  const Leak = on ? cl(0.3 - 0.25 * a) : cl(0.6 + 0.35 * a);
  const BP = on ? cl(a * (mon ? 0.25 : 1) * (0.5 + 0.45 * a)) : 0.05;
  const Pu = on ? cl((0.2 + 0.6 * a) * (mon ? 0.6 : 1)) : 0.03;
  const Cl = on ? cl(0.1 + 0.5 * a) : 0.02;
  const Pf = on ? cl(a * (mon ? 0.2 : 1) * (0.35 + 0.5 * a)) : 0.01;
  const Wd = on ? cl((0.35 + 0.55 * a) * (mon ? 0.25 : 1)) : 0.05;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "shrinking", "dying"]), w(BP, 0.25, 0.6, ["ok", "high", "very high"]), w(Pu, 0.25, 0.6, ["tight", "leaking", "flooding"])];
  return { a, on, mon, K, Grow, Leak, BP, Pu, Cl, Pf, Wd, words, readout: "tumour " + words[0] + " · blood pressure " + words[1] + " · kidneys " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · blood pressure ok · kidneys tight"],
  [0, 1, "tumour shrinking · blood pressure ok · kidneys leaking"],
  [2, 1, "tumour dying · blood pressure very high · kidneys flooding"],
  [2, 2, "tumour dying · blood pressure ok · kidneys leaking"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="bv-zone" x="34" y="68">TUMOUR AND NEW VESSELS</text>
<text class="bv-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="tum"></g>
<g id="ves"></g>
<g id="sprout"></g>
<g id="veg"></g>
<g id="ab"></g>
<g id="cx"></g>
<g id="deb"></g>
<g id="leak"></g>
<g id="kidSlot"></g><g id="kidFx"></g>
<g id="artSlot"></g><g id="artFx"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="skinSlot"></g><g id="skinFx"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "bevacizumab-mechanism-adverse-effects", fig: "Fig 1", title: "Bevacizumab: VEGF blockade and side effects", W, H, body,
  label: "An animated tumour with a sprouting vessel and toxicity organs. The tumour releases VEGF that pulls a new leaky branch from the parent vessel. Bevacizumab antibodies mop up VEGF so the sprout stalls, vessels tighten and the tumour starves. The kidney leaks protein, the artery tightens and clots, the bowel wall can tear and a skin wound stays open and bleeds. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-bev.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With protection",
  sourcesLis: [
    "<strong>How bevacizumab works.</strong> Bevacizumab is a monoclonal antibody to VEGF-A. It soaks up free VEGF so it cannot switch on VEGF receptors on endothelium; tumour sprouts stall and regress, leaky tumour vessels normalise, and the tumour starves. Hypertension follows lower endothelial nitric oxide, proteinuria follows loss of glomerular VEGF signalling, and bleeding, gut perforation, poor wound healing and arterial thrombosis follow the same vessel blockade in healthy tissue. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Protection shown.</strong> Blood pressure control plus holding the drug around surgery, which keeps pressure, gut and wound harm low while tumour kill, protein leak and clot risk continue. This is a teaching toggle only.",
  ],
  simplified: "Other VEGF drugs, chemotherapy combinations, eye uses, fistula, heart failure, infusion reactions, testing and monitoring schedules, when to hold or stop the drug, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.bv-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.bv-cap{fill:var(--anatomy-strong);font-size:13px}
.bv-abd{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.7;stroke-linejoin:round}
.bv-veg{--cc:var(--c-cyt)}
.bv-cx{--cc:var(--c-mac)}
.bv-deb{--cc:var(--c-graft)}
.bv-leak{fill:var(--c-fl)}
.bv-lumen{fill:color-mix(in srgb,var(--c-rbc) 32%,var(--anatomy-paper))}
.bv-sprout{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:.8}
.bv-prot{--cc:#e9c46a}
.bv-tint{fill:var(--c-bad)}
.bv-flow{--cc:var(--c-rbc)}
.bv-fib{fill:none;stroke:color-mix(in srgb,var(--c-plt) 70%,#fff);stroke-width:1}
.bv-hole{fill:#241a12}
.bv-spill{--cc:var(--c-eos)}
.bv-gut{fill:var(--c-bad)}
.bv-slash{fill:var(--c-bad)}
.bv-lip{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:.6}
.bv-blood{fill:var(--c-rbc)}
.bv-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
`,
});
