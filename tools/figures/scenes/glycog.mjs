/* Glucose homeostasis: glycogen synthesis, glycolysis, glycogenolysis and gluconeogenesis (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/glycog.mjs [--print-model]
 * Static layout here; substrates, enzymes and gauges move in glycog.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Feeding state", a: [0, 1, 2, 3], names: ["fed", "early fast", "prolonged fast", "glycogen storage defect"], ticks: ["fed", "early fast", "prolonged fast", "storage defect"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "frequent feeds" },
    { label: "glucagon" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "frequent feeds", "glucagon"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const def = t === 3 ? 1 : 0, feed = drug === 1 ? 1 : 0, gtx = drug === 2 ? 1 : 0;
  const ins = cl([0.9, 0.3, 0.18, 0.22][t] + feed * 0.3);
  const gcg = cl([0.12, 0.75, 0.9, 0.8][t] + gtx * 0.35 - feed * 0.25);
  const meal = t === 0 ? 1 : 0;
  const fasting = [0.08, 0.5, 1, 0.85][t];
  const store = cl([0.78, 0.55, 0.12, 0.95][t] + feed * 0.04 - gtx * 0.05);
  const g6pase = def ? 0.06 : 1;
  const pepck = cl(0.1 + fasting * 0.85);
  const syn = cl(ins * (0.35 + 0.65 * meal + feed * 0.3) * (def ? 0.4 : 1));
  const gly = cl(ins * 0.85 + meal * 0.08);
  const lys = cl(gcg * (0.3 + store) * (meal ? 0.2 : 1));
  const gng = cl(fasting * (0.25 + 0.75 * gcg) * (0.45 + 0.55 * pepck) + gtx * fasting * 0.12);
  const out = cl((lys * 0.55 + gng * 0.6) * g6pase);
  const BG = cl(0.3 + meal * 0.28 + out * 0.5 + feed * 0.48 - def * 0.18);
  const la = cl(0.18 + def * (lys + gng) * 0.32 + gly * 0.06 - gng * 0.06);
  const g6p = cl((lys + gng) * (def ? 0.85 : 0.25) + syn * 0.15);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const glucoseWord = w(BG, 0.45, 0.72, ["low", "maintained", "high"]);
  const storeWord = w(store, 0.25, 0.7, ["empty", "partly full", "full"]);
  const outWord = def ? "blocked" : w(out, 0.22, 0.55, ["low", "active", "high"]);
  const lactateWord = w(la, 0.35, 0.6, ["normal", "raised", "high"]);
  const words = [glucoseWord, storeWord, outWord, lactateWord];
  return { t, def, feed, gtx, ins, gcg, meal, fasting, store, g6pase, pepck, syn, gly, lys, gng, out, BG, la, g6p, words, readout: "blood glucose " + words[0] + " · glycogen " + words[1] + " · liver glucose output " + words[2] + " · lactate " + words[3] };
}
const TESTS = [
  [0, 0, "blood glucose maintained · glycogen full · liver glucose output low · lactate normal"],
  [2, 0, "blood glucose maintained · glycogen empty · liver glucose output high · lactate normal"],
  [3, 0, "blood glucose low · glycogen full · liver glucose output blocked · lactate high"],
  [3, 1, "blood glucose maintained · glycogen full · liver glucose output blocked · lactate raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="gly-hep" x="235" y="52" width="510" height="308" rx="22"/>
<rect class="gly-mito" x="455" y="240" width="240" height="95" rx="38"/>
<rect id="lumen" class="sc-lumen" x="14" y="372" width="${W - 28}" height="48"/>
<text class="sc-zone" x="255" y="74">LIVER CELL</text>
<text class="sc-zone sc-dim" x="32" y="398">BLOOD</text>
<text class="sc-lab" x="258" y="336">CYTOSOL</text>
<text class="sc-lab" x="472" y="324">MITOCHONDRION</text>
<text class="sc-lab" x="375" y="142" text-anchor="middle">glucokinase</text>
<text class="sc-lab" x="592" y="148" text-anchor="middle">builds glycogen</text>
<text class="sc-lab" x="592" y="180" text-anchor="middle">breaks glycogen</text>
<text class="sc-lab" x="390" y="252" text-anchor="middle">glycolysis</text>
<g id="sources"></g><g id="hep"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.gly-hep{fill:color-mix(in srgb,var(--c-liver,#b8645a) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-liver,#b8645a) 65%,#000);stroke-width:1.4}
.gly-mito{fill:color-mix(in srgb,#e9a13b 18%,var(--anatomy-paper));stroke:#c47b1e;stroke-width:1.4}
.gly-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.gly-enz{fill:#ffd24a;stroke:color-mix(in srgb,#ffd24a 55%,#000);stroke-width:.8}
.gly-gran{fill:#e8b64a;stroke:color-mix(in srgb,#e8b64a 55%,#000);stroke-width:.7}
.gly-block{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.gly-tissue{fill:color-mix(in srgb,var(--c-lymph) 25%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.3}
.gly-stri{fill:none;stroke:#7fb6d9;stroke-width:.8;opacity:.5}
.cl-src{--cc:#b7a1e6}.cl-fat2{--cc:#f3e1a0}
.p-gluc{--cc:#f2b23a}.p-lac{--cc:#b27af0}.p-aa{--cc:#38b6c9}.p-gly{--cc:#f08a4b}.p-g6p{--cc:#ee6a4a}.p-ins{--cc:#2fc2a3}.p-gcg{--cc:#f07a7a}
.dr-g-fill.g-gluc{fill:#f2b23a}.dr-g-fill.g-store{fill:#e8b64a}.dr-g-fill.g-gly{fill:#2fc2a3}.dr-g-fill.g-gng{fill:#38b6c9}.dr-g-fill.g-lac{fill:#b27af0}
`;

buildScene({
  id: "gluconeogenesis-glycogen", fig: "Fig 1", title: "Glucose homeostasis: glycogen and gluconeogenesis", W, H, body, extraCss,
  label: "An animated liver cell in fed and fasting states. In the fed state insulin drives glucose into glycogen and through glycolysis. In an early fast glycogen breaks down to glucose. In a prolonged fast the liver makes new glucose from lactate, amino acids and glycerol through PEPCK and glucose-6-phosphatase. In a glycogen storage defect the last step is blocked, glucose-6-phosphate builds up and is diverted to lactate. Gauges show blood glucose, the glycogen store, glycolysis, gluconeogenesis and lactate. Treatment choices are frequent feeds and glucagon.",
  caption: "Schematic, not to scale. Particle speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "glycog.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Fed and fasting glucose control.</strong> After a meal, insulin promotes glucose uptake and glycogen synthesis (glycogenesis) in liver and muscle and promotes glycolysis, while suppressing glycogen breakdown and new glucose production. As fasting begins, falling insulin and rising glucagon activate glycogen breakdown (glycogenolysis); glucose-6-phosphate is converted to free glucose by glucose-6-phosphatase in the liver and released into blood. With prolonged fasting glycogen runs out and gluconeogenesis takes over, making glucose from lactate, glucogenic amino acids and glycerol. Phosphoenolpyruvate carboxykinase (PEPCK) is a key regulated step, and glucose-6-phosphatase is the shared final step for both glycogenolysis and gluconeogenesis. This is standard teaching in biochemistry and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The storage defect and treatments shown.</strong> In glucose-6-phosphatase deficiency (von Gierke disease, glycogen storage disease type I), glycogenolysis and gluconeogenesis cannot release free glucose, so fasting hypoglycaemia occurs with glycogen accumulation and diversion of glucose-6-phosphate to lactate. Frequent feeds supply glucose from outside and so bypass the blocked step; glucagon cannot help when the final step is blocked or when glycogen is exhausted. These are teaching toggles only and show direction of effect, not how any person should be treated.",
  ],
  simplified: "Muscle glycogen (which cannot release free glucose), the kidney contribution in very prolonged fasting, fatty-acid oxidation and ketones as alternative fuels, individual transport steps, and hormonal detail beyond insulin and glucagon are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
