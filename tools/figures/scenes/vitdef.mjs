/* Vitamin deficiency syndromes as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/vitdef.mjs [--print-model]
 * Static layout here; vitamin flow, cofactor work and syndrome rows animate in vitdef.page.js. Qualitative: no doses, no numbers. */
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
const ROWS = [
  ["A", "Night blindness", "Dry eye, xerophthalmia", "Vitamin A lack: retinal for the vision pigment fails and the eye surface dries and keratinises, giving night blindness and xerophthalmia."],
  ["B1", "Beriberi", "Nerve, heart and brain", "Thiamine (B1) lack: thiamine pyrophosphate fails for energy enzymes, giving beriberi with peripheral neuropathy, heart failure or brain signs, often with alcoholism or poor intake."],
  ["B3", "Pellagra", "Skin, gut and mind", "Niacin (B3) lack: NAD and NADP fall, giving pellagra with dermatitis in sun exposed skin, diarrhoea and dementia."],
  ["B12", "Neuropathy", "Cord, nerve and marrow", "Vitamin B12 lack: cofactor failure for methionine and methylmalonyl steps damages cord and peripheral nerves and makes large red cells. Malabsorption and bariatric surgery are classic routes."],
  ["C", "Scurvy", "Gums, wounds, vessels", "Vitamin C lack: ascorbate fails as cofactor for collagen hydroxylation, so collagen is weak and scurvy gives gum swelling, poor wound healing and bleeding."],
  ["D", "Rickets", "Soft growing bone", "Vitamin D lack: calcitriol driven calcium absorption falls and growing bone cannot mineralise, giving rickets in children and soft bone in adults."],
  ["K", "Bleeding", "Clotting factors fail", "Vitamin K lack: the carboxylation cofactor for clotting factors fails, so clotting is weak and bleeding follows. Fat malabsorption is a classic route."],
];
const rows = ROWS.map((r, i) => { const y = 112 + i * 44, cy = y + 19;
  return `<g class="hot" id="row${i}" tabindex="0" data-info="${esc(r[3])}"><rect class="vd-row" id="rowR${i}" x="586" y="${y}" width="330" height="38" rx="10"/><circle class="vd-ic vd-i${i}" cx="612" cy="${cy}" r="13"/><text class="vd-letter" x="612" y="${cy + 4}" text-anchor="middle">${esc(r[0])}</text><text class="vd-t" x="634" y="${cy - 1}">${esc(r[1])}</text><text class="vd-ts" x="634" y="${cy + 13}">${esc(r[2])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="vd-sub" x="30" y="76" width="210" height="348" rx="12"/>
<rect class="vd-sub" x="256" y="76" width="304" height="348" rx="12"/>
<rect class="vd-sub" x="572" y="76" width="358" height="348" rx="12"/>
<text class="sc-zone" x="46" y="96">INTAKE AND GUT</text>
<text class="sc-zone" x="272" y="96">COFACTOR AT WORK</text>
<text class="sc-zone" x="588" y="96">WHERE IT SHOWS</text>
<g id="nodes">
  <circle class="vd-diet" cx="85" cy="160" r="17"/>
  <path class="vd-food" d="M74 156 C78 148 84 150 87 155 C91 148 98 149 99 156 C103 151 107 154 106 160 L74 160 Z"/>
  <rect class="vd-supp" x="161" y="150" width="28" height="20" rx="7"/>
  <path class="vd-supp2" d="M175 150 L175 170"/>
  <circle class="vd-gut" cx="85" cy="245" r="18"/>
  <path class="vd-villi" d="M73 245 C76 236 80 236 82 245 C85 236 89 236 91 245 C94 237 97 238 98 245"/>
  <rect class="vd-block" x="158" y="228" width="34" height="34" rx="8"/>
  <path id="blockX" class="vd-x" d="M166 236 L184 254 M184 236 L166 254"/>
  <rect class="vd-bottle" x="74" y="316" width="22" height="30" rx="5"/>
  <rect class="vd-bottle" x="80" y="306" width="10" height="12" rx="3"/>
  <ellipse class="vd-plate" cx="175" cy="330" rx="24" ry="12"/>
  <ellipse class="vd-plate2" cx="175" cy="328" rx="13" ry="6"/>
  <circle id="badge" class="vd-badge" cx="408" cy="160" r="22"/>
  <text id="cofLetter" class="vd-letter" x="408" y="165" text-anchor="middle">B1</text>
  <text id="cofForm" class="vd-t" x="408" y="200" text-anchor="middle">Thiamine pyrophosphate</text>
  <circle class="vd-subst" cx="316" cy="270" r="16"/>
  <polygon id="enz" class="vd-enz" points="408,238 440,270 408,302 376,270"/>
  <circle class="vd-prod" cx="500" cy="270" r="16"/>
  <path class="vd-arrow" d="M334 270 H372 M444 270 H480"/>
  <text id="role1" class="vd-t" x="408" y="348" text-anchor="middle">Energy enzymes in nerve and heart</text>
  <text id="role2" class="vd-ts" x="408" y="364" text-anchor="middle">Pyruvate and keto acid steps</text>
</g>
<g id="rowsG">${rows}</g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.vd-sub{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.7}
.vd-t{fill:var(--anatomy-text);font-size:11px}
.vd-ts{fill:var(--anatomy-text);font-size:9.5px;opacity:.75}
.vd-letter{fill:var(--anatomy-strong);font-size:10px;font-weight:700}
.vd-diet{fill:#8fbf6a;stroke:color-mix(in srgb,#8fbf6a 55%,#000);stroke-width:1.2}
.vd-food{fill:#f2c94c;stroke:color-mix(in srgb,#f2c94c 55%,#000);stroke-width:.8}
.vd-supp{fill:#f4f6f8;stroke:var(--anatomy-mid);stroke-width:1.2}
.vd-supp2{fill:none;stroke:var(--c-bad);stroke-width:1.4}
.vd-gut{fill:#e9a2b3;stroke:color-mix(in srgb,#e9a2b3 55%,#000);stroke-width:1.2}
.vd-villi{fill:none;stroke:color-mix(in srgb,#e9a2b3 60%,#000);stroke-width:1.6;stroke-linecap:round}
.vd-block{fill:#f2d27a;stroke:color-mix(in srgb,#f2d27a 55%,#000);stroke-width:1.2}
.vd-x{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.vd-bottle{fill:#8a5a2a;stroke:color-mix(in srgb,#8a5a2a 55%,#000);stroke-width:1}
.vd-plate{fill:#d8dee6;stroke:var(--anatomy-mid);stroke-width:1}
.vd-plate2{fill:var(--anatomy-paper);stroke:var(--anatomy-faint);stroke-width:.8}
.vd-badge{fill:#e9b84a;stroke:color-mix(in srgb,#e9b84a 55%,#000);stroke-width:1.4}
.vd-subst{fill:#7ab8ff;stroke:color-mix(in srgb,#7ab8ff 55%,#000);stroke-width:1.2}
.vd-enz{fill:#3ec6b8;stroke:color-mix(in srgb,#3ec6b8 55%,#000);stroke-width:1.4}
.vd-prod{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 55%,#000);stroke-width:1.2}
.vd-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.8;stroke-linecap:round}
.vd-row{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.vd-ic{stroke:color-mix(in srgb,#000 25%,transparent);stroke-width:.8}
.vd-i0{fill:#f2c94c}.vd-i1{fill:#e9b84a}.vd-i2{fill:#f08a4b}.vd-i3{fill:#c084fc}.vd-i4{fill:#ff8a7a}.vd-i5{fill:#7fc4e8}.vd-i6{fill:#e5484d}
.p-vit{--cc:#e9b84a}.p-cof{--cc:#3ec6b8}.p-prod{--cc:#3ddc97}.p-drop{--cc:var(--c-bad)}
.dr-g-fill.g-cof{fill:#3ec6b8}.dr-g-fill.g-tiss{fill:var(--c-good)}.dr-g-fill.g-syn{fill:var(--c-bad)}.dr-g-fill.g-eff{fill:#e9b84a}
`;

buildScene({
  id: "vitamin-deficiency-syndromes", fig: "Fig 1", title: "Vitamin deficiency syndromes: cofactor to syndrome", W, H, body, extraCss,
  label: "An animated intake, gut, cofactor and tissue scene for vitamin deficiencies. Each vitamin group on the slider shows its active cofactor form, the enzyme or tissue step it supports, and the syndrome row it produces: vitamin A with night blindness and xerophthalmia, thiamine with beriberi, niacin with pellagra, vitamin B12 with neuropathy, vitamin C with scurvy from failed collagen hydroxylation, vitamin D with rickets, and vitamin K with bleeding. Gauges show cofactor activity, tissue function, syndrome severity and treatment response. Treatment choices are replacement, dietary correction and treating a malabsorption cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "vitdef.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Fat soluble vitamins.</strong> Vitamin A supplies retinal for the vision pigment and keeps eye and skin surfaces healthy, so lack gives night blindness and xerophthalmia with a dry, keratinised eye surface. Vitamin D, through its active hormone form, drives gut calcium absorption, so lack impairs mineralisation and gives rickets in growing bone. Vitamin K is the cofactor for carboxylation of several clotting factors, so lack weakens clotting and causes bleeding. Fat malabsorption can lower all three. This is standard teaching in nutrition, ophthalmology, bone and haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Water soluble vitamins and cofactors.</strong> Thiamine (B1) becomes thiamine pyrophosphate for pyruvate and keto acid energy steps, so lack gives beriberi with peripheral neuropathy, heart failure or brain signs, classically with alcoholism, poor intake or bariatric surgery. Niacin (B3) supplies NAD and NADP for redox reactions, so lack gives pellagra with dermatitis, diarrhoea and dementia. Vitamin B12 is a cofactor for methionine and methylmalonyl steps, so lack damages spinal cord and peripheral nerves and makes large red cells, often from malabsorption. Vitamin C (ascorbate) is the cofactor that keeps the iron centre working for collagen hydroxylation enzymes, so lack makes weak collagen and scurvy. Riboflavin, other B vitamins, trace minerals and excess vitamin toxicity are noted only in the simplification list. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Replacement restores the missing vitamin directly, dietary correction restores intake over time, and treating a malabsorption cause restores absorption from the gut. Which route matters depends on why the vitamin is low. These are teaching toggles only.",
  ],
  simplified: "Riboflavin and other B group members beyond thiamine, niacin and B12, folate (covered in its own marrow scene), vitamin E, trace mineral deficiencies, vitamin excess and toxicity, amino acid and enzyme detail for each cofactor step, absorption transporters, body store sizes, laboratory assays, and all doses, routes and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
