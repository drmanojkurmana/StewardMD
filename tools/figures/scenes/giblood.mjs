/* Gastrointestinal bleeding, upper and lower, as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/giblood.mjs [--print-model]
 * Static layout here; blood, red cells, heart and gauges move in giblood.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Size of the bleed", a: [0.3, 0.65, 1], names: ["minor", "moderate", "massive"], ticks: ["minor", "moderate", "massive"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "resuscitation (fluids and blood)" },
    { label: "endoscopic therapy" },
    { label: "surgery or embolisation" },
  ],
  status: "Bleed: {level} · {drug} ·",
  drugNames: ["no treatment", "resuscitation", "endoscopic therapy", "surgery or embolisation"],
};
function modelOf(S, level, drug) {
  const stopK = [1, 0.95, 0.28, 0.1][drug];
  const resusK = [0, 1, 0.35, 0.35][drug];
  const ctrlK = [0, 0, 1, 1][drug];
  const a = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const bleed = cl(a * stopK);
  const lost = cl(a * (ctrlK ? 0.58 : drug === 1 ? 0.85 : 1));
  const vol = cl(0.98 - 0.72 * lost + resusK * 0.42);
  const bp = cl(0.35 + 0.6 * vol - 0.15 * bleed);
  const perf = cl(0.9 * bp + 0.18 * vol - 0.1 * bleed);
  const hr = cl(0.18 + 0.85 * (1 - bp));
  const shock = cl(0.75 * (1 - bp) + 0.25 * bleed + 0.3 * (1 - perf));
  const upper = cl(bleed * 0.95), lower = cl(bleed * 0.9);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const bw = w(bleed, 0.18, 0.5, ["slow", "steady", "brisk"]);
  const bpw = bp > 0.68 ? "maintained" : bp > 0.45 ? "borderline" : "low";
  const pfw = perf > 0.65 ? "good" : perf > 0.4 ? "reduced" : "poor";
  const shw = shock < 0.35 ? "none" : shock < 0.7 ? "compensated" : "overt";
  return { a, bleed, lost, vol, bp, perf, hr, shock, upper, lower, resus: resusK, ctrl: ctrlK, endo: drug === 2 ? 1 : 0, surg: drug === 3 ? 1 : 0, readout: "bleeding " + bw + " · blood pressure " + bpw + " · perfusion " + pfw + " · shock " + shw };
}
const TESTS = [
  [2, 0, "bleeding brisk · blood pressure low · perfusion poor · shock overt"],
  [1, 0, "bleeding brisk · blood pressure borderline · perfusion reduced · shock compensated"],
  [2, 1, "bleeding brisk · blood pressure maintained · perfusion good · shock compensated"],
  [2, 2, "bleeding steady · blood pressure maintained · perfusion good · shock none"],
  [2, 3, "bleeding slow · blood pressure maintained · perfusion good · shock none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="300" height="186" rx="16"/>
<rect class="sc-tissue" x="14" y="246" width="300" height="194" rx="16"/>
<rect class="sc-tissue" x="330" y="44" width="300" height="396" rx="16"/>
<rect class="sc-tissue" x="646" y="44" width="300" height="396" rx="16"/>
<text class="sc-zone" x="34" y="68">UPPER GUT</text>
<text class="sc-zone" x="34" y="270">LOWER GUT</text>
<text class="sc-zone" x="348" y="68">CIRCULATION</text>
<text class="sc-zone" x="664" y="68">HOW IT SHOWS</text>
<path class="gb-oes" d="M62 76h28v82H62Z"/>
<circle id="varix0" class="gb-varix" cx="76" cy="102" r="6"/>
<circle id="varix1" class="gb-varix" cx="76" cy="122" r="6"/>
<circle id="varix2" class="gb-varix" cx="76" cy="142" r="6"/>
<path class="gb-tear" d="M92 150l8 6l-6 5l9 5"/>
<path class="gb-stom" d="M92 152C80 190 105 228 150 230C195 232 238 215 245 185C250 162 230 148 205 152C180 156 165 140 140 142C118 144 100 140 92 152Z"/>
<ellipse id="ulcer" class="gb-ulcer" cx="212" cy="196" rx="16" ry="9"/>
<path class="gb-duod" d="M240 200C268 206 290 196 300 176"/>
<path class="gb-colon" d="M58 402L58 326Q58 302 84 302L242 302Q266 302 266 326L266 402"/>
<path class="gb-rect" d="M254 400h24v28h-24Z"/>
<circle class="gb-div" cx="40" cy="338" r="9"/><circle class="gb-div" cx="40" cy="366" r="9"/><circle class="gb-div" cx="284" cy="338" r="9"/>
<path class="gb-angio" d="M138 292c8-10 22-10 28 0c10-8 24-4 26 8c-10 6-20 2-26-4c-8 8-22 8-28-4Z"/>
<path class="gb-colitis" d="M266 348v42"/>
<g id="clips" opacity="0"><path class="gb-clip" d="M68 108h16M68 128h16M204 190h16"/><circle class="gb-clipc" cx="76" cy="118" r="5"/></g>
<rect id="vessel" class="gb-vessel" x="352" y="288" width="256" height="36" rx="18"/>
<g id="heartg"></g><g id="rbcs"></g>
<circle class="gb-face" cx="716" cy="392" r="24"/>
<circle id="pale" class="gb-pale" cx="716" cy="392" r="24" opacity="0"/>
<circle class="gb-eye" cx="708" cy="386" r="2.4"/><circle class="gb-eye" cx="724" cy="386" r="2.4"/>
<path class="gb-mouth" d="M708 402q8 5 16 0"/>
<g id="signs"></g><g id="treat"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.gb-oes{fill:color-mix(in srgb,var(--c-endo) 48%,var(--anatomy-paper));stroke:#c76a7a;stroke-width:1.4}
.gb-varix{fill:#8a2f5e;stroke:#5a1a3c;stroke-width:1.2}
.gb-tear{fill:none;stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.gb-stom{fill:color-mix(in srgb,#e8a0a0 42%,var(--anatomy-paper));stroke:#c76a6a;stroke-width:1.5}
.gb-ulcer{fill:#7a1f2b;stroke:var(--c-bad);stroke-width:1.6}
.gb-duod{fill:none;stroke:color-mix(in srgb,#e8a0a0 55%,var(--anatomy-paper));stroke-width:20;stroke-linecap:round}
.gb-colon{fill:none;stroke:color-mix(in srgb,#d98a7a 55%,var(--anatomy-paper));stroke-width:22;stroke-linecap:round}
.gb-rect{fill:color-mix(in srgb,#d98a7a 55%,var(--anatomy-paper));stroke:#b86a5a;stroke-width:1.2}
.gb-div{fill:color-mix(in srgb,#d98a7a 65%,var(--anatomy-paper));stroke:#b86a5a;stroke-width:1.2}
.gb-angio{fill:#a03a6a;stroke:#6a1f45;stroke-width:1.2}
.gb-colitis{fill:none;stroke:var(--c-bad);stroke-width:16;stroke-linecap:round;opacity:.75}
.gb-clip{fill:none;stroke:#2fc2a3;stroke-width:2.6}.gb-clipc{fill:none;stroke:#2fc2a3;stroke-width:2.2}
.gb-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:1.2}
.cl-heart{--cc:#d94a5a}.cl-rbc{--cc:var(--c-rbc)}
.gb-face{fill:#e8b88a;stroke:#b8855a;stroke-width:1.3}.gb-pale{fill:#e8e2da}.gb-eye{fill:#4a3226}.gb-mouth{fill:none;stroke:#8a5a3a;stroke-width:1.6;stroke-linecap:round}
.gb-bowl{fill:color-mix(in srgb,var(--anatomy-mid) 35%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.gb-vomit{fill:#7a1f2b}.gb-stoolb{fill:#241a1e}.gb-stoolr{fill:var(--c-bad)}
.gb-ivbag{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.5}
.gb-scope{fill:none;stroke:#2fc2a3;stroke-width:3;stroke-linecap:round}
.gb-cath{fill:none;stroke:#c9a03a;stroke-width:3;stroke-linecap:round}
.p-bld{fill:var(--c-bad)}.p-bldb{fill:#4a1218}
.dr-g-fill.g-bleed{fill:var(--c-bad)}.dr-g-fill.g-vol{fill:var(--c-fl)}.dr-g-fill.g-press{fill:var(--c-good)}.dr-g-fill.g-pulse{fill:var(--c-neut)}.dr-g-fill.g-perf{fill:#3ddc97}.dr-g-fill.g-shock{fill:#c084fc}
`;

buildScene({
  id: "gi-bleeding-upper-lower", fig: "Fig 1", title: "Gastrointestinal bleeding: upper, lower and shock", W, H, body, extraCss,
  label: "An animated gut and circulation. In the upper gut, swollen varices, a Mallory-Weiss tear after vomiting and an ulcer bleed into the stomach, giving vomited blood and black stool. In the lower gut, diverticula, angiodysplasia and colitis bleed bright red. Lost blood lowers circulating volume, the pulse speeds to compensate, blood pressure and perfusion fall, and shock follows. Treatments are resuscitation, endoscopic therapy, or surgery or embolisation, with gauges for bleeding, volume, pressure, pulse, perfusion and shock.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "giblood.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How gastrointestinal bleeding presents.</strong> Upper gastrointestinal bleeding, from oesophageal varices, a peptic ulcer, or a Mallory-Weiss tear torn by repeated vomiting, usually presents with haematemesis (vomited blood) and melaena (black, tarry stool from digested blood). Lower gastrointestinal bleeding, from diverticula, angiodysplasia, colitis, cancer or other colonic sources, usually presents with haematochezia (bright red blood per rectum), although a brisk upper bleed can do the same. Risk clues in the history include aspirin and other NSAIDs, anticoagulants, alcohol, liver disease and being elderly. A slow occult bleed may show only as anaemia, unintentional weight loss, anorexia, nausea or a change in bowel habit, which should prompt further testing and, where indicated, screening or endoscopy for cancer rather than reassurance. This is standard teaching in medicine and gastroenterology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Assessment and treatment ideas shown.</strong> Assessment comes first: airway, breathing, circulation, pulse and blood pressure, signs of shock, and urgent tests including blood count, grouping and cross matching, clotting and liver tests. Clear fluids or nil by mouth, hospitalize decisions and how active the bleed looks all follow that assessment and local protocol; the figure does not set them. Resuscitation with fluids and blood restores circulating volume but does not stop the source. Endoscopic therapy at endoscopy (bands for varices, clips, heat or injection for ulcers and tears, and selected treatment for angiodysplasia or colitis) treats the source in the lumen. Surgery or embolisation is the fallback when bleeding cannot be controlled, is massive, or returns. Given the stakes, a patient who should be admitted and observed is not sent home on the strength of a single quiet moment. These are teaching toggles only.",
  ],
  simplified: "Scoring systems, transfusion triggers, vasoactive and acid suppression drugs, variceal antibiotics, timing of endoscopy, interventional radiology details, obscure and small bowel bleeding, aortoenteric fistula, and all doses, targets and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
