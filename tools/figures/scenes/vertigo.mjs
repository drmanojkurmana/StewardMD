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
    { label: "Epley manoeuvre" },
    { label: "vestibular suppressant (short course)" },
    { label: "salt restriction" },
  ],
  status: "Cause: {level} · {drug} ·",
  drugNames: ["no treatment", "Epley manoeuvre", "vestibular suppressant", "salt restriction"],
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
  const epl = drug === 1 ? 1 : 0, sup = drug === 2 ? 1 : 0, salt = drug === 3 ? 1 : 0;
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
  [0, 1, "vertigo settled · nystagmus none · balance steady · ear fullness none"],
  [1, 2, "vertigo mild spinning · nystagmus present · balance unsteady · ear fullness none"],
  [2, 3, "vertigo mild spinning · nystagmus present · balance steady · ear fullness some"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">INNER EAR</text>
<text class="sc-zone" x="390" y="68">BRAINSTEM</text>
<text class="sc-zone" x="620" y="68">EYES AND VOR</text>
<circle class="vt-canal vt-post" cx="145" cy="175" r="58"/>
<circle class="vt-canal" cx="205" cy="145" r="38"/>
<ellipse class="vt-canal" cx="175" cy="235" rx="62" ry="24"/>
<g id="cochleaG"><circle class="vt-coch" cx="268" cy="228" r="26"/><circle class="vt-coch" cx="268" cy="228" r="16"/><circle class="vt-dot" cx="268" cy="228" r="6"/></g>
<circle class="vt-vest" cx="185" cy="195" r="20"/>
<g id="saccule"><ellipse class="vt-oto" cx="172" cy="202" rx="15" ry="10"/><circle class="vt-speck" cx="166" cy="199" r="2"/><circle class="vt-speck" cx="173" cy="203" r="2"/><circle class="vt-speck" cx="178" cy="198" r="1.6"/></g>
<ellipse class="vt-cereb" cx="495" cy="292" rx="62" ry="34"/>
<rect class="vt-brain" x="415" y="108" width="100" height="205" rx="28"/>
<path id="nerve" class="vt-nerve" d="M202 190C280 180 340 176 415 174"/>
<path class="vt-vor" d="M500 158C570 138 620 148 662 160"/>
<g id="nuclei"><circle class="vt-nuc" cx="450" cy="160" r="11"/><circle class="vt-nuc" cx="480" cy="160" r="11"/><circle class="vt-nuc" cx="450" cy="190" r="11"/><circle class="vt-nuc" cx="480" cy="190" r="11"/></g>
<g id="inflCell"></g>
<path id="headArc" class="vt-arc" d="M648 122A118 44 0 0 1 842 122"/>
<path class="vt-arrow" d="M842 122l-12 -2l6 11z"/>
<ellipse class="vt-eye" cx="680" cy="172" rx="52" ry="32"/><ellipse class="vt-eye" cx="812" cy="172" rx="52" ry="32"/>
<g id="irisL"><circle class="vt-iris" cx="680" cy="172" r="13"/><circle class="vt-pupil" cx="680" cy="172" r="5"/></g>
<g id="irisR"><circle class="vt-iris" cx="812" cy="172" r="13"/><circle class="vt-pupil" cx="812" cy="172" r="5"/></g>
<rect class="vt-box" x="34" y="350" width="430" height="72" rx="12"/>
<rect class="vt-box" x="496" y="350" width="430" height="72" rx="12"/>
<text class="dr-pt" x="50" y="374">PERIPHERAL CAUSES</text>
<text class="dr-pt2" x="50" y="394">Inner ear or vestibular nerve</text>
<text class="dr-pt2" x="50" y="410">Nystagmus beats one way and calms with fixation</text>
<text class="dr-pt" x="512" y="374">CENTRAL CAUSES</text>
<text class="dr-pt2" x="512" y="394">Brainstem or cerebellum</text>
<text class="dr-pt2" x="512" y="410">Vertical or changing nystagmus, speech or limb signs</text>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "vestibular-vertigo", fig: "Fig 1", title: "Vestibular system and vertigo", W, H, body,
  label: "An animated inner ear, vestibular nerve, brainstem and eyes. Semicircular canals sense head rotation, otolith organs sense gravity, and signals reach the vestibular nuclei. The vestibulo-ocular reflex moves the eyes to hold gaze steady. Displaced canalith crystals, nerve inflammation or excess endolymph upset the balance signal and cause vertigo and nystagmus. Gauges show canalith, inflammation, hydrops, vertigo, nystagmus and balance.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "vertigo.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
.vt-canal{fill:none;stroke:var(--c-lymph);stroke-width:13;opacity:.75}
.vt-post{stroke:var(--c-eos)}
.vt-coch{fill:var(--c-lymph);fill-opacity:.28;stroke:var(--c-lymph);stroke-width:2}
.vt-vest{fill:var(--c-b);stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:1}
.vt-oto{fill:var(--c-donor);stroke:color-mix(in srgb,var(--c-donor) 55%,#000);stroke-width:.8}
.vt-speck{fill:var(--anatomy-strong)}
.vt-dot{fill:var(--c-lymph)}
.vt-cereb{fill:var(--c-mast);fill-opacity:.5;stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:1}
.vt-brain{fill:var(--c-tis);stroke:var(--anatomy-mid);stroke-width:1.2}
.vt-nuc{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:.9}
.vt-nerve{fill:none;stroke:var(--c-neut);stroke-width:6;stroke-linecap:round}
.vt-vor{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-dasharray:6 5}
.vt-eye{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.vt-iris{fill:var(--c-th2);stroke:color-mix(in srgb,var(--c-th2) 55%,#000);stroke-width:.8}
.vt-pupil{fill:var(--anatomy-strong)}
.vt-arc{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-dasharray:5 4}
.vt-arrow{fill:var(--anatomy-mid)}
.vt-box{fill:var(--anatomy-paper);fill-opacity:.45;stroke:var(--anatomy-faint);stroke-width:1}
.vt-can{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 50%,#000);stroke-width:.6}
.vt-endo{fill:var(--c-lymph)}
.vt-imp{fill:var(--c-good)}
`,
  sourcesLis: [
    "<strong>How balance sensing works.</strong> The semicircular canals sense head rotation and the otolith organs (utricle and saccule) sense gravity and straight line movement. Hair cells send signals along the vestibular nerve to the vestibular nuclei in the brainstem. From there the vestibulo-ocular reflex moves the eyes opposite to the head so gaze stays steady, while other pathways help posture. Unequal signals from the two sides are read as movement and cause vertigo and nystagmus. This is standard teaching in neurology and ENT texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Causes shown.</strong> In BPPV, loose otoconia (canaliths) enter a semicircular canal, usually the posterior canal, and brief position changes trigger vertigo. In vestibular neuritis, inflammation of the vestibular nerve causes sustained vertigo without hearing loss. In Meniere disease, excess endolymph (endolymphatic hydrops) causes episodic vertigo with ear fullness and hearing symptoms. Central causes in the brainstem or cerebellum are suggested by vertical or direction changing nystagmus and by speech, limb or gait signs. These are teaching summaries only.",
    "<strong>Treatment ideas shown.</strong> The Epley manoeuvre moves canaliths out of the posterior canal in BPPV. A vestibular suppressant may calm severe vertigo for a short course but can slow central compensation if continued. Salt restriction is a long term measure used in Meniere disease. These are teaching toggles only.",
  ],
  simplified: "One ear only is drawn, hearing pathways and the full range of central and peripheral causes, Dix Hallpike and other bedside tests, vestibular rehabilitation, migraine and other episodic syndromes, drug choices and doses, and all time courses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
