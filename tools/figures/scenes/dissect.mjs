/* Aortic dissection as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dissect.mjs [--print-model]
 * Static layout here; flow, false lumen, heart and gauges move in dissect.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Dissection pattern", a: [0.42, 0.68, 1], names: ["type B", "type A", "complicated"], ticks: ["type B", "type A", "complicated"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "blood pressure and heart rate control" },
    { label: "surgery" },
    { label: "endovascular repair" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "blood pressure and heart rate control", "surgery", "endovascular repair"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const typeA = level > 0 ? 1 : 0, compl = level === 2 ? 1 : 0;
  const ctrl = drug === 1 ? 1 : 0, surg = drug === 2 ? 1 : 0, endo = drug === 3 ? 1 : 0;
  const surgEff = surg ? (typeA ? 0.9 : 0.35) : 0;
  const endoEff = endo ? (typeA ? 0.15 : 0.9) : 0;
  const repair = Math.max(surgEff, endoEff);
  const Impulse = cl(0.92 - 0.5 * ctrl - 0.35 * repair);
  const FalseL = cl((0.35 + 0.55 * a) * (1 - 0.3 * ctrl) * (1 - 0.7 * repair));
  const Branch = cl((0.1 + 0.55 * compl + 0.15 * typeA) * (0.6 + 0.4 * a) * (1 - 0.65 * repair) * (1 - 0.15 * ctrl));
  const Tamp = typeA ? cl((compl ? 0.75 : 0.32) * (1 - 0.85 * surgEff) * (1 - 0.2 * endoEff)) : 0.04;
  const AR = typeA ? cl((compl ? 0.7 : 0.3) * (1 - 0.85 * surgEff) * (1 - 0.15 * endoEff)) : 0.03;
  const Pain = cl(0.3 + 0.55 * a - 0.18 * ctrl - 0.25 * repair);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const comp = Math.max(Tamp, AR);
  const words = [w(FalseL, 0.45, 0.7, ["contained", "expanding", "extensive"]), w(Branch, 0.25, 0.55, ["open", "threatened", "blocked"]), w(comp, 0.15, 0.45, ["none", "developing", "severe"])];
  return { a, typeA, compl, ctrl, surg, endo, surgEff, endoEff, repair, Impulse, FalseL, Branch, Tamp, AR, Pain, words, readout: "false lumen " + words[0] + " · branches " + words[1] + " · complications " + words[2] };
}
const TESTS = [
  [0, 0, "false lumen expanding · branches open · complications none"],
  [1, 0, "false lumen extensive · branches open · complications developing"],
  [2, 0, "false lumen extensive · branches blocked · complications severe"],
  [2, 2, "false lumen contained · branches threatened · complications developing"],
  [0, 3, "false lumen contained · branches open · complications none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEART AND AORTA</text>
<text class="sc-zone sc-dim" x="850" y="68">BRANCHES</text>
<g id="aorta"></g><g id="branches"></g><g id="organs"></g><g id="heart"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "aortic-dissection", fig: "Fig 1", title: "Aortic dissection: tear, false lumen and complications", W, H, body,
  label: "An animated aorta and heart. A tear in the inner lining lets blood enter the wall and split it, forming a false lumen beside the true lumen. Type B starts in the descending aorta, type A involves the ascending aorta and root, and the complicated pattern adds blocked branch vessels, fluid around the heart and a leaking aortic valve. Gauges show the false lumen, impulse on the wall, branch blockage, tamponade, valve leak and pain. Treatment choices include impulse control, surgery and endovascular repair.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "dissect.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How a dissection develops.</strong> A tear in the intima, the inner lining of the aorta, lets pressurised blood enter the media, the middle layer of the wall. The blood splits the media and creates a false lumen beside the true lumen, separated by an intimal flap. The split can propagate along the aorta. Hypertension increases the impulse and shear on the wall, and connective tissue disease can weaken the media, so both predispose to dissection. The classic symptom is abrupt tearing chest or back pain. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Patterns and complications shown.</strong> In the Stanford scheme, type A involves the ascending aorta and often the aortic root, while type B is confined to the descending aorta. Propagation can cover branch vessel openings and block flow to organs. A type A dissection can leak blood into the pericardium and cause tamponade, and root involvement can distort the aortic valve and cause aortic regurgitation. A complicated pattern here means branch blockage or a major complication is present.",
    "<strong>Treatment ideas shown.</strong> Blood pressure and heart rate control lowers the impulse driving propagation. Surgery replaces the torn ascending aorta and root when needed. Endovascular repair places a stent graft to cover a descending tear and expand the true lumen. Which option fits depends on the pattern and complications. These are teaching toggles only.",
  ],
  simplified: "Entry and re-entry tears, intramural haematoma and penetrating ulcer variants, detailed branch anatomy, organ-specific malperfusion syndromes, imaging, operative technique, contraindications and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ds-wall{fill:none;stroke:color-mix(in srgb,var(--c-endo) 42%,var(--c-tis));stroke-width:66;stroke-linecap:round;stroke-linejoin:round}
.ds-true{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke-width:48;stroke-linecap:round;stroke-linejoin:round}
.ds-false{fill:none;stroke:#8e2447;stroke-linecap:round;stroke-linejoin:round}
.ds-flap{fill:none;stroke:#f3e6c4;stroke-width:2.2;stroke-linecap:round;opacity:.9}
.ds-tear{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.ds-graft{fill:none;stroke:#e8dcc0;stroke-width:44;stroke-linecap:round;opacity:.95}
.ds-stent{fill:none;stroke:var(--anatomy-strong);stroke-width:1.7;stroke-linejoin:round}
.ds-weak{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-dasharray:5 5;opacity:.8}
.ds-branch{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-mid));stroke-width:7;stroke-linecap:round}
.ds-branch-end{fill:var(--c-lymph);stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.9}
.ds-organ{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:.9}
.ds-occ{fill:#5a5258;stroke:#3a3438;stroke-width:.9}
.ds-peri{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:5 4}
.ds-fluid{fill:var(--c-fl)}
.ds-myo{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--c-tis))}
.ds-cav{fill:color-mix(in srgb,var(--c-rbc) 35%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ds-valve{fill:none;stroke:#f3e6c4;stroke-width:3;stroke-linecap:round}
.ds-arrow{fill:var(--c-bad)}
.ds-pain{fill:none;stroke:var(--c-neut);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.p-false{--cc:#e5484d}.p-ar{--cc:var(--c-fl)}
.dr-g-fill.g-imp{fill:var(--c-neut)}.dr-g-fill.g-tamp{fill:var(--c-fl)}.dr-g-fill.g-pain{fill:var(--c-neut)}
`,
});
