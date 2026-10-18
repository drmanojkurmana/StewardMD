/* Electron transport chain and oxidative phosphorylation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/etc.mjs [--print-model]
 * Static layout here; electrons, protons, oxygen, water, ATP and gauges move in etc.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "State of the chain", a: [0, 1, 2], names: ["normal", "inhibitor", "uncoupler"], ticks: ["normal", "inhibitor", "uncoupler"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "antidote (removes the inhibitor or uncoupler)" },
    { label: "supportive oxygen" },
  ],
  status: "Chain: {level} · {drug} ·",
  drugNames: ["no treatment", "an antidote", "supportive oxygen"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  let E = [0.78, 0.12, 0.92][t], G = [0.78, 0.1, 0.12][t], A = [0.82, 0.08, 0.1][t], O = [0.75, 0.12, 0.9][t], Heat = [0.16, 0.08, 0.88][t];
  let inh = t === 1 ? 0.9 : 0, unc = t === 2 ? 0.9 : 0;
  const ant = drug === 1 && t !== 0 ? 1 : 0;
  if (ant && t === 1) { const k = 0.88; E = E + (0.78 - E) * k; G = G + (0.78 - G) * k; A = A + (0.82 - A) * k; O = O + (0.75 - O) * k; Heat = Heat + (0.16 - Heat) * k; inh = inh * 0.12; }
  if (ant && t === 2) { const k = 0.82; E = E + (0.78 - E) * k; G = G + (0.78 - G) * k; A = A + (0.82 - A) * k; O = O + (0.75 - O) * k; Heat = Heat + (0.16 - Heat) * k; unc = unc * 0.18; }
  const oxy = drug === 2 ? 1 : 0;
  if (oxy) { E = cl(E + 0.06); O = cl(O + 0.2); A = cl(A + (t === 0 ? 0.06 : t === 1 ? 0.03 : 0.01)); Heat = cl(Heat + (t === 2 ? 0.08 : 0.02)); }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(E, 0.3, 0.6, ["low", "moderate", "high"]), w(G, 0.3, 0.6, ["low", "moderate", "high"]), w(A, 0.3, 0.6, ["low", "moderate", "high"]), w(O, 0.3, 0.6, ["low", "moderate", "high"])];
  return { t, drug, E, G, A, O, Heat, inh, unc, oxy: drug === 2 ? 1 : 0.35, ant, words, readout: "electron flow " + words[0] + " · proton gradient " + words[1] + " · ATP production " + words[2] + " · oxygen use " + words[3] };
}
const TESTS = [
  [0, 0, "electron flow high · proton gradient high · ATP production high · oxygen use high"],
  [1, 0, "electron flow low · proton gradient low · ATP production low · oxygen use low"],
  [2, 0, "electron flow high · proton gradient low · ATP production low · oxygen use high"],
  [1, 1, "electron flow high · proton gradient high · ATP production high · oxygen use high"],
  [2, 2, "electron flow high · proton gradient low · ATP production low · oxygen use high"],
];

/* ---------------- static layout ---------------- */
const CX = [230, 370, 510, 650];
const complexes = CX.map((x, i) => `<g id="etcCx${i + 1}"><rect class="etc-cx etc-c${i + 1}" x="${x - 38}" y="212" width="76" height="56" rx="14"/><circle class="etc-sub" cx="${x - 14}" cy="232" r="8"/><circle class="etc-sub" cx="${x + 13}" cy="248" r="9"/><circle class="etc-sub" cx="${x + 16}" cy="228" r="5"/></g>`).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone sc-dim" x="30" y="68">CYTOSOL</text>
<rect class="etc-mito" x="130" y="62" width="700" height="352" rx="48"/>
<path class="etc-o2path" d="M900 150 Q830 170 690 198"/>
<path class="etc-atppath" d="M782 300 Q840 322 902 344"/>
<text class="sc-zone" x="150" y="88">MITOCHONDRION</text>
<text class="sc-zone" x="590" y="88">INTERMEMBRANE SPACE</text>
<text class="sc-zone" x="150" y="410">MATRIX</text>
<path class="etc-memb" d="M150 240 L210 232 L270 248 L330 232 L390 248 L450 232 L510 248 L570 232 L630 248 L690 232 L750 248 L810 240"/>
${complexes}
<g id="etcSynth"><rect class="etc-chan" x="746" y="212" width="28" height="56" rx="8"/><circle class="etc-head" cx="760" cy="284" r="20"/><g id="etcRotor"><path class="etc-spoke" d="M760 284 L760 268 M760 284 L774 292 M760 284 L746 292"/></g><circle class="etc-hub" cx="760" cy="284" r="4"/></g>
<g id="etcRes"></g><g id="etcUnc"></g><g id="etcParts"></g><g id="etcOver"></g><g id="etcPanel"></g>`;

const extraCss = `
body{--etc1:#e9a2b3;--etc2:#7fc4e8;--etc3:#b7a1e6;--etc4:#7fcf6a;--etc-memb:#c98a5e;--etc-prot:#7ab8ff;--etc-elec:#ffd24a;--etc-atp:#3ddc97;--etc-o2:#7fd3ff;--etc-heat:#ff7a45}
body[data-theme="light"]{--etc1:#d9788f;--etc2:#3fa0d4;--etc3:#8f72d0;--etc4:#4fa63c;--etc-memb:#b06f3e;--etc-prot:#2f7ad8;--etc-elec:#c9a010;--etc-atp:#0f9f76;--etc-o2:#0a7fd1;--etc-heat:#e06a25}
.etc-mito{fill:color-mix(in srgb,var(--etc3) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.etc-memb{fill:none;stroke:var(--etc-memb);stroke-width:24;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
.etc-cx{stroke:color-mix(in srgb,var(--cc) 50%,#000);stroke-width:1}
.etc-c1{--cc:var(--etc1);fill:var(--etc1)}.etc-c2{--cc:var(--etc2);fill:var(--etc2)}.etc-c3{--cc:var(--etc3);fill:var(--etc3)}.etc-c4{--cc:var(--etc4);fill:var(--etc4)}
.etc-sub{fill:color-mix(in srgb,var(--anatomy-paper) 35%,transparent);stroke:none;opacity:.5}
.etc-chan{fill:var(--etc-atp);stroke:color-mix(in srgb,var(--etc-atp) 50%,#000);stroke-width:1}
.etc-head{fill:color-mix(in srgb,var(--etc-atp) 65%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--etc-atp) 50%,#000);stroke-width:1}
.etc-spoke{stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.etc-hub{fill:var(--anatomy-strong)}
.etc-o2path,.etc-atppath{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;stroke-dasharray:3 4;opacity:.6}
.p-elec{fill:var(--etc-elec);stroke:color-mix(in srgb,var(--etc-elec) 50%,#000);stroke-width:.5}
.p-nadh{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.p-fadh{fill:#ff5e8a;stroke:color-mix(in srgb,#ff5e8a 50%,#000);stroke-width:.5}
.p-prot{fill:var(--etc-prot);stroke:color-mix(in srgb,var(--etc-prot) 50%,#000);stroke-width:.5}
.p-atpp{fill:var(--etc-atp);stroke:color-mix(in srgb,var(--etc-atp) 50%,#000);stroke-width:.5}
.p-o2p{fill:var(--etc-o2);stroke:color-mix(in srgb,var(--etc-o2) 50%,#000);stroke-width:.5}
.p-water{fill:var(--etc-o2)}
.p-heatp{fill:none;stroke:var(--etc-heat);stroke-width:1.4;stroke-linecap:round}
.p-ant{fill:var(--etc-atp);stroke:color-mix(in srgb,var(--etc-atp) 50%,#000);stroke-width:.5}
.etc-uncdot{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.6}
.etc-blk-c{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.8}
.etc-blk-l{stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.dr-g-fill.g-oxy{fill:var(--etc-o2)}.dr-g-fill.g-heat{fill:var(--etc-heat)}.dr-g-fill.g-atp{fill:var(--etc-atp)}.dr-g-fill.g-elec{fill:var(--etc-elec)}
`;

buildScene({
  id: "electron-transport-chain", fig: "Fig 1", title: "Electron transport chain: protons to ATP", W, H, body, extraCss,
  label: "An animated mitochondrion cut across its inner membrane. In the matrix, NADH donates electrons at complex I and FADH2 at complex II. Electrons flow through complexes III and IV to oxygen, which becomes water. Complexes I, III and IV pump protons into the intermembrane space. The proton gradient drives ATP synthase, which makes ATP that leaves for the cytosol. Inhibitors block complex I, complex IV and ATP synthase; an uncoupler leaks protons back and releases heat. Gauges show electron flow, proton gradient, ATP production, oxygen use and heat.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H, CX }, pageJs: readFileSync(join(HERE, "etc.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How the chain works.</strong> NADH donates electrons at complex I and FADH2 (from succinate dehydrogenase) at complex II. Electrons pass through complex III and complex IV, where oxygen is the final acceptor and is reduced to water. Complexes I, III and IV use the energy to pump protons from the matrix into the intermembrane space. The resulting proton gradient (chemiosmosis) drives protons back through ATP synthase, which makes ATP from ADP and phosphate. Rotenone blocks complex I, cyanide blocks complex IV, and oligomycin blocks ATP synthase; uncouplers carry protons back across the membrane so energy is released as heat instead of ATP. Supportive oxygen keeps the final acceptor supplied, and an antidote is shown as a conceptual removal of the blocking agent. This is standard teaching in biochemistry and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> An antidote that removes the inhibitor or uncoupler, and supportive oxygen. These are teaching toggles that show which step each idea acts on, not a recommendation for any patient or any specific drug.",
  ],
  simplified: "Mobile carriers (ubiquinone and cytochrome c), the Q cycle, proton counts per complex, ATP yield per donor, reactive oxygen species, brown fat and regulated uncoupling proteins, specific antidotes for each poison, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
