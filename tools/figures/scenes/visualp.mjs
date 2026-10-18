/* Visual pathway and field defects as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/visualp.mjs [--print-model]
 * Static layout here; signals, lesion marker, fields and gauges move in visualp.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Lesion site", a: [0, 1, 2, 3, 4, 5], names: ["optic nerve", "chiasm", "optic tract", "temporal loop", "parietal fibres", "occipital cortex"], ticks: ["nerve", "chiasm", "tract", "temporal", "parietal", "occipital"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "treat the cause" },
    { label: "visual rehabilitation" },
  ],
  status: "Lesion: {level} · {drug} ·",
  drugNames: ["no treatment", "treating the cause", "visual rehabilitation"],
};
function modelOf(S, level, drug) {
  var TABLE = [
    { defect: "monocular blindness", loss: 0.5, rec: 0.45 },
    { defect: "bitemporal hemianopia", loss: 0.5, rec: 0.5 },
    { defect: "homonymous hemianopia", loss: 0.5, rec: 0.25 },
    { defect: "upper quadrantanopia", loss: 0.25, rec: 0.3 },
    { defect: "lower quadrantanopia", loss: 0.25, rec: 0.3 },
    { defect: "hemianopia, macular sparing", loss: 0.42, rec: 0.2 }
  ];
  var cl = function (v) { return Math.max(0, Math.min(1, v)); };
  var t = TABLE[level] || TABLE[0];
  var treat = drug === 1 ? 1 : 0, rehab = drug === 2 ? 1 : 0;
  var loss = cl(t.loss * (1 - (treat ? t.rec : 0)));
  var reach = cl(1 - loss);
  var intact = cl(1 - loss);
  var comp = cl(0.08 + (rehab ? 0.78 : 0) + (treat ? 0.16 : 0));
  var func = cl(reach * 0.62 + comp * 0.5 - 0.04);
  var w = function (v, x, y, ws) { return v < x ? ws[0] : v < y ? ws[1] : ws[2]; };
  var words = [t.defect, w(reach, 0.55, 0.8, ["low", "partial", "good"]), w(func, 0.4, 0.68, ["poor", "limited", "good"])];
  return { defectIdx: level, defect: t.defect, loss: loss, reach: reach, intact: intact, comp: comp, func: func, treat: treat, rehab: rehab, words: words, readout: "field " + words[0] + " · signal to cortex " + words[1] + " · daily function " + words[2] };
}
const TESTS = [
  [0, 0, "field monocular blindness · signal to cortex low · daily function poor"],
  [1, 0, "field bitemporal hemianopia · signal to cortex low · daily function poor"],
  [3, 0, "field upper quadrantanopia · signal to cortex partial · daily function limited"],
  [1, 2, "field bitemporal hemianopia · signal to cortex low · daily function good"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="606" height="396" rx="18"/>
<rect class="sc-tissue" x="630" y="44" width="316" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">VISUAL PATHWAY, FROM ABOVE</text>
<text class="sc-zone" x="650" y="68">VISUAL FIELDS</text>
<text class="sc-lab" x="650" y="84">one circle for each eye</text>
<path id="fib0" class="vp-fibre" d="M107 125L165 145L255 200L330 250L405 265L462 292L600 222"/>
<path id="fib1" class="vp-fibre" d="M107 125L165 145L255 200L330 150L405 135L478 125L600 195"/>
<path id="fib2" class="vp-fibre" d="M107 275L165 255L255 200L330 150L405 135L478 125L600 195"/>
<path id="fib3" class="vp-fibre" d="M107 275L165 255L255 200L330 250L405 265L462 292L600 222"/>
<path id="fibHealU" class="vp-heal-fibre" d="M255 200L330 150L405 135L478 125L600 195"/>
<path id="fibHealD" class="vp-heal-fibre" d="M255 200L330 250L405 265L462 292L600 222"/>
<g id="nodes">
<ellipse class="vp-node vp-nerve" cx="165" cy="145" rx="16" ry="11"/><ellipse class="vp-node vp-nerve" cx="165" cy="255" rx="16" ry="11"/>
<circle class="vp-node vp-chiasm" cx="255" cy="200" r="17"/><path class="vp-x" d="M246 191L264 209M264 191L246 209"/>
<ellipse class="vp-node vp-tract" cx="330" cy="150" rx="15" ry="10"/><ellipse class="vp-node vp-tract" cx="330" cy="250" rx="15" ry="10"/>
<ellipse class="vp-node vp-lgn" cx="405" cy="135" rx="18" ry="13"/><ellipse class="vp-node vp-lgn" cx="405" cy="265" rx="18" ry="13"/>
<ellipse class="vp-node vp-rad" cx="478" cy="125" rx="14" ry="10"/><ellipse class="vp-node vp-rad" cx="462" cy="292" rx="14" ry="10"/>
</g>
<g id="eyeSlotU"></g><g id="eyeSlotL"></g><g id="brainSlot"></g>
<g id="glow"></g>
<g id="fields"></g>
<g id="parts"></g><g id="lesion"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "visual-pathway-field-defects", fig: "Fig 1", title: "Visual pathway: lesion site and field defect", W, H, body,
  label: "An animated visual pathway seen from above. Light signals travel from the two eyes through the optic nerves, chiasm, optic tracts and geniculate bodies, then through the optic radiations into the brain to the visual cortex. Moving the lesion site changes which fibres are blocked and blackens the matching part of the two visual field circles. Treating the cause reopens fibres and shrinks the dark area, while rehabilitation trains scanning without restoring the field. Gauges show signal reaching cortex, field intact, compensation and daily function.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "visualp.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With visual rehabilitation",
  sourcesLis: [
    "<strong>How the visual pathway is organised.</strong> Retinal ganglion cell fibres leave each eye in the optic nerve. At the chiasm, fibres from the nasal half of each retina cross, so each optic tract carries fibres for the opposite half of the visual field from both eyes. After the lateral geniculate body, fibres fan out as the optic radiations: the temporal loop carries fibres for the upper field and the parietal fibres carry fibres for the lower field, ending in the occipital cortex around the calcarine sulcus. The central macular field has a large cortical area and often a dual blood supply, so occipital lesions may spare it. This is standard teaching in neuroanatomy and neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Lesion patterns shown.</strong> An optic nerve lesion blinds one eye. A chiasm lesion damages crossing nasal fibres and loses the temporal field of each eye. A tract, radiation or occipital lesion loses the same side of the field in both eyes: a full homonymous hemianopia, an upper quadrantanopia from the temporal loop, a lower quadrantanopia from the parietal fibres, and a homonymous hemianopia with macular sparing from the occipital cortex. These are teaching toggles only.",
    "<strong>Treatment ideas shown.</strong> Treating the cause (for example relieving pressure or treating inflammation where present) may partly restore fibres that are not yet destroyed. Visual rehabilitation (scanning training, prisms and occupational strategies) does not restore the lost field but improves compensation and daily function. These are teaching toggles only.",
  ],
  simplified: "Retinotopy within the geniculate layers, pupillary fibres leaving before the geniculate body, pretectal and suprachiasmatic branches, exact calcarine retinotopy, vascular territories, bilateral lesions, congruity grading, and all causes, investigations and treatments in detail are left out. Only one side is lesioned in the radiation and occipital examples. The figure does not say how any patient should be treated.",
  extraCss: `
.vp-fibre{fill:none;stroke:var(--anatomy-mid);stroke-width:2.2;opacity:.55;stroke-linecap:round;stroke-linejoin:round}
.vp-heal-fibre{fill:none;stroke:var(--c-good);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:9 7}
.vp-heal{fill:none;stroke:var(--c-good);stroke-width:2.5}
.vp-comp{fill:var(--c-good);stroke:none}
.vp-scan{fill:var(--c-good);stroke:none}
.vp-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.vp-node{stroke:color-mix(in srgb,var(--anatomy-strong) 45%,#000);stroke-width:1}
.vp-nerve{fill:#7fc4e8}
.vp-chiasm{fill:#c084fc}
.vp-x{fill:none;stroke:#2b2118;stroke-width:1.6;stroke-linecap:round}
.vp-tract{fill:#5ec1a0}
.vp-lgn{fill:#e9a2b3}
.vp-rad{fill:#f08a4b}
.vp-field-bg{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1.2}
.vp-field-line{fill:none;stroke:var(--anatomy-faint);stroke-width:.8}
.vp-loss{fill:#17121c}
.vp-macular{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.7}
.vp-lesion{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:2}
.vp-lesion-x{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.vp-gaze{fill:var(--c-good)}
.p-signal{--cc:#ffd24a}
.dr-g-fill.g-reach{fill:var(--c-good)}
.dr-g-fill.g-intact{fill:var(--c-fl)}
.dr-g-fill.g-comp{fill:var(--c-cyt)}
`,
});
