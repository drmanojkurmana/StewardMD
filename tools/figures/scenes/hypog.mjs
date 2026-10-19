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
    { label: "glucagon" },
    { label: "intravenous glucose" },
  ],
  status: "Low blood sugar: {level} · {drug} ·",
  drugNames: ["no treatment", "oral glucose", "glucagon", "intravenous glucose"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const oral = drug === 1 ? 1 : 0, gluc = drug === 2 ? 1 : 0, iv = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const boost = oral ? (a > 0.9 ? 0.2 : 0.5) : gluc ? 0.6 : iv ? 0.85 : 0;
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
  [2, 0, "blood glucose low · brain supply starved · warning symptoms strong · brain symptoms marked"],
  [2, 1, "blood glucose low · brain supply starved · warning symptoms strong · brain symptoms some"],
  [2, 3, "blood glucose restored · brain supply supplied · warning symptoms clear · brain symptoms none"],
];

/* ---------------- static layout ---------------- */
const CY = 290;
const body = `
<rect class="sc-tissue" x="14" y="44" width="932" height="396" rx="18"/>
<path id="vesselGlow" class="hypo-vglow" d="M220 290 L740 290"/>
<path id="vessel" class="hypo-vessel" d="M220 290 L740 290"/>
<path id="ivLine" class="hypo-ivline" d="M660 368 L660 296"/>
<ellipse id="brainGlow" class="hypo-bglow" cx="800" cy="170" rx="95" ry="80" opacity="0"/>
<ellipse id="liverGlow" class="hypo-lglow" cx="545" cy="170" rx="100" ry="70" opacity="0"/>
<g id="pancSlot"></g>
<g id="muscSlot"></g>
<g id="liverSlot"></g>
<g id="brainSlot"></g>
<g id="heartSlot"></g>
<circle id="receptor" class="hypo-recept" cx="500" cy="205" r="6"/>
<g id="blockM" opacity="0"><circle class="hypo-block" cx="585" cy="212" r="9"/><path class="hypo-block" d="M579 218L591 206"/></g>
<g id="tr-oral"><path class="hypo-icon" d="M506 388h28l-4 20h-20Z"/><circle class="sc-p p-gluc" cx="520" cy="396" r="3.4"/></g>
<g id="tr-iv"><rect class="hypo-ico2" x="648" y="340" width="24" height="30" rx="5"/><path class="p-fl" d="M660 352c3.4 4.2 4.2 6.8 4.2 8.6a4.2 4.2 0 0 1-8.4 0c0-1.8 0.8-4.4 4.2-8.6Z"/></g>
<g id="tr-gluc"><rect class="hypo-icon" x="788" y="384" width="44" height="13" rx="3"/><path class="hypo-iconln" d="M832 388h14M786 390h-8M786 386v9"/></g>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.cl-alpha{--cc:#9fd0e8}.cl-adr{--cc:#e9b84a}.cl-pit{--cc:#b7a1e6}
.p-gluc{--cc:#f2b23a}.p-ins{--cc:#2fc2a3}.p-horm{--cc:#c084fc}.p-horm2{--cc:#38d1ff}.p-horm3{--cc:#f07a7a}.p-horm4{--cc:#3ddc97}
.hypo-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:15;stroke-linecap:round;opacity:.8}
.hypo-vglow{fill:none;stroke:#f2b23a;stroke-width:19;stroke-linecap:round;opacity:.15}
.hypo-ivline{fill:none;stroke:#2fc2a3;stroke-width:3;stroke-linecap:round;stroke-dasharray:5 4;opacity:.5}
.hypo-bglow{fill:var(--c-bad);stroke:none}
.hypo-lglow{fill:#f2b23a;stroke:none}
.hypo-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.hypo-icon{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.3}
.hypo-ico2{fill:color-mix(in srgb,#2fc2a3 35%,var(--anatomy-paper));stroke:#2fc2a3;stroke-width:1.3}
.hypo-iconln{fill:none;stroke:var(--c-fl);stroke-width:1.3;stroke-linecap:round}
.hypo-block{fill:none;stroke:var(--c-bad);stroke-width:2}
.hypo-recept{fill:var(--anatomy-paper);stroke:#f07a7a;stroke-width:2}
.hypo-spark{fill:#f2b23a}
.dr-g-fill.g-gl{fill:#f2b23a}.dr-g-fill.g-horm{fill:var(--c-cyt)}
`;

buildScene({
  id: "hypoglycaemia", fig: "Fig 1", title: "Hypoglycaemia: when blood glucose falls", W, H, body, extraCss,
  label: "An animated scene of low blood sugar. Too much insulin drives glucose into muscle and stops the liver making more, so blood glucose in the vessel falls and the brain runs short. Rescue hormones try to raise it again. The heart races as a warning sign and thinking fades as the brain starves. Treatment choices are oral glucose, glucagon and intravenous glucose, with gauges for glucose, brain supply and symptoms.",
  caption: "Schematic, not to scale. Speeds, particle counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "hypog.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With intravenous glucose",
  sourcesLis: [
    "<strong>How blood glucose falls, and how the body answers.</strong> Glucose stops coming in during fasting, and excess insulin drives glucose into muscle and suppresses liver glucose production from glycogen breakdown and making new glucose. As glucose falls, insulin secretion normally switches off and rescue hormones rise: glucagon and adrenaline act fast, cortisol and growth hormone act more slowly, all pushing the liver to release glucose. Adrenaline also causes the warning symptoms (sweating, shaking, racing heart, hunger). The brain depends on a steady glucose supply, so continued shortage causes brain symptoms (poor concentration, confusion, odd behaviour, drowsiness and, if severe, seizures or coma). This is standard teaching in medicine and endocrine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Oral glucose only when the person is awake and can swallow safely, intravenous glucose when they cannot, and glucagon, which raises glucose by telling the liver to release its stored glucose and so may work less well after prolonged fasting when stores are low. Finding and treating the cause matters as much as raising the glucose. These are teaching toggles only.",
  ],
  simplified: "Sulfonylurea and other drug causes, alcohol, critical illness, hormone deficiencies, rechecking and follow on treatment, driving and safety rules, and all doses, thresholds and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
