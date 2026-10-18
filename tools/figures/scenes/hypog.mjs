/* Hypoglycaemia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hypog.mjs [--print-model]
 * Static layout here; organs, glucose, hormones, symptoms and gauges move in hypog.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Severity of low blood sugar", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "oral glucose" },
    { label: "intravenous glucose" },
    { label: "glucagon" },
  ],
  status: "Low blood sugar: {level} · {drug} ·",
  drugNames: ["no treatment", "oral glucose", "intravenous glucose", "glucagon"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const oral = drug === 1 ? 1 : 0, iv = drug === 2 ? 1 : 0, gluc = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const boost = oral ? (a > 0.9 ? 0.2 : 0.5) : iv ? 0.85 : gluc ? 0.6 : 0;
  const G = cl(0.92 - 0.82 * a + boost);
  const B = G;
  const CR = cl(0.15 + 0.85 * a - 0.55 * boost);
  const L = cl(0.2 + 0.45 * CR + (gluc ? 0.35 : 0) - 0.25 * a);
  const Adr = cl(0.15 + 0.8 * a - 0.5 * boost);
  const Neuro = cl(0.95 - 1.05 * B);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(G, 0.4, 0.7, ["low", "borderline", "restored"]), w(B, 0.4, 0.7, ["starved", "short", "supplied"]), w(Adr, 0.3, 0.6, ["mild", "clear", "strong"]), w(Neuro, 0.35, 0.65, ["none", "some", "marked"])];
  return { a, oral, iv, gluc, boost, G, B, CR, L, Adr, Neuro, words, readout: "blood glucose " + words[0] + " · brain supply " + words[1] + " · warning symptoms " + words[2] + " · brain symptoms " + words[3] };
}
const TESTS = [
  [1, 0, "blood glucose low · brain supply starved · warning symptoms strong · brain symptoms some"],
  [1, 1, "blood glucose restored · brain supply supplied · warning symptoms clear · brain symptoms none"],
  [1, 2, "blood glucose restored · brain supply supplied · warning symptoms mild · brain symptoms none"],
  [1, 3, "blood glucose restored · brain supply supplied · warning symptoms clear · brain symptoms none"],
  [2, 1, "blood glucose low · brain supply starved · warning symptoms strong · brain symptoms some"],
];

/* ---------------- static layout ---------------- */
const CY = 285;
const body = `
<rect class="sc-tissue" x="14" y="44" width="280" height="200" rx="16"/>
<rect class="sc-tissue" x="306" y="44" width="300" height="200" rx="16"/>
<rect class="sc-tissue" x="618" y="44" width="328" height="200" rx="16"/>
<text class="sc-zone" x="32" y="68">WHEN SUPPLY FAILS</text>
<text class="sc-zone" x="324" y="68">LIVER MAKES GLUCOSE</text>
<text class="sc-zone" x="636" y="68">BRAIN</text>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 26}" width="932" height="52"/>
<text class="sc-zone sc-dim" x="30" y="${CY + 4}">BLOOD</text>
<rect class="sc-tissue" x="14" y="348" width="370" height="96" rx="16"/>
<rect class="sc-tissue" x="396" y="348" width="270" height="96" rx="16"/>
<rect class="sc-tissue" x="678" y="348" width="268" height="96" rx="16"/>
<text class="sc-zone" x="30" y="366">COUNTER-REGULATION</text>
<text class="sc-zone" x="412" y="366">SYMPTOMS</text>
<text class="sc-zone" x="694" y="366">TREATMENT, WHEN GIVEN</text>
<g id="cells"></g><g id="parts"></g><g id="marks"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-liver{--cc:#b8645a}.cl-alpha{--cc:#9fd0e8}.cl-brain{--cc:#e9a2b3}.cl-adr{--cc:#e9b84a}.cl-pit{--cc:#b7a1e6}.cl-mus{--cc:#d77a7a}
.p-gluc{--cc:#f2b23a}.p-ins{--cc:#2fc2a3}.p-horm{--cc:#c084fc}.p-horm2{--cc:#38d1ff}.p-horm3{--cc:#f07a7a}.p-horm4{--cc:#3ddc97}
.hypo-plate{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.hypo-musc{fill:color-mix(in srgb,#d77a7a 45%,var(--anatomy-paper));stroke:#c25a5a;stroke-width:1.2}
.hypo-stri{stroke:#c25a5a;stroke-width:.8;opacity:.5}
.hypo-squig{fill:none;stroke:color-mix(in srgb,var(--anatomy-strong) 55%,#e9a2b3);stroke-width:1.4;stroke-linecap:round}
.hypo-heart{fill:#e5484d;stroke:#a02030;stroke-width:1}
.hypo-icon{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.hypo-ico2{fill:color-mix(in srgb,#2fc2a3 35%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.3}
.hypo-stop{fill:none;stroke:var(--c-bad);stroke-width:1.8}
.hypo-spark{fill:#f2b23a}
.dr-g-fill.g-gl{fill:#f2b23a}.dr-g-fill.g-horm{fill:var(--c-cyt)}
`;

buildScene({
  id: "hypoglycaemia", fig: "Fig 1", title: "Hypoglycaemia: when blood glucose falls", W, H, body, extraCss,
  label: "An animated scene of low blood sugar. Fasting brings no new glucose and excess insulin drives glucose into muscle and stops the liver making more, so blood glucose falls. Hormones including glucagon, adrenaline, cortisol and growth hormone try to raise it again. The brain, which depends on glucose, first triggers warning symptoms and then brain symptoms. Treatment choices are oral glucose, intravenous glucose and glucagon, with gauges for glucose, brain supply, counter-regulation and symptoms.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "hypog.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How blood glucose falls, and how the body answers.</strong> Glucose stops coming in during fasting, and excess insulin (from treatment, an insulin secreting tumour or other causes) drives glucose into muscle and suppresses liver glucose production from glycogen breakdown and gluconeogenesis. As glucose falls, insulin secretion normally switches off and counter-regulatory hormones rise: glucagon and adrenaline act fast, cortisol and growth hormone act more slowly, all pushing the liver to release glucose. Adrenaline also causes the warning symptoms (sweating, shaking, racing heart, hunger). The brain depends on a steady glucose supply, so continued shortage causes neuroglycopenic symptoms (poor concentration, confusion, odd behaviour, drowsiness and, if severe, seizures or coma). This is standard teaching in medicine and endocrine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Oral glucose only when the person is awake and can swallow safely, intravenous glucose when they cannot, and glucagon, which raises glucose by telling the liver to release its glycogen stores and so may work less well after prolonged fasting when stores are low. Finding and treating the cause matters as much as raising the glucose. These are teaching toggles only.",
  ],
  simplified: "Sulfonylurea and other drug causes, alcohol, critical illness, hormone deficiencies, rechecking and follow on treatment, driving and safety rules, and all doses, thresholds and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
