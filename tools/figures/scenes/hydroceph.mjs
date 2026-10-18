/* Hydrocephalus and CSF circulation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hydroceph.mjs [--print-model]
 * Static layout here; CSF particles, ventricle size and gauges move in hydroceph.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pattern of CSF build up", a: [0, 1, 2], names: ["normal", "obstructive", "communicating"], ticks: ["normal", "obstructive", "communicating"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "shunt (drain to the abdomen)" },
    { label: "endoscopic third ventriculostomy" },
    { label: "treat the cause" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "a shunt", "endoscopic third ventriculostomy", "treatment of the cause"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const obstruct = [0, 1, 0][level], failing = [0, 0, 1][level];
  const shunt = drug === 1 ? 1 : 0, etv = drug === 2 ? 1 : 0, cause = drug === 3 ? 1 : 0;
  const bypass = etv * (obstruct ? 0.85 : failing ? 0.1 : 0);
  const unblock = cause * (obstruct ? 0.72 : failing ? 0.2 : 0);
  const restored = cause * (failing ? 0.55 : obstruct ? 0.15 : 0);
  const divert = shunt * 0.9;
  const prod = 0.72;
  const flow = cl(0.92 - obstruct * 0.68 + bypass * 0.58 + unblock * 0.5 + restored * 0.1);
  const absorb = cl(0.9 - failing * 0.74 - obstruct * 0.52 + restored * 0.42 + bypass * 0.34 + unblock * 0.28);
  const vent = cl(0.18 + obstruct * 0.66 + failing * 0.6 - divert * 0.58 - bypass * 0.44 - unblock * 0.4 - restored * 0.32);
  const downVent = obstruct ? cl(vent * 0.38 + bypass * 0.18 + unblock * 0.22) : vent;
  const pressure = cl(0.24 + obstruct * 0.6 + failing * 0.48 - divert * 0.55 - bypass * 0.4 - unblock * 0.36 - restored * 0.28);
  const triad = cl(failing * (0.85 - divert * 0.62 - restored * 0.4 - bypass * 0.08));
  const symptoms = cl(0.12 + pressure * 0.62 + triad * 0.42 - divert * 0.12);
  const blockVis = cl(obstruct * (1 - unblock * 0.85));
  const villiFail = cl(failing * (1 - restored * 0.8));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(vent, 0.3, 0.65, ["normal", "enlarged", "grossly enlarged"]), w(pressure, 0.35, 0.65, ["normal", "raised", "high"]), w(absorb, 0.3, 0.65, ["poor", "reduced", "good"])];
  return { prod, flow, absorb, vent, downVent, pressure, symptoms, triad, obstruct, failing, shunt, etv, blockVis, villiFail, words, readout: "ventricles " + words[0] + " · pressure " + words[1] + " · absorption " + words[2] };
}
const TESTS = [
  [0, 0, "ventricles normal · pressure normal · absorption good"],
  [1, 0, "ventricles grossly enlarged · pressure high · absorption reduced"],
  [2, 0, "ventricles grossly enlarged · pressure high · absorption poor"],
  [1, 2, "ventricles enlarged · pressure raised · absorption good"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BRAIN AND CSF SPACES</text>
<ellipse class="hc-sas" cx="325" cy="230" rx="284" ry="174"/>
<ellipse id="brainShape" class="hc-brain" cx="325" cy="230" rx="258" ry="154"/>
<path class="hc-sinus" d="M382 76Q478 50 574 82"/>
<g class="hc-villi"><circle cx="458" cy="76" r="9"/><circle cx="484" cy="66" r="10"/><circle cx="511" cy="63" r="10"/><circle cx="538" cy="67" r="10"/><circle cx="563" cy="76" r="9"/></g>
<g id="villiMark" opacity="0"><circle class="hc-markC" cx="511" cy="63" r="15"/><path class="hc-markX" d="M502 54L520 72M520 54L502 72"/></g>
<path class="hc-channel" d="M292 190Q316 214 326 208"/>
<path class="hc-channel" d="M332 272Q348 292 366 300"/>
<g id="etvMark" opacity="0"><ellipse class="hc-stoma" cx="340" cy="272" rx="11" ry="5"/></g>
<g id="vent">
<g id="ventLat"><path class="hc-vent" d="M-72 -16C-42 -40 48 -34 64 -2C52 28 -38 36 -70 14C-88 2 -88 -6 -72 -16Z"/></g>
<g id="ventThird"><ellipse class="hc-vent" rx="13" ry="36"/></g>
<g id="ventFourth"><path class="hc-vent" d="M0 -28L21 0L0 28L-21 0Z"/></g>
</g>
<g id="choroid"></g>
<g id="blockMark" opacity="0"><circle class="hc-markC" cx="348" cy="282" r="14"/><path class="hc-markX" d="M340 274L356 290M356 274L340 290"/></g>
<path id="shuntTube" class="hc-shunt" opacity="0" d="M268 158C380 92 620 78 760 118C790 150 800 230 805 318"/>
<ellipse id="abdomen" class="hc-abdomen" cx="805" cy="340" rx="68" ry="52" opacity="0.25"/>
<g id="triadG" opacity="0"><text class="sc-zone" x="648" y="168">NORMAL PRESSURE TRIAD</text><circle class="hc-dot" cx="654" cy="190" r="4"/><text class="sc-lab" x="668" y="194">gait unsteady</text><circle class="hc-dot" cx="654" cy="215" r="4"/><text class="sc-lab" x="668" y="219">thinking slowed</text><circle class="hc-dot" cx="654" cy="240" r="4"/><text class="sc-lab" x="668" y="244">bladder urgency</text></g>
<g id="pressG" opacity="0"><text class="sc-zone" x="648" y="168">RAISED PRESSURE</text><circle class="hc-dot" cx="654" cy="190" r="4"/><text class="sc-lab" x="668" y="194">headache</text><circle class="hc-dot" cx="654" cy="215" r="4"/><text class="sc-lab" x="668" y="219">vomiting</text><circle class="hc-dot" cx="654" cy="240" r="4"/><text class="sc-lab" x="668" y="244">vision blurred</text></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.hc-brain{fill:var(--c-tis);stroke:var(--anatomy-faint);stroke-width:1.2}
.hc-sas{fill:none;stroke:var(--c-fl);stroke-width:2;stroke-dasharray:7 6;opacity:.65}
.hc-vent{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:1.2;opacity:.88}
.hc-channel{fill:none;stroke:var(--c-fl);stroke-width:7;stroke-linecap:round;opacity:.75}
.hc-chorDot{fill:#e5484d;stroke:color-mix(in srgb,#e5484d 55%,#000);stroke-width:.6}
.hc-sinus{fill:none;stroke:#7a5fd0;stroke-width:11;stroke-linecap:round;opacity:.8}
.hc-villi circle{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.hc-markC{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.4}
.hc-markX{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.hc-stoma{fill:var(--anatomy-paper);stroke:var(--c-good);stroke-width:2}
.hc-shunt{fill:none;stroke:var(--c-good);stroke-width:4;stroke-linecap:round}
.hc-abdomen{fill:color-mix(in srgb,var(--c-plt) 45%,var(--anatomy-paper));stroke:var(--c-plt);stroke-width:1.4}
.hc-dot{fill:var(--c-bad)}
.p-csf{--cc:var(--c-fl)}
`;

buildScene({
  id: "hydrocephalus-csf-circulation", fig: "Fig 1", title: "Hydrocephalus: CSF circulation and build up", W, H, body, extraCss,
  label: "An animated side view of the brain and its CSF spaces. The choroid plexus in the lateral ventricle makes CSF, which flows to the third ventricle, through the aqueduct to the fourth ventricle, out into the subarachnoid space, and is absorbed by arachnoid villi into the venous sinus. A slider switches between normal flow, an obstructive block and failed absorption in communicating hydrocephalus, including the normal pressure triad. Treatments are a shunt, endoscopic third ventriculostomy and treating the cause. Gauges show production, flow, absorption, ventricle size, pressure and symptoms.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, pressures or other numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hydroceph.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>CSF circulation.</strong> Cerebrospinal fluid is made mainly by the choroid plexus in the ventricles. It flows from the lateral ventricles to the third ventricle, through the cerebral aqueduct to the fourth ventricle, then out into the subarachnoid space around the brain and spinal cord, and is absorbed through arachnoid villi into the venous sinuses. This is standard teaching in neuroanatomy and neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Obstructive and communicating patterns.</strong> In obstructive (non-communicating) hydrocephalus, flow is blocked inside the ventricular system, classically at the narrow cerebral aqueduct, so the ventricles before the block enlarge and pressure rises. In communicating hydrocephalus, CSF reaches the subarachnoid space but absorption fails, for example after bleeding or meningitis, so all the ventricles enlarge. Normal pressure hydrocephalus is a chronic communicating pattern in older adults with the triad of gait disturbance, cognitive slowing and urinary urgency, often with near normal CSF pressure.",
    "<strong>Treatment ideas shown.</strong> A shunt drains CSF from a ventricle, usually to the peritoneum. Endoscopic third ventriculostomy makes a hole in the floor of the third ventricle to bypass an aqueduct block, so it suits obstructive rather than communicating patterns. Treating the cause acts on the block or on the failed absorption itself. These are teaching toggles only.",
  ],
  simplified: "The spinal CSF circulation in detail, CSF production outside the choroid plexus, the openings of the fourth ventricle by name, causes such as tumours and congenital aqueduct stenosis by name, infant signs such as an enlarging head, shunt complications and valve settings, and all pressures, volumes and doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
