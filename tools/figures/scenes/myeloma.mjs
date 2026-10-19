/* Multiple myeloma as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/myeloma.mjs [--print-model]
 * Static layout here; clone, paraprotein, bone, kidney and blood move in myeloma.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of the plasma cell disorder", a: [0.18, 0.55, 1], names: ["MGUS", "smouldering myeloma", "active myeloma"], ticks: ["MGUS", "smouldering", "active myeloma"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "proteasome inhibitor-based therapy" },
    { label: "bisphosphonate" },
    { label: "supportive care" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "proteasome inhibitor-based therapy", "a bisphosphonate", "supportive care"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const pi = drug === 1 ? 1 : 0, bis = drug === 2 ? 1 : 0, sup = drug === 3 ? 1 : 0;
  const clone = cl(a * (1 - pi * 0.68));
  const para = cl((0.1 + 0.86 * a) * (1 - pi * 0.62));
  const light = para;
  const boneBurden = cl(0.04 + 0.9 * a * a);
  const boneAct = cl(boneBurden * (1 - bis * 0.6) * (1 - pi * 0.35));
  const Ca = cl(0.08 + 0.84 * boneAct);
  const K = cl(light * 0.88 * (1 - sup * 0.22) * (1 - pi * 0.12));
  const red = cl(0.96 - 0.62 * a + pi * 0.26 * a + sup * 0.2);
  const def = cl(0.96 - 0.5 * a - 0.16 * para + pi * 0.18 * a + sup * 0.16);
  const Inf = cl(1 - def);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(clone, 0.3, 0.62, ["small", "growing", "large"]), w(para, 0.3, 0.62, ["low", "raised", "high"]), w(Ca, 0.3, 0.6, ["normal", "raised", "high"]), w(K, 0.3, 0.6, ["clear", "stressed", "injured"])];
  return { a, pi, bis, sup, clone, para, light, boneBurden, boneAct, Ca, K, red, def, Inf, words, readout: "clone " + words[0] + " · paraprotein " + words[1] + " · calcium " + words[2] + " · kidney " + words[3] };
}
const TESTS = [
  [0, 0, "clone small · paraprotein low · calcium normal · kidney clear"],
  [2, 0, "clone large · paraprotein high · calcium high · kidney injured"],
  [2, 1, "clone growing · paraprotein raised · calcium raised · kidney clear"],
  [2, 2, "clone large · paraprotein high · calcium raised · kidney injured"],
];

/* ---------------- static layout ----------------
 * Marrow x24-464, bone x496-706, kidney x716-946 (all y54-290).
 * Blood vessel y344-416 across the width. Panel starts y448.
 * The kidney is real organ art in kidneySlot; light chains and casts anchor to it at runtime.
 * Pills sit in the clear bands y84-105 (top organs) and y316-339 (blood top),
 * clear of zone labels (y58-68), organ shapes (from y112) and the panel.
 * The caption line sits at y428, clear of the blood pills above it. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="mm-sub" x="24" y="54" width="440" height="236" rx="14"/>
<rect class="mm-sub" x="496" y="54" width="210" height="236" rx="14"/>
<rect class="mm-sub" x="716" y="54" width="230" height="236" rx="14"/>
<text class="sc-zone" x="34" y="68">BONE MARROW</text>
<text class="sc-zone" x="506" y="68">BONE</text>
<text class="sc-zone" x="726" y="68">KIDNEY</text>
<text class="sc-zone sc-dim" x="34" y="330">BLOOD</text>
<rect class="mm-boneShape" x="568" y="112" width="64" height="156" rx="28"/>
<g id="kidneySlot"></g>
<g id="holes"></g><g id="clone"></g><g id="norm"></g><g id="osteo"></g><g id="kidneyFx"></g>
<rect class="sc-lumen" x="24" y="344" width="922" height="72"/>
<g id="rbcs"></g><g id="bloodW"></g><g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-plasma:#c084fc;--c-osteo:#f08a4b;--c-cast:#f2d27a;--c-ca:#ffd24a;--c-para:#c084fc;--c-light:#38d1ff}
body[data-theme="light"]{--c-plasma:#7c3aed;--c-osteo:#e06a25;--c-cast:#d9a92c;--c-ca:#c99700;--c-para:#7c3aed;--c-light:#0a7fd1}
.mm-sub{fill:color-mix(in srgb,var(--anatomy-card) 45%,transparent);stroke:var(--anatomy-faint);stroke-width:1}
.mm-boneShape{fill:color-mix(in srgb,var(--c-plt) 28%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1.2}
.mm-hole{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.mm-cap{fill:var(--anatomy-strong);font-size:12px}
.cl-plasma{--cc:var(--c-plasma)}.cl-osteo{--cc:var(--c-osteo)}.cl-normr{--cc:var(--c-rbc)}.cl-normn{--cc:var(--c-neut)}
.p-para{fill:none;stroke:var(--c-para);stroke-width:1.6;stroke-linecap:round}
.p-light{--cc:var(--c-light)}.p-ca{--cc:var(--c-ca)}.p-sh{--cc:var(--c-good)}.p-drip{--cc:var(--c-fl)}
.mm-cast{fill:var(--c-cast);stroke:color-mix(in srgb,var(--c-cast) 55%,#000);stroke-width:.6}
.dr-g-fill.g-clone{fill:var(--c-plasma)}.dr-g-fill.g-para{fill:var(--c-para)}.dr-g-fill.g-ca{fill:var(--c-ca)}
`;

buildScene({
  id: "multiple-myeloma", fig: "Fig 1", title: "Multiple myeloma: a plasma cell clone and its CRAB features", W, H, body, extraCss,
  label: "An animated bone marrow, bone, kidney and blood. A malignant clone of plasma cells expands in the marrow and makes one kind of antibody, the paraprotein. Free light chains from the clone pass through the kidney and injure it. The clone stirs bone resorption, leaving lytic holes and releasing calcium into the blood. Crowding of the marrow lowers red cells and normal defence, causing anaemia and infection risk. Together these are the CRAB features: high calcium, renal injury, anaemia and bone lesions. Gauges show clone, paraprotein, calcium, kidney injury, red cells and defence. The stage slider moves from MGUS through smouldering to active myeloma. Proteasome inhibitor-based therapy kills clone cells, a bisphosphonate coats bone and slows bone loss, and supportive care tops up blood and flushes the kidney.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "myeloma.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With proteasome inhibitor",
  sourcesLis: [
    "<strong>The clone and the paraprotein.</strong> Multiple myeloma is a malignant clone of plasma cells in the bone marrow. The clone makes a single monoclonal antibody, the paraprotein, and often excess free light chains. MGUS is a small clone with a low paraprotein and no organ damage. Smouldering myeloma is a larger burden without organ damage. Active myeloma is defined by organ damage or high risk features. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>CRAB features.</strong> Bone resorption driven by the clone leaves osteolytic lesions and releases calcium, giving bone pain, holes in bone and high calcium. Free light chains injure kidney tubules and can form casts, giving renal injury. Marrow crowding lowers red cell production, giving anaemia, and normal antibody and white cell defence falls, giving infection risk. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Proteasome inhibitor-based therapy kills plasma cells and shrinks the clone and paraprotein. A bisphosphonate coats bone, slows bone resorption and calcium release but does not shrink the clone. Supportive care supports blood counts, kidney and defence without attacking the clone. These are teaching toggles only.",
  ],
  simplified: "Risk staging, cytogenetics, imaging and lab criteria, amyloid and other plasma cell disorders, transplant and other drug classes, bone pain and fracture care, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
