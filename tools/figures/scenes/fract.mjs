/* Fracture healing as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/fract.mjs [--print-model]
 * Static layout here; callus, cells, vessels and gauges move in fract.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Healing stage", a: [0.1, 0.42, 0.72, 1], names: ["haematoma", "soft callus", "hard callus", "remodelling"], ticks: ["haematoma", "soft callus", "hard callus", "remodelling"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no support" },
    { label: "immobilise (cast or splint)" },
    { label: "internal fixation" },
  ],
  status: "Healing stage: {level} · {drug} ·",
  drugNames: ["no support", "immobilised", "fixed internally"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const stab = [0.12, 0.68, 0.96][drug];
  const motion = 1 - stab;
  const soft = cl(1 - Math.abs(a - 0.42) * 2.4);
  const bridge = cl((a - 0.06) * 1.2 * (0.45 + 0.55 * stab));
  const mineral = cl(Math.pow(a, 1.35) * 1.2 * (0.5 + 0.5 * stab));
  const hard = cl(mineral * (1 - Math.max(0, a - 0.72) * 1.6));
  const remodel = cl((a - 0.72) * 3.4);
  const align = cl(0.3 + 0.62 * stab - (drug === 0 ? a * 0.18 : 0));
  const union = cl(bridge * 0.6 + mineral * 0.4 - motion * 0.18 * (1 - a));
  const delay = cl(motion * 0.72 + (1 - bridge) * 0.28 - remodel * 0.35);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(bridge, 0.25, 0.65, ["absent", "partial", "complete"]), w(mineral, 0.25, 0.6, ["soft", "forming", "hard"]), w(align, 0.35, 0.65, ["poor", "fair", "good"]), w(union, 0.3, 0.7, ["not united", "uniting", "united"])];
  return { a, stab, motion, soft, bridge, mineral, hard, remodel, align, union, delay, words, readout: "bridging " + words[0] + " · hardness " + words[1] + " · alignment " + words[2] + " · union " + words[3] };
}
const TESTS = [
  [0, 0, "bridging absent · hardness soft · alignment fair · union not united"],
  [1, 1, "bridging partial · hardness forming · alignment good · union uniting"],
  [2, 2, "bridging complete · hardness hard · alignment good · union united"],
  [3, 0, "bridging partial · hardness hard · alignment poor · union uniting"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LONG BONE, CUT ALONG ITS LENGTH</text>
<g id="muscleSlotT"></g>
<g id="muscleSlotB"></g>
<g id="fragL">
<polygon class="fr-bone" points="60,170 452,170 438,212 458,250 436,288 452,330 60,330"/>
<rect class="fr-cortex" x="60" y="170" width="392" height="26"/>
<rect class="fr-cortex" x="60" y="304" width="392" height="26"/>
<rect class="fr-marrow" x="60" y="196" width="378" height="108"/>
</g>
<g id="fragR">
<polygon class="fr-bone" points="508,170 900,170 900,330 508,330 524,288 502,250 522,212"/>
<rect class="fr-cortex" x="508" y="170" width="392" height="26"/>
<rect class="fr-cortex" x="508" y="304" width="392" height="26"/>
<rect class="fr-marrow" x="522" y="196" width="378" height="108"/>
</g>
<g id="haem"></g>
<g id="callus"></g>
<g id="vessels"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="treat"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "fracture-healing", fig: "Fig 1", title: "Fracture healing: clot to remodelled bone", W, H, body,
  label: "An animated long bone broken in the middle, framed by muscle above and below. A blood clot fills the gap, then a soft callus bridges it, hardens into bone, and is reshaped. Vessels grow in from the bone ends and the nearby muscle while builders lay down new bone. A cast cuff holds the limb still from outside, and a plate with screws holds the ends in line from inside. Gauges show bridging, hardness, alignment, healing and the risk of slow healing.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "fract.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without support", withLabel: "With internal fixation",
  extraCss: `
body{--c-bone:#e8d9b0;--c-cortex:#c9a86a;--c-marrow:#f4ead0;--c-soft:#9fc6d8;--c-hard:#d9b878;--c-haem:#8e2432;--c-plate:#9aa3ad;--c-cast:#7ab8ff}
body[data-theme="light"]{--c-bone:#e0cda0;--c-cortex:#b8934f;--c-marrow:#f7efdb;--c-soft:#6fa8c4;--c-hard:#c4a055;--c-haem:#a02838;--c-plate:#6e7883;--c-cast:#2f7ad8}
.fr-bone{fill:var(--c-bone);stroke:color-mix(in srgb,var(--c-cortex) 70%,#000);stroke-width:1}
.fr-cortex{fill:var(--c-cortex);opacity:.85}
.fr-marrow{fill:var(--c-marrow);opacity:.8}
.fr-haem{fill:var(--c-haem);stroke:color-mix(in srgb,var(--c-haem) 60%,#000);stroke-width:.8}
.fr-soft{fill:var(--c-soft);stroke:color-mix(in srgb,var(--c-soft) 55%,#000);stroke-width:.8}
.fr-hard{fill:var(--c-hard);stroke:color-mix(in srgb,var(--c-hard) 55%,#000);stroke-width:.8}
.fr-bridge{fill:var(--c-bone);stroke:color-mix(in srgb,var(--c-cortex) 60%,#000);stroke-width:.8}
.fr-vess{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.fr-plate{fill:var(--c-plate);stroke:color-mix(in srgb,var(--c-plate) 55%,#000);stroke-width:.8}
.fr-screw{fill:var(--c-plate);stroke:color-mix(in srgb,var(--c-plate) 55%,#000);stroke-width:.8}
.fr-cast{fill:var(--c-cast);stroke:color-mix(in srgb,var(--c-cast) 55%,#000);stroke-width:1.5}
.fr-cuffedge{fill:none;stroke:color-mix(in srgb,var(--c-cast) 55%,#000);stroke-width:2}
.fr-strap{fill:color-mix(in srgb,var(--c-cast) 72%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cast) 55%,#000);stroke-width:1}
.fr-arrow{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.fr-streak{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.fr-cap{fill:var(--anatomy-strong);font-size:12px}
.p-frrbc{--cc:var(--c-bad)}
.fr-shaft{fill:none;stroke:var(--c-plate);stroke-width:2;stroke-linecap:round}
.dr-g-fill.g-bridge{fill:var(--c-soft)}.dr-g-fill.g-hard{fill:var(--c-hard)}.dr-g-fill.g-align{fill:var(--c-good)}.dr-g-fill.g-union{fill:var(--c-good)}.dr-g-fill.g-delay{fill:var(--c-bad)}
.cl-ost{--cc:#d9b878}.cl-ocl{--cc:#c978c9}
`,
  sourcesLis: [
    "<strong>How a fracture heals.</strong> Bleeding from the broken bone ends forms a clot (haematoma) in the gap. Inflammatory cells clear debris, new blood vessels grow in, and a soft callus of fibrous tissue and cartilage bridges the gap. Bone-forming cells then replace it with woven bone (hard callus), which restores strength. Over time the woven bone is removed and replaced by lamellar bone and the shape and inner canal are restored (remodelling). This is standard teaching in orthopaedic and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What slows healing, and what can go wrong.</strong> Movement at the fracture, a poor blood supply, infection, smoking, diabetes, poor nutrition and some medicines can delay union. Problems include delayed union, failure to unite (nonunion), healing in a poor position (malunion), infection of bone, stiffness of nearby joints and, in children, growth disturbance. These are teaching points only, shown without any numbers.",
    "<strong>Treatment ideas shown.</strong> Holding the fracture still and in line with a cast or splint (immobilisation), or holding it with metalwork inside the body (internal fixation, for example a plate and screws). These are teaching toggles only.",
  ],
  simplified: "Open fractures, the detailed cell signalling, growth-plate injuries in children, bone grafts, external fixators, weight-bearing advice, and all doses, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
