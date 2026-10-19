/* Vitamin deficiency syndromes as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/vitdef.mjs [--print-model]
 * Static layout here; vitamin flow, cofactor work, target tissue and signs animate in vitdef.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Vitamin group shown", a: [0, 1, 2, 3, 4, 5, 6], names: ["vitamin A", "thiamine (B1)", "niacin (B3)", "vitamin B12", "vitamin C", "vitamin D", "vitamin K"], ticks: ["A", "B1", "B3", "B12", "C", "D", "K"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "replacement" },
    { label: "dietary correction" },
    { label: "treat malabsorption cause" },
  ],
  status: "Vitamin: {level} · {drug} ·",
  drugNames: ["no treatment", "replacement", "dietary correction", "treating malabsorption"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const sevTab = [0.86, 0.90, 0.84, 0.88, 0.85, 0.84, 0.82];
  const effTab = [[0, 0.85, 0.58, 0.72], [0, 0.88, 0.60, 0.48], [0, 0.86, 0.62, 0.45], [0, 0.90, 0.55, 0.80], [0, 0.90, 0.65, 0.50], [0, 0.86, 0.58, 0.74], [0, 0.88, 0.56, 0.78]];
  const sev = sevTab[t], eff = effTab[t][drug];
  const Cof = cl(0.10 + 0.84 * (1 - sev) + eff * 0.74);
  const Syn = cl(sev * (1 - eff * 0.86));
  const Tiss = cl(1 - Syn * 0.92 + eff * 0.04);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Cof, 0.35, 0.65, ["low", "reduced", "working"]), w(Tiss, 0.35, 0.65, ["impaired", "reduced", "preserved"]), w(Syn, 0.30, 0.60, ["mild", "moderate", "severe"])];
  return { t, drug, sev, eff, Cof, Syn, Tiss, words, readout: "cofactor " + words[0] + " · tissue function " + words[1] + " · syndrome " + words[2] };
}
const TESTS = [
  [0, 0, "cofactor low · tissue function impaired · syndrome severe"],
  [0, 1, "cofactor working · tissue function preserved · syndrome mild"],
  [3, 2, "cofactor reduced · tissue function reduced · syndrome moderate"],
  [1, 2, "cofactor reduced · tissue function reduced · syndrome moderate"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="vd-sub" x="30" y="76" width="210" height="348" rx="12"/>
<rect class="vd-sub" x="256" y="76" width="304" height="348" rx="12"/>
<rect class="vd-sub" x="572" y="76" width="358" height="348" rx="12"/>
<text class="sc-zone" x="46" y="96">INTAKE AND GUT</text>
<text class="sc-zone" x="272" y="96">COFACTOR AT WORK</text>
<text class="sc-zone" x="588" y="96">WHERE IT SHOWS</text>
<path id="vesselFood" class="vd-vess" d="M95 166 L120 250"/>
<path id="vesselAbs" class="vd-vess" d="M200 320 L386 162"/>
<path id="vesselRx" class="vd-vess" d="M185 174 L388 160"/>
<path id="vesselProd" class="vd-vess" d="M444 270 L660 225"/>
<g id="gutSlot"></g>
<g class="hot" data-info="Food is the usual source of most vitamins. Poor intake lowers supply."><ellipse class="vd-plate" cx="95" cy="152" rx="30" ry="14"/><ellipse class="vd-plate2" cx="95" cy="150" rx="16" ry="7"/></g>
<g class="hot" data-info="Replacement gives the missing vitamin directly. It restores the cofactor fastest in this teaching model."><rect class="vd-bottle" x="168" y="128" width="34" height="44" rx="6"/><rect class="vd-bottle" x="177" y="116" width="16" height="14" rx="3"/></g>
<g id="blockG" class="hot" data-info="A gut cause blocks uptake. Treating the cause restores absorption."><rect class="vd-block" x="186" y="282" width="38" height="38" rx="8"/><path id="blockX" class="vd-x" d="M194 290 L216 312 M216 290 L194 312"/></g>
<g id="nodes">
  <circle id="badge" class="vd-badge" cx="408" cy="160" r="22"/>
  <text id="cofLetter" class="vd-letter" x="408" y="165" text-anchor="middle">B1</text>
  <text id="cofForm" class="vd-t" x="408" y="200" text-anchor="middle">Thiamine pyrophosphate</text>
  <g class="hot" data-info="Starting material entering the cofactor dependent step."><circle class="vd-subst" cx="316" cy="270" r="16"/></g>
  <polygon id="enz" class="vd-enz" points="408,238 440,270 408,302 376,270"/>
  <g class="hot" data-info="Product of the cofactor dependent step, sent on to the tissue that needs it."><circle class="vd-prod" cx="500" cy="270" r="16"/></g>
  <path class="vd-arrow" d="M334 270 H370 M446 270 H480"/>
  <text id="role1" class="vd-t" x="408" y="348" text-anchor="middle">Energy enzymes in nerve and heart</text>
  <text id="role2" class="vd-ts" x="408" y="364" text-anchor="middle">Pyruvate and keto acid steps</text>
</g>
<ellipse id="signGlow" class="vd-glow" cx="750" cy="215" rx="120" ry="95" opacity="0"/>
<g id="targetSlot"></g>
<ellipse id="sickHaze" class="vd-haze" cx="750" cy="218" rx="85" ry="70" opacity="0"/>
<g id="signCard" class="hot" data-info="The deficiency syndrome for the vitamin shown."><rect class="vd-card" x="600" y="318" width="300" height="74" rx="10"/><text id="signName" class="vd-sign" x="750" y="345" text-anchor="middle">Beriberi</text><text id="signLine" class="vd-sign2" x="750" y="363" text-anchor="middle">Numb feet and a weak heart</text></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.vd-sub{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.7}
.vd-t{fill:var(--anatomy-text);font-size:11px}
.vd-ts{fill:var(--anatomy-text);font-size:9.5px;opacity:.75}
.vd-letter{fill:var(--anatomy-strong);font-size:10px;font-weight:700}
.vd-sign{fill:var(--anatomy-strong);font-size:12px;font-weight:700}
.vd-sign2{fill:var(--anatomy-text);font-size:10px}
.vd-cap{fill:var(--anatomy-strong);font-size:12.5px}
.vd-vess{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:8;stroke-linecap:round;opacity:.5}
.vd-plate{fill:#d8dee6;stroke:var(--anatomy-mid);stroke-width:1}
.vd-plate2{fill:var(--anatomy-paper);stroke:var(--anatomy-faint);stroke-width:.8}
.vd-block{fill:#f2d27a;stroke:color-mix(in srgb,#f2d27a 55%,#000);stroke-width:1.2}
.vd-x{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.vd-bottle{fill:#8a5a2a;stroke:color-mix(in srgb,#8a5a2a 55%,#000);stroke-width:1}
.vd-badge{fill:#e9b84a;stroke:color-mix(in srgb,#e9b84a 55%,#000);stroke-width:1.4}
.vd-subst{fill:#7ab8ff;stroke:color-mix(in srgb,#7ab8ff 55%,#000);stroke-width:1.2}
.vd-enz{fill:#3ec6b8;stroke:color-mix(in srgb,#3ec6b8 55%,#000);stroke-width:1.4}
.vd-prod{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 55%,#000);stroke-width:1.2}
.vd-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.8;stroke-linecap:round}
.vd-glow{fill:var(--c-bad);stroke:none}
.vd-haze{fill:var(--c-bad);stroke:none}
.vd-card{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.p-vit{--cc:#e9b84a}.p-cof{--cc:#3ec6b8}.p-prod{--cc:#3ddc97}.p-drop{--cc:var(--c-bad)}
.dr-g-fill.g-cof{fill:#3ec6b8}.dr-g-fill.g-tiss{fill:var(--c-good)}.dr-g-fill.g-syn{fill:var(--c-bad)}.dr-g-fill.g-eff{fill:#e9b84a}
`;

buildScene({
  id: "vitamin-deficiency-syndromes", fig: "Fig 1", title: "Vitamin deficiency syndromes: cofactor to syndrome", W, H, body, extraCss,
  label: "An animated intake, gut, cofactor and target tissue scene for vitamin deficiencies. Food passes through a real gut to supply the vitamin, the active cofactor form drives a body step, and the target tissue shows the syndrome: eye with night blindness for vitamin A, heart and nerves with beriberi for thiamine, skin with pellagra for niacin, nerves with neuropathy for vitamin B12, vessels with scurvy for vitamin C, growing bone with rickets for vitamin D, and clotting with bleeding for vitamin K. Gauges show cofactor activity, tissue function, syndrome severity and treatment response. Treatment choices are replacement, dietary correction and treating a malabsorption cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "vitdef.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With replacement",
  sourcesLis: [
    "<strong>Fat soluble vitamins.</strong> Vitamin A supplies retinal for the vision pigment and keeps eye and skin surfaces healthy, so lack gives night blindness and xerophthalmia with a dry, keratinised eye surface. Vitamin D, through its active hormone form, drives gut calcium absorption, so lack impairs mineralisation and gives rickets in growing bone. Vitamin K is the cofactor for carboxylation of several clotting factors, so lack weakens clotting and causes bleeding. Fat malabsorption can lower all three. This is standard teaching in nutrition, ophthalmology, bone and haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Water soluble vitamins and cofactors.</strong> Thiamine (B1) becomes thiamine pyrophosphate for pyruvate and keto acid energy steps, so lack gives beriberi with peripheral neuropathy, heart failure or brain signs, classically with alcoholism, poor intake or bariatric surgery. Niacin (B3) supplies NAD and NADP for redox reactions, so lack gives pellagra with dermatitis, diarrhoea and dementia. Vitamin B12 is a cofactor for methionine and methylmalonyl steps, so lack damages spinal cord and peripheral nerves and makes large red cells, often from malabsorption. Vitamin C (ascorbate) is the cofactor that keeps the iron centre working for collagen hydroxylation enzymes, so lack makes weak collagen and scurvy. Riboflavin, other B vitamins, trace minerals and excess vitamin toxicity are noted only in the simplification list. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Replacement restores the missing vitamin directly, dietary correction restores intake over time, and treating a malabsorption cause restores absorption from the gut. Which route matters depends on why the vitamin is low. These are teaching toggles only.",
  ],
  simplified: "Riboflavin and other B group members beyond thiamine, niacin and B12, folate (covered in its own marrow scene), vitamin E, trace mineral deficiencies, vitamin excess and toxicity, amino acid and enzyme detail for each cofactor step, absorption transporters, body store sizes, laboratory assays, and all doses, routes and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
