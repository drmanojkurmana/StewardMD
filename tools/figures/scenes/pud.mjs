/* Peptic ulcer disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pud.mjs [--print-model]
 * Static layout here; acid, bacteria, crater and gauges move in pud.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Ulcer site and state", a: [0.55, 0.75, 1], hp: [0.62, 0.92, 0.85], ns: [0.78, 0.35, 0.6], ac: [0.62, 0.92, 0.8], deep: [0.18, 0.22, 0.62], cx: [300, 630, 465], names: ["gastric", "duodenal", "complicated"], ticks: ["gastric", "duodenal", "complicated"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "acid suppression" },
    { label: "H. pylori eradication" },
    { label: "stop NSAID" },
  ],
  status: "Ulcer: {level} · {drug} ·",
  drugNames: ["no treatment", "acid suppression", "H. pylori eradication", "NSAID stopped"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const acidSupp = drug === 1 ? 1 : 0, erad = drug === 2 ? 1 : 0, stopN = drug === 3 ? 1 : 0;
  const Hp = cl(S.level.hp[level] * (erad ? 0.1 : 1));
  const Ns = cl(S.level.ns[level] * (stopN ? 0.08 : 1));
  const Ac = cl(S.level.ac[level] * (acidSupp ? 0.22 : 1) * (erad ? 0.9 : 1));
  const Def = cl(0.92 - 0.38 * Hp - 0.42 * Ns + (stopN ? 0.12 : 0));
  const U = cl(0.05 + S.level.deep[level] + 0.38 * Ac + 0.24 * Hp + 0.2 * Ns - 0.55 * Def - 0.28 * acidSupp - 0.12 * erad * S.level.hp[level] - 0.12 * stopN * S.level.ns[level]);
  const compBase = level === 2 ? 1 : 0.12;
  const Bleed = cl(compBase * U * 0.95 - 0.12);
  const Perf = cl(compBase * (U - 0.22) * 0.9);
  const Comp = cl(Math.max(Bleed, Perf));
  const Heal = cl(0.85 - U + 0.25 * acidSupp + 0.2 * erad * S.level.hp[level] + 0.2 * stopN * S.level.ns[level]);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(U, 0.3, 0.62, ["healing", "open", "deep"]), w(Def, 0.35, 0.62, ["weak", "thinned", "intact"]), w(Comp, 0.22, 0.5, ["none", "at risk", "present"])];
  return { a: S.level.a[level], acidSupp, erad, stopN, Hp, Ns, Ac, Def, U, Bleed, Perf, Comp, Heal, cx: S.level.cx[level], words, readout: "ulcer " + words[0] + " · defence " + words[1] + " · complication " + words[2] };
}
const TESTS = [
  [0, 0, "ulcer open · defence thinned · complication none"],
  [1, 0, "ulcer deep · defence thinned · complication none"],
  [2, 0, "ulcer deep · defence weak · complication present"],
  [2, 1, "ulcer open · defence weak · complication at risk"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="pud-lumen" x="14" y="44" width="${W - 28}" height="168" rx="18"/>
<text class="sc-zone" x="34" y="68">LUMEN</text>
<text class="sc-zone sc-dim" x="850" y="68">WALL</text>
<g id="wallg"></g><g id="vesselg"></g><g id="craterg"></g><g id="bac"></g><g id="paric"></g><g id="nsaidg"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "peptic-ulcer", fig: "Fig 1", title: "Peptic ulcer disease: acid breaches weakened defence", W, H, body,
  label: "An animated cross-section of gastric or duodenal wall. Helicobacter pylori and non-steroidal anti-inflammatory drugs weaken the mucus and bicarbonate defence, so acid and pepsin dig a crater into the mucosa. A deep crater can reach a blood vessel and bleed, or pass through the wall and perforate. Gauges show Helicobacter pylori, NSAID effect, acid, mucosal defence, ulcer depth and complications. Treatment choices are acid suppression, eradication of Helicobacter pylori, and stopping the NSAID.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or treatment recommendations are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pud.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How a peptic ulcer forms.</strong> The stomach and duodenum are normally protected by a mucus and bicarbonate layer, mucosal blood flow and prostaglandin-supported repair. Helicobacter pylori inflames the mucosa and disturbs acid control, while NSAIDs block prostaglandin production and thin that defence. Acid and pepsin then erode a crater through the mucosa. A crater that reaches a vessel can bleed, and one that passes through the whole wall can perforate. Gastric ulcers lean more on weakened defence, duodenal ulcers more on Helicobacter pylori and acid. This is standard teaching in medicine and gastroenterology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Acid suppression lowers acid and pepsin activity so the crater can heal, eradication removes Helicobacter pylori so ulcers are less likely to return, and stopping the NSAID lets prostaglandin-supported defence recover. These are teaching toggles only.",
  ],
  simplified: "Gastrin and acid hypersecretion syndromes, gastric cancer in a non-healing gastric ulcer, stress ulceration, other drugs and alcohol, endoscopy and surgery, transfusion, and all doses and durations are left out. Gastric, duodenal and complicated ulcers are shown on one shared wall cross-section, and the figure does not say how any patient should be treated.",
  extraCss: `
.pud-lumen{fill:color-mix(in srgb,#e6c85a 12%,var(--anatomy-paper))}
.pud-mucus{fill:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper));opacity:.8}
.pud-mucosa{fill:color-mix(in srgb,var(--c-endo) 38%,var(--c-tis))}
.pud-sub{fill:color-mix(in srgb,var(--c-endo) 18%,var(--c-tis))}
.pud-muscle{fill:color-mix(in srgb,var(--c-sm) 42%,var(--c-tis))}
.pud-vessel{fill:color-mix(in srgb,var(--c-rbc) 18%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.pud-crater{fill:color-mix(in srgb,#e6c85a 12%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:1.4}
.pud-rim{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round;opacity:.75}
.pud-pit{fill:none;stroke:color-mix(in srgb,var(--c-endo) 60%,#000);stroke-width:1;opacity:.5}
.pud-nsaidtab{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.8}
.pud-nsaidhalf{fill:var(--c-bad);opacity:.65}
.p-acid{--cc:#e6c85a}.p-pep{--cc:#ff9a3d}.p-bic{--cc:var(--c-fl)}.p-blood{--cc:var(--c-rbc)}.p-leak{--cc:#e6c85a}
.cl-hp{--cc:var(--c-bac)}.cl-pari{--cc:#ff9a3d}
.dr-g-fill.g-acid{fill:#e6c85a}.dr-g-fill.g-def{fill:var(--c-good)}.dr-g-fill.g-ulcer{fill:var(--c-bad)}.dr-g-fill.g-nsaid{fill:var(--anatomy-strong)}
`,
});
