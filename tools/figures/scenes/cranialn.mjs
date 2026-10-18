/* Cranial nerves I to XII: brainstem nuclei and exits, functions and common lesions, as an animated scene.
 * Original drawing; Anima styling, Anatomy page shell.
 *   node tools/figures/scenes/cranialn.mjs [--print-model]
 * Layout and model here; nerve signals, eye, face and tongue signs and gauges move in cranialn.page.js.
 * Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Nerve group shown", a: [0, 1, 2, 3], names: ["special senses I, II and VIII", "eye movers III, IV and VI", "face: trigeminal V and facial VII", "lower nerves IX to XII"], ticks: ["I II VIII", "III IV VI", "V VII", "IX to XII"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "protect the eye" },
    { label: "treat the cause" },
  ],
  status: "Group: {level} · {drug} ·",
  drugNames: ["no treatment", "eye protected", "cause treated"],
};
function modelOf(S, level, drug) {
  const G = [
    { s: 0.48, f: 0.44, p: 0.12, r: 0.30 },
    { s: 0.34, f: 0.30, p: 0.22, r: 0.88 },
    { s: 0.38, f: 0.34, p: 0.86, r: 0.62 },
    { s: 0.42, f: 0.38, p: 0.18, r: 0.66 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const g = G[level];
  let s = g.s, f = g.f, p = g.p, r = g.r;
  if (drug === 1) { if (level === 1 || level === 2) { r = cl(r - 0.55); f = cl(f + 0.06); } }
  if (drug === 2) {
    s = cl(s + 0.38); f = cl(f + 0.34); p = cl(p - 0.55);
    if (level === 1 || level === 2) { r = cl(r - 0.45); }
    else if (level === 3) { r = cl(r - 0.35); }
    else { r = cl(r - 0.18); }
  }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(s, 0.35, 0.65, ["weak", "reduced", "strong"]), w(f, 0.35, 0.65, ["lost", "reduced", "working"]), w(p, 0.2, 0.55, ["none", "some", "severe"]), w(r, 0.35, 0.65, ["low", "raised", "high"])];
  return { grp: level, drug, sig: s, fn: f, pain: p, risk: r, words, readout: "signal " + words[0] + " · function " + words[1] + " · pain " + words[2] + " · risk " + words[3] };
}
const TESTS = [
  [1, 0, "signal weak · function lost · pain some · risk high"],
  [1, 2, "signal strong · function reduced · pain none · risk raised"],
  [2, 1, "signal reduced · function reduced · pain severe · risk low"],
  [2, 2, "signal strong · function working · pain some · risk low"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="cn-zone" x="34" y="68">BRAIN AND NERVES</text>
<text class="cn-zone" x="690" y="68">FACE AND TARGETS</text>
<g id="brainSlot"></g>
<path class="cn-bar" d="M200 190L290 190L283 395Q283 402 276 402L214 402Q207 402 207 395Z"/>
<path class="cn-sep" d="M201 250H289M201 320H289"/>
<path class="cn-sep" d="M245 196L245 398"/>
<g id="nerves"></g><g id="nuclei"></g>
<ellipse id="lesGlow" class="cn-glow" cx="735" cy="195" rx="60" ry="42" opacity="0"/>
<g id="parts"></g>
<ellipse class="cn-head" cx="770" cy="235" rx="100" ry="118"/>
<ellipse class="cn-ear" cx="672" cy="235" rx="10" ry="20"/>
<ellipse class="cn-eye" cx="735" cy="195" rx="17" ry="11"/>
<ellipse class="cn-eye" cx="805" cy="195" rx="17" ry="11"/>
<g id="pupilL"><circle class="cn-pupil" cx="735" cy="195" r="5"/></g>
<g id="pupilR"><circle class="cn-pupil" cx="805" cy="195" r="5"/></g>
<rect id="lidL" class="cn-lid" x="717" y="183" width="36" height="8" rx="4" opacity="0"/>
<path class="cn-nose" d="M770 205L762 238H778"/>
<path id="mouthEl" class="cn-mouth" d="M738 282Q770 292 802 282"/>
<ellipse id="tongueEl" class="cn-tongue" cx="770" cy="312" rx="20" ry="9"/>
<circle id="uvulaEl" class="cn-uvula" cx="770" cy="272" r="4"/>
<ellipse class="cn-chest" cx="770" cy="408" rx="34" ry="16"/>
<ellipse id="flush" class="cn-flush" cx="700" cy="262" rx="24" ry="32" opacity="0"/>
<g id="bolts" opacity="0"><path class="cn-bolt" d="M690 240L702 252L694 264L706 276"/><path class="cn-bolt" d="M716 236L728 248L720 260L732 272"/><path class="cn-bolt" d="M664 248L676 260L668 272L680 284"/></g>
<g id="shieldMk" opacity="0"><rect class="cn-shield" x="700" y="172" width="74" height="48" rx="12"/><path class="cn-tape" d="M706 216L768 178"/><g id="drop1"><circle class="cn-drop" cx="0" cy="0" r="3"/></g><g id="drop2"><circle class="cn-drop" cx="0" cy="0" r="2.4"/></g></g>
<g id="blockMk"><circle class="cn-halo" cx="0" cy="0" r="24"/><rect class="cn-clamp" x="-15" y="-12" width="30" height="24" rx="7"/><path class="cn-clampgap" d="M-15 -5H15M-15 5H15"/></g>
<g id="facefx"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cranial-nerve-lesions", fig: "Fig 1", title: "Cranial nerves: nuclei, exits and lesion signs", W, H, body,
  label: "An animated brain and face. Cranial nerve nuclei sit in the midbrain, pons and medulla, with the smell and vision pathways above. Nerves travel to the eye, face, ear, throat and tongue. Signals travel along the highlighted nerve group, but a block on the nerve slows them. A blocked third nerve moves the eye down and out with a wide pupil and a drooping lid. A blocked facial nerve weakens the face and fires pain, and blocked lower nerves affect voice, swallowing and the tongue. A slider picks the nerve group, and treatment choices are none, protect the eye, or treat the cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cranialn.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With cause treated",
  sourcesLis: [
    "<strong>How the cranial nerves are organised.</strong> Each cranial nerve has a nucleus or ganglion, a course from the brainstem, and sensory, motor or parasympathetic fibers to a target. The trigeminal nerve (fifth) carries facial sensation and motor fibers to chewing muscles; its ganglion holds sensory cell bodies. Trigeminal neuralgia gives brief severe facial pain with numbness usually absent. The facial nerve (seventh) moves the face, carries taste from the front of the tongue, and supplies tear and saliva glands. A lower seventh lesion weakens the whole face and risks the cornea, while an upper lesion spares the forehead. The third nerve moves most eye muscles and lifts the lid, and its fibers narrow the pupil, so compression gives a down and out eye with a wide pupil. The sixth nerve supplies only lateral rectus, so its lesion keeps the eye from turning out. The vagus affects voice, palate and swallowing, and the twelfth nerve moves the tongue, which points toward a lower lesion. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Treat the cause means lifting pressure or calming inflammation where present, so signals flow again. Protect the eye means drops and a shield when the lid cannot close, guarding the cornea while the nerve heals. These are teaching toggles only.",
  ],
  simplified: "Individual foramina, detailed brainstem cross sections, reflex arcs, vestibular and hearing testing, olfactory and visual field detail, and all drug choices and doses are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
  extraCss: `
.cn-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.cn-bar{fill:color-mix(in srgb,var(--c-endo) 32%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}
.cn-sep{stroke:var(--anatomy-mid);stroke-width:.8;fill:none;opacity:.6}
.cn-head{fill:color-mix(in srgb,var(--c-plt) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:1}
.cn-ear{fill:color-mix(in srgb,var(--c-plt) 40%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.8}
.cn-eye{fill:#fff;stroke:var(--anatomy-mid);stroke-width:.9}
.cn-pupil{fill:#20222a}
.cn-lid{fill:color-mix(in srgb,var(--c-plt) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-plt) 60%,#000);stroke-width:.7}
.cn-nose{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-linecap:round}
.cn-mouth{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.cn-tongue{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:.8}
.cn-uvula{fill:var(--c-bad)}
.cn-chest{fill:color-mix(in srgb,var(--c-lymph) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 55%,#000);stroke-width:.9}
.cn-nerve{fill:none;stroke:var(--c-lymph);stroke-width:2;stroke-linecap:round}
.cn-nuc{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.9}
.cn-gang{fill:var(--c-ab);stroke:color-mix(in srgb,var(--c-ab) 55%,#000);stroke-width:.9}
.cn-fx{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.cn-halo{fill:var(--c-bad);stroke:none}
.cn-clamp{fill:color-mix(in srgb,var(--c-bad) 70%,#000);stroke:color-mix(in srgb,var(--c-bad) 40%,#fff);stroke-width:1.2}
.cn-clampgap{fill:none;stroke:var(--anatomy-paper);stroke-width:1.6;stroke-linecap:round}
.cn-glow{fill:var(--c-bad);stroke:none}
.cn-bolt{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.cn-flush{fill:var(--c-bad);stroke:none}
.cn-shield{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.4}
.cn-tape{fill:none;stroke:var(--anatomy-mid);stroke-width:3;stroke-linecap:round;opacity:.7}
.cn-drop{fill:var(--c-fl);stroke:none}
.cn-cap{fill:var(--anatomy-strong);font-size:12px;pointer-events:none}
.p-sig{--cc:var(--c-cyt2)}
.dr-g-fill.g-fn{fill:var(--c-lymph)}.dr-g-fill.g-pain{fill:var(--c-neut)}
`,
});
