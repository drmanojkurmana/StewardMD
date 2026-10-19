/* Raised intracranial pressure (ICP) as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/icp.mjs [--print-model]
 * Layout and model here; skull, brain, mass, Monro-Kellie curve, Cushing waveforms and gauges move in icp.page.js.
 * Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: {
    label: "Space-occupying mass or brain swelling",
    a: [0, 1, 2, 3],
    names: [
      "normal cranial state",
      "early mass: compensated by venous and CSF displacement",
      "expanding mass: compliance exhausted",
      "critical mass: herniation and brainstem coning",
    ],
    ticks: ["normal", "compensated", "decompensated", "herniation"],
    start: 2,
  },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "head elevation (raised head of bed, neutral neck)" },
    { label: "osmotic therapy (mannitol or hypertonic saline)" },
    { label: "CSF drainage (external ventricular drain)" },
    { label: "surgical decompression (craniectomy or mass evacuation)" },
    { label: "tiered neurocritical care bundle: all measures" },
  ],
  drugNames: [
    "no treatment",
    "head elevation",
    "osmotic therapy",
    "CSF drainage",
    "surgical decompression",
    "the full tiered bundle",
  ],
  status: "Intracranial mass: {level} · {drug} ·",
  withoutLabel: "Without treatment",
  withLabel: "With tiered care bundle",
};

function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  // level: 0 = normal, 1 = compensated, 2 = decompensated, 3 = herniation
  const massBase = [0, 0.28, 0.62, 1.0][level];
  const headUp = drug === 1 || drug === 5 ? 1 : 0;
  const osm    = drug === 2 || drug === 5 ? 1 : 0;
  const evd    = drug === 3 || drug === 5 ? 1 : 0;
  const decomp = drug === 4 || drug === 5 ? 1 : 0;

  // Mass volume after osmotic shrinkage or surgical evacuation/decompression
  const mass = cl(massBase * (decomp ? 0.10 : 1) * (osm ? 0.65 : 1));

  // Monro-Kellie compensatory buffer reserves (venous blood and CSF)
  const venReserve = cl(1 - massBase * 1.05 + 0.25 * headUp);
  const csfReserve = cl(1 - massBase * 1.15 + 0.45 * evd);
  const compReserve = cl(0.5 * venReserve + 0.5 * csfReserve + (decomp ? 0.8 : 0));

  // ICP on the Monro-Kellie curve:
  // Flat initial plateau while buffers compensate, then steep exponential rise
  let icp = cl(0.10 + 0.12 * massBase + 0.78 * Math.pow(mass, 2.0));
  if (level === 1 && drug === 0) icp = 0.22; // compensated plateau
  if (headUp) icp = cl(icp - 0.10);
  if (osm)    icp = cl(icp - 0.22);
  if (evd)    icp = cl(icp - 0.28);
  if (decomp) icp = cl(icp * 0.18);
  if (drug === 5) icp = cl(0.08);

  // Herniation risk & brainstem compression:
  const shift = cl(massBase * (decomp ? 0.08 : 1) * (osm ? 0.65 : 1) * (evd ? 0.85 : 1));
  const hernia = cl((shift - 0.60) * 2.5 * (decomp ? 0.1 : 1));

  // Cushing reflex triggers from severe ICP / brainstem ischaemia
  const cushingTrigger = cl((icp - 0.58) / 0.35);
  const cushing = hernia > 0.4 ? cl(0.45 + 0.55 * cushingTrigger) : (icp > 0.45 && shift > 0.5 ? 0.30 : 0);

  // Mean arterial pressure surges during Cushing response to overcome ICP
  const map = cl(0.74 + 0.24 * cushing);
  // CPP = MAP - ICP. If ICP rises without Cushing, CPP collapses. Even with Cushing, microperfusion drops.
  const cpp = cl(map - icp * 0.90);

  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const icpWord = w(icp, 0.26, 0.58, ["normal", "elevated", "critical"]);
  const cppWord = w(cpp, 0.35, 0.54, ["compromised", "threatened", "adequate"]);
  const shiftWord = hernia > 0.45 ? "herniating" : shift > 0.25 ? "midline shift" : "none";
  const cushWord = cushing > 0.6 ? "active" : cushing > 0.2 ? "impending" : "absent";

  const words = [icpWord, cppWord, shiftWord, cushWord];
  const readout = "ICP " + words[0] + " · perfusion " + words[1] + " · brain shift " + words[2] + " · Cushing reflex " + words[3];
  return { mass, icp, cpp, compReserve, shift, hernia, cushing, map, headUp, osm, evd, decomp, words, readout };
}

const TESTS = [
  [0, 0, "ICP normal · perfusion adequate · brain shift none · Cushing reflex absent"],
  [1, 0, "ICP normal · perfusion adequate · brain shift midline shift · Cushing reflex absent"],
  [2, 0, "ICP elevated · perfusion threatened · brain shift midline shift · Cushing reflex impending"],
  [3, 0, "ICP critical · perfusion compromised · brain shift herniating · Cushing reflex active"],
  [3, 5, "ICP normal · perfusion adequate · brain shift none · Cushing reflex absent"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEAD IN SECTION</text>
<text class="sc-zone" x="604" y="68">PRESSURE INSIDE</text>
<text class="sc-zone" x="604" y="270">BODY ALARMS</text>
<g id="skull"></g>
<g id="brainMove"><g id="brainSlot"></g></g>
<g id="mass"></g>
<g id="devices"></g>
<g id="eye"></g>
<g id="monro"></g>
<g id="alarm"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "raised-icp", fig: "Fig 1", title: "Raised intracranial pressure: Monro-Kellie and herniation", W, H, body,
  label: "An animated side view of the head. A growing mass takes up space inside the rigid skull, pressure climbs the steep part of the volume pressure curve, and the brain is pushed down toward the base of the skull. The pupil widens as the third nerve is squeezed, and failing brainstem control raises blood pressure while slowing pulse and breathing. Treatment choices are raising the head of the bed, drawing water out of the brain with osmotic therapy, draining fluid through a ventricular catheter, and removing a bone flap.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, pressures or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "icp.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With tiered care bundle",
  sourcesLis: [
    "<strong>The Monro-Kellie doctrine and intracranial compliance.</strong> The rigid skull holds brain tissue, blood and cerebrospinal fluid in a fixed total volume. When a growing mass or swelling appears, compensation first squeezes venous blood out through the neck veins and fluid down around the spinal cord. Once that spare room is gone, small further growth causes steep rises in pressure inside the skull. This is standard teaching in neurology, neurosurgery and neurocritical care texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Perfusion and downward herniation.</strong> Blood reaches the brain only if arterial pressure beats intracranial pressure. As pressure climbs, that margin collapses and the brain becomes starved of blood. The mass pushes the brain sideways and down toward the opening at the skull base, squeezing the brainstem. Pressure on the third nerve widens the pupil on that side, and a squeezed brainstem fires the Cushing response of high blood pressure, slow pulse and uneven breathing. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Raising the head speeds venous drainage through the neck without lowering arterial pressure; osmotic therapy pulls water from swollen brain tissue into the blood; a ventricular drain vents fluid directly; and removing a bone flap gives the swollen brain room to bulge outward. These are teaching toggles only.",
  ],
  simplified: "Specific pressure targets, carbon dioxide reactivity and hyperventilation, sedation and temperature measures, lesion causes such as trauma, bleeding, stroke or tumour, surgical detail, and all doses are left out. The head is a schematic side view and the waveforms are qualitative teaching drawings. This figure does not provide clinical guidance or treatment recommendations for any patient.",
  extraCss: `
.icp-bone{fill:color-mix(in srgb,#f0e6d6 55%,var(--anatomy-paper));stroke:#8c7b66;stroke-width:2.2;stroke-linejoin:round}
.icp-dura{fill:none;stroke:#6c7d93;stroke-width:2;stroke-linecap:round}
.icp-canal{fill:none;stroke:#8c7b66;stroke-width:4;stroke-linecap:round}
.icp-glow{fill:var(--c-bad);stroke:none}
.icp-cone{fill:var(--c-bad);stroke:none}
.icp-mass{fill:color-mix(in srgb,var(--c-bad) 70%,#150505);stroke:var(--c-bad);stroke-width:1.5}
.icp-oedema{fill:var(--c-fl);stroke:none;opacity:.35}
.icp-bulge{fill:color-mix(in srgb,var(--c-endo) 40%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1.2}
.icp-flap{fill:color-mix(in srgb,#f0e6d6 65%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:2;stroke-linejoin:round}
.icp-evd{fill:none;stroke:var(--anatomy-strong);stroke-width:1.8}
.icp-chamber{fill:color-mix(in srgb,var(--anatomy-card) 85%,transparent);stroke:var(--anatomy-mid);stroke-width:1.2}
.icp-fluid{fill:color-mix(in srgb,var(--c-fl) 50%,var(--anatomy-paper));stroke:none}
.icp-wedge{fill:color-mix(in srgb,var(--c-fl) 30%,var(--anatomy-card));stroke:var(--anatomy-strong);stroke-width:1.2}
.icp-vess{fill:none;stroke-linecap:round}
.icp-vess.art{stroke:var(--c-rbc);stroke-width:2.4}
.icp-vess.ven{stroke:var(--c-fl);stroke-width:3}
.icp-arrow{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.icp-aperture{fill:#06060c;stroke:none}
.icp-grid{fill:none;stroke:var(--anatomy-faint);stroke-width:.5;opacity:.35}
.icp-curve{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.icp-trace-bp{fill:none;stroke:var(--c-rbc);stroke-width:1.8;stroke-linejoin:round}
.icp-trace-hr{fill:none;stroke:var(--c-good);stroke-width:1.6;stroke-linejoin:round}
.icp-trace-resp{fill:none;stroke:var(--c-cyt);stroke-width:1.6;stroke-linejoin:round}
.icp-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-art{--cc:var(--c-rbc)}
.p-ven{--cc:var(--c-fl)}
.p-csf{--cc:#7ab8ff}
.p-osm{--cc:#38d1ff}
.mk-brain{fill:color-mix(in srgb,var(--c-endo) 45%,var(--anatomy-paper))}
.mk-csf{fill:var(--c-fl)}
.mk-blood{fill:var(--c-rbc)}
.mk-mass{fill:var(--c-bad)}
`,
});
