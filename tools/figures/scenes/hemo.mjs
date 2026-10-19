/* Haemophilia and von Willebrand disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hemo.mjs [--print-model]
 * Static layout here; plug, cascade, joint and gauges move in hemo.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of the factor defect", a: [0.25, 0.6, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "factor replacement" },
    { label: "desmopressin" },
    { label: "avoid NSAIDs" },
  ],
  status: "Defect: {level} · {drug} ·",
  drugNames: ["no treatment", "factor replacement", "desmopressin", "avoiding NSAIDs"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const sev = S.level.a[level];
  const fac = drug === 1 ? 1 : 0, des = drug === 2 ? 1 : 0, avo = drug === 3 ? 1 : 0;
  const desEff = des ? cl(1 - 0.7 * sev) : 0;
  const V = cl(0.62 - 0.42 * sev + 0.5 * desEff);
  const baseF = 0.88 - 0.72 * sev;
  const F = cl(baseF + (fac ? 0.78 : 0) + 0.4 * desEff);
  const P = cl(0.18 + 0.72 * V + (avo ? 0.14 : 0));
  const Fb = cl(0.12 + 0.78 * F);
  const Stab = cl(0.45 * P + 0.55 * Fb);
  const Bleed = cl(0.95 - 0.55 * Fb - 0.28 * P);
  const Ap = cl(0.08 + 0.9 * (1 - F));
  const Bt = cl(0.08 + 0.9 * (1 - P));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Fb, 0.35, 0.65, ["low", "reduced", "near normal"]), w(Ap, 0.3, 0.6, ["near normal", "raised", "prolonged"]), w(Bt, 0.3, 0.6, ["near normal", "raised", "prolonged"]), w(Bleed, 0.3, 0.6, ["low", "raised", "high"])];
  return { sev, fac, des, avo, desEff, V, F, P, Fb, Stab, Bleed, Ap, Bt, words, readout: "fibrin " + words[0] + " · aPTT " + words[1] + " · bleeding time " + words[2] + " · joint bleed risk " + words[3] };
}
const TESTS = [
  [2, 0, "fibrin low · aPTT prolonged · bleeding time prolonged · joint bleed risk high"],
  [2, 1, "fibrin near normal · aPTT near normal · bleeding time prolonged · joint bleed risk raised"],
  [0, 2, "fibrin near normal · aPTT near normal · bleeding time near normal · joint bleed risk low"],
  [2, 3, "fibrin low · aPTT prolonged · bleeding time raised · joint bleed risk high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="vesselSlot"></g>
<g id="jointSlot"></g>
<g id="haloG"></g>
<g id="vwf"></g>
<g id="plug"></g>
<g id="fib"></g>
<g id="casc"></g>
<g id="parts"></g>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "haemophilia-coagulation-defects", fig: "Fig 1", title: "Haemophilia and von Willebrand disease: defects that bleed", W, H, body,
  label: "An animated story from left to right. A torn vessel wall exposes collagen. Von Willebrand factor strands catch platelets into a plug, while a short cascade from factors XII and XI through IX (helped by VIII) to X, thrombin and fibrin weaves the fibrin mesh that firms the plug. Without enough factor VIII or IX the mesh is thin, blood leaks out and collects in the knee joint. Without von Willebrand factor the platelets cannot stick. A slider sets defect severity. Factor replacement, desmopressin and avoiding NSAIDs each act on the drawing.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, factor levels or laboratory values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hemo.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With factor replacement",
  sourcesLis: [
    "<strong>Two defects, one weak plug.</strong> Primary haemostasis: platelets stick to exposed collagen through von Willebrand factor (vWF, platelet GPIb), activate and clump into a plug. In von Willebrand disease vWF is low or works poorly, so platelets stick badly, mucosal bleeding and heavy periods are typical, and bleeding time is prolonged. Secondary haemostasis: the intrinsic cascade (XII, XI, IX with cofactor VIII) feeds factor X, thrombin and fibrin, which stabilises the plug. Missing factor VIII (haemophilia A) or IX (haemophilia B, Christmas disease) gives haemophilia: the plug forms but is not stabilised, so bleeding is deep, into joints (haemarthrosis) and muscles, often after a delay, and aPTT is prolonged because aPTT tests the intrinsic arm. PT, which tests the extrinsic arm, stays normal in both. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Factor replacement supplies the missing VIII or IX (aPTT and fibrin correct, but a pure factor concentrate does not fix a vWF adhesion defect, so bleeding time can stay prolonged). Desmopressin releases stored vWF and factor VIII from vessel lining cells, helping most in mild disease and much less when little is stored, as in severe disease. Avoiding NSAIDs protects platelet function, because NSAIDs block platelet cyclo-oxygenase, so it eases the platelet side but does not correct the cascade or aPTT. These are teaching toggles only.",
  ],
  simplified: "Haemophilia carriers and inheritance (X linked), inhibitors against replaced factor, the types and laboratory subtyping of von Willebrand disease, acquired von Willebrand syndrome, platelet receptor detail, tranexamic acid and other adjuncts, prophylaxis schedules, joint damage over time, and all doses and factor levels are left out. One vessel and one joint stand for many bleeding sites, and counts and speeds are illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
.hm-vwf{fill:none;stroke:var(--anatomy-hi);stroke-width:1.6;stroke-linecap:round}
.hm-fib{fill:none;stroke:color-mix(in srgb,var(--c-plt) 60%,var(--anatomy-paper));stroke-width:1.2;stroke-linecap:round}
.hm-coll{fill:none;stroke:color-mix(in srgb,var(--c-neut) 60%,var(--anatomy-paper));stroke-width:2.4;stroke-linecap:round}
.hm-wound{fill:color-mix(in srgb,var(--c-bad) 55%,#000);stroke:color-mix(in srgb,var(--c-bad) 70%,var(--anatomy-mid));stroke-width:1}
.hm-halo{fill:var(--c-bad);stroke:none}
.hm-node{fill:color-mix(in srgb,var(--c-cyt) 28%,var(--anatomy-card));stroke:var(--anatomy-mid);stroke-width:1.2}
.hm-nodebad{fill:color-mix(in srgb,var(--c-bad) 26%,var(--anatomy-card));stroke:var(--c-bad);stroke-width:1.6}
.hm-arr{fill:none;stroke:color-mix(in srgb,var(--c-cyt) 70%,var(--anatomy-mid));stroke-width:1.8;stroke-linecap:round}
.hm-dash{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;stroke-dasharray:4 3}
.hm-jblood{fill:var(--c-rbc);stroke:none}
.hm-jring{fill:none;stroke:var(--c-bad);stroke-width:2}
.hm-xp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.hm-flash{fill:none;stroke:var(--c-good);stroke-width:2}
.p-casc{--cc:var(--c-cyt)}.p-leak{fill:var(--c-rbc)}.p-fac{--cc:#d9a441}.p-desmo{--cc:var(--c-good)}.p-nsaid{--cc:#9aa3ab}
.dr-g-fill.g-vwf{fill:var(--c-fl)}.dr-g-fill.g-fac{fill:var(--c-cyt)}.dr-g-fill.g-stab{fill:var(--c-good)}
`,
});
