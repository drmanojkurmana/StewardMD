/* Graft rejection as an animated, working scene: direct and indirect allorecognition, T and B cell arms, immunosuppressant targets.
 *   node tools/figures/scenes/graft.mjs [--print-model]
 * Original drawing built from the mechanism (Anima styling, Anatomy page shell). Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "HLA mismatch", a: [0.35, 0.65, 1], names: ["well matched", "partly matched", "poorly matched"], ticks: ["well matched", "partly", "poorly matched"], start: 1 },
  drugLabel: "Immunosuppression",
  settings: [
    { label: "no immunosuppression", t: 1, ab: 1, fl: {} },
    { label: "calcineurin inhibitor (blocks IL-2 production)", t: 0.4, ab: 0.6, fl: { cni: 1 } },
    { label: "antiproliferative (blocks lymphocyte division)", t: 0.6, ab: 0.45, fl: { mmf: 1 } },
    { label: "costimulation blocker (blocks CD28 and B7)", t: 0.4, ab: 0.45, fl: { cos: 1 } },
    { label: "anti-IL-2 receptor antibody", t: 0.6, ab: 0.8, fl: { il2r: 1 } },
    { label: "anti-thymocyte globulin (removes T cells)", t: 0.25, ab: 0.5, fl: { atg: 1 } },
    { label: "triple therapy (calcineurin inhibitor, antiproliferative, steroid)", t: 0.2, ab: 0.25, fl: { cni: 1, mmf: 1, st: 1 } },
  ],
  status: "HLA mismatch: {level} · {drug} ·",
  drugNames: ["no immunosuppression", "a calcineurin inhibitor", "an antiproliferative", "a costimulation blocker", "an anti-IL-2 receptor antibody", "anti-thymocyte globulin", "triple therapy"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], F = S.settings[drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const T = cl((0.08 + 0.88 * a) * F.t), Ab = cl((0.04 + 0.8 * a) * F.ab);
  const G = cl(0.03 + 0.6 * T + 0.38 * Ab), Fn = 1 - G;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(T, 0.3, 0.6, ["low", "moderate", "high"]), w(Ab, 0.3, 0.6, ["low", "moderate", "high"]), w(G, 0.25, 0.55, ["intact", "injured", "rejecting"])];
  return { a, T, Ab, G, Fn, fl: F.fl, words, readout: "T-cell activation " + words[0] + " · antibodies " + words[1] + " · graft " + words[2] };
}
const TESTS = [
  [1, 0, "T-cell activation high · antibodies moderate · graft rejecting"],
  [1, 1, "T-cell activation low · antibodies moderate · graft injured"],
  [1, 3, "T-cell activation low · antibodies low · graft injured"],
  [1, 6, "T-cell activation low · antibodies low · graft intact"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="296" height="394" rx="18"/>
<rect class="sc-node" x="322" y="44" width="624" height="394" rx="18"/>
<text class="sc-zone" x="34" y="68">DONOR GRAFT (KIDNEY)</text>
<text class="sc-zone" x="342" y="68">RECIPIENT LYMPH NODE</text>
<text class="sc-zone sc-dim" x="218" y="434">blood</text>
<g id="L0"></g><g id="Ldir"></g><g id="Lind"></g><g id="Lpart"></g><g id="Lover"></g><g id="Lpanel"></g>`;

buildScene({
  id: "graft-rejection", fig: "Fig 1", title: "Graft rejection: direct and indirect pathways", W, H, body,
  label: "An animated donor graft and a recipient lymph node. In the direct pathway a donor dendritic cell leaves the graft and shows donor MHC to a recipient T cell. In the indirect pathway a recipient antigen-presenting cell picks up shed donor proteins and shows pieces of them on its own MHC to a CD4 T cell, which also helps B cells make antibodies. Activated CD8 T cells attack graft cells, and antibodies and complement attack graft vessels. Gauges show T-cell activation, antibodies, graft damage and graft function. Immunosuppressant classes can be switched on and their targets are marked.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, levels or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "graft.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without immunosuppression", withLabel: "With immunosuppression",
  extraControls: `\n  <label class="dr-range"><span>Pathway shown</span><select id="path"><option value="0">both pathways</option><option value="1">direct only (donor cells present)</option><option value="2">indirect only (recipient cells present)</option></select></label>`,
  extraCss: `.sc-node{fill:var(--c-lymph);opacity:.1}.mhc-d{fill:var(--c-donor);stroke:color-mix(in srgb,var(--c-donor) 50%,#000);stroke-width:.5}.mhc-stem{stroke:var(--anatomy-mid);stroke-width:1}.mhc-r{fill:var(--c-mac)}.pep{fill:var(--c-donor)}
.sig{stroke:var(--c-cyt2);stroke-width:1.4;fill:none}.sig2{stroke:var(--c-no);stroke-width:1.4;fill:none;stroke-dasharray:3 3}.sig-t{fill:var(--anatomy-strong);font:700 10px var(--anatomy-mono);pointer-events:none}
.p-ab{fill:none;stroke:var(--c-ab);stroke-width:1.5;stroke-linecap:round}.p-comp{fill:none;stroke:var(--c-bad);stroke-width:1.2}.p-perf{fill:var(--c-bad)}.p-shed{fill:var(--c-donor)}.p-il2{--cc:var(--c-cyt2)}
.cl-graft .cl-b{fill:color-mix(in srgb,var(--cc) calc((1 - var(--dm,0)) * 100%),#4a4a4a)}.den{stroke:var(--c-donor);stroke-width:1.3;stroke-linecap:round;fill:none}
.blk-c{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:2}.blk-l{stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}.blk-t{fill:var(--c-bad);font:700 9.5px var(--anatomy-mono);pointer-events:none}`,
  sourcesLis: [
    "<strong>How rejection starts.</strong> Recipient T cells recognise donor tissue by its HLA (MHC) molecules. In the <em>direct</em> pathway, donor dendritic cells carried in the graft travel to recipient lymph nodes and show intact donor MHC to recipient T cells. In the <em>indirect</em> pathway, recipient antigen-presenting cells take up shed donor proteins, process them and show donor peptides on recipient MHC, mainly to CD4 T cells, which help B cells make donor-specific antibodies. T-cell activation needs signal 1 (the T-cell receptor meeting MHC with peptide), signal 2 (costimulation, CD28 on the T cell with B7 on the antigen-presenting cell) and signal 3 (cytokines such as IL-2 driving division). Activated CD8 T cells kill graft cells; antibodies and complement injure graft vessels. This is standard teaching in immunology and transplant texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Drug targets shown.</strong> Calcineurin inhibitors stop IL-2 being made after signal 1. Antiproliferatives stop lymphocytes dividing. Costimulation blockers stop CD28 meeting B7. Anti-IL-2 receptor antibodies block the IL-2 receptor. Anti-thymocyte globulin removes T cells. Steroids dampen cytokine and macrophage activity. These are teaching toggles only.",
  ],
  simplified: "Memory and regulatory cells, the semi-direct pathway, hyperacute and chronic rejection, tolerance, infection and cancer risks of immunosuppression, drug levels and combinations used in practice, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
