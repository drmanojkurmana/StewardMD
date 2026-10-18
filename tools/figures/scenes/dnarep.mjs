/* DNA replication and repair as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/dnarep.mjs [--print-model]
 * Static layout here; fork enzymes, nucleotide flow, damage and repair move in dnarep.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "DNA state", a: [0, 1, 2], names: ["normal", "UV damage", "repair defect"], ticks: ["normal", "UV damage", "repair defect"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "sunscreen and avoidance" },
    { label: "PARP inhibitor concept" },
  ],
  status: "DNA state: {level} · {drug} ·",
  drugNames: ["no intervention", "sunscreen and avoidance", "a PARP inhibitor concept"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const baseD = [0.14, 0.78, 0.46][level];
  const defect = level === 2 ? 1 : 0;
  const prevent = drug === 1 && level === 1 ? 0.8 : drug === 1 ? 0.08 : 0;
  const D = cl(baseD * (1 - prevent));
  const cap0 = defect ? 0.22 : 0.9;
  const parp = drug === 2 ? 1 : 0;
  const cap = cl(cap0 * (parp ? (defect ? 0.45 : 0.78) : 1));
  const unrep = cl(D * (1 - cap) + (parp && defect ? 0.22 : 0));
  const R = cl(0.94 - 0.38 * D - 0.42 * unrep);
  const M = cl(unrep * 1.5 + (defect ? 0.06 : 0));
  const kill = cl(parp && defect ? 0.8 : parp ? 0.12 : unrep * 0.2);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(R, 0.45, 0.75, ["stalled", "slowed", "steady"]), w(D, 0.3, 0.6, ["low", "raised", "high"]), w(M, 0.25, 0.55, ["rare", "some", "frequent"])];
  return { D, cap, unrep, R, M, kill, parp, defect, sun: drug === 1 ? 1 : 0, lvl: level, words, readout: "replication " + words[0] + " · damage " + words[1] + " · mutations " + words[2] };
}
const TESTS = [
  [0, 0, "replication steady · damage low · mutations rare"],
  [1, 0, "replication slowed · damage high · mutations rare"],
  [1, 1, "replication steady · damage low · mutations rare"],
  [2, 0, "replication slowed · damage raised · mutations frequent"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="212" rx="18"/>
<rect class="sc-tissue dn-dmgzone" x="14" y="268" width="${W - 28}" height="172" rx="18"/>
<text class="sc-zone" x="34" y="68">REPLICATION FORK</text>
<text class="sc-zone" x="34" y="292">DAMAGE AND REPAIR</text>
<g id="fork"></g>
<g id="dmgzone"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.dn-dmgzone{opacity:.38}
.dn-parent{fill:none;stroke:var(--anatomy-strong);stroke-width:3;stroke-linecap:round;opacity:.85}
.dn-rung{stroke:var(--anatomy-mid);stroke-width:1.2;opacity:.6}
.dn-temp{fill:none;stroke:var(--anatomy-mid);stroke-width:2.4;stroke-linecap:round}
.dn-lead{fill:none;stroke:var(--c-good);stroke-width:3.4;stroke-linecap:round}
.dn-lag{fill:none;stroke:var(--c-cyt2);stroke-width:3.4;stroke-linecap:round}
.dn-primer{fill:none;stroke:var(--c-bad);stroke-width:4;stroke-linecap:round}
.dn-dna2{fill:none;stroke:var(--anatomy-strong);stroke-width:2.6;stroke-linecap:round;opacity:.85}
.dn-sister{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-dasharray:5 4;opacity:.7}
.cl-heli{--cc:#e9b84a}.cl-pol{--cc:#5fa8d3}.cl-prim{--cc:#f08a4b}.cl-lig{--cc:#3ddc97}.cl-rep{--cc:#b7a1e6}
.p-nuc{--cc:#ffd24a}.p-uv{--cc:#ffe95e}.p-fix{--cc:#3ddc97}.p-mut{--cc:var(--c-bad)}
.dn-dimer{fill:#ffe95e;stroke:color-mix(in srgb,#ffe95e 50%,#000);stroke-width:.7}
.dn-mis{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 50%,#000);stroke-width:.7}
.dn-sun{fill:#ffe95e;stroke:#d9a92c;stroke-width:1}
.dn-shield{fill:none;stroke:var(--c-good);stroke-width:2.4;stroke-linecap:round}
.dr-g-fill.g-rep{fill:var(--c-good)}.dr-g-fill.g-dmg{fill:#ffe95e}.dr-g-fill.g-mut{fill:var(--c-bad)}.dr-g-fill.g-kill{fill:#c084fc}
`;

buildScene({
  id: "dna-replication-repair", fig: "Fig 1", title: "DNA replication and repair", W, H, body, extraCss,
  label: "An animated replication fork and a damaged DNA segment. At the fork helicase unwinds the parental strands, primase lays primers, DNA polymerase builds a continuous leading strand and a lagging strand in Okazaki pieces joined by ligase, and proofreading removes errors. Below, ultraviolet light makes thymine dimers, copying can leave a mismatch, and a double strand break severs the DNA. Nucleotide excision repair, mismatch repair and homologous recombination fix each lesion. Gauges show replication, damage, repair, mutations and loss of defective cells. The level slider sets normal DNA, UV damage or an inherited repair defect, and the treatment choices show sunscreen and avoidance and the PARP inhibitor concept.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "dnarep.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without intervention", withLabel: "With intervention",
  sourcesLis: [
    "<strong>Replication.</strong> Helicase unwinds the double helix at the fork. Primase makes a short RNA primer. DNA polymerase extends from the primer, building the leading strand continuously toward the fork and the lagging strand in short Okazaki pieces away from the fork; DNA ligase seals the pieces. Polymerase proofreading (its exonuclease activity) removes most copying errors. This is standard teaching in molecular biology and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Damage and repair.</strong> Ultraviolet light joins neighbouring thymines into a thymine dimer, fixed by nucleotide excision repair; failure causes xeroderma pigmentosum. A base mismatch left by copying is fixed by mismatch repair; failure causes Lynch syndrome. A double strand break is fixed accurately by homologous recombination using the sister chromatid; failure of BRCA1 or BRCA2 pushes the cell toward error prone repair and cancer. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Interventions shown.</strong> Sunscreen and avoidance cut the ultraviolet damage reaching DNA. The PARP inhibitor idea: blocking PARP leaves single strand breaks unrepaired, which become double strand breaks at the fork; cells lacking homologous recombination (BRCA defect) cannot cope and are lost, while normal cells can. These are teaching toggles only.",
  ],
  simplified: "Single strand binding proteins, topoisomerase, sliding clamps, telomeres, base excision repair, non homologous end joining detail, checkpoint signalling and every enzyme name and step inside each repair pathway are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
