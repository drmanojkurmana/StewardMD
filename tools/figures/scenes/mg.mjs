/* Myasthenia gravis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/mg.mjs [--print-model]
 * Static layout here; antibodies, acetylcholine, receptors and gauges move in mg.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How widely weakness spreads", a: [0.3, 0.65, 1], names: ["ocular", "generalised", "crisis"], ticks: ["ocular", "generalised", "crisis"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "cholinesterase inhibitor" },
    { label: "immunosuppression" },
    { label: "thymectomy and plasmapheresis" },
  ],
  status: "Spread: {level} · {drug} ·",
  drugNames: ["no treatment", "a cholinesterase inhibitor", "immunosuppression", "thymectomy and plasmapheresis"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const ach = drug === 1 ? 1 : 0, imm = drug === 2 ? 1 : 0, rem = drug === 3 ? 1 : 0;
  const abFactor = imm ? 0.5 : rem ? 0.28 : 1;
  const Ab = cl((0.25 + 0.75 * a) * abFactor);
  const Comp = cl(Ab * 0.92);
  const Rec = cl(1 - 0.8 * Comp);
  const Sig = cl(Rec * (ach ? 1.5 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Ab, 0.3, 0.6, ["low", "moderate", "high"]), w(Comp, 0.3, 0.6, ["low", "moderate", "high"]), w(Rec, 0.35, 0.65, ["few", "reduced", "many"]), w(Sig, 0.35, 0.65, ["weak", "reduced", "strong"])];
  return { a, lvl: level, ach, imm, rem, Ab, Comp, Rec, Sig, words, readout: "antibodies " + words[0] + " · complement " + words[1] + " · receptors " + words[2] + " · signal " + words[3] };
}
const TESTS = [
  [0, 0, "antibodies moderate · complement moderate · receptors many · signal strong"],
  [1, 0, "antibodies high · complement high · receptors reduced · signal reduced"],
  [2, 0, "antibodies high · complement high · receptors few · signal weak"],
  [1, 3, "antibodies low · complement low · receptors many · signal strong"],
];

/* ---------------- static layout ---------------- */
const NX = 480, MY = 315;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">IMMUNE SOURCE</text>
<text class="sc-zone" x="310" y="68">NERVE TO MUSCLE JUNCTION</text>
<text class="sc-zone" x="738" y="68">MUSCLES AFFECTED</text>
<ellipse class="mg-thymus" cx="95" cy="148" rx="38" ry="50"/>
<ellipse class="mg-thymus" cx="148" cy="148" rx="38" ry="50"/>
<ellipse class="mg-thy-h" cx="108" cy="128" rx="16" ry="22"/>
<rect class="mg-nerve" x="${NX - 14}" y="44" width="28" height="200"/>
<ellipse class="mg-nerve" cx="${NX}" cy="252" rx="54" ry="30"/>
<circle class="mg-ves" cx="${NX - 22}" cy="246" r="5"/><circle class="mg-ves" cx="${NX}" cy="256" r="5"/><circle class="mg-ves" cx="${NX + 22}" cy="246" r="5"/>
<rect id="muscleRect" class="mg-muscle" x="285" y="${MY}" width="400" height="92" rx="18"/>
<path class="mg-band" d="M330 ${MY + 10}V${MY + 82}M380 ${MY + 10}V${MY + 82}M430 ${MY + 10}V${MY + 82}M530 ${MY + 10}V${MY + 82}M580 ${MY + 10}V${MY + 82}M630 ${MY + 10}V${MY + 82}"/>
<rect id="eyeRing" class="mg-ring" x="772" y="122" width="116" height="66" rx="16"/>
<ellipse class="mg-eye" cx="830" cy="155" rx="46" ry="22"/>
<circle class="mg-pupil" cx="830" cy="155" r="10"/>
<path id="lidPath" class="mg-lid" d="M784 152Q830 132 876 152"/>
<rect id="limbRing" class="mg-ring" x="772" y="228" width="116" height="72" rx="16"/>
<rect class="mg-limb" x="782" y="244" width="62" height="26" rx="13"/>
<path class="mg-arm" d="M844 257H862"/>
<circle id="weightC" class="mg-weight" cx="878" cy="282" r="15"/>
<rect id="breathRing" class="mg-ring" x="772" y="318" width="116" height="76" rx="16"/>
<ellipse class="mg-lung" cx="830" cy="352" rx="40" ry="24"/>
<path id="diaphPath" class="mg-diaph" d="M790 378Q830 390 870 378"/>
<g id="cells"></g>
<g id="recs"></g>
<g id="parts"></g>
<g id="imps"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.mg-thymus{fill:#d98a9e;stroke:color-mix(in srgb,#d98a9e 55%,#000);stroke-width:1}
.mg-thy-h{fill:color-mix(in srgb,#d98a9e 40%,#fff);opacity:.55}
.mg-nerve{fill:#f3e2b8;stroke:#b89a58;stroke-width:1}
.mg-ves{fill:#fff;stroke:#b89a58;stroke-width:.8}
.mg-muscle{fill:color-mix(in srgb,var(--c-sm) 32%,var(--anatomy-paper));stroke:var(--c-sm);stroke-width:1.2}
.mg-band{fill:none;stroke:color-mix(in srgb,var(--c-sm) 60%,#000);stroke-width:1.4;opacity:.45}
.mg-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1.2}
.mg-pupil{fill:var(--anatomy-strong)}
.mg-lid{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.mg-limb{fill:color-mix(in srgb,var(--c-sm) 45%,var(--anatomy-paper));stroke:var(--c-sm);stroke-width:1.2}
.mg-arm{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round}
.mg-weight{fill:var(--anatomy-mid);stroke:var(--anatomy-strong);stroke-width:1}
.mg-lung{fill:color-mix(in srgb,var(--c-fl) 28%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.2}
.mg-diaph{fill:none;stroke:var(--c-fl);stroke-width:2.4;stroke-linecap:round}
.mg-ring{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:4 3;opacity:0}
.mg-rec{fill:#e9c04a;stroke:color-mix(in srgb,#e9c04a 55%,#000);stroke-width:.8}
.mg-abd{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.mg-imp{fill:#fff;stroke:var(--c-neut);stroke-width:2}
.p-ach{--cc:var(--c-no)}.p-comp{--cc:var(--c-bad)}
.g-ab{fill:var(--c-ab)}.g-comp{fill:var(--c-bad)}.g-rec{fill:#e9c04a}
`;

buildScene({
  id: "myasthenia-gravis", fig: "Fig 1", title: "Myasthenia gravis: antibodies at the neuromuscular junction", W, H, body, extraCss,
  label: "An animated neuromuscular junction in myasthenia gravis. The thymus linked immune response makes plasma cells release antibodies against acetylcholine receptors. Antibodies block receptors and attract complement, which damages the folds and leaves fewer working receptors. Acetylcholine from the motor nerve then gives a smaller muscle signal that fades with repeated use, causing fatigable weakness. The spread slider moves from ocular to generalised to crisis. Treatment choices are a cholinesterase inhibitor, immunosuppression, and thymectomy with plasmapheresis. Gauges show antibodies, complement, receptors left and muscle signal.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H, NX, MY }, pageJs: readFileSync(join(HERE, "mg.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How myasthenia gravis weakens muscle.</strong> In the common form, antibodies against the acetylcholine receptor at the neuromuscular junction block the receptor and attract complement. Complement damages the folded muscle membrane and receptors are lost, so each nerve impulse makes a smaller endplate signal. When that signal falls below what is needed, the fibre fails, and failure grows with repeated use: fatigable weakness. The thymus is often abnormal in this disease and helps drive the faulty antibody response, which is why removing it can help some people. Eye muscles are often first (drooping lid, double vision), then limb and bulbar muscles, and in crisis the breathing muscles. This is standard teaching in neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A cholinesterase inhibitor slows breakdown of acetylcholine in the cleft, so what receptors remain get a stronger, longer signal, but it does not stop the antibody attack. Immunosuppression lowers antibody production over time. Thymectomy removes the thymus source and plasmapheresis removes circulating antibody, so receptor damage eases. These are teaching toggles only and name no individual drug or dose.",
  ],
  simplified: "Other antibody types (for example MuSK and LRP4), congenital myasthenic syndromes, tests such as repetitive stimulation and single fibre studies, individual immunosuppressant drugs and their risks, who benefits from thymectomy, intensive care for crisis, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
