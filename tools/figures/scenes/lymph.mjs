/* Lymphoma as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/lymph.mjs [--print-model]
 * Static layout here; node architecture, malignant cells, spread map and gauges move in lymph.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ----------------
 * Level slider packs type and stage: 0 Hodgkin limited, 1 Hodgkin advanced,
 * 2 B-cell non-Hodgkin limited, 3 B-cell non-Hodgkin advanced. */
const MD = {
  level: { label: "Type and stage", a: [0, 1, 2, 3], names: ["Hodgkin lymphoma, limited stage", "Hodgkin lymphoma, advanced stage", "B-cell non-Hodgkin lymphoma, limited stage", "B-cell non-Hodgkin lymphoma, advanced stage"], ticks: ["HL limited", "HL advanced", "NHL limited", "NHL advanced"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "chemotherapy" },
    { label: "anti-CD20 antibody" },
    { label: "radiotherapy" },
  ],
  status: "Lymphoma: {level} · {drug} ·",
  drugNames: ["no treatment", "chemotherapy", "an anti-CD20 antibody", "radiotherapy"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const type = level < 2 ? 0 : 1;              // 0 Hodgkin, 1 B-cell non-Hodgkin
  const adv = level % 2 === 1;
  const base = adv ? 0.86 : 0.48;
  let eff = 0, sysEff = 0;                     // eff on the clone in the node, sysEff on spread and symptoms
  if (drug === 1) { eff = 0.68; sysEff = 0.68; }
  else if (drug === 2) { eff = type === 1 ? 0.66 : 0.04; sysEff = eff; }
  else if (drug === 3) { eff = adv ? 0.18 : 0.62; sysEff = adv ? 0.05 : 0.5; }
  const C = cl(base * (1 - eff));
  const N = cl((adv ? 0.84 : 0.5) * (1 - eff * 0.85));
  const Sp = cl((adv ? 0.88 : 0.18) * (1 - sysEff));
  const Bs = cl((adv ? 0.78 : 0.24) * (1 - sysEff * 0.9) + C * 0.08);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(C, 0.25, 0.55, ["low", "moderate", "high"]), w(Sp, 0.25, 0.55, ["confined", "regional", "widespread"]), w(Bs, 0.25, 0.55, ["absent", "mild", "marked"])];
  return { type, adv, drug, eff, sysEff, C, N, Sp, Bs, words, readout: "clone " + words[0] + " · spread " + words[1] + " · B symptoms " + words[2] };
}
const TESTS = [
  [0, 0, "clone moderate · spread confined · B symptoms mild"],
  [1, 0, "clone high · spread widespread · B symptoms marked"],
  [3, 2, "clone moderate · spread regional · B symptoms mild"],
  [1, 3, "clone high · spread widespread · B symptoms marked"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">LYMPH NODE, SECTION</text>
<text class="sc-zone" x="612" y="68">SPREAD MAP</text>
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.node-out{fill:color-mix(in srgb,var(--c-lymph) 12%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:2}
.node-in{fill:color-mix(in srgb,var(--c-lymph) 7%,transparent);stroke:color-mix(in srgb,var(--c-lymph) 55%,transparent);stroke-width:1}
.foll{fill:color-mix(in srgb,var(--c-b) 20%,var(--anatomy-paper));stroke:var(--c-b);stroke-width:1}
.gc{fill:color-mix(in srgb,var(--c-b) 45%,var(--anatomy-paper))}
.cl-rs{--cc:#b565d8}.cl-sheet{--cc:var(--c-b)}.cl-react{--cc:var(--c-lymph)}.cl-plasma{--cc:#e88bb0}
.rs-nuc{fill:#4a245e;opacity:.9}
.rs-dot{fill:#e9d5ff;opacity:.95}
.cd20{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 50%,#000);stroke-width:.4}
.body-o{fill:color-mix(in srgb,var(--anatomy-mid) 12%,transparent);stroke:var(--anatomy-mid);stroke-width:1.6}
.diaph{stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:6 5}
.site{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.site.on{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.site.sp{fill:var(--c-plt)}
.organ{fill:color-mix(in srgb,var(--c-endo) 35%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.beam{fill:var(--c-plt);opacity:.16}
.field{fill:none;stroke:var(--c-plt);stroke-width:1.6;stroke-dasharray:7 5}
.arr{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;marker-end:url(#arrh)}
.p-chemo{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.ab2{fill:none;stroke:var(--c-good);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
`;

buildScene({
  id: "lymphoma", fig: "Fig 1", title: "Lymphoma: Hodgkin and B-cell non-Hodgkin", W, H, body, extraCss,
  label: "An animated lymph node section and spread map. In Hodgkin lymphoma a few large Reed-Sternberg cells sit in a rich reactive background and the node architecture is partly kept. In B-cell non-Hodgkin lymphoma sheets of similar B cells carrying CD20 fill and efface the node. Limited disease stays in one region; advanced disease crosses the diaphragm or reaches organs and marrow. Gauges show clone burden, node swelling, B symptoms and spread. Treatments are chemotherapy, anti-CD20 antibody and radiotherapy.",
  caption: "Schematic, not to scale. Counts, speeds and gauge levels are qualitative and illustrative; no doses or treatment schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "lymph.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Hodgkin lymphoma.</strong> The malignant Reed-Sternberg cells (large, often with two nuclei like owl eyes, CD30 positive and usually CD15 positive, typically without CD20) are a minority scattered in a reactive mix of lymphocytes, eosinophils, plasma cells and histiocytes. It tends to spread in an orderly way to neighbouring node groups. This is standard teaching in pathology and haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>B-cell non-Hodgkin lymphoma.</strong> A clonal sheet of B cells (CD20 positive) grows monotonously and effaces the normal follicles and zones of the node. Spread is less orderly and organs or bone marrow may be involved early. Subtypes, grading and molecular groups are not shown.",
    "<strong>Stage and B symptoms.</strong> Limited stage means disease confined to one side of the diaphragm in a small number of node regions; advanced stage means both sides of the diaphragm, or spread to organs such as liver or bone marrow (the Ann Arbor idea, shown in words rather than numerals). The B symptoms are fever, drenching night sweats and weight loss, and they make the outlook and the treatment plan more urgent.",
    "<strong>Treatment ideas shown.</strong> Chemotherapy acts throughout the body in both kinds. An anti-CD20 antibody (such as rituximab) binds CD20, so it helps in B-cell non-Hodgkin lymphoma and not in classic Hodgkin lymphoma. Radiotherapy is a local field, strongest for limited disease and unable on its own to reach widespread disease. These are teaching toggles only.",
  ],
  simplified: "Lymphoma subtypes and grading, PET and other imaging, biopsy markers beyond the few named, bone marrow biopsy detail, prognosis scores, relapsed disease, stem cell transplant, targeted and immune treatments other than anti-CD20, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
