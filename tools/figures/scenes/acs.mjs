/* Acute coronary syndrome / myocardial infarction as an animated, working scene. Original drawing.
 *   node tools/figures/scenes/acs.mjs [--print-model]
 * Layout and model here; plaque, thrombus, heart, ECG and gauges move in acs.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How blocked is the artery", a: [0.45, 0.75, 1], names: ["partial", "subtotal", "complete"], ticks: ["partial", "subtotal", "complete"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antiplatelet drugs (aspirin, a P2Y12 inhibitor)" },
    { label: "anticoagulant (heparin)" },
    { label: "reperfusion (primary PCI or thrombolysis)" },
    { label: "statin, beta-blocker and ACE inhibitor (secondary prevention)" },
    { label: "full ACS bundle: all of the above" },
  ],
  status: "Blockage: {level} · {drug} ·",
  drugNames: ["no treatment", "antiplatelet drugs", "anticoagulant", "reperfusion", "secondary prevention", "the full ACS bundle"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const antiplt = drug === 1 || drug === 5 ? 1 : 0, anticoag = drug === 2 || drug === 5 ? 1 : 0, reperf = drug === 3 || drug === 5 ? 1 : 0, prev = drug === 4 || drug === 5 ? 1 : 0;
  const Occ = a * 0.9 * (1 - 0.45 * antiplt) * (1 - 0.25 * anticoag) * (reperf ? 0.12 : 1);   // lumen blocked by plaque plus clot
  const I = cl(Occ * 1.1 - 0.15 * prev);                                                        // ischaemia
  const N = cl((Occ - 0.4) * 1.6 * (1 - 0.2 * prev));                                          // necrosis
  const P = cl(1 - 0.65 * N - 0.2 * I + (N > 0.2 ? 0.12 * prev : 0));                          // pump function
  const T = cl(N * 1.1 + (I > 0.3 ? 0.03 : 0));                                                 // troponin
  const Cp = cl(I * 1.05 - 0.1 * prev);                                                         // chest pain
  const st = Occ >= 0.75 ? Occ : Occ > 0.3 ? -Occ * 0.9 : 0;                                    // ST shift: elevation or depression
  const qw = N > 0.5 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const muscle = N >= 0.5 ? "infarcted" : N >= 0.08 ? "infarcting" : I >= 0.3 ? "ischaemic" : "protected";
  const ecg = st > 0.3 ? "ST elevation" : st < -0.1 ? "ST depression" : "normal";
  const words = [w(Occ, 0.3, 0.7, ["open", "narrowed", "blocked"]), muscle, ecg];
  return { a, antiplt, anticoag, reperf, prev, Occ, I, N, P, T, Cp, st, qw, words, readout: "artery " + words[0] + " · muscle " + words[1] + " · ECG " + words[2] };
}
const TESTS = [
  [2, 0, "artery blocked · muscle infarcted · ECG ST elevation"],
  [1, 0, "artery narrowed · muscle infarcting · ECG ST depression"],
  [2, 3, "artery open · muscle protected · ECG normal"],
  [0, 5, "artery open · muscle protected · ECG normal"],
];

/* ---------------- static layout ---------------- */
const ECG = { x: 24, y: 322, w: 542, h: 110 };
let grid = "";
for (let x = ECG.x; x <= ECG.x + ECG.w; x += 18) grid += `<path class="ac-grid${(x - ECG.x) % 90 === 0 ? " major" : ""}" d="M${x} ${ECG.y}V${ECG.y + ECG.h}"/>`;
for (let y = ECG.y; y <= ECG.y + ECG.h; y += 18) grid += `<path class="ac-grid${(y - ECG.y) % 90 === 0 ? " major" : ""}" d="M${ECG.x} ${y}H${ECG.x + ECG.w}"/>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="266" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="396" rx="18"/>
<rect class="ac-ecgbg" x="14" y="312" width="560" height="128" rx="14"/>
<g clip-path="url(#ecgclip)">${grid}</g>
<clipPath id="ecgclip"><rect x="${ECG.x}" y="${ECG.y}" width="${ECG.w}" height="${ECG.h}"/></clipPath>
<text class="sc-zone" x="34" y="68">CORONARY ARTERY, CUT OPEN</text>
<text class="sc-zone" x="604" y="68">HEART MUSCLE</text>
<text class="sc-zone sc-dim" x="34" y="${ECG.y + 18}">ECG, ONE LEAD</text>
<g id="art"></g><g id="heart"></g><g id="ecg"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "acs-myocardial-infarction", fig: "Fig 1", title: "Acute coronary syndrome: from plaque to infarct", W, H, body,
  label: "An animated coronary artery cut open lengthwise. A fatty plaque with a fibrous cap ruptures, platelets and fibrin form a clot that blocks the lumen, and the heart muscle downstream first becomes ischaemic and then infarcts. A live ECG shows ST depression with a partial block and ST elevation with a complete block. Gauges show blood flow, clot, injury, pump function, troponin and chest pain. Treatment choices include antiplatelet drugs, an anticoagulant, reperfusion and secondary prevention.",
  caption: "Schematic, not to scale. Speeds and gauge levels are qualitative and illustrative; no doses, times or numbers are shown or implied.",
  scene: { W, H, ECG }, pageJs: readFileSync(join(HERE, "acs.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How an acute coronary syndrome develops.</strong> A lipid-rich atherosclerotic plaque (foam cells, lipid core, thin fibrous cap) ruptures or erodes. Exposed material activates platelets, which stick and clump, and the clotting cascade lays down fibrin, forming a thrombus. A partial block with a still-open vessel gives unstable angina or NSTEMI (often ST depression); a complete block gives STEMI (ST elevation, transmural injury). Muscle starved of blood becomes ischaemic, then infarcts, and troponin leaks out. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antiplatelet drugs stop platelet clumping, an anticoagulant blocks fibrin formation, reperfusion (PCI with a stent, or a clot-dissolving drug) reopens the vessel, and a statin, beta-blocker and ACE inhibitor reduce further events and remodelling. These are teaching toggles only.",
  ],
  simplified: "Plaque erosion versus rupture, vasospasm, microvascular disease, time-dependence of salvage, reperfusion injury, arrhythmias, mechanical complications, contraindications, drug choice and all doses are left out. The ECG is a single schematic lead and the heart is a simple short-axis ring. The figure does not say how any patient should be treated.",
  extraCss: `
.ac-ecgbg{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ac-grid{stroke:var(--anatomy-faint);stroke-width:.5;opacity:.35;fill:none}.ac-grid.major{opacity:.7}
.ac-trace{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linejoin:round}
.ac-wall{fill:color-mix(in srgb,var(--c-endo) 45%,var(--c-tis))}.ac-intima{fill:none;stroke:var(--c-endo);stroke-width:2.4}
.ac-lum{fill:color-mix(in srgb,var(--c-rbc) 12%,var(--anatomy-paper))}
.ac-plaque{fill:color-mix(in srgb,#d9b97a 55%,var(--c-tis));stroke:color-mix(in srgb,#d9b97a 60%,#000);stroke-width:.8}
.ac-core{fill:#e6c85a;stroke:#b8962f;stroke-width:.8}
.ac-cap{fill:none;stroke:#f3e6c4;stroke-width:3.4;stroke-linecap:round}
.ac-thromb{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--c-plt))}
.ac-fib{stroke:#f6f1e0;stroke-width:1.1;opacity:.85}
.cl-foam{--cc:#f0d98a}.cl-foam .cl-n{fill:#b8962f;opacity:.5}
.ac-vac{fill:none;stroke:#b8962f;stroke-width:.8}
.ac-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.ac-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.ac-stent{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linejoin:round}
.ac-myo{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 55%,var(--c-tis))}.ac-cav{fill:color-mix(in srgb,var(--c-rbc) 35%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.ac-isch{fill:#8a5fc4}.ac-inf{fill:#4a4048}
.ac-lad{fill:none;stroke:var(--c-rbc);stroke-width:5.5;stroke-linecap:round}.ac-lad2{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 50%,#fff);stroke-width:1.4;stroke-linecap:round;opacity:.7}
.ac-blk{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:2}
.p-trop{--cc:#ffd24a}.p-plas{--cc:var(--c-good)}.p-spill{--cc:#e6c85a}
.dr-g-fill.g-pain{fill:var(--c-neut)}
`,
});
