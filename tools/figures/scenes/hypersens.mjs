/* Hypersensitivity types I to IV (Gell and Coombs) as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hypersens.mjs [--print-model]
 * Static layout here; the four mechanisms and gauges animate in hypersens.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Hypersensitivity type shown", a: [0, 1, 2, 3], names: ["type I", "type II", "type III", "type IV"], ticks: ["I", "II", "III", "IV"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "adrenaline (rescue for type I)" },
    { label: "antihistamine" },
    { label: "corticosteroid" },
    { label: "immunosuppressant or biologic" },
    { label: "remove or avoid the trigger" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "adrenaline", "an antihistamine", "a corticosteroid", "an immunosuppressant or biologic", "trigger removed"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const R0 = [0.9, 0.7, 0.75, 0.65][t], D0 = [0.6, 0.85, 0.8, 0.7][t], speed = [1, 0.6, 0.4, 0.15][t];
  const eR = [[0, 0, 0, 0], [0.1, 0, 0, 0], [0, 0, 0, 0], [0.3, 0.45, 0.5, 0.55], [0.2, 0.5, 0.55, 0.65], [0.85, 0.75, 0.75, 0.75]][drug][t];
  const eD = [[0, 0, 0, 0], [0.75, 0.05, 0.05, 0], [0.6, 0, 0, 0], [0.4, 0.5, 0.55, 0.6], [0.3, 0.55, 0.6, 0.7], [0.85, 0.75, 0.75, 0.75]][drug][t];
  const R = cl(R0 * (1 - eR)), D = cl(D0 * (1 - eD)), Sv = cl(0.4 * R + 0.6 * D);
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(R, 0.25, 0.6, ["low", "moderate", "high"]), w(D, 0.25, 0.55, ["little", "some", "marked"]), w(Sv, 0.25, 0.55, ["mild", "moderate", "severe"])];
  return { type: t, drug, R, D, S: Sv, speed, words, readout: "mediators " + words[0] + " · tissue damage " + words[1] + " · severity " + words[2] };
}
const TESTS = [
  [0, 0, "mediators high · tissue damage marked · severity severe"],
  [0, 1, "mediators high · tissue damage little · severity moderate"],
  [3, 1, "mediators high · tissue damage marked · severity severe"],
  [2, 5, "mediators low · tissue damage little · severity mild"],
];

/* ---------------- static layout ---------------- */
const CARDS = [
  ["TYPE I  immediate (IgE)", "onset: minutes", "allergy, anaphylaxis, asthma"],
  ["TYPE II  antibody to cell", "onset: minutes to hours", "transfusion, haemolysis, Graves"],
  ["TYPE III  immune complex", "onset: hours to days", "serum sickness, SLE, PSGN"],
  ["TYPE IV  T cell, delayed", "onset: one to three days", "contact dermatitis, TB test"],
];
const cards = CARDS.map((c, i) => { const x = 22 + i * 232;
  return `<g class="hot sc-card" id="card${i}" tabindex="0" data-info="${esc(["Type I: IgE on mast cells meets allergen and the cell releases histamine within minutes.", "Type II: antibody binds a cell-surface or tissue antigen and complement or phagocytes damage the target, or the antibody disturbs a receptor.", "Type III: circulating antigen-antibody complexes lodge in vessel walls and complement and neutrophils injure the wall.", "Type IV: T cells and macrophages, not antibody. It is slow, peaking after one to three days."][i])}"><rect class="sc-card-r" x="${x}" y="46" width="220" height="72" rx="12"/><text class="sc-zone" x="${x + 12}" y="66">${esc(c[0])}</text><text class="sc-lab" x="${x + 12}" y="86">${esc(c[1])}</text><text class="sc-lab sc-dim2" x="${x + 12}" y="104">${esc(c[2])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue" x="14" y="126" width="${W - 28}" height="316" rx="18"/>
${cards}
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sc-card-r{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-card.on .sc-card-r{stroke:var(--anatomy-lit);stroke-width:2;fill:color-mix(in srgb,var(--anatomy-lit) 10%,var(--anatomy-card))}
.sc-dim2{opacity:.75}
.cl-rbc2{--cc:var(--c-rbc)}
.p-allergen{--cc:#ff9a3d}.p-hist{--cc:#ff5e8a}.p-gran{--cc:#c978c9}.p-comp{--cc:#7fd3ff}.p-ifn{--cc:#c084fc}.p-perf{--cc:#ff7a45}.p-frag{--cc:var(--c-rbc)}.p-cplx{--cc:#ff9a3d}.p-enz{--cc:#ffd24a}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ag{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.sc-wall{fill:color-mix(in srgb,var(--c-endo) 70%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.sc-lum2{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper))}
.mk-c{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.4}.mk-x{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.mk-g{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.cl-tgt{--cc:var(--c-graft)}.cl-act .cl-b{stroke:var(--c-bad)}
.clk{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}.clk-h{stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
`;

buildScene({
  id: "hypersensitivity-types", fig: "Fig 1", title: "Hypersensitivity types I to IV", W, H, body, extraCss,
  label: "Four animated panels in one: type I (IgE on mast cells, histamine release), type II (antibody on cell surfaces, complement and phagocytes), type III (immune complexes in vessel walls with complement and neutrophils) and type IV (delayed T cell and macrophage attack). A strip compares onset and examples. Gauges show mediator release, tissue damage, onset speed and severity. Treatment choices include adrenaline, antihistamine, corticosteroid, immunosuppressant and removing the trigger.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, levels or numbers are shown or implied.",
  scene: { W }, pageJs: readFileSync(join(HERE, "hypersens.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>The four types.</strong> The Gell and Coombs scheme groups immune-mediated tissue reactions. Type I: allergen cross-links IgE on mast cells, which release histamine and other mediators within minutes (allergy, anaphylaxis). Type II: antibody against a cell-surface or tissue antigen causes damage through complement, phagocytes, or by disturbing a receptor (transfusion reaction, autoimmune haemolysis, Goodpasture, Graves, myasthenia gravis). Type III: soluble antigen-antibody complexes deposit in vessel walls and trigger complement and neutrophils (serum sickness, SLE, post-streptococcal glomerulonephritis). Type IV: delayed, T cell and macrophage mediated (contact dermatitis, tuberculin test, graft rejection). This is standard teaching in immunology and pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Adrenaline for anaphylaxis, antihistamines for histamine effects, corticosteroids and immunosuppressants for broader immune reactions, and removing the trigger. They are teaching toggles that show which step each class acts on.",
  ],
  simplified: "Real reactions overlap (many diseases mix types), Th2 and other cell types, the late-phase type I response, the full complement pathways, genetics and every drug and dose are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
