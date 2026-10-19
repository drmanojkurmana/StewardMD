/* Vestibular system and vertigo as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/vertigo.mjs [--print-model]
 * Static layout here; canalith, endolymph, nerve impulses, eyes and gauges move in vertigo.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Peripheral cause", a: [0.92, 0.92, 0.92], names: ["BPPV", "vestibular neuritis", "Meniere disease"], ticks: ["BPPV", "neuritis", "Meniere"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "vestibular suppressant (short course)" },
    { label: "salt restriction" },
    { label: "Epley manoeuvre" },
  ],
  status: "Cause: {level} · {drug} ·",
  drugNames: ["no treatment", "vestibular suppressant", "salt restriction", "Epley manoeuvre"],
};
function modelOf(S, level, drug) {
  const TAB = [
    { C: 0.92, I: 0.06, Hy: 0.12 },
    { C: 0.06, I: 0.92, Hy: 0.12 },
    { C: 0.06, I: 0.08, Hy: 0.92 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const b = TAB[level];
  let C = b.C, I = b.I, Hy = b.Hy;
  const sup = drug === 1 ? 1 : 0, salt = drug === 2 ? 1 : 0, epl = drug === 3 ? 1 : 0;
  if (epl) C = C * (level === 0 ? 0.13 : 0.85);
  if (salt) Hy = Hy * (level === 2 ? 0.38 : 0.9);
  const drive = Math.max(C, I, Hy);
  let V = cl(0.06 + 0.78 * drive), N = cl(0.02 + 0.82 * drive);
  if (sup) { V = V * 0.5; N = N * 0.55; }
  const Bln = cl(0.92 - 0.68 * V - (sup ? 0.18 : 0));
  const F = Hy;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(V, 0.3, 0.6, ["settled", "mild spinning", "strong spinning"]), w(N, 0.25, 0.55, ["none", "present", "strong"]), w(1 - Bln, 0.35, 0.6, ["steady", "unsteady", "very unsteady"]), w(F, 0.3, 0.6, ["none", "some", "full"])];
  return { C, I, Hy, V, N, Bln, F, epl, sup, salt, drive, words, readout: "vertigo " + words[0] + " · nystagmus " + words[1] + " · balance " + words[2] + " · ear fullness " + words[3] };
}
const TESTS = [
  [0, 0, "vertigo strong spinning · nystagmus strong · balance very unsteady · ear fullness none"],
  [0, 3, "vertigo settled · nystagmus none · balance steady · ear fullness none"],
  [1, 1, "vertigo mild spinning · nystagmus present · balance unsteady · ear fullness none"],
  [2, 2, "vertigo mild spinning · nystagmus present · balance steady · ear fullness some"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">INNER EAR</text>
<text class="sc-zone" x="390" y="68">BRAINSTEM</text>
<text class="sc-zone" x="620" y="68">EYES AND VOR</text>
<ellipse id="hydroHalo" class="vt-hydro" cx="182" cy="206" rx="120" ry="82"/>
<circle class="vt-canal vt-post" cx="150" cy="182" r="56"/>
<circle class="vt-canal" cx="208" cy="148" r="36"/>
<ellipse class="vt-canal" cx="176" cy="240" rx="60" ry="22"/>
<g id="cochleaG"><path class="vt-spiral" d="M268 232 m-2.5 0 a2.5 2.5 0 0 1 5 0 a5 5 0 0 1 -10 0 a8.5 8.5 0 0 1 17 0 a12 12 0 0 1 -24 1 a15.5 15.5 0 0 1 30 -3"/><circle class="vt-core" cx="268" cy="232" r="3.5"/></g>
<circle id="vestibule" class="vt-vest" cx="188" cy="200" r="11"/>
<g id="saccule"><ellipse class="vt-oto" cx="176" cy="207" rx="13" ry="8.5"/><circle class="vt-speck" cx="170" cy="205" r="1.8"/><circle class="vt-speck" cx="177" cy="209" r="1.8"/><circle class="vt-speck" cx="182" cy="204" r="1.5"/></g>
<path id="epleyPath" class="vt-guide" d="M150 238 L132 260 L140 280 L165 280 L188 252 L188 208" opacity="0"/>
<path id="nerve" class="vt-nerve" d="M199 196 C280 186 350 184 514 208"/>
<path id="nerveHot" class="vt-nervehot" d="M199 196 C280 186 350 184 514 208" opacity="0"/>
<g id="brainSlot"></g>
<g id="nuclei"><circle class="vt-nuc" cx="-14" cy="-9" r="9"/><circle class="vt-nuc" cx="14" cy="-9" r="9"/><circle class="vt-nuc" cx="-14" cy="9" r="9"/><circle class="vt-nuc" cx="14" cy="9" r="9"/><circle class="vt-drug" cx="-14" cy="-9" r="4.5" opacity="0"/><circle class="vt-drug" cx="14" cy="-9" r="4.5" opacity="0"/><circle class="vt-drug" cx="-14" cy="9" r="4.5" opacity="0"/><circle class="vt-drug" cx="14" cy="9" r="4.5" opacity="0"/></g>
<path id="vor" class="vt-vor" d="M514 208 C560 200 610 186 656 184"/>
<ellipse class="vt-eye" cx="700" cy="192" rx="46" ry="30"/><ellipse class="vt-eye" cx="828" cy="192" rx="46" ry="30"/>
<g id="irisL"><circle class="vt-iris" cx="700" cy="192" r="12"/><circle class="vt-pupil" cx="700" cy="192" r="5"/></g>
<g id="irisR"><circle class="vt-iris" cx="828" cy="192" r="12"/><circle class="vt-pupil" cx="828" cy="192" r="5"/></g>
<path id="headArc" class="vt-arc" d="M646 132 A118 42 0 0 1 838 132"/>
<path class="vt-arrow" d="M838 132 l-13 -1 l7 11 z"/>
<g id="spinG" opacity="0"><path class="vt-spin" d="M-96 -74 C-136 -52 -136 52 -96 74"/><path class="vt-spin" d="M96 -74 C136 -52 136 52 96 74"/><path class="vt-spinarrow" d="M-96 74 l-13 -3 l9 -10 z"/><path class="vt-spinarrow" d="M96 -74 l13 3 l-9 10 z"/></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "vestibular-vertigo", fig: "Fig 1", title: "Vestibular system and vertigo", W, H, body,
  label: "An animated inner ear, vestibular nerve, brainstem and eyes. Semicircular canals sense head rotation, otolith organs sense gravity, and signals reach the vestibular nuclei. The vestibulo-ocular reflex moves the eyes to hold gaze steady. Displaced canalith crystals, nerve inflammation or excess endolymph upset the balance signal and cause vertigo and nystagmus. Treatments act on the drawing: the Epley manoeuvre guides crystals out of the canal, suppressant dots sit on the relay nuclei and calm the signal, and less salt shrinks inner ear fluid. Gauges show canalith, inflammation, hydrops, vertigo, nystagmus and balance.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "vertigo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With Epley manoeuvre",
  extraCss: `
.vt-hydro{fill:var(--c-fl);stroke:none}
.vt-canal{fill:none;stroke:var(--c-lymph);stroke-width:12}
.vt-post{stroke:var(--c-eos);stroke-width:13}
.vt-spiral{fill:none;stroke:var(--c-lymph);stroke-width:2.5;stroke-linecap:round}
.vt-core{fill:var(--c-lymph);stroke:none}
.vt-vest{fill:var(--c-b);stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:1}
.vt-oto{fill:var(--c-donor);stroke:color-mix(in srgb,var(--c-donor) 55%,#000);stroke-width:.8}
.vt-speck{fill:var(--anatomy-strong);stroke:none}
.vt-guide{fill:none;stroke:var(--c-no);stroke-width:3;stroke-dasharray:8 6;stroke-linecap:round;stroke-linejoin:round}
.vt-nerve{fill:none;stroke:var(--c-neut);stroke-width:5;stroke-linecap:round}
.vt-nervehot{fill:none;stroke:var(--c-bad);stroke-width:5;stroke-linecap:round}
.vt-nuc{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:.9}
.vt-drug{fill:var(--c-bad);stroke:#fff;stroke-width:1}
.vt-vor{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-dasharray:6 5;stroke-linecap:round}
.vt-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.vt-iris{fill:var(--c-th2);stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:.8}
.vt-pupil{fill:var(--anatomy-strong);stroke:none}
.vt-arc{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 4}
.vt-arrow{fill:var(--anatomy-mid);stroke:none}
.vt-spin{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-dasharray:9 8;stroke-linecap:round}
.vt-spinarrow{fill:var(--c-bad);stroke:none}
.vt-can{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 50%,#000);stroke-width:.6}
.vt-endo{fill:var(--c-lymph);stroke:none}
.vt-imp{fill:var(--c-good);stroke:none}
.vt-cap{fill:var(--anatomy-strong);font-size:12px}
`,
  sourcesLis: [
    "<strong>How balance sensing works.</strong> The semicircular canals sense head rotation and the otolith organs (utricle and saccule) sense gravity and straight line movement. Hair cells send signals along the vestibular nerve to the vestibular nuclei in the brainstem. From there the vestibulo-ocular reflex moves the eyes opposite to the head so gaze stays steady, while other pathways help posture. Unequal signals from the two sides are read as movement and cause vertigo and nystagmus. This is standard teaching in neurology and ENT texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Causes shown.</strong> In BPPV, loose otoconia (canaliths) enter a semicircular canal, usually the posterior canal, and brief position changes trigger vertigo. In vestibular neuritis, inflammation of the vestibular nerve causes sustained vertigo without hearing loss. In Meniere disease, excess endolymph (endolymphatic hydrops) causes episodic vertigo with ear fullness and hearing symptoms. Central causes in the brainstem or cerebellum are suggested by vertical or direction changing nystagmus and by speech, limb or gait signs. These are teaching summaries only.",
    "<strong>Treatment ideas shown.</strong> The Epley manoeuvre moves canaliths out of the posterior canal in BPPV. A vestibular suppressant may calm severe vertigo for a short course but can slow central compensation if continued. Salt restriction is a long term measure used in Meniere disease. These are teaching toggles only.",
  ],
  simplified: "One ear only is drawn, hearing pathways and the full range of central and peripheral causes, Dix Hallpike and other bedside tests, vestibular rehabilitation, migraine and other episodic syndromes, drug choices and doses, and all time courses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
