/* Head injury haematomas as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hematoma.mjs [--print-model]
 * Static layout here; skull, brain, collections and gauges move in hematoma.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Haematoma type", a: [0, 1, 2], names: ["extradural", "acute subdural", "chronic subdural"], ticks: ["extradural", "acute subdural", "chronic subdural"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "surgical evacuation" },
    { label: "observation" },
    { label: "measures for raised intracranial pressure" },
  ],
  status: "Haematoma: {level} · {drug} ·",
  drugNames: ["no treatment", "surgical evacuation", "observation", "raised pressure measures"],
};
function modelOf(S, level, drug) {
  const kinds = [
    { grow: 0.92, injury: 0.22, atrophy: 0.12 },
    { grow: 0.88, injury: 0.78, atrophy: 0.2 },
    { grow: 0.6, injury: 0.28, atrophy: 0.85 },
  ];
  const k = kinds[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const surg = drug === 1 ? 1 : 0, obs = drug === 2 ? 1 : 0, icpM = drug === 3 ? 1 : 0;
  const C = cl(k.grow * (surg ? 0.16 : icpM ? 0.94 : obs ? 0.98 : 1));
  const inj = cl(k.injury * (surg ? 0.85 : 1));
  const P = cl(0.06 + 0.74 * C + 0.2 * inj - (icpM ? 0.26 : 0) - (surg ? 0.04 : 0));
  const Sh = cl(0.04 + 0.84 * C - (icpM ? 0.1 : 0));
  const A = cl(1 - 0.62 * P - 0.28 * inj + (surg ? 0.06 : 0) + (icpM ? 0.07 : 0) + (obs ? 0.03 : 0));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(C, 0.3, 0.6, ["small", "moderate", "large"]), w(P, 0.3, 0.6, ["normal", "raised", "high"]), w(Sh, 0.25, 0.55, ["none", "mild", "marked"]), w(A, 0.35, 0.65, ["low", "reduced", "preserved"])];
  return { kind: level, grow: k.grow, atrophy: k.atrophy, surg, obs, icpM, C, P, Sh, inj, A, words, readout: "collection " + words[0] + " · pressure " + words[1] + " · shift " + words[2] + " · alertness " + words[3] };
}
const TESTS = [
  [0, 0, "collection large · pressure high · shift marked · alertness reduced"],
  [0, 1, "collection small · pressure normal · shift none · alertness preserved"],
  [1, 0, "collection large · pressure high · shift marked · alertness low"],
  [2, 3, "collection moderate · pressure normal · shift mild · alertness preserved"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HEAD AND MENINGES</text>
<g id="head"></g><g id="bleed"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "extradural-subdural-haematoma", fig: "Fig 1", title: "Head injury haematomas: extradural and subdural", W, H, body,
  label: "An animated head in cross section. A temporal skull fracture tears the middle meningeal artery and blood collects between skull and dura as a lens shaped extradural haematoma, often after a lucid interval. A torn bridging vein lets blood spread between dura and brain as a crescent shaped subdural haematoma, acute after major trauma or chronic and liquefied in an older atrophic brain. Blood in the subarachnoid space and a cerebral contusion are also shown. A growing collection raises intracranial pressure, shifts the midline and threatens herniation. Gauges show collection size, pressure, shift, brain injury and alertness. Treatment choices include surgical evacuation, observation and measures for raised intracranial pressure.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hematoma.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Extradural haematoma.</strong> A fracture of the temporal bone can tear the middle meningeal artery. Arterial blood strips the dura from the inner skull and forms a biconvex, lens shaped collection that is limited where the dura is firmly attached. The classic story is a brief loss of consciousness, a lucid interval when the person seems to recover, then rapid deterioration as the collection expands and pressure rises. This is standard teaching in neurosurgery and emergency medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Subdural haematoma.</strong> Bridging veins that cross from the brain surface to the dural sinuses can tear, classically with acceleration and deceleration injury. Venous blood spreads freely between dura and brain as a crescent that can cross suture lines. An acute subdural often comes with underlying contusion and brain injury, so the outlook is worse than the collection alone suggests. A chronic subdural forms slowly, often after minor trauma in an older person with an atrophic brain and stretched veins; the blood liquefies and a membrane forms around it. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Other bleeding and pressure effects shown.</strong> Traumatic subarachnoid blood collects in the grooves on the brain surface, and a contusion is a bruise of brain tissue, often at the frontal and temporal poles. Any expanding collection inside the rigid skull raises intracranial pressure, pushes the midline across and can force brain tissue past the tentorium or foramen magnum, which is herniation. Surgical evacuation removes the collection, observation means close watching with repeat assessment for selected small collections, and measures for raised pressure aim to lower pressure while the cause is dealt with. These are teaching toggles only.",
  ],
  simplified: "Skull base fractures, diffuse axonal injury, coagulopathy, hydrocephalus, the choice between a craniotomy and burr holes, decompressive surgery, external drainage, seizure and infection risks, imaging appearances in detail, and all doses, pressures and thresholds are left out. The section is a simple oval and the collections are stylised shapes. The figure does not say how any patient should be treated.",
  extraCss: `
.hm-skull{fill:color-mix(in srgb,#d9b97a 32%,var(--anatomy-card));stroke:color-mix(in srgb,#d9b97a 55%,#000);stroke-width:1.2}
.hm-dura{fill:color-mix(in srgb,var(--c-endo) 28%,var(--anatomy-card));stroke:var(--c-endo);stroke-width:1.2}
.hm-brain{fill:color-mix(in srgb,var(--c-rbc) 9%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hm-gyrus{fill:none;stroke:var(--anatomy-mid);stroke-width:1;opacity:.55}
.hm-mid{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:4 4;opacity:.7}
.hm-vent{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8}
.hm-sinus{fill:color-mix(in srgb,var(--c-lymph) 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8}
.hm-art{fill:none;stroke:var(--c-rbc);stroke-width:2;stroke-linecap:round}
.hm-vein{fill:none;stroke:var(--c-lymph);stroke-width:1.8;stroke-linecap:round}
.hm-frac{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.hm-extra{fill:color-mix(in srgb,var(--c-rbc) 72%,#7a1020);stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:.8}
.hm-acute{fill:color-mix(in srgb,var(--c-rbc) 62%,#7a1020);stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:.8}
.hm-chronic{fill:color-mix(in srgb,var(--c-rbc) 38%,var(--anatomy-card));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.8}
.hm-memb{fill:none;stroke:var(--anatomy-strong);stroke-width:1.2;opacity:.7}
.hm-cont{fill:color-mix(in srgb,#8a5fc4 55%,var(--c-rbc));stroke:color-mix(in srgb,#8a5fc4 60%,#000);stroke-width:.8}
.hm-sah{fill:none;stroke:var(--c-rbc);stroke-width:1.6;stroke-linecap:round}
.hm-flap{fill:color-mix(in srgb,#d9b97a 45%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:1.4}
.hm-drain{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.hm-arrow{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.p-blood{--cc:var(--c-rbc)}
.dr-g-fill.g-coll{fill:var(--c-rbc)}.dr-g-fill.g-press{fill:var(--c-bad)}.dr-g-fill.g-shift{fill:var(--c-cyt)}.dr-g-fill.g-inj{fill:#8a5fc4}.dr-g-fill.g-alert{fill:var(--c-good)}
`,
});
