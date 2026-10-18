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
  const stones = cl(-0.02 + 1.02 * a - drain * 0.58);
  const sec = cl(1.02 - 0.88 * a);
  const dig = cl(sec + enz * 0.52);
  const insul = cl(1.05 - 0.28 * a - 0.65 * a * a);
  const pain = cl(painBase - painTx * 0.48 - drain * 0.28 - enz * 0.04);
  const steat = cl(0.08 + 0.85 * (1 - dig));
  const gluc = cl(0.08 + 0.85 * (1 - insul));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(fib, 0.3, 0.6, ["patchy", "widespread", "dense"]), w(sec, 0.3, 0.6, ["lost", "reduced", "preserved"]), w(pain, 0.3, 0.6, ["mild", "moderate", "severe"]), w(gluc, 0.3, 0.6, ["controlled", "borderline", "diabetic range"])];
  return { a, enz, painTx, drain, injury, fib, stones, sec, dig, insul, pain, steat, gluc, words, readout: "fibrosis " + words[0] + " · enzyme flow " + words[1] + " · pain " + words[2] + " · sugar " + words[3] };
}
const TESTS = [
  [0, 0, "fibrosis patchy · enzyme flow preserved · pain moderate · sugar controlled"],
  [1, 0, "fibrosis widespread · enzyme flow reduced · pain severe · sugar borderline"],
  [2, 0, "fibrosis dense · enzyme flow lost · pain moderate · sugar diabetic range"],
  [1, 2, "fibrosis widespread · enzyme flow reduced · pain moderate · sugar borderline"],
];

/* ---------------- static layout ---------------- */
const ORGAN = "M185 268C185 224 232 196 322 194L618 194C692 194 736 226 736 268C736 310 692 340 618 342L322 342C232 340 185 310 185 268Z";
const FIB = ["M250 215C300 245 340 285 390 325", "M360 205C400 240 430 285 470 330", "M480 205C510 245 540 285 575 330", "M590 210C615 245 640 280 665 320", "M230 300C290 275 350 250 420 225"];
let fibPaths = "";
for (const d of FIB) fibPaths += `<path class="cp-fib" d="${d}"/>`;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">CAUSES</text>
<text class="sc-zone" x="34" y="190">PANCREAS</text>
<text class="sc-zone sc-dim" x="852" y="190">DUODENUM</text>
<path class="cp-duo" d="M752 205C800 230 802 305 756 338"/>
<path class="cp-organ" d="${ORGAN}"/>
<g id="fibg">${fibPaths}</g>
<path id="inj" class="cp-inj" d="${ORGAN}" opacity="0"/>
<ellipse id="painHalo" class="cp-pain" cx="460" cy="268" rx="282" ry="80" opacity="0"/>
<path class="cp-duct" d="M222 268L702 268M300 268L282 234M390 268L374 302M480 268L464 234M570 268L554 302M650 268L636 236"/>
<g id="stones"></g>
<g id="islets"></g>
<g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>
<path class="cp-alcs" d="M132 118C140 130 143 136 143 142A11 11 0 0 1 121 142C121 136 124 130 132 118Z"/>
<path class="cp-alcs" d="M160 138C167 148 169 153 169 158A9 9 0 0 1 151 158C151 153 153 148 160 138Z"/>
<path class="cp-alcs" d="M108 144C115 154 117 159 117 164A9 9 0 0 1 99 164C99 159 101 154 108 144Z"/>
<g id="dna"><path class="cp-dna" d="M255 105C275 120 275 140 255 155M285 105C265 120 265 140 285 155M258 115L282 115M258 130L282 130M258 145L282 145"/></g>
<path class="cp-arrow" d="M175 175C190 205 200 225 215 245"/>
<path class="cp-arrow" d="M280 165C295 195 310 215 330 235"/>
<rect class="cp-gut" x="742" y="322" width="170" height="28" rx="14"/>
<text class="sc-zone sc-dim" x="770" y="341">GUT</text>`;

buildScene({
  id: "chronic-pancreatitis", fig: "Fig 1", title: "Chronic pancreatitis: repeated injury to fibrosis and failure", W, H, body,
  label: "An animated pancreas in chronic pancreatitis. Alcohol and genetic susceptibility cause repeated acinar injury. Over time fibrosis scars the gland, stones form in the duct, acinar cells are lost so enzyme flow falls and fat is malabsorbed with steatorrhoea and weight loss, and islets are lost so sugar control fails. Pain is prominent. Gauges show fibrosis, duct stones, enzyme flow, fat in stool, insulin and pain. Treatment choices include enzyme replacement, pain control with stopping alcohol, and drainage of the duct.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "chronicpanc.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How chronic pancreatitis develops.</strong> Repeated pancreatic injury, most often linked with alcohol and in some people with genetic susceptibility affecting trypsinogen activation and enzyme inhibitors, leads to progressive fibrosis. The pancreatic duct becomes distorted and may contain stones. Loss of acinar tissue reduces digestive enzyme secretion, so fat is poorly absorbed, causing steatorrhoea and weight loss. Loss of islet tissue reduces insulin and can cause diabetes. Pain may arise from duct obstruction, stones, inflammation and nerve involvement. Serum amylase and lipase are often not strikingly raised in established chronic disease, unlike an acute flare. This is standard teaching in medicine and gastroenterology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Stopping alcohol and controlling pain, replacing pancreatic enzymes to aid digestion, and endoscopic or surgical drainage when a blocked duct with stones drives pain. These are teaching toggles only and do not reverse established fibrosis or restore lost tissue in the way a simple toggle might suggest.",
  ],
  simplified: "Gallstones, severe hypertriglyceridemia, drugs and other causes of pancreatic injury, acute flares on chronic disease, pancreatic cancer risk, detailed duct anatomy, exocrine testing, and all doses and procedural choices are left out. Fibrosis is not reversed by the treatments shown. The figure does not say how any patient should be treated.",
  extraCss: `
body{--c-acinar:#e8a2c0;--c-fib:#e8ddc8;--c-stone:#f2ead2;--c-islet:#f2b84a;--c-enz:#3ec6a7;--c-fat:#e6c85a}
body[data-theme="light"]{--c-acinar:#cf779e;--c-fib:#b8a67e;--c-stone:#c9b98a;--c-islet:#c98f1f;--c-enz:#15957c;--c-fat:#c9a52e}
.cl-acinar{--cc:var(--c-acinar)}
.cp-organ{fill:color-mix(in srgb,var(--c-acinar) 30%,var(--c-tis));stroke:color-mix(in srgb,var(--c-acinar) 60%,#000);stroke-width:1.2}
.cp-inj{fill:var(--c-bad)}
.cp-pain{fill:var(--c-bad)}
.cp-fib{fill:none;stroke:var(--c-fib);stroke-width:7;stroke-linecap:round;opacity:.0}
.cp-duct{fill:none;stroke:var(--anatomy-mid);stroke-width:5;stroke-linecap:round;opacity:.65}
.cp-duo{fill:none;stroke:color-mix(in srgb,var(--c-fat) 55%,var(--anatomy-mid));stroke-width:16;stroke-linecap:round;opacity:.55}
.cp-gut{fill:color-mix(in srgb,var(--c-fat) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fat) 55%,#000);stroke-width:1}
.cp-stone{fill:var(--c-stone);stroke:#8a8172;stroke-width:1.1}
.cp-stone-h{fill:#fff;opacity:.7}
.cp-islet{fill:var(--c-islet);stroke:color-mix(in srgb,var(--c-islet) 55%,#000);stroke-width:.7;opacity:.9}
.cp-alcs{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8;opacity:.85}
.cp-dna{fill:none;stroke:var(--c-enz);stroke-width:2.4;stroke-linecap:round}
.cp-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:2;stroke-dasharray:5 4;opacity:.75}
.cp-gran{fill:var(--anatomy-paper);opacity:.75}
.p-enzp{--cc:var(--c-enz)}.p-fatp{--cc:var(--c-fat)}.p-injp{--cc:var(--c-bad)}
.dr-g-fill.g-fib{fill:var(--c-fib)}.dr-g-fill.g-stone{fill:var(--c-stone)}.dr-g-fill.g-enz{fill:var(--c-enz)}.dr-g-fill.g-fatg{fill:var(--c-fat)}.dr-g-fill.g-islet{fill:var(--c-islet)}.dr-g-fill.g-paing{fill:var(--c-neut)}
`,
});
