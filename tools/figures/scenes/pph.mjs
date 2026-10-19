/* Postpartum haemorrhage as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pph.mjs [--print-model]
 * After delivery the uterus must contract to compress the spiral arteries. Bleeding follows the four Ts:
 * tone (uterine atony), trauma (tears), tissue (retained placenta) and thrombin (coagulopathy).
 * Static layout here; uterus, blood loss, clot and gauges move in pph.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Main cause (the four Ts)", a: [0, 1, 2, 3], names: ["tone", "trauma", "tissue", "thrombin"], ticks: ["tone", "trauma", "tissue", "thrombin"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "uterine massage and uterotonic" },
    { label: "repair tear or remove retained tissue" },
    { label: "tranexamic acid and clotting support" },
  ],
  status: "Cause: {level} · {drug} ·",
  drugNames: ["no treatment", "uterine massage and a uterotonic", "repair or removal", "tranexamic acid and clotting support"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const cause = S.level.a[level];
  const toneBase = [0.95, 0.18, 0.6, 0.22][cause];
  const traumaBase = [0.05, 0.95, 0.05, 0.08][cause];
  const tissueBase = [0.05, 0.05, 0.95, 0.05][cause];
  const thromBase = [0.05, 0.08, 0.1, 0.95][cause];
  const mass = drug === 1 ? 1 : 0, rep = drug === 2 ? 1 : 0, txa = drug === 3 ? 1 : 0;
  const toneEff = cl(toneBase * (mass ? 0.15 : 1) * (rep && cause === 2 ? 0.45 : 1));
  const traumaEff = cl(traumaBase * (rep ? 0.1 : 1));
  const tissueEff = cl(tissueBase * (rep ? 0.08 : 1));
  const thromEff = cl(thromBase * (txa ? 0.1 : 1));
  const Contr = cl(0.95 - 0.8 * toneEff - 0.25 * tissueEff);
  const Bleed = cl(0.04 + 0.6 * (1 - Contr) + 0.5 * traumaEff + 0.24 * tissueEff + 0.28 * thromEff);
  const Clot = cl(0.96 - 0.85 * thromEff - 0.12 * Bleed * thromEff);
  const Press = cl(0.96 - 0.62 * Bleed);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Contr, 0.35, 0.65, ["soft and weak", "partial", "firm"]), w(Bleed, 0.28, 0.55, ["scant", "moderate", "heavy"]), w(Press, 0.45, 0.7, ["low", "borderline", "maintained"]), w(Clot, 0.35, 0.7, ["poor", "forming", "firm"])];
  return { cause, mass, rep, txa, toneEff, traumaEff, tissueEff, thromEff, Contr, Bleed, Clot, Press, words, readout: "uterus " + words[0] + " · bleeding " + words[1] + " · pressure " + words[2] + " · clotting " + words[3] };
}
const TESTS = [
  [0, 0, "uterus soft and weak · bleeding heavy · pressure borderline · clotting firm"],
  [0, 1, "uterus firm · bleeding scant · pressure maintained · clotting firm"],
  [1, 2, "uterus firm · bleeding scant · pressure maintained · clotting firm"],
  [3, 3, "uterus firm · bleeding scant · pressure maintained · clotting firm"],
];

/* ---------------- static layout ---------------- */
const CARDS = [
  ["TONE", "uterine atony", "uterus stays soft"],
  ["TRAUMA", "tears", "cervix or vaginal tear"],
  ["TISSUE", "retained placenta", "tissue left inside"],
  ["THROMBIN", "coagulopathy", "blood does not clot"],
];
const cards = CARDS.map((c, i) => { const x = 22 + i * 232;
  const info = ["Tone: the uterus stays soft after delivery (uterine atony), so the spiral arteries are not compressed and they keep bleeding.", "Trauma: a tear of the cervix, vagina or perineum, or a ruptured uterus. The uterus may be firm yet bleeding continues from the tear.", "Tissue: retained placenta or membranes left inside the uterus stop it contracting fully, so bleeding continues until the tissue is removed.", "Thrombin: a clotting problem (coagulopathy). Blood stays liquid, clots do not form or break down, and every surface oozes."][i];
  return `<g class="hot sc-card" id="card${i}" tabindex="0" data-info="${esc(info)}"><rect class="sc-card-r" x="${x}" y="46" width="220" height="72" rx="12"/><text class="sc-zone" x="${x + 12}" y="68">${esc(c[0] + "  " + c[1])}</text><text class="sc-lab" x="${x + 12}" y="88">${esc(c[2])}</text><text class="sc-lab sc-dim2" x="${x + 12}" y="106">${esc(["most common cause", "firm uterus, still bleeding", "uterus cannot finish contracting", "oozing, poor clot"][i])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue" x="14" y="126" width="${W - 28}" height="316" rx="18"/>
${cards}
<g id="flow"></g>
<g id="uterusSlot"></g>
<g id="heartSlot"></g>
<g id="cells"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sc-card-r{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-card.on .sc-card-r{stroke:var(--anatomy-lit);stroke-width:2;fill:color-mix(in srgb,var(--anatomy-lit) 10%,var(--anatomy-card))}
.sc-dim2{opacity:.75}
.pp-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.pp-spiral{fill:none;stroke:var(--c-rbc);stroke-width:2.4;stroke-linecap:round}
.pp-tear{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.pp-stitch{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.pp-tissue{fill:#c9859b;stroke:color-mix(in srgb,#c9859b 55%,#000);stroke-width:1}
.pp-pool{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:.8}
.pp-lumen{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper))}
.pp-vwall{fill:color-mix(in srgb,var(--c-endo) 60%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.pp-canal{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 65%,#000);stroke-width:1.2}
.pp-dish{fill:color-mix(in srgb,var(--c-endo) 60%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.pp-stub{fill:none;stroke:var(--c-rbc);stroke-width:10;stroke-linecap:round;opacity:.85}
.pp-fibrin{fill:none;stroke:#f6f1e0;stroke-width:1.1;opacity:.9}
.p-drop{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 50%,#000);stroke-width:.5}
.p-txa{--cc:var(--c-good)}
.p-uto{--cc:var(--c-cyt)}
.dr-g-fill.g-pool{fill:var(--c-rbc)}
`;

buildScene({
  id: "postpartum-haemorrhage", fig: "Fig 1", title: "Postpartum haemorrhage: the four Ts", W, H, body, extraCss,
  label: "An animated uterus after delivery. It must contract to squeeze the spiral arteries shut. Four causes of heavy bleeding are shown: tone (the uterus stays soft), trauma (a tear), tissue (retained placenta) and thrombin (blood that does not clot). Blood escapes into a pool, clot forms in a dish on the right, and the circulation slows as pressure falls. Gauges show contraction, bleeding, clotting and blood pressure. Treatments are uterine massage with a uterotonic, repair or removing tissue, and tranexamic acid with clotting support.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pph.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With uterine massage and uterotonic",
  sourcesLis: [
    "<strong>Why bleeding happens after delivery.</strong> When the placenta separates, the spiral arteries are left open. A firm uterine contraction compresses them and stops the flow, so failure to contract (tone, uterine atony) is the leading cause of postpartum haemorrhage. The other causes in the four Ts are trauma (tears of the cervix, vagina or uterus), tissue (retained placenta or membranes preventing full contraction) and thrombin (coagulopathy, where clots do not form). Heavy loss lowers circulating volume and blood pressure and can progress to shock. This is standard teaching in obstetrics texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Uterine massage and a uterotonic restore tone, repair of a tear or removal of retained tissue removes that source, and tranexamic acid with clotting support helps a firm clot form and hold. Resuscitation and transfusion run alongside in real care but are not drawn here. They are teaching toggles only.",
  ],
  simplified: "Resuscitation, transfusion, balloon tamponade, surgery, embolisation, the full coagulation workup, rarer causes such as placenta accreta and uterine inversion, and all doses and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
