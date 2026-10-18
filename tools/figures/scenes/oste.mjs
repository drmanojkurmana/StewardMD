/* Osteomyelitis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/oste.mjs [--print-model]
 * Static layout here; bacteria, pus, dead bone and gauges move in oste.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of bone infection", a: [0.4, 0.7, 1], names: ["acute", "subacute", "chronic"], ticks: ["acute", "subacute", "chronic"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "prolonged antibiotics" },
    { label: "surgical debridement" },
    { label: "immobilisation" },
    { label: "antibiotics, debridement and immobilisation" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "prolonged antibiotics", "surgical debridement", "immobilisation", "combined care"],
};
function modelOf(S, level, drug) {
  const stageTable = [
    { bac: 0.95, pus: 0.9, nec: 0.22, inv: 0.06, sin: 0.02, infl: 0.95 },
    { bac: 0.78, pus: 0.66, nec: 0.58, inv: 0.44, sin: 0.24, infl: 0.62 },
    { bac: 0.62, pus: 0.46, nec: 0.95, inv: 0.9, sin: 0.9, infl: 0.38 },
  ];
  const treatTable = [
    { abx: 0, surg: 0, imm: 0 },
    { abx: 1, surg: 0, imm: 0 },
    { abx: 0, surg: 1, imm: 0 },
    { abx: 0, surg: 0, imm: 1 },
    { abx: 1, surg: 1, imm: 1 },
  ];
  const st = stageTable[level], tr = treatTable[drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const shield = st.nec;
  const B = cl(st.bac * (1 - 0.74 * tr.abx * (1 - 0.68 * shield)) * (1 - 0.52 * tr.surg));
  const Pus = cl(st.pus * (0.3 + 0.7 * (B / Math.max(0.2, st.bac))) - 0.42 * tr.surg - 0.12 * tr.abx);
  const Nec = cl(st.nec * (1 - 0.88 * tr.surg) * (1 - 0.1 * tr.abx));
  const Inv = cl(st.inv * (0.55 + 0.45 * (1 - B * 0.5)) + 0.08 * tr.surg);
  const Sin = cl(st.sin * (1 - 0.78 * tr.surg) * (1 - 0.32 * tr.abx));
  const Infl = cl(st.infl * (0.25 + 0.75 * B) - 0.18 * tr.surg);
  const Heal = cl((1 - B) * 0.34 + (1 - Pus) * 0.24 + (1 - Nec) * 0.24 + tr.imm * 0.12 + tr.surg * 0.08 + Inv * 0.06 - st.sin * 0.08);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.25, 0.55, ["controlled", "present", "high"]), w(Pus, 0.25, 0.55, ["low", "raised", "high"]), w(Nec, 0.25, 0.6, ["little", "forming", "sequestrum"]), w(Heal, 0.3, 0.62, ["poor", "slow", "healing"])];
  return { a: S.level.a[level], abx: tr.abx, surg: tr.surg, imm: tr.imm, B, Pus, Nec, Inv, Sin, Infl, Heal, words, readout: "infection " + words[0] + " · pus pressure " + words[1] + " · dead bone " + words[2] + " · bone healing " + words[3] };
}
const TESTS = [
  [0, 0, "infection high · pus pressure high · dead bone little · bone healing poor"],
  [0, 1, "infection present · pus pressure raised · dead bone little · bone healing slow"],
  [2, 0, "infection high · pus pressure raised · dead bone sequestrum · bone healing poor"],
  [2, 4, "infection controlled · pus pressure low · dead bone little · bone healing healing"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone sc-dim" x="34" y="428">CHILD LONG BONE, CUT ALONG ITS LENGTH</text>
<g id="vessel">
<rect class="ost-vessel" x="28" y="76" width="306" height="28" rx="14"/>
<path class="ost-arrow" d="M334 90L366 112L334 118Z"/>
</g>
<g id="bone">
<path class="ost-bone" d="M372 96Q480 72 588 96L584 142L596 168L560 232L552 424Q480 438 408 424L400 232L364 168L376 142Z"/>
<rect class="ost-plate" x="378" y="140" width="204" height="10" rx="5"/>
<path class="ost-marrow" d="M402 168L558 168L546 410Q480 420 414 410Z"/>
<path class="ost-cortex" d="M400 232L414 410M560 232L546 410"/>
<path id="periL" class="ost-peri" d="M388 218Q372 320 398 414"/>
<path id="periR" class="ost-peri" d="M572 218Q588 320 562 414"/>
<path id="invL" class="ost-inv" d="M366 238Q344 322 376 402"/>
<path id="invR" class="ost-inv" d="M594 238Q616 322 584 402"/>
</g>
<g id="pusG"><ellipse id="pusEl" class="ost-pus" cx="480" cy="252" rx="62" ry="76"/></g>
<g id="seqG">
<polygon class="ost-seq" points="452,238 492,224 516,252 502,292 462,300 440,272"/>
<polygon class="ost-seq2" points="492,306 520,298 528,322 500,332 486,320"/>
<circle class="ost-seqdot" cx="478" cy="264" r="7"/>
</g>
<g id="sinusG">
<path id="sinusPath" class="ost-sinus" d="M536 282Q612 286 656 266Q682 254 700 262"/>
<circle id="sinusMouth" class="ost-mouth" cx="702" cy="262" r="7"/>
</g>
<rect class="ost-skin" x="700" y="172" width="34" height="196" rx="12"/>
<g id="bac"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="treat"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "osteomyelitis", fig: "Fig 1", title: "Osteomyelitis: infected bone under pressure", W, H, body,
  label: "An animated child long bone. Bacteria carried in the blood lodge in the metaphysis, multiply as Staphylococcus aureus, and form pus under pressure. Pressure cuts off the bone blood supply, dead bone forms a sequestrum, new bone forms an involucrum under a lifted periosteum, and a chronic sinus drains to skin. In sickle cell disease Salmonella is a classic alternative organism. Gauges show infection, pus pressure, dead bone, new bone, sinus and healing. Treatments include prolonged antibiotics, surgical debridement and immobilisation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "oste.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With combined care",
  extraCss: `
body{--c-bone:#e8d9b0;--c-cortex:#c9a86a;--c-marrow:#f4ead0;--c-pus:#e9c84a;--c-seq:#6b5a4a;--c-skin:#d9a07a;--c-vess:#d63a4a;--c-staph:#e9a13b;--c-inv:#d9b878;--c-splint:#7ab8ff}
body[data-theme="light"]{--c-bone:#e0cda0;--c-cortex:#b8934f;--c-marrow:#f7efdb;--c-pus:#c9a227;--c-seq:#5a4636;--c-skin:#c9855a;--c-vess:#c42a3d;--c-staph:#c47a1a;--c-inv:#b8934f;--c-splint:#2f7ad8}
.ost-bone{fill:var(--c-bone);stroke:color-mix(in srgb,var(--c-cortex) 70%,#000);stroke-width:1.2}
.ost-plate{fill:var(--c-cortex);opacity:.9}
.ost-marrow{fill:var(--c-marrow);opacity:.85}
.ost-cortex{fill:none;stroke:var(--c-cortex);stroke-width:16;opacity:.55;stroke-linecap:round}
.ost-vessel{fill:color-mix(in srgb,var(--c-vess) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-vess) 60%,#000);stroke-width:1}
.ost-arrow{fill:var(--c-vess);opacity:.8}
.ost-peri{fill:none;stroke:var(--c-endo);stroke-width:5;stroke-linecap:round}
.ost-inv{fill:none;stroke:var(--c-inv);stroke-width:9;stroke-linecap:round}
.ost-pus{fill:var(--c-pus);stroke:color-mix(in srgb,var(--c-pus) 55%,#000);stroke-width:.9}
.ost-seq{fill:var(--c-seq);stroke:color-mix(in srgb,var(--c-seq) 45%,#000);stroke-width:1}
.ost-seq2{fill:var(--c-seq);stroke:color-mix(in srgb,var(--c-seq) 45%,#000);stroke-width:1;opacity:.9}
.ost-seqdot{fill:color-mix(in srgb,var(--c-seq) 70%,#fff);opacity:.8}
.ost-sinus{fill:none;stroke:var(--c-pus);stroke-width:7;stroke-linecap:round}
.ost-mouth{fill:var(--c-pus);stroke:color-mix(in srgb,var(--c-pus) 55%,#000);stroke-width:.8}
.ost-skin{fill:var(--c-skin);stroke:color-mix(in srgb,var(--c-skin) 55%,#000);stroke-width:1}
.ost-splint{fill:var(--c-splint);stroke:color-mix(in srgb,var(--c-splint) 55%,#000);stroke-width:1;stroke-dasharray:6 4}
.ost-strap{fill:none;stroke:var(--c-splint);stroke-width:4;stroke-linecap:round}
.cl-staph{--cc:var(--c-staph)}.cl-ost{--cc:var(--c-inv)}
.p-pus{--cc:var(--c-pus)}.p-sinus{--cc:var(--c-pus)}
.dr-g-fill.g-pus{fill:var(--c-pus)}.dr-g-fill.g-seq{fill:var(--c-seq)}.dr-g-fill.g-inv{fill:var(--c-inv)}.dr-g-fill.g-sinus{fill:var(--c-pus)}.dr-g-fill.g-heal{fill:var(--c-good)}
`,
  sourcesLis: [
    "<strong>How osteomyelitis develops in a child.</strong> Bacteria carried in the blood (haematogenous seeding) lodge in the slow looping vessels of the metaphysis, the growing end of a long bone. Staphylococcus aureus is the usual organism; streptococci and other pyogenic bacteria also occur, and in sickle cell disease Salmonella is a classic alternative. Pus forms under pressure inside rigid bone, pressure cuts off the local blood supply, and bone dies. Dead bone is a sequestrum, new bone laid down under a lifted and reactive periosteum is an involucrum (periosteal reaction), and a chronic sinus may drain pus to skin. Fever, pain and loss of use are typical acute signs. This is standard teaching in medicine, paediatric and orthopaedic texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Ideas the slider compresses.</strong> Acute disease is mainly pus, pressure and systemic signs. Subacute disease is more contained and may form a local cavity. Chronic disease is defined by dead bone, involucrum and a draining sinus, so antibiotics alone penetrate poorly and healing is slow. Vertebral and spinal disease, implant-associated infection, infection spreading from endocarditis, and disease in a joint or with neurologic signs follow related principles but different anatomy, so they are mentioned here rather than drawn. Where cultures are negative or the course is atypical, biopsy for cultures and histology should be considered, and the antibiotic spectrum, an alternative diagnosis and complications should be reconsidered with specialists. This is a teaching summary only, without any numbers.",
    "<strong>Treatment ideas shown.</strong> A prolonged antibiotic course, surgical debridement to drain pus and remove dead bone, and immobilisation to rest and protect the bone. Therapy usually needs weeks rather than days and often combines approaches. These are teaching toggles only.",
  ],
  simplified: "Vertebral and spinal anatomy, implant-associated infection, joint spread, growth plate damage and deformity, detailed imaging, organism identification beyond the named examples, resistant organisms, and all doses, routes, timings and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
