/* Antibiotic resistance mechanisms as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/abxres.mjs [--print-model]
 * Static layout here; drug particles, pumps and the population animate in abxres.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Resistance level", a: [0, 1, 2], names: ["susceptible", "resistant by one mechanism", "multi-resistant"], ticks: ["susceptible", "one mechanism", "multi-resistant"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "beta-lactam" },
    { label: "beta-lactam plus beta-lactamase inhibitor" },
    { label: "different class (ribosome target)" },
  ],
  status: "Resistance: {level} · {drug} ·",
  drugNames: ["a beta-lactam", "a beta-lactam with inhibitor", "a different class"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const bla = a >= 1 ? 1 : 0;
  const pbp = a >= 2 ? 1 : 0;
  const eff = a >= 2 ? 1 : 0;
  const por = a === 0 ? 0 : a === 1 ? 0.5 : 1;
  const ribo = a >= 2 ? 1 : 0;
  const blaEff = bla ? (drug === 0 ? 0.85 : drug === 1 ? 0.08 : 0) : 0;
  const pbpEff = pbp && drug !== 2 ? 0.7 : 0;
  const effEff = eff ? (drug === 2 ? 0.25 : 0.5) : 0;
  const porEff = por * (drug === 2 ? 0.2 : 0.45);
  const riboEff = ribo && drug === 2 ? 0.42 : 0;
  const Reach = cl((1 - porEff) * (1 - blaEff) * (1 - pbpEff) * (1 - effEff) * (1 - riboEff));
  const Kill = cl(Reach * 0.95);
  const Surv = cl(1 - Kill);
  const Barrier = cl(Math.max(porEff, blaEff, effEff, pbpEff, riboEff));
  const Spread = cl(0.08 + 0.55 * Surv * (a >= 1 ? 1 : 0.25) + (a >= 2 ? 0.25 : a === 1 ? 0.1 : 0) * Surv);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Surv, 0.35, 0.7, ["killed", "surviving", "thriving"]), w(Reach, 0.25, 0.6, ["blocked", "partly reaching", "reaching"]), w(Spread, 0.25, 0.55, ["low", "moderate", "high"])];
  return { a, bla, pbp, eff, por, ribo, Reach, Kill, Surv, Barrier, Spread, words, readout: "bacteria " + words[0] + " · drug " + words[1] + " target · spread " + words[2] };
}
const TESTS = [
  [1, 0, "bacteria thriving · drug blocked target · spread high"],
  [1, 1, "bacteria killed · drug reaching target · spread moderate"],
  [2, 0, "bacteria thriving · drug blocked target · spread high"],
  [2, 2, "bacteria surviving · drug partly reaching target · spread high"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ONE BACTERIAL CELL</text>
<text class="sc-zone sc-dim" x="640" y="68">POPULATION</text>
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.abx-cap{fill:var(--anatomy-strong);font-size:13px}
.abx-damage{fill:var(--c-bad);stroke:none}
.abx-crack{fill:none;stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.abx-capd{fill:#3ddc97;stroke:color-mix(in srgb,#3ddc97 55%,#000);stroke-width:.6}
.abx-bound{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 55%,#000);stroke-width:.6}
.abx-dock{fill:#7fd3ff;stroke:color-mix(in srgb,#7fd3ff 55%,#000);stroke-width:.6}
.abx-chain{fill:#e8d36a;stroke:color-mix(in srgb,#e8d36a 55%,#000);stroke-width:.5}
.abx-spark{--cc:#ffb020}
.enzyme{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 55%,#000);stroke-width:.8}
.porin{fill:var(--anatomy-card);stroke:var(--c-fl);stroke-width:1.4}
.porin-in{fill:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper))}
.pump-b{fill:#c978c9;stroke:color-mix(in srgb,#c978c9 55%,#000);stroke-width:.9}
.pump-in{fill:color-mix(in srgb,#c978c9 45%,#fff);opacity:.6}
.pbp{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.8}
.pbp-alt{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.ribo{fill:#e8d36a;stroke:color-mix(in srgb,#e8d36a 55%,#000);stroke-width:.8}
.ribo-alt{fill:none;stroke:var(--c-bad);stroke-width:2}
.plasmid{fill:none;stroke:#ff5e8a;stroke-width:1.8}
.chrom{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;opacity:.8}
.p-bl{--cc:#ff9a3d}.p-inh{--cc:#3ddc97}.p-alt{--cc:#7fd3ff}.p-plas{--cc:#ff5e8a}
.mem{fill:color-mix(in srgb,var(--c-bac) 28%,var(--anatomy-paper));stroke:var(--c-bac);stroke-width:2}
.mem-in{fill:none;stroke:color-mix(in srgb,var(--c-bac) 60%,#000);stroke-width:1;opacity:.6}
`;

buildScene({
  id: "antibiotic-resistance-mechanisms", fig: "Fig 1", title: "Antibiotic resistance: how bacteria survive", W, H, body, extraCss,
  label: "An animated bacterial cell and population. A beta-lactam drug approaches the cell, may be destroyed by beta-lactamase, blocked by fewer porins, pumped out by an efflux pump, or fail to bind an altered target. A different class acts on the ribosome, which may also be modified. Resistant cells survive under selection pressure and share a resistance plasmid by conjugation. Gauges show bacterial survival, drug reaching its target, barrier activity and spread.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "abxres.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without effective treatment", withLabel: "With effective treatment",
  sourcesLis: [
    "<strong>How resistance works.</strong> Bacteria resist antibiotics by destroying the drug (beta-lactamase breaks the beta-lactam ring), changing the target (altered penicillin-binding protein PBP2a in MRSA, or a modified ribosome binding site), pumping the drug out (efflux pumps), or letting less drug in (fewer or altered porin channels). Resistance genes often sit on plasmids and can pass between bacteria by conjugation. Under antibiotic selection pressure, susceptible bacteria die and resistant ones multiply and spread. This is standard teaching in microbiology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A beta-lactamase inhibitor protects a beta-lactam from the enzyme but does not fix an altered target, efflux or a closed porin. A drug from a different class bypasses beta-lactam defences but can still be reduced by efflux or by modification of its own target. These are teaching toggles only.",
  ],
  simplified: "Gene mutation and regulation, every enzyme and pump family, biofilms, persisters, tolerance, resistance in viruses and fungi, infection control, stewardship, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
