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
const NX = 480, MY = 318;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">IMMUNE SOURCE</text>
<text class="sc-zone" x="300" y="68">NERVE TO MUSCLE JUNCTION</text>
<text class="sc-zone" x="752" y="68">MUSCLES AFFECTED</text>
<g id="thymusG">
<path class="mg-thymus" d="M90 110C78 114 72 130 74 152C76 176 84 198 96 202C106 205 112 196 112 178C112 156 106 118 90 110Z"/>
<path class="mg-thymus" d="M146 110C158 114 164 130 162 152C160 176 152 198 140 202C130 205 124 196 124 178C124 156 130 118 146 110Z"/>
<path class="mg-septa" d="M78 142L106 138M78 162L108 162M84 182L106 186"/>
<path class="mg-septa" d="M158 142L130 138M158 162L128 162M152 182L130 186"/>
<circle class="mg-lob" cx="90" cy="150" r="2.2"/><circle class="mg-lob" cx="96" cy="168" r="2.2"/>
<circle class="mg-lob" cx="146" cy="150" r="2.2"/><circle class="mg-lob" cx="140" cy="168" r="2.2"/>
</g>
<rect class="mg-nerve" x="${NX - 14}" y="44" width="28" height="190"/>
<ellipse class="mg-nerve" cx="${NX}" cy="252" rx="54" ry="30"/>
<circle class="mg-ves" cx="${NX - 22}" cy="246" r="5"/><circle class="mg-ves" cx="${NX}" cy="256" r="5"/><circle class="mg-ves" cx="${NX + 22}" cy="246" r="5"/>
<rect class="mg-cleft" x="366" y="282" width="228" height="36" rx="10"/>
<rect id="muscleRect" class="mg-muscle" x="300" y="${MY}" width="360" height="88" rx="18"/>
<path class="mg-band" d="M340 ${MY + 10}V${MY + 78}M377 ${MY + 10}V${MY + 78}M414 ${MY + 10}V${MY + 78}M451 ${MY + 10}V${MY + 78}M529 ${MY + 10}V${MY + 78}M566 ${MY + 10}V${MY + 78}M603 ${MY + 10}V${MY + 78}M640 ${MY + 10}V${MY + 78}"/>
<ellipse id="glowGood" class="mg-glow-g" cx="480" cy="362" rx="178" ry="44"/>
<ellipse id="glowBad" class="mg-glow-b" cx="480" cy="362" rx="178" ry="44"/>
<g id="eyeSlot"></g>
<g id="limbSlot"></g>
<g id="lungSlot"></g>
<rect id="eyeRing" class="mg-ring" x="755" y="70" width="166" height="146" rx="16"/>
<rect id="limbRing" class="mg-ring" x="739" y="220" width="182" height="94" rx="16"/>
<rect id="breathRing" class="mg-ring" x="784" y="274" width="108" height="140" rx="16"/>
<path id="lidPath" class="mg-lid" d="M768 140Q785 128 802 140"/>
<path id="armLine" class="mg-arm" d="M874 269L902 283"/>
<circle id="weightC" class="mg-weight" cx="902" cy="294" r="13"/>
<path id="diaphPath" class="mg-diaph" d="M797 414Q838 424 879 414"/>
<g id="cells"></g>
<g id="recs"></g>
<g id="parts"></g>
<g id="filt"></g>
<g id="imps"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.mg-thymus{fill:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1.2}
.mg-septa{fill:none;stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1;opacity:.7}
.mg-lob{fill:color-mix(in srgb,var(--c-lymph) 70%,#000);stroke:none}
.mg-nerve{fill:#f3e2b8;stroke:#b89a58;stroke-width:1}
.mg-ves{fill:#fff;stroke:#b89a58;stroke-width:.8}
.mg-cleft{fill:var(--c-no);opacity:.08;stroke:none}
.mg-muscle{fill:color-mix(in srgb,var(--c-sm) 32%,var(--anatomy-paper));stroke:var(--c-sm);stroke-width:1.2}
.mg-band{fill:none;stroke:color-mix(in srgb,var(--c-sm) 60%,#000);stroke-width:1.4;opacity:.45}
.mg-glow-g{fill:var(--c-good);stroke:none;pointer-events:none}
.mg-glow-b{fill:var(--c-bad);stroke:none;pointer-events:none}
.mg-ring{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:4 3;opacity:0}
.mg-lid{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.mg-arm{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round}
.mg-weight{fill:var(--anatomy-mid);stroke:var(--anatomy-strong);stroke-width:1}
.mg-diaph{fill:none;stroke:var(--c-fl);stroke-width:2.4;stroke-linecap:round}
.mg-rec{fill:#e9c04a;stroke:color-mix(in srgb,#e9c04a 55%,#000);stroke-width:.8}
.mg-abd{fill:none;stroke:var(--c-ab);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.mg-enz{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.mg-filt{fill:var(--anatomy-card);stroke:var(--c-fl);stroke-width:1.2}
.mg-mesh{fill:none;stroke:var(--c-fl);stroke-width:.8;opacity:.7}
.mg-imp{fill:#fff;stroke:var(--c-neut);stroke-width:2}
.mg-cap{fill:var(--anatomy-strong);font-size:12px}
.p-ach{--cc:var(--c-no)}.p-comp{--cc:var(--c-bad)}.p-drug{--cc:var(--c-lymph)}
.g-ab{fill:var(--c-ab)}.g-comp{fill:var(--c-bad)}.g-rec{fill:#e9c04a}
`;

buildScene({
  id: "myasthenia-gravis", fig: "Fig 1", title: "Myasthenia gravis: antibodies at the neuromuscular junction", W, H, body, extraCss,
  label: "An animated neuromuscular junction in myasthenia gravis. The thymus linked immune response makes plasma cells release antibodies against acetylcholine receptors. Antibodies block receptors and attract complement, which damages the folds and leaves fewer working receptors. Acetylcholine from the motor nerve then gives a smaller muscle signal that fades with repeated use, causing fatigable weakness. The spread slider moves from ocular to generalised to crisis. A cholinesterase inhibitor caps the enzymes that break messenger down so the signal lasts longer, immunosuppression calms antibody making, and thymectomy with plasmapheresis removes the thymus source and filters antibodies out of the blood. Gauges show antibodies, complement, receptors left and muscle signal.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H, NX, MY }, pageJs: readFileSync(join(HERE, "mg.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With thymectomy and plasmapheresis",
  sourcesLis: [
    "<strong>How myasthenia gravis weakens muscle.</strong> In the common form, antibodies against the acetylcholine receptor at the neuromuscular junction block the receptor and attract complement. Complement damages the folded muscle membrane and receptors are lost, so each nerve impulse makes a smaller endplate signal. When that signal falls below what is needed, the fibre fails, and failure grows with repeated use: fatigable weakness. The thymus is often abnormal in this disease and helps drive the faulty antibody response, which is why removing it can help some people. Eye muscles are often first (drooping lid, double vision), then limb and bulbar muscles, and in crisis the breathing muscles. This is standard teaching in neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A cholinesterase inhibitor slows breakdown of acetylcholine in the cleft, so what receptors remain get a stronger, longer signal, but it does not stop the antibody attack. Immunosuppression lowers antibody production over time. Thymectomy removes the thymus source and plasmapheresis removes circulating antibody, so receptor damage eases. These are teaching toggles only and name no individual drug or dose.",
  ],
  simplified: "Other antibody types (for example MuSK and LRP4), congenital myasthenic syndromes, tests such as repetitive stimulation and single fibre studies, individual immunosuppressant drugs and their risks, who benefits from thymectomy, intensive care for crisis, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
