/* Sickle cell disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/sickle.mjs [--print-model]
 * Static layout here; cells, polymers and gauges move in sickle.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Disease state", a: [0.08, 0.55, 1], names: ["trait", "steady state", "crisis"], ticks: ["trait", "steady state", "crisis"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "hydroxycarbamide" },
    { label: "hydration and analgesia" },
    { label: "transfusion" },
  ],
  status: "State: {level} · {drug} ·",
  drugNames: ["no treatment", "hydroxycarbamide", "hydration and analgesia", "transfusion"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], hyc = drug === 1 ? 1 : 0, hyd = drug === 2 ? 1 : 0, txf = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const HbF = cl(hyc ? 0.78 : level === 0 ? 0.18 : 0.08);
  const P = cl(a * (hyc ? 0.38 : 1) * (txf ? 0.58 : 1));
  const Sick = cl(P * 1.05 - 0.02);
  const Occ = cl(Sick * 0.96 * (hyd ? 0.58 : 1) * (txf ? 0.78 : 1));
  const Haem = cl(Sick * 0.85 * (hyc ? 0.72 : 1) * (txf ? 0.55 : 1));
  const Pain = cl(Occ * 1.05 * (hyd ? 0.42 : 1));
  const Org = cl(0.62 * Occ + 0.38 * Haem);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Sick, 0.2, 0.6, ["little", "some", "marked"]), w(Occ, 0.2, 0.55, ["open", "narrowed", "blocked"]), w(Haem, 0.2, 0.55, ["little", "some", "marked"])];
  return { a, hyc, hyd, txf, HbF, P, Sick, Occ, Haem, Pain, Org, words, readout: "sickling " + words[0] + " · vessel " + words[1] + " · haemolysis " + words[2] };
}
const TESTS = [
  [0, 0, "sickling little · vessel open · haemolysis little"],
  [2, 0, "sickling marked · vessel blocked · haemolysis marked"],
  [2, 1, "sickling some · vessel narrowed · haemolysis some"],
  [2, 3, "sickling some · vessel narrowed · haemolysis some"],
];

/* ---------------- static layout ---------------- */
const CY = 315;
const body = `
<rect class="sc-tissue" x="14" y="44" width="686" height="396" rx="18"/>
<rect class="sc-tissue" x="712" y="44" width="234" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">FROM HAEMOGLOBIN TO BLOCKED VESSEL</text>
<text class="sc-zone" x="732" y="68">ORGANS AT RISK</text>
<text class="sc-zone sc-dim" x="34" y="258">BLOOD VESSEL</text>
<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#8a8496"/></marker></defs>
<path class="sk-arrow" d="M206 145H252"/>
<path class="sk-arrow" d="M438 145H492"/>
<path class="sk-arrow" d="M648 315H704"/>
<g id="hb">
  <circle class="sk-hba" cx="112" cy="128" r="21"/><circle class="sk-hba" cx="150" cy="128" r="21"/>
  <circle class="sk-hbb" cx="112" cy="164" r="21"/><circle class="sk-hbb" cx="150" cy="164" r="21"/>
  <circle id="mutdot" class="sk-mut" cx="150" cy="128" r="5"/>
</g>
<g id="polyGhost">
  <ellipse class="sk-ghost" cx="362" cy="145" rx="66" ry="37"/>
  <g id="fibres" opacity="0">
    <path class="sk-fibre" d="M312 132L412 124"/><path class="sk-fibre" d="M306 148L418 142"/>
    <path class="sk-fibre" d="M314 164L410 158"/><path class="sk-fibre" d="M326 118L398 112"/>
    <path class="sk-fibre" d="M324 176L402 170"/>
  </g>
</g>
<g id="bigcell">
  <ellipse id="bigdisc" class="sk-disc" cx="572" cy="148" rx="42" ry="26"/>
  <ellipse id="bigdiscin" class="sk-discin" cx="572" cy="148" rx="16" ry="9"/>
  <path id="bigsick" class="sk-sickle" d="M530 158Q566 108 616 132Q584 140 576 166Q550 178 530 158Z" opacity="0"/>
</g>
<rect id="lumen" class="sc-lumen" x="14" y="275" width="686" height="80" rx="6"/>
<path class="sk-wall" d="M14 275H700M14 355H700"/>
<g id="rbcs"></g><g id="occ"></g><g id="haem"></g><g id="organs"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "sickle-cell-disease", fig: "Fig 1", title: "Sickle cell disease: from HbS to vaso-occlusion", W, H, body,
  label: "An animated scene of sickle cell disease. A point change in the beta globin chain makes haemoglobin S. When it gives up oxygen, haemoglobin S sticks together into stiff polymers that bend red cells into sickles. Sickled cells block small vessels and break apart early, causing pain and organ damage. Gauges show polymer, sickling, vessel block, haemolysis, pain and organ risk. Treatment choices include hydroxycarbamide, hydration and analgesia, and transfusion.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "sickle.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How sickle cell disease develops.</strong> A single point change in the beta globin gene swaps one amino acid in the beta chain, making haemoglobin S (HbS). Oxygenated HbS behaves much like normal haemoglobin, but deoxygenated HbS is sticky and joins into long polymers. The polymers stiffen and bend the red cell into a sickle. Sickled cells jam in small vessels (vaso-occlusion), causing pain and organ injury, and they survive a shorter time in the circulation, so haemolysis causes anaemia and jaundice. A person with one copy (trait) makes mostly normal haemoglobin and sickles little. This is standard teaching in medicine and haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Hydroxycarbamide raises fetal haemoglobin (HbF), which does not join the polymer and so reduces sickling. Hydration and analgesia support flow and ease pain during a crisis without changing the haemoglobin. Transfusion adds red cells with normal haemoglobin and dilutes the sickled cells. These are teaching toggles only.",
  ],
  simplified: "Oxygen affinity, HbF distribution between cells, adhesion to the vessel wall, inflammation, nitric oxide loss, stroke and leg ulcer and priapism detail, chronic organ screening, gene therapy and transplantation, drug choice and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.sk-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;marker-end:url(#arr)}
.sk-hba{fill:color-mix(in srgb,var(--c-lymph) 65%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-lymph) 60%,#000);stroke-width:1}
.sk-hbb{fill:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.sk-mut{fill:var(--c-neut);stroke:#7a5a12;stroke-width:1}
.sk-ghost{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--c-rbc);stroke-width:1.2;stroke-dasharray:5 4}
.sk-fibre{fill:none;stroke:var(--c-cyt);stroke-width:3;stroke-linecap:round;opacity:.85}
.sk-disc{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.sk-discin{fill:color-mix(in srgb,var(--c-rbc) 55%,#fff);opacity:.7}
.sk-sickle{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.sk-wall{fill:none;stroke:var(--c-endo);stroke-width:3}
.sk-o2{fill:none;stroke:var(--c-fl);stroke-width:1.2}
.sk-hbf{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 50%,#000);stroke-width:.5}
.p-fluid{fill:var(--c-fl)}
.sk-frag{fill:none;stroke:var(--c-rbc);stroke-width:1.6;stroke-linecap:round}
.sk-dmg{fill:var(--c-bad)}
.sk-bone{fill:#e8ddc4;stroke:#9a8a62;stroke-width:1}
.sk-spleen{fill:color-mix(in srgb,var(--c-mast) 70%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:1}
.dr-g-fill.g-pain{fill:var(--c-neut)}
`,
});
