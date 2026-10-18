/* Brachial plexus injuries as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/brachial.mjs [--print-model]
 * Static layout here; signals, limb posture and gauges move in brachial.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Injury site", a: [0, 1, 2, 3], names: ["upper trunk", "lower trunk", "radial nerve", "ulnar nerve"], ticks: ["upper", "lower", "radial", "ulnar"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "observation" },
    { label: "splint and physiotherapy" },
    { label: "nerve repair" },
  ],
  status: "Injury: {level} · {drug} ·",
  drugNames: ["observation", "splint and physiotherapy", "nerve repair"],
};
function modelOf(S, level, drug) {
  const BASE = [
    { w: 0.86, s: 0.55, d: 0.82 },
    { w: 0.72, s: 0.72, d: 0.86 },
    { w: 0.82, s: 0.46, d: 0.88 },
    { w: 0.68, s: 0.62, d: 0.82 },
  ];
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const base = BASE[t];
  const splint = drug === 1 ? 1 : 0, repair = drug === 2 ? 1 : 0;
  const Weak = cl(base.w * (1 - (repair ? 0.38 : splint ? 0.12 : 0)));
  const Sens = cl(base.s * (1 - (repair ? 0.32 : splint ? 0.05 : 0)));
  const Deform = cl(base.d * (1 - (splint ? 0.45 : repair ? 0.25 : 0)));
  const Func = cl(1 - (0.5 * Weak + 0.25 * Sens + 0.25 * Deform) + (splint ? 0.08 : repair ? 0.06 : 0));
  const Recov = cl(0.18 + (repair ? 0.48 : splint ? 0.28 : 0) * (1 - 0.2 * base.w));
  const Signal = cl(1 - 0.78 * Weak + (repair ? 0.08 : splint ? 0.03 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Weak, 0.35, 0.65, ["mild", "moderate", "severe"]), w(Sens, 0.35, 0.65, ["preserved", "reduced", "lost"]), w(Deform, 0.35, 0.65, ["straight", "altered", "deformed"])];
  return { lvl: t, splint, repair, Weak, Sens, Deform, Func, Recov, Signal, words, readout: "weakness " + words[0] + " · sensation " + words[1] + " · posture " + words[2] };
}
const TESTS = [
  [0, 0, "weakness severe · sensation reduced · posture deformed"],
  [0, 2, "weakness moderate · sensation reduced · posture altered"],
  [1, 1, "weakness moderate · sensation lost · posture altered"],
  [3, 0, "weakness severe · sensation reduced · posture deformed"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="590" y="44" width="356" height="396" rx="18"/>
<text class="bp-zone" x="34" y="68">BRACHIAL PLEXUS</text>
<text class="bp-zone" x="610" y="68">ARM AND HAND</text>
<g id="wires">
<path class="bp-line" d="M90 115L235 135M90 155L235 135M90 195L235 195M90 235L235 255M90 275L235 255"/>
<path class="bp-line" d="M235 135L360 120M235 135L360 150M235 195L360 180M235 195L360 210M235 255L360 240M235 255L360 270"/>
<path class="bp-line" d="M360 120L470 135M360 150L470 195M360 180L470 135M360 210L470 255M360 240L470 195M360 270L470 255"/>
<path class="bp-line" d="M470 135L540 90M470 195L540 140M470 195L540 290M470 135L540 190M470 255L540 190M470 255L540 240"/>
</g>
<g id="nodes">
<circle class="bp-root" cx="90" cy="115" r="16"/><circle class="bp-root" cx="90" cy="155" r="16"/><circle class="bp-root" cx="90" cy="195" r="16"/><circle class="bp-root" cx="90" cy="235" r="16"/><circle class="bp-root" cx="90" cy="275" r="16"/>
<text class="bp-in" x="90" y="119" text-anchor="middle">C5</text><text class="bp-in" x="90" y="159" text-anchor="middle">C6</text><text class="bp-in" x="90" y="199" text-anchor="middle">C7</text><text class="bp-in" x="90" y="239" text-anchor="middle">C8</text><text class="bp-in" x="90" y="279" text-anchor="middle">T1</text>
<ellipse class="bp-trunk" cx="235" cy="135" rx="32" ry="19"/><ellipse class="bp-trunk" cx="235" cy="195" rx="32" ry="19"/><ellipse class="bp-trunk" cx="235" cy="255" rx="32" ry="19"/>
<text class="bp-in" x="235" y="139" text-anchor="middle">Upper</text><text class="bp-in" x="235" y="199" text-anchor="middle">Mid</text><text class="bp-in" x="235" y="259" text-anchor="middle">Lower</text>
<circle class="bp-div" cx="360" cy="120" r="9"/><circle class="bp-div" cx="360" cy="150" r="9"/><circle class="bp-div" cx="360" cy="180" r="9"/><circle class="bp-div" cx="360" cy="210" r="9"/><circle class="bp-div" cx="360" cy="240" r="9"/><circle class="bp-div" cx="360" cy="270" r="9"/>
<circle class="bp-cord" cx="470" cy="135" r="18"/><circle class="bp-cord" cx="470" cy="195" r="18"/><circle class="bp-cord" cx="470" cy="255" r="18"/>
<text class="bp-lab" x="442" y="139" text-anchor="end">Lateral</text><text class="bp-lab" x="442" y="199" text-anchor="end">Posterior</text><text class="bp-lab" x="442" y="259" text-anchor="end">Medial</text>
<circle class="bp-branch" cx="540" cy="90" r="12"/><circle class="bp-branch" cx="540" cy="140" r="12"/><circle class="bp-branch" cx="540" cy="190" r="12"/><circle class="bp-branch" cx="540" cy="240" r="12"/><circle class="bp-branch" cx="540" cy="290" r="12"/>
<text class="bp-lab" x="540" y="72" text-anchor="middle">Musculocut.</text><text class="bp-lab" x="540" y="122" text-anchor="middle">Radial</text><text class="bp-lab" x="540" y="172" text-anchor="middle">Median</text><text class="bp-lab" x="540" y="222" text-anchor="middle">Ulnar</text><text class="bp-lab" x="540" y="272" text-anchor="middle">Axillary</text>
<ellipse id="inj0" class="bp-inj" cx="235" cy="135" rx="40" ry="27"/>
<ellipse id="inj1" class="bp-inj" cx="235" cy="255" rx="40" ry="27"/>
<circle id="inj2" class="bp-inj" cx="540" cy="140" r="20"/>
<circle id="inj3" class="bp-inj" cx="540" cy="240" r="20"/>
<g id="rep0" class="bp-rep"><path d="M228 128L242 142M242 128L228 142"/></g>
<g id="rep1" class="bp-rep"><path d="M228 248L242 262M242 248L228 262"/></g>
<g id="rep2" class="bp-rep"><path d="M533 133L547 147M547 133L533 147"/></g>
<g id="rep3" class="bp-rep"><path d="M533 233L547 247M547 233L533 247"/></g>
</g>
<g id="limb">
<circle class="bp-skin" cx="768" cy="110" r="16"/>
<path class="bp-skinp" d="M752 124H784V214H752Z"/>
<circle class="bp-skin" cx="768" cy="215" r="11"/>
<text class="bp-lab" x="736" y="114" text-anchor="end">Shoulder</text><text class="bp-lab" x="736" y="219" text-anchor="end">Elbow</text><text class="bp-lab" x="736" y="304" text-anchor="end">Wrist</text>
<g id="forearmG">
<path class="bp-skinp" d="M754 215H782V302H754Z"/>
<g id="handG">
<ellipse class="bp-skin" cx="768" cy="332" rx="27" ry="30"/>
<g id="normF"><path class="bp-finger" d="M748 356V378M761 360V382M774 360V380M786 356V374M742 322L728 336"/></g>
<g id="clawF"><path class="bp-finger" d="M748 356Q746 370 756 374M761 360Q760 374 770 376M774 360Q776 372 784 372M786 356Q790 366 796 366M742 322L728 336"/></g>
</g>
<rect id="splintEl" class="bp-splint" x="742" y="272" width="52" height="72" rx="9"/>
</g>
<path id="waiterArrow" class="bp-arrow" d="M812 238Q838 268 812 298M812 298L804 284M812 298L824 288"/>
</g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-root:#5ec1a0;--c-trunk:#e9b84a;--c-cord:#b7a1e6;--c-branch:#7ab8ff;--c-skin:#e8c39a;--c-sig:#ffd24a}
body[data-theme="light"]{--c-root:#2f9f7c;--c-trunk:#d99a1f;--c-cord:#8f72d0;--c-branch:#2f7ad8;--c-skin:#d9a06a;--c-sig:#b58900}
.bp-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.bp-lab{fill:var(--anatomy-text);font-size:10.5px;pointer-events:none}
.bp-in{fill:#1a1030;font-size:10.5px;font-weight:700;pointer-events:none}
.bp-line{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;opacity:.75}
.bp-root{fill:var(--c-root);stroke:color-mix(in srgb,var(--c-root) 55%,#000);stroke-width:1}
.bp-trunk{fill:var(--c-trunk);stroke:color-mix(in srgb,var(--c-trunk) 55%,#000);stroke-width:1}
.bp-div{fill:var(--c-cord);stroke:color-mix(in srgb,var(--c-cord) 55%,#000);stroke-width:.8;opacity:.85}
.bp-cord{fill:var(--c-cord);stroke:color-mix(in srgb,var(--c-cord) 55%,#000);stroke-width:1}
.bp-branch{fill:var(--c-branch);stroke:color-mix(in srgb,var(--c-branch) 55%,#000);stroke-width:1}
.bp-inj{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-dasharray:5 4;opacity:0}
.bp-rep{stroke:var(--c-good);stroke-width:2.2;stroke-linecap:round;opacity:0}
.bp-skin{fill:var(--c-skin);stroke:color-mix(in srgb,var(--c-skin) 55%,#000);stroke-width:1}
.bp-skinp{fill:var(--c-skin);stroke:color-mix(in srgb,var(--c-skin) 55%,#000);stroke-width:1}
.bp-finger{fill:none;stroke:var(--c-skin);stroke-width:7;stroke-linecap:round}
.bp-splint{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:1;opacity:0}
.bp-arrow{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:0}
.p-sig{--cc:var(--c-sig)}
.dr-g-fill.g-sens{fill:var(--c-cyt)}.dr-g-fill.g-post{fill:var(--c-trunk)}.dr-g-fill.g-rec{fill:var(--c-root)}
`;

buildScene({
  id: "brachial-plexus-injuries", fig: "Fig 1", title: "Brachial plexus injuries: roots to hand", W, H, body, extraCss,
  label: "An animated brachial plexus from roots C5 to T1 through trunks, divisions and cords to the main branches, with an arm and hand showing the posture for each injury. Upper trunk injury gives Erb palsy with a waiter's tip posture. Lower trunk injury gives Klumpke palsy with a claw hand. Radial nerve injury gives wrist drop. Ulnar nerve injury gives an ulnar claw. The median nerve and its ape hand pattern are described on its branch label. Gauges show weakness, sensory loss, posture deformity, function, recovery and nerve signal. Treatment choices are observation, splint and physiotherapy, and nerve repair.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "brachial.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How the plexus is built.</strong> Ventral rami C5 to T1 form upper, middle and lower trunks. Each trunk splits into anterior and posterior divisions behind the clavicle. Divisions recombine into lateral, posterior and medial cords around the axillary artery. Cords give the main branches: musculocutaneous, axillary, radial, median and ulnar nerves. This is standard teaching in anatomy texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The patterns shown.</strong> Erb palsy from upper trunk (C5 to C6) injury, classically after shoulder dystocia or trauma, weakens shoulder abduction and elbow flexion; the arm hangs adducted and internally rotated with the forearm pronated, the waiter's tip posture. Klumpke palsy from lower trunk (C8 to T1) injury weakens intrinsic hand muscles and gives a claw hand, sometimes with medial hand sensory loss. Radial nerve injury weakens wrist and finger extension and gives wrist drop. Ulnar nerve injury weakens intrinsic muscles, gives an ulnar claw (mainly ring and little fingers) and sensory loss in the little finger. Median nerve injury, described on the median branch label, wastes the thenar muscles and loses thumb opposition, the ape hand pattern. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Observation while a stretched nerve recovers, a splint to hold a safe posture with physiotherapy to keep joints mobile and strengthen recovering muscles, and nerve repair for a divided or severely injured nerve. These are teaching toggles only.",
  ],
  simplified: "Root avulsion, Horner syndrome in lower trunk injury, individual muscle testing, dermatomes in detail, electrodiagnostics, imaging, timing of surgery and all drug doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
