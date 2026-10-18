/* Jaundice and bilirubin metabolism as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/jaund.mjs [--print-model]
 * Static layout here; bilirubin particles, samples and gauges move in jaund.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Where the problem is", a: [0, 1, 2], names: ["pre-hepatic", "hepatic", "post-hepatic"], ticks: ["pre-hepatic", "hepatic", "post-hepatic"], start: 0 },
  drugLabel: "Treatment idea",
  settings: [
    { label: "no treatment" },
    { label: "phototherapy (light on the skin)" },
    { label: "relieve the obstruction (drain the bile duct)" },
    { label: "treat the underlying cause" },
  ],
  status: "Pattern: {level} · {drug} ·",
  drugNames: ["no treatment", "phototherapy", "relieving the obstruction", "treating the underlying cause"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const type = S.level.a[level];
  const photo = drug === 1 ? 1 : 0, relieve = drug === 2 ? 1 : 0, cause = drug === 3 ? 1 : 0;
  let U = type === 0 ? 0.92 : type === 1 ? 0.62 : 0.3;
  let C = type === 0 ? 0.24 : type === 1 ? 0.58 : 0.95;
  let Flow = type === 0 ? 0.82 : type === 1 ? 0.55 : 0.07;
  if (photo) { U = cl(U * 0.45); }
  if (relieve && type === 2) { C = 0.28; Flow = 0.85; U = cl(U * 0.9); }
  if (cause && type === 0) { U = 0.34; C = 0.2; }
  if (cause && type === 1) { U = 0.36; C = 0.32; Flow = 0.72; }
  if (cause && type === 2) { C = cl(C * 0.92); }
  const Obs = type === 2 && !relieve ? 1 : 0;
  const Total = cl((U + C) * 0.58);
  const J = cl(Total * (photo ? 0.75 : 1));
  const UrineB = type === 0 ? 0.04 : cl(C * (type === 2 ? 1 : 0.8) * (relieve && type === 2 ? 0.35 : 1));
  const Uro = cl(Flow * (type === 0 ? 1.05 : 0.9));
  const Stool = cl(0.08 + 0.85 * Flow);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(U, 0.35, 0.7, ["low", "raised", "high"]), w(C, 0.35, 0.7, ["low", "raised", "high"]), w(UrineB, 0.15, 0.55, ["absent", "present", "strong"]), w(Stool, 0.3, 0.65, ["pale", "normal", "dark"])];
  return { type, photo, relieve, cause, U, C, Flow, Obs, Total, J, UrineB, Uro, Stool, words, readout: "unconjugated " + words[0] + " · conjugated " + words[1] + " · urine bilirubin " + words[2] + " · stool " + words[3] };
}
const TESTS = [
  [0, 0, "unconjugated high · conjugated low · urine bilirubin absent · stool dark"],
  [2, 0, "unconjugated low · conjugated high · urine bilirubin strong · stool pale"],
  [2, 2, "unconjugated low · conjugated low · urine bilirubin absent · stool dark"],
  [0, 1, "unconjugated raised · conjugated low · urine bilirubin absent · stool dark"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="jd-liver" d="M360 118 C390 96 520 92 552 118 C578 140 572 182 540 200 C480 218 400 214 372 196 C348 178 340 140 360 118Z"/>
<ellipse class="jd-gall" cx="628" cy="208" rx="24" ry="30"/>
<path class="jd-duct" d="M548 188 C600 196 632 224 652 262 C664 286 672 306 684 326"/>
<rect class="jd-vessel" x="30" y="255" width="500" height="34" rx="17"/>
<path class="jd-gut" d="M700 348 C740 322 790 368 830 342 C862 322 900 348 906 372 C912 398 884 418 848 410 C812 402 786 424 748 410 C714 398 678 372 700 348Z"/>
<ellipse class="jd-kidney" cx="822" cy="142" rx="34" ry="44" transform="rotate(18 822 142)"/>
<g id="spleen"></g><g id="face"></g><g id="flow"></g><g id="rbcs"></g><g id="parts"></g>
<circle id="stone" class="jd-stone" cx="654" cy="266" r="13"/>
<g id="samples"></g><g id="light"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "jaundice-bilirubin", fig: "Fig 1", title: "Jaundice: bilirubin from red cells to gut", W, H, body,
  label: "An animated bilirubin pathway. Old red cells break down and release haem, which becomes unconjugated bilirubin. It travels in blood to the liver, where it is conjugated, then leaves in bile through the bile duct to the gut. Gut bacteria make urobilinogen and brown stool pigment; some urobilinogen reaches the kidney. A slider switches between pre-hepatic, hepatic and post-hepatic patterns, changing urine bilirubin and stool colour. Treatment ideas include phototherapy, relieving an obstruction and treating the underlying cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "jaund.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How bilirubin is handled.</strong> Old or damaged red cells are broken down, mainly in the spleen. Haem from haemoglobin becomes unconjugated bilirubin, which is not water soluble, travels in blood bound to albumin, and cannot appear in urine. Hepatocytes take it up and conjugate it (glucuronidation), making water soluble conjugated bilirubin that is excreted in bile. In the gut, bacteria convert it to urobilinogen; most becomes brown stercobilin in stool and a little is reabsorbed and excreted by the kidney. This is standard textbook teaching in physiology and medicine and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The three patterns.</strong> Pre-hepatic jaundice (for example excess haemolysis): mainly unconjugated bilirubin, no bilirubin in urine, more urobilinogen and normal to dark stool. Hepatic jaundice (liver cell injury or impaired conjugation): a mixed rise, bilirubin may appear in urine. Post-hepatic jaundice (blocked bile duct): mainly conjugated bilirubin, dark urine with bilirubin, pale clay coloured stool and little urobilinogen. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Phototherapy uses light on the skin to break down unconjugated bilirubin, relieving an obstruction restores bile flow, and treating the underlying cause tackles haemolysis or liver injury at its source. These are teaching toggles only.",
  ],
  simplified: "Haem oxygenase and biliverdin steps, albumin binding detail, enterohepatic cycling detail, Gilbert and other inherited syndromes, neonatal physiology detail, causes of each pattern, itch and fat malabsorption in obstruction, imaging, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.jd-liver{fill:color-mix(in srgb,var(--c-rbc) 38%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1.2}
.jd-gall{fill:#7fae5a;stroke:#4d7038;stroke-width:1.1}
.jd-duct{fill:none;stroke:#7fae5a;stroke-width:9;stroke-linecap:round;opacity:.85}
.jd-vessel{fill:color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 35%,#000);stroke-width:.8}
.jd-gut{fill:color-mix(in srgb,var(--c-eos) 28%,var(--c-tis));stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1.1}
.jd-kidney{fill:color-mix(in srgb,var(--c-rbc) 48%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.1}
.jd-stone{fill:#d8d2c4;stroke:#8a8474;stroke-width:1.2}
.jd-jaund{fill:#e8c832}
.jd-skin{fill:color-mix(in srgb,var(--c-neut) 35%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.jd-eye{fill:#fff;stroke:var(--anatomy-mid);stroke-width:.8}
.jd-iris{fill:#5a4632}
.jd-ray{stroke:#38b6d3;stroke-width:2.4;stroke-linecap:round}
.jd-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.jd-urine{fill:#e8d98a}.jd-urine-d{fill:#9a6a12}.jd-stool{fill:#7a4a22}.jd-stool-p{fill:#ddd3b8}
.p-un{--cc:#e8c832}.p-con{--cc:#e08a2e}.p-uro{--cc:#a8c86a}
.cl-haem{--cc:#b03040}
.dr-g-fill.g-un{fill:#e8c832}.dr-g-fill.g-con{fill:#e08a2e}.dr-g-fill.g-jau{fill:#d9b62a}.dr-g-fill.g-uri{fill:#c98a1e}.dr-g-fill.g-uro{fill:#7fae5a}.dr-g-fill.g-sto{fill:#8a5a2e}
`,
});
