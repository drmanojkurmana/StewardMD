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
  const upper = cl(bleed * 0.95 * (drug === 2 ? 0.2 : 1) * (drug === 3 ? 0.35 : 1));
  const lower = cl(bleed * 0.9 * (drug === 2 ? 0.85 : 1) * (drug === 3 ? 0.35 : 1));
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
<rect id="veil" class="gb-veil" x="330" y="44" width="616" height="396" rx="16" opacity="0"/>
<text class="sc-zone" x="34" y="68">UPPER GUT</text>
<text class="sc-zone" x="34" y="270">LOWER GUT</text>
<text class="sc-zone" x="348" y="68">CIRCULATION</text>
<text class="sc-zone" x="664" y="68">HOW IT SHOWS</text>
<g id="stomSlot"></g>
<g id="colSlot"></g>
<g id="heartSlot"></g>
<path id="heartOut" class="gb-link" d="M506 236L506 292"/>
<rect id="vessel" class="gb-vessel" x="352" y="288" width="256" height="36" rx="18"/>
<circle id="varix0" class="gb-varix" cx="137" cy="87" r="5"/>
<circle id="varix1" class="gb-varix" cx="149" cy="95" r="5"/>
<ellipse id="ulcer" class="gb-ulcer" cx="158" cy="118" rx="13" ry="7"/>
<ellipse id="poolU" class="gb-pool" cx="155" cy="209" rx="34" ry="10" opacity="0"/>
<ellipse id="cbleed" class="gb-ulcer" cx="115" cy="332" rx="10" ry="6"/>
<ellipse id="poolL" class="gb-pool" cx="150" cy="426" rx="30" ry="8" opacity="0"/>
<path id="tr-scope" class="gb-scope" d="M158 52C158 80 158 96 158 116" opacity="0.25"/>
<g id="clips" opacity="0"><path class="gb-clip" d="M-14 -3h28M-14 3h28"/><circle class="gb-clipc" cx="0" cy="0" r="6"/></g>
<path id="tr-cath" class="gb-cath" d="M330 400C280 380 200 360 99 324" opacity="0.25"/>
<g id="coilU" opacity="0"><circle class="gb-coil" cx="-6" cy="0" r="6"/><circle class="gb-coil" cx="5" cy="-3" r="5"/><circle class="gb-coil" cx="1" cy="5" r="4.5"/></g>
<g id="coilL" opacity="0"><circle class="gb-coil" cx="-6" cy="0" r="6"/><circle class="gb-coil" cx="5" cy="-3" r="5"/><circle class="gb-coil" cx="1" cy="5" r="4.5"/></g>
<g id="tr-iv" opacity="0.35"><rect class="gb-ivbag" x="366" y="380" width="22" height="30" rx="6"/><path class="gb-ivline" d="M377 380L368 342L357 318"/></g>
<g id="rbcs"></g>
<path class="gb-bowl" d="M678 122h56l-7 20h-42Z"/>
<g id="sign-vom"><ellipse class="gb-vomit" cx="706" cy="123" rx="24" ry="5"/></g>
<g id="sign-mel"><ellipse class="gb-stoolb" cx="700" cy="222" rx="20" ry="10"/><ellipse class="gb-stoolb" cx="714" cy="216" rx="13" ry="7"/></g>
<g id="sign-hae"><ellipse class="gb-stoolr" cx="700" cy="318" rx="20" ry="10"/><ellipse class="gb-stoolr" cx="714" cy="312" rx="13" ry="7"/></g>
<circle class="gb-face" cx="716" cy="392" r="24"/>
<circle id="pale" class="gb-pale" cx="716" cy="392" r="24" opacity="0"/>
<circle class="gb-eye" cx="708" cy="386" r="2.4"/><circle class="gb-eye" cx="724" cy="386" r="2.4"/>
<path class="gb-mouth" d="M708 402q8 5 16 0"/>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.gb-link{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round;opacity:.8}
.gb-vessel{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:1.2}
.gb-veil{fill:#aebfcf;stroke:none}
.gb-ulcer{fill:#7a1f2b;stroke:var(--c-bad);stroke-width:1.6}
.gb-varix{fill:#8a2f5e;stroke:#5a1a3c;stroke-width:1.2}
.gb-pool{fill:#7a1f2b;stroke:none}
.gb-clip{fill:none;stroke:#2fc2a3;stroke-width:2.6}.gb-clipc{fill:none;stroke:#2fc2a3;stroke-width:2.2}
.gb-scope{fill:none;stroke:#2fc2a3;stroke-width:3;stroke-linecap:round}
.gb-cath{fill:none;stroke:#c9a03a;stroke-width:3;stroke-linecap:round}
.gb-coil{fill:#c9a03a;stroke:#7a5a1a;stroke-width:1}
.gb-ivbag{fill:color-mix(in srgb,var(--c-fl) 35%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1.5}
.gb-ivline{fill:none;stroke:var(--c-fl);stroke-width:2.5}
.cl-rbc{--cc:var(--c-rbc)}
.gb-face{fill:#e8b88a;stroke:#b8855a;stroke-width:1.3}.gb-pale{fill:#e8e2da}.gb-eye{fill:#4a3226}.gb-mouth{fill:none;stroke:#8a5a3a;stroke-width:1.6;stroke-linecap:round}
.gb-bowl{fill:color-mix(in srgb,var(--anatomy-mid) 35%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.4}
.gb-vomit{fill:#7a1f2b}.gb-stoolb{fill:#241a1e}.gb-stoolr{fill:var(--c-bad)}
.gb-cap{fill:var(--anatomy-strong);font-size:12px}
.p-bld{fill:var(--c-bad)}
.dr-g-fill.g-bleed{fill:var(--c-bad)}.dr-g-fill.g-vol{fill:var(--c-fl)}.dr-g-fill.g-press{fill:var(--c-good)}.dr-g-fill.g-pulse{fill:var(--c-neut)}.dr-g-fill.g-perf{fill:#3ddc97}.dr-g-fill.g-shock{fill:#c084fc}
`;

buildScene({
  id: "gi-bleeding-upper-lower", fig: "Fig 1", title: "Gastrointestinal bleeding: upper, lower and shock", W, H, body, extraCss,
  label: "An animated gut and circulation. In the upper gut, swollen varices and an ulcer bleed into the stomach, giving vomited blood and black stool. In the lower gut, a colon bleed gives bright red stool. Lost blood lowers circulating volume, the pulse speeds to compensate, blood pressure and perfusion fall, and shock follows. Treatments are resuscitation, endoscopic therapy, or surgery or embolisation, with gauges for bleeding, volume, pressure, pulse, perfusion and shock.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "giblood.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With surgery or embolisation",
  sourcesLis: [
    "<strong>How gastrointestinal bleeding presents.</strong> Upper gastrointestinal bleeding, from oesophageal varices or a peptic ulcer, usually presents with haematemesis (vomited blood) and melaena (black, tarry stool from digested blood). Lower gastrointestinal bleeding, from diverticula, angiodysplasia, colitis, cancer or other colonic sources, usually presents with haematochezia (bright red blood per rectum), although a brisk upper bleed can do the same. Risk clues in the history include aspirin and other NSAIDs, anticoagulants, alcohol, liver disease and being elderly. A slow bleed may show only as anaemia, which should prompt further testing and, where indicated, endoscopy rather than reassurance. This is standard teaching in medicine and gastroenterology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Assessment and treatment ideas shown.</strong> Assessment comes first: airway, breathing, circulation, pulse and blood pressure, signs of shock, and urgent tests including blood count, grouping and cross matching, clotting and liver tests. Resuscitation with fluids and blood restores circulating volume but does not stop the source. Endoscopic therapy at endoscopy (bands for varices, clips, heat or injection for ulcers) treats the source in the lumen. Surgery or embolisation is the fallback when bleeding cannot be controlled, is massive, or returns. These are teaching toggles only.",
  ],
  simplified: "Scoring systems, transfusion triggers, vasoactive and acid suppression drugs, variceal antibiotics, timing of endoscopy, interventional radiology details, obscure and small bowel bleeding, aortoenteric fistula, and all doses, targets and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
