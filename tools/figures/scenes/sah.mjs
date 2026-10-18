/* Subarachnoid haemorrhage as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/sah.mjs [--print-model]
 * Static layout here; blood, arteries, ventricles and gauges move in sah.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course after the bleed", a: [0.4, 0.8, 1], names: ["rupture", "day 4 to 10", "hydrocephalus"], ticks: ["rupture", "day 4 to 10", "hydrocephalus"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "aneurysm clipping or coiling (secure the aneurysm)" },
    { label: "nimodipine" },
    { label: "CSF drainage" },
    { label: "secure the aneurysm, with nimodipine and CSF drainage" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "aneurysm secured", "nimodipine", "CSF drainage", "secure, nimodipine and drainage"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const b0 = [0.92, 0.78, 0.5][level], v0 = [0.1, 0.92, 0.5][level], h0 = [0.1, 0.38, 0.95][level], r0 = [0.9, 0.65, 0.4][level];
  const secure = drug === 1 || drug === 4 ? 1 : 0, nimo = drug === 2 || drug === 4 ? 1 : 0, drain = drug === 3 || drug === 4 ? 1 : 0;
  const Hy = cl(h0 * (drain ? 0.28 : 1));
  const V = cl(v0 * (1 - 0.5 * nimo));
  const B = cl(b0 * (secure ? 0.88 : 1));
  const R = secure ? 0.04 : r0;
  const Is = cl(0.9 * V - 0.05);
  const ICP = cl(0.45 * B + 0.55 * Hy + 0.2 * R);
  const Hd = cl(0.55 * B + 0.5 * ICP);
  const Perf = cl(1 - 0.75 * Is - 0.2 * ICP);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [secure ? "secured" : "open", w(V, 0.25, 0.6, ["absent", "developing", "severe"]), w(Is, 0.25, 0.55, ["none", "developing", "established"]), w(Hy, 0.3, 0.65, ["normal", "enlarging", "dilated"])];
  return { secure, nimo, drain, B, V, Hy, R, Is, ICP, Hd, Perf, words, readout: "aneurysm " + words[0] + " · vasospasm " + words[1] + " · ischaemia " + words[2] + " · ventricles " + words[3] };
}
const TESTS = [
  [0, 0, "aneurysm open · vasospasm absent · ischaemia none · ventricles normal"],
  [1, 0, "aneurysm open · vasospasm severe · ischaemia established · ventricles enlarging"],
  [2, 0, "aneurysm open · vasospasm developing · ischaemia developing · ventricles dilated"],
  [2, 4, "aneurysm secured · vasospasm developing · ischaemia none · ventricles normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="600" height="396" rx="18"/>
<rect class="sc-tissue" x="624" y="44" width="322" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">BRAIN AND CSF SPACES</text>
<text class="sc-zone" x="644" y="68">CIRCLE OF WILLIS, ZOOM</text>
<ellipse class="sah-csf" cx="315" cy="245" rx="250" ry="135"/>
<ellipse class="sah-brain" cx="315" cy="245" rx="218" ry="112"/>
<g id="isch"></g><g id="vent"></g><g id="artL"></g><g id="bloodL"></g><g id="aneurL"></g>
<g id="drainG"></g><g id="burst"></g>
<g id="willis"></g><g id="aneurR"></g><g id="bloodR"></g><g id="secureG"></g>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "subarachnoid-haemorrhage", fig: "Fig 1", title: "Subarachnoid haemorrhage: aneurysm rupture and its complications", W, H, body,
  label: "An animated brain in section beside a magnified circle of Willis. A berry aneurysm at an arterial branching point ruptures and blood spreads through the subarachnoid space around the brain. The bleed causes a thunderclap headache and raised pressure inside the skull. Days later blood around cerebral arteries provokes vasospasm and delayed cerebral ischaemia with focal neurologic deficits. Blood blocking cerebrospinal fluid flow and absorption causes hydrocephalus with enlarging ventricles, and an unsecured aneurysm can rerupture. Gauges show blood load, headache, intracranial pressure, vasospasm, ischaemia and ventricle size. Treatment choices are securing the aneurysm by clipping or endovascular coiling, nimodipine, and cerebrospinal fluid drainage.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond those named as treatment classes are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "sah.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How a subarachnoid haemorrhage develops.</strong> Most spontaneous bleeds follow rupture of a berry (saccular) aneurysm at a branching point of the circle of Willis, for example on the anterior communicating, posterior communicating, middle cerebral or basilar artery. Blood under arterial pressure floods the subarachnoid space, giving a sudden thunderclap headache, vomiting, collapse and raised intracranial pressure. Early dangers are rerupture of the unsecured aneurysm and hydrocephalus when blood blocks cerebrospinal fluid circulation and absorption. Over the following days, classically from day 4 to about day 10 and sometimes into the next two weeks, blood breakdown products around cerebral arteries provoke vasospasm; narrowed arteries can cause delayed cerebral ischemia and focal neurologic deficits, including motor weakness, which may progress to infarction. Severity is graded clinically (for example the World Federation of Neurosurgical Societies grade, based on the Glasgow Coma Scale score and focal deficits) and by the amount of blood on imaging. This is standard teaching in medicine and neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Investigation and treatment ideas shown.</strong> The aneurysm is located with CT angiography or catheter angiography. Securing it early, either with a surgical clip across its neck or with endovascular coiling techniques through the artery, prevents rerupture; neither removes blood already in the subarachnoid space. Nimodipine is given to improve outcome after aneurysmal bleeding and lessen delayed ischaemia; it does not seal the aneurysm. Hydrocephalus is relieved by draining cerebrospinal fluid, shown here as an external drain. These are teaching toggles only, and major accompanying care such as blood pressure control, reversal of coagulopathy and critical care is not shown.",
  ],
  simplified: "Non-aneurysmal causes, aneurysm formation and growth, sentinel leaks, seizures, hyponatraemia and other systemic complications, transcranial Doppler monitoring, induced hypertension and other vasospasm rescue techniques, permanent shunting, drug choice and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sah-csf{fill:color-mix(in srgb,var(--c-fl) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:1}
.sah-brain{fill:color-mix(in srgb,var(--c-endo) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}
.sah-vent{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:.8}
.sah-bloodring{fill:var(--c-bad)}
.sah-ringstroke{fill:none;stroke:var(--c-bad)}
.sah-art{fill:none;stroke:var(--c-rbc);stroke-linecap:round}
.sah-art2{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,#fff);stroke-linecap:round;opacity:.65}
.sah-aneur{fill:color-mix(in srgb,var(--c-bad) 72%,#fff);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1}
.sah-isch{fill:#8a5fc4;stroke:#5b3a8a;stroke-width:.8}
.sah-clip{fill:var(--anatomy-strong)}
.sah-coil{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}
.sah-seal{fill:var(--anatomy-strong)}
.sah-drain{fill:none;stroke:var(--c-fl);stroke-width:2.4;stroke-linecap:round}
.sah-bag{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1}
.sah-burst{fill:none;stroke:var(--c-neut);stroke-width:2;stroke-linecap:round}
.sah-block{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.p-blood{--cc:var(--c-bad)}
.dr-g-fill.g-pain{fill:var(--c-neut)}
.dr-g-fill.g-isch{fill:#8a5fc4}
`,
});
