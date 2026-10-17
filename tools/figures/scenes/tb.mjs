/* Tuberculosis pathogenesis as an animated scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/tb.mjs [--print-model]
 * Static layout here; bacilli, cells, mediators and gauges move in tb.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Host immunity", a: [0.9, 0.55, 0.2], names: ["strong", "partial", "impaired"], ticks: ["strong", "partial", "impaired"], start: 1 },
  drugLabel: "Treatment or immune state",
  settings: [
    { label: "no treatment" },
    { label: "antitubercular combination therapy" },
    { label: "preventive therapy (latent infection)" },
    { label: "immune suppression (TNF inhibitor or advanced HIV)" },
  ],
  status: "Host immunity: {level} · {drug} ·",
  drugNames: ["no treatment", "combination therapy", "preventive therapy", "immune suppression"],
};
function modelOf(S, level, drug) {
  const imm = S.level.a[level], abx = drug === 1 ? 1 : 0, prev = drug === 2 ? 1 : 0, sup = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const ie = imm * (1 - 0.75 * sup);
  let B = cl(0.95 - 0.65 * ie), G = cl(ie * 1.05 - 0.05), Cas = cl(0.2 + 0.7 * (1 - ie)), Cav = cl((1 - ie - 0.35) * 1.4), Sp = cl((1 - ie - 0.25) * 1.3);
  if (abx) { B *= 0.12; Cas *= 0.6; Cav *= 0.5; Sp *= 0.2; G *= 0.85; }
  if (prev) { B *= 0.35; Cav *= 0.5; Sp *= 0.5; }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.5, ["few", "held in check", "multiplying"]), w(G, 0.35, 0.7, ["breaking down", "forming", "intact"]), w(Sp, 0.2, 0.5, ["none", "local", "miliary"])];
  return { imm, ie, abx, prev, sup, B, G, Cas, Cav, Sp, words, readout: "bacilli " + words[0] + " · granuloma " + words[1] + " · spread " + words[2] };
}
const TESTS = [
  [0, 0, "bacilli held in check · granuloma intact · spread none"],
  [1, 0, "bacilli multiplying · granuloma forming · spread local"],
  [2, 0, "bacilli multiplying · granuloma breaking down · spread miliary"],
  [2, 1, "bacilli few · granuloma breaking down · spread none"],
  [0, 3, "bacilli multiplying · granuloma breaking down · spread miliary"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="sc-air" x="30" y="58" width="304" height="140" rx="14"/>
<text class="sc-zone" x="46" y="82">ALVEOLUS (AIR)</text>
<rect class="sc-node" x="750" y="64" width="186" height="116" rx="46"/>
<text class="sc-zone" x="782" y="88">LYMPH NODE</text>
<rect class="sc-vessel" x="690" y="356" width="246" height="60" rx="30"/>
<text class="sc-zone sc-dim" x="716" y="352">BLOOD VESSEL</text>
<path id="link" class="sc-link" d="M505 268C440 262 380 238 330 206" opacity="0"/>
<ellipse id="caseum" class="sc-case" cx="520" cy="292" rx="30" ry="26"/>
<ellipse id="cavity" class="sc-cav" cx="520" cy="292" rx="1" ry="1"/>
<g id="gran"></g><g id="bac"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "tb-pathogenesis", fig: "Fig 1", title: "Tuberculosis: from inhaled bacillus to granuloma", W, H, body,
  label: "An animated alveolus and lung tissue. Inhaled tubercle bacilli are taken up by macrophages. T helper cells release interferon gamma and TNF, which wall the infection in a granuloma with a caseous core. Strong immunity holds the bacilli in check, which is latent infection. Weak immunity lets the core break down into a cavity and the bacilli spread to the lymph node and the blood. Treatment and immune suppression change the picture. Gauges show bacterial load, granuloma integrity, caseation and spread.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, durations or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "tb.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without therapy", withLabel: "With therapy or drug",
  extraCss: `
.sc-air{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:.8}
.sc-node{fill:color-mix(in srgb,var(--c-lymph) 12%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:.8}
.sc-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:.8}
.sc-case{fill:color-mix(in srgb,#efe3b8 70%,var(--anatomy-paper));stroke:color-mix(in srgb,#b5a262 60%,#000);stroke-width:.8;stroke-dasharray:3 3}
.sc-cav{fill:color-mix(in srgb,#000 70%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8}
.sc-link{fill:none;stroke:color-mix(in srgb,#000 70%,var(--anatomy-paper));stroke-linecap:round;stroke-width:10}
.bac-rod{fill:#e0505f;stroke:color-mix(in srgb,#e0505f 50%,#000);stroke-width:.5}
.p-ifn{--cc:#ffd24a}.p-tnf{--cc:var(--c-cyt)}
.blk{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.cl-epi .cl-b{--cc:var(--c-endo)}.cl-epi{--cc:var(--c-endo)}
.cl-epith{--cc:#c7a6e0}.cl-giant{--cc:#b394d6}.cl-th1{--cc:var(--c-lymph)}
`,
  sourcesLis: [
    "<strong>How tuberculosis takes hold.</strong> Inhaled Mycobacterium tuberculosis is taken up by alveolar macrophages, where it blocks fusion of the phagosome with the lysosome and survives. Infected cells and monocytes gather, and antigen-specific Th1 cells release interferon gamma, which (with TNF) activates macrophages. These form a granuloma: epithelioid macrophages, Langhans giant cells and a rim of lymphocytes, with caseous (cheese-like) necrosis at the centre. In most people the granuloma contains the infection (latent TB) and a primary (Ghon) focus with nodal involvement heals. When immunity fails or falls later (HIV, TNF inhibitors, malnutrition), the core liquefies into a cavity, bacilli spread through airways, lymph and blood (miliary TB), and active disease follows. This is standard teaching in medicine and microbiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Multi-drug combination therapy for active disease and preventive therapy for latent infection are teaching toggles that show effects only; the drug-by-drug mechanisms are in the antitubercular drugs figure.",
  ],
  simplified: "Drug resistance, extrapulmonary sites other than lymph node and blood, the Ghon complex and Ranke complex staging, latent testing methods, immune reconstitution, and all regimens, doses and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
