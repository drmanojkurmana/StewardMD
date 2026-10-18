/* Haem synthesis and porphyria as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/haemsyn.mjs [--print-model]
 * Static layout here; particles, block marks and gauges move in haemsyn.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Condition", a: [0.2, 0.85, 0.8], names: ["normal", "lead poisoning", "acute intermittent porphyria"], ticks: ["normal", "lead poisoning", "acute intermittent porphyria"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "chelation" },
    { label: "haem and glucose" },
    { label: "avoid triggers" },
  ],
  status: "Condition: {level} · {drug} ·",
  drugNames: ["no treatment", "chelation", "haem and glucose", "avoiding triggers"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  let D = [0.42, 0.78, 0.92][level];
  if (drug === 2) D *= 0.38;
  if (drug === 3) D *= level === 2 ? 0.58 : level === 1 ? 0.9 : 1;
  if (drug === 1 && level === 1) D *= 0.9;
  const dehyd = level === 1 ? (drug === 1 ? 0.86 : drug === 3 ? 0.38 : 0.27) : 1;
  const deam = level === 2 ? 0.33 : 1;
  const ferro = level === 1 ? (drug === 1 ? 0.86 : drug === 3 ? 0.4 : 0.3) : 1;
  const Fpg = D * dehyd;
  const Fpor = Fpg * deam;
  const Fhaem = Fpor * ferro;
  const ALA = cl(0.08 + D * 0.35 + (D - Fpg) * 0.9 + (Fpg - Fpor) * 0.35);
  const PBG = cl(0.07 + Fpg * 0.25 + (Fpg - Fpor) * 1.0);
  const Por = cl(0.07 + Fpor * 0.25 + (Fpor - Fhaem) * 1.0 + (level === 1 ? (1 - ferro) * 0.25 : 0));
  const Haem = cl(0.28 + Fhaem * 0.75 + (drug === 2 ? 0.28 : 0) + (level === 0 ? 0.25 : 0));
  const Sym = cl(ALA * 0.45 + PBG * 0.45 + (1 - Haem) * 0.25 - 0.18);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(ALA, 0.3, 0.6, ["low", "raised", "high"]), w(PBG, 0.3, 0.6, ["low", "raised", "high"]), w(Haem, 0.35, 0.65, ["low", "borderline", "normal"]), w(Sym, 0.2, 0.5, ["none", "present", "severe"])];
  return { D, dehyd, deam, ferro, Fpg, Fpor, Fhaem, ALA, PBG, Por, Haem, Sym, level, drug, words, readout: "ALA " + words[0] + " · PBG " + words[1] + " · haem " + words[2] + " · symptoms " + words[3] };
}
const TESTS = [
  [0, 0, "ALA low · PBG low · haem normal · symptoms none"],
  [1, 0, "ALA high · PBG low · haem low · symptoms present"],
  [2, 0, "ALA high · PBG high · haem borderline · symptoms severe"],
  [1, 1, "ALA raised · PBG low · haem normal · symptoms none"],
];

/* ---------------- static layout ---------------- */
const FY = 190;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="hs-mito" x="34" y="78" width="212" height="224" rx="26"/>
<rect class="hs-mito-in" x="46" y="90" width="188" height="200" rx="20"/>
<rect class="hs-mito" x="714" y="78" width="212" height="224" rx="26"/>
<rect class="hs-mito-in" x="726" y="90" width="188" height="200" rx="20"/>
<text class="sc-zone" x="50" y="68">MITOCHONDRION</text>
<text class="sc-zone" x="276" y="68">CYTOSOL</text>
<text class="sc-zone" x="730" y="68">MITOCHONDRION</text>
<text class="sc-lab hs-note" x="480" y="68" text-anchor="middle">same organelle, drawn twice</text>
<path class="hs-flow" d="M78 ${FY}H882"/>
<g id="nodes">
<circle class="hs-sub" cx="78" cy="${FY - 14}" r="9"/><circle class="hs-sub2" cx="94" cy="${FY + 10}" r="7"/>
<g id="enz1"><circle class="hs-enz" cx="150" cy="${FY}" r="23"/><circle class="hs-enz-in" cx="150" cy="${FY}" r="12"/></g>
<circle class="hs-ala" cx="255" cy="${FY}" r="11"/>
<g id="enz2"><circle class="hs-enz" cx="350" cy="${FY}" r="23"/><circle class="hs-enz-in" cx="350" cy="${FY}" r="12"/></g>
<circle class="hs-pbg" cx="440" cy="${FY}" r="11"/>
<g id="enz3"><circle class="hs-enz" cx="525" cy="${FY}" r="23"/><circle class="hs-enz-in" cx="525" cy="${FY}" r="12"/></g>
<circle class="hs-por" cx="615" cy="${FY}" r="11"/><circle class="hs-por" cx="648" cy="${FY - 12}" r="7"/><circle class="hs-por" cx="648" cy="${FY + 12}" r="7"/>
<circle class="hs-iron" cx="762" cy="148" r="9"/><path class="hs-flow" d="M762 157L798 178"/>
<g id="enz4"><circle class="hs-enz" cx="815" cy="${FY}" r="23"/><circle class="hs-enz-in" cx="815" cy="${FY}" r="12"/></g>
<circle class="hs-haem" cx="882" cy="${FY}" r="16"/><circle class="hs-haem-in" cx="882" cy="${FY}" r="7"/>
</g>
<path class="hs-feedback" d="M882 214C882 414 150 414 150 216"/>
<g id="patientG">
<rect class="hs-patient" x="648" y="342" width="278" height="84" rx="14"/>
<circle class="hs-head" cx="682" cy="372" r="11"/><path class="hs-body" d="M682 383L682 404M682 390L668 398M682 390L696 396M682 404L672 420M682 404L692 420"/>
<text class="sc-lab hs-sym" x="712" y="372">Abdominal pain</text>
<text class="sc-lab hs-sym" x="712" y="396">Nerve pain and weakness</text>
<circle id="symDot1" class="hs-sym-dot" cx="704" cy="368" r="3.4"/><circle id="symDot2" class="hs-sym-dot" cx="704" cy="392" r="3.4"/>
</g>
<g id="parts"></g><g id="blocks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.hs-mito{fill:color-mix(in srgb,#e9a23b 20%,var(--anatomy-paper));stroke:#c47b1e;stroke-width:1.2}
.hs-mito-in{fill:none;stroke:color-mix(in srgb,#e9a23b 55%,var(--anatomy-mid));stroke-width:1;stroke-dasharray:5 4;opacity:.8}
.hs-note{opacity:.6;font-size:9.5px}
.hs-flow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:2 5;stroke-linecap:round;opacity:.7}
.hs-feedback{fill:none;stroke:var(--c-bad);stroke-width:1.2;stroke-dasharray:6 5;opacity:.45}
.hs-sub{fill:#b9c4cc;stroke:#6d7b85;stroke-width:1}.hs-sub2{fill:#8fa8b8;stroke:#5d7484;stroke-width:1}
.hs-enz{fill:color-mix(in srgb,var(--c-good) 42%,var(--anatomy-paper));stroke:var(--c-good);stroke-width:1.6}
.hs-enz-in{fill:color-mix(in srgb,var(--c-good) 30%,var(--anatomy-paper));stroke:none}
.hs-ala{fill:#ff9a3d;stroke:#b95f14;stroke-width:1}.hs-pbg{fill:#b07fe8;stroke:#7440b0;stroke-width:1}
.hs-por{fill:#e87fa8;stroke:#b04070;stroke-width:1}.hs-iron{fill:#c7ccd1;stroke:#7d868e;stroke-width:1.2}
.hs-haem{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.2}.hs-haem-in{fill:#5e1220;stroke:none}
.hs-patient{fill:color-mix(in srgb,var(--anatomy-paper) 82%,var(--c-bad));stroke:var(--anatomy-mid);stroke-width:1}
.hs-head{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6}.hs-body{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linecap:round}
.hs-sym{font-size:10.5px}.hs-sym-dot{fill:var(--c-bad)}
.hs-block{fill:none;stroke:var(--c-bad);stroke-width:3.2;stroke-linecap:round}
.hs-lead{fill:#3d4450;stroke:#14181f;stroke-width:.8}
.p-sub{--cc:#9db4c2}.p-ala{--cc:#ff9a3d}.p-pbg{--cc:#b07fe8}.p-por{--cc:#e87fa8}.p-haem{--cc:var(--c-rbc)}.p-lead{--cc:#3d4450}.p-treat{--cc:var(--c-good)}
.dr-g-fill.g-ala{fill:#e07f22}.dr-g-fill.g-pbg{fill:#8b5fd6}.dr-g-fill.g-por{fill:#d65f92}.dr-g-fill.g-haemg{fill:var(--c-good)}.dr-g-fill.g-sym{fill:var(--c-bad)}
`;

buildScene({
  id: "haem-synthesis-porphyria", fig: "Fig 1", title: "Haem synthesis and porphyria", W, H, body, extraCss,
  label: "An animated haem synthesis pathway drawn across a mitochondrion, the cytosol and the mitochondrion again. Glycine and succinyl-CoA make ALA by ALA synthase. ALA dehydratase makes porphobilinogen, PBG deaminase and later steps make porphyrin intermediates, and ferrochelatase inserts iron to make haem. Lead blocks ALA dehydratase and ferrochelatase. In acute intermittent porphyria PBG deaminase is faulty, ALA and PBG build up and cause abdominal pain and neuropathy. Gauges show ALA, PBG, porphyrins, haem and symptoms. Treatments are chelation, haem and glucose, and avoiding triggers.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { FY, W, H }, pageJs: readFileSync(join(HERE, "haemsyn.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How haem is made.</strong> The first step is in the mitochondrion: glycine and succinyl-CoA are joined by ALA synthase to make aminolaevulinic acid (ALA). In the cytosol, ALA dehydratase joins ALA molecules to make porphobilinogen (PBG), and PBG deaminase plus later cytosol steps build porphyrin intermediates. Back in the mitochondrion the last steps run, and ferrochelatase inserts iron into protoporphyrin to make haem. Haem feeds back to restrain ALA synthase. This is standard teaching in biochemistry and haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Lead and acute intermittent porphyria.</strong> Lead inhibits ALA dehydratase and ferrochelatase, so ALA and porphyrin intermediates build up while haem falls. Acute intermittent porphyria is a partial defect of PBG deaminase; when ALA synthase is driven up, ALA and PBG build up ahead of the faulty step and attacks bring abdominal pain and neuropathy. Chelation removes lead, haem and glucose restrain ALA synthase, and avoiding triggers reduces attacks. These are teaching toggles only.",
  ],
  simplified: "The named porphyrin intermediates between PBG and protoporphyrin, other porphyrias and their skin features, erythropoietic versus hepatic detail, zinc protoporphyrin, blood lead testing, attack precipitants in detail, and all doses and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
