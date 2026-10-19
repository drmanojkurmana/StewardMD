/* Chronic pancreatitis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/chronicpanc.mjs [--print-model]
 * Static layout here; cells, enzymes and gauges move in chronicpanc.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of chronic pancreatitis", a: [0.25, 0.6, 1], names: ["early", "established", "burnt out"], ticks: ["early", "established", "burnt out"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "enzyme replacement" },
    { label: "pain control and stopping alcohol" },
    { label: "endoscopic or surgical drainage" },
  ],
  status: "Chronic pancreatitis: {level} · {drug} ·",
  drugNames: ["no treatment", "enzyme replacement", "pain control and stopping alcohol", "drainage procedure"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], enz = drug === 1 ? 1 : 0, painTx = drug === 2 ? 1 : 0, drain = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const painBase = [0.42, 0.82, 0.58][level];
  const injury = cl(a * (painTx ? 0.35 : 1));
  const fib = cl(0.05 + 0.75 * a - (painTx ? 0.08 * a : 0) - (drain ? 0.04 : 0));
  const stones = cl(-0.02 + 1.02 * a - drain * 0.75);
  const sec = cl(1.02 - 0.88 * a);
  const dig = cl(sec + enz * 0.52 + drain * 0.3);
  const insul = cl(1.05 - 0.28 * a - 0.65 * a * a);
  const pain = cl(painBase - painTx * 0.48 - drain * 0.28 - enz * 0.04);
  const steat = cl(0.08 + 0.85 * (1 - dig));
  const gluc = cl(0.08 + 0.85 * (1 - insul));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(fib, 0.3, 0.6, ["patchy", "widespread", "dense"]), w(dig, 0.3, 0.6, ["poor", "partial", "good"]), w(pain, 0.3, 0.6, ["mild", "moderate", "severe"]), w(gluc, 0.3, 0.6, ["controlled", "borderline", "diabetic range"])];
  return { a, enz, painTx, drain, injury, fib, stones, sec, dig, insul, pain, steat, gluc, words, readout: "fibrosis " + words[0] + " · digestion " + words[1] + " · pain " + words[2] + " · sugar " + words[3] };
}
const TESTS = [
  [0, 0, "fibrosis patchy · digestion good · pain moderate · sugar controlled"],
  [1, 0, "fibrosis widespread · digestion partial · pain severe · sugar borderline"],
  [2, 0, "fibrosis dense · digestion poor · pain moderate · sugar diabetic range"],
  [1, 3, "fibrosis widespread · digestion good · pain moderate · sugar borderline"],
];

/* ---------------- static layout ----------------
 * The gland itself is real organ art (drawn in the page script from the
 * pancreas ports, as in hepenc). Placeholders below are repositioned there. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<ellipse id="glow" class="cp-glow" cx="430" cy="272" rx="235" ry="64" opacity="0"/>
<ellipse id="halo" class="cp-pain" cx="430" cy="272" rx="252" ry="80" opacity="0"/>
<g id="pancSlot"></g>
<path id="duct" class="cp-duct" d="M240 272L620 272"/>
<g id="scars"></g>
<g id="stones"></g>
<path id="duo" class="cp-duo" d="M660 220C700 250 700 300 662 332"/>
<rect id="gutBox" class="cp-gut" x="742" y="322" width="170" height="28" rx="14"/>
<rect id="sheen" class="cp-sheen" x="742" y="322" width="170" height="28" rx="14" opacity="0"/>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "chronic-pancreatitis", fig: "Fig 1", title: "Chronic pancreatitis: repeated injury to fibrosis and failure", W, H, body,
  label: "An animated pancreas in chronic pancreatitis. Alcohol and genetic susceptibility cause repeated acinar injury. Over time fibrosis scars the gland, stones form in the duct, acinar cells are lost so enzyme flow falls and fat is malabsorbed with steatorrhoea and weight loss, and islets are lost so sugar control fails. Pain is prominent. Gauges show fibrosis, duct stones, enzyme flow, fat in stool, insulin and pain. Treatment choices include enzyme replacement, pain control with stopping alcohol, and drainage of the duct.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "chronicpanc.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With drainage",
  sourcesLis: [
    "<strong>How chronic pancreatitis develops.</strong> Repeated pancreatic injury, most often linked with alcohol and in some people with genetic susceptibility affecting trypsinogen activation and enzyme inhibitors, leads to progressive fibrosis. The pancreatic duct becomes distorted and may contain stones. Loss of acinar tissue reduces digestive enzyme secretion, so fat is poorly absorbed, causing steatorrhoea and weight loss. Loss of islet tissue reduces insulin and can cause diabetes. Pain may arise from duct obstruction, stones, inflammation and nerve involvement. Serum amylase and lipase are often not strikingly raised in established chronic disease, unlike an acute flare. This is standard teaching in medicine and gastroenterology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Stopping alcohol and controlling pain, replacing pancreatic enzymes to aid digestion, and endoscopic or surgical drainage when a blocked duct with stones drives pain. Drainage clears the blockage so juices flow again, but established fibrosis and lost tissue do not come back. These are teaching toggles only.",
  ],
  simplified: "Gallstones, severe hypertriglyceridemia, drugs and other causes of pancreatic injury, acute flares on chronic disease, pancreatic cancer risk, detailed duct anatomy, exocrine testing, and all doses and procedural choices are left out. Fibrosis is not reversed by the treatments shown. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-acinar:#e8a2c0;--c-fib:#e8ddc8;--c-stone:#f2ead2;--c-islet:#f2b84a;--c-enz:#3ec6a7;--c-fat:#e6c85a}
body[data-theme="light"]{--c-acinar:#cf779e;--c-fib:#b8a67e;--c-stone:#c9b98a;--c-islet:#c98f1f;--c-enz:#15957c;--c-fat:#c9a52e}
.cl-acinar{--cc:var(--c-acinar)}
.cp-glow{fill:var(--c-bad);stroke:none}
.cp-pain{fill:var(--c-bad);stroke:none}
.cp-duct{fill:none;stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round;opacity:.8}
.cp-duo{fill:none;stroke:color-mix(in srgb,var(--c-fat) 55%,var(--anatomy-mid));stroke-width:16;stroke-linecap:round;opacity:.55}
.cp-gut{fill:color-mix(in srgb,var(--c-fat) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fat) 55%,#000);stroke-width:1}
.cp-sheen{fill:var(--c-fat);stroke:none}
.cp-scar{fill:none;stroke:var(--c-fib);stroke-width:7;stroke-linecap:round}
.cp-stone{fill:var(--c-stone);stroke:#8a8172;stroke-width:1.1}
.cp-stone-h{fill:#fff;opacity:.7}
.cp-islet{fill:var(--c-islet);stroke:color-mix(in srgb,var(--c-islet) 55%,#000);stroke-width:.7;opacity:.9}
.cp-gran{fill:var(--anatomy-paper);opacity:.75}
.cp-cap{fill:var(--anatomy-strong);font-size:13px}
.p-cap{fill:var(--anatomy-paper);stroke:var(--c-enz);stroke-width:1}
.p-cap2{fill:var(--c-enz);stroke:none}
.p-enzp{--cc:var(--c-enz)}.p-fatp{--cc:var(--c-fat)}.p-injp{--cc:var(--c-bad)}.p-insp{--cc:var(--c-islet)}
.dr-g-fill.g-fib{fill:var(--c-fib)}.dr-g-fill.g-stone{fill:var(--c-stone)}.dr-g-fill.g-enz{fill:var(--c-enz)}.dr-g-fill.g-fatg{fill:var(--c-fat)}.dr-g-fill.g-islet{fill:var(--c-islet)}.dr-g-fill.g-paing{fill:var(--c-neut)}
`,
});
