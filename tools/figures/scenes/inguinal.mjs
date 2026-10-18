/* Inguinal canal and hernias as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/inguinal.mjs [--print-model]
 * Static layout here; hernia sacs, cord flow and gauges move in inguinal.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How stuck is the hernia", a: [0.25, 0.6, 1], names: ["reducible", "irreducible", "strangulated"], ticks: ["reducible", "irreducible", "strangulated"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "truss concept (support pad, holds it in)" },
    { label: "elective repair (planned mesh repair)" },
    { label: "emergency surgery (urgent operation)" },
  ],
  status: "Hernia: {level} · {drug} ·",
  drugNames: ["no treatment", "a truss", "elective repair", "emergency surgery"],
};
function modelOf(S, level, drug) {
  const baseSac = [0.55, 0.9, 1];
  const baseTrapped = [0.08, 0.85, 1];
  const baseIsch = [0.04, 0.28, 1];
  const baseSwell = [0.18, 0.55, 1];
  const baseObst = [0.04, 0.38, 0.9];
  const cl = (v) => Math.max(0, Math.min(1, v));
  let sac = baseSac[level], trapped = baseTrapped[level], isch = baseIsch[level], swell = baseSwell[level], obst = baseObst[level], repair = 0.08;
  const truss = drug === 1 ? 1 : 0, elect = drug === 2 ? 1 : 0, emerg = drug === 3 ? 1 : 0;
  if (truss) { repair = 0.12; if (level === 0) { sac = sac * 0.25; trapped = 0.05; swell = swell * 0.7; } else { swell = cl(swell + 0.08); } }
  if (elect) { repair = 0.85; sac = 0.08; trapped = 0.06; if (level === 2) { isch = 0.68; obst = 0.58; swell = 0.75; } else { isch = isch * 0.4; obst = obst * 0.4; swell = swell * 0.45; } }
  if (emerg) { repair = 0.9; sac = 0.04; trapped = 0.02; isch = level === 2 ? 0.18 : isch * 0.3; obst = obst * 0.2; swell = swell * 0.35; }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(sac, 0.2, 0.6, ["held in", "out", "stuck out"]), w(isch, 0.2, 0.6, ["intact", "at risk", "cut off"]), w(obst, 0.2, 0.6, ["flowing", "slowing", "blocked"])];
  return { a: S.level.a[level], sac, trapped, isch, swell, obst, repair, truss, elect, emerg, words, readout: "sac " + words[0] + " · blood supply " + words[1] + " · bowel " + words[2] };
}
const TESTS = [
  [0, 0, "sac out · blood supply intact · bowel flowing"],
  [2, 0, "sac stuck out · blood supply cut off · bowel blocked"],
  [0, 1, "sac held in · blood supply intact · bowel flowing"],
  [2, 3, "sac held in · blood supply intact · bowel flowing"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ABDOMINAL WALL</text>
<ellipse class="in-bowel" cx="150" cy="92" rx="58" ry="30"/>
<ellipse class="in-bowel2" cx="138" cy="84" rx="30" ry="14"/>
<path class="in-perit" d="M62 132Q210 64 372 128"/>
<polygon class="in-canal" points="240,124 622,268 642,322 260,178"/>
<polygon class="in-hess" points="340,180 545,245 455,338"/>
<rect class="in-rectus" x="548" y="96" width="66" height="238" rx="10"/>
<path class="in-lig" d="M115 340L725 340"/>
<path class="in-cord" d="M250 150L632 295C658 328 678 354 700 380"/>
<path class="in-cord2" d="M244 162L626 307C652 338 674 362 694 386"/>
<path class="in-ant" d="M240 124L622 268"/>
<path class="in-post" d="M260 178L642 322"/>
<path class="in-vess" d="M335 82C325 140 345 190 335 238"/>
<path class="in-vess2" d="M347 82C337 140 357 190 347 238"/>
<ellipse class="in-ring" cx="250" cy="150" rx="15" ry="26" transform="rotate(62 250 150)"/>
<ellipse class="in-ring" cx="632" cy="295" rx="14" ry="24" transform="rotate(62 632 295)"/>
<ellipse class="in-scrot" cx="705" cy="388" rx="42" ry="32"/>
<g id="sacD"></g><g id="sacI"></g><g id="dots"></g><g id="treat"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "inguinal-canal-hernia", fig: "Fig 1", title: "Inguinal canal and hernias: indirect, direct and strangulation", W, H, body,
  label: "An animated front view of the inguinal canal. The canal runs obliquely from the deep ring laterally to the superficial ring medially, carrying the spermatic cord. An indirect hernia sac enters the deep ring lateral to the inferior epigastric vessels and follows the canal. A direct bulge pushes through the weak posterior wall inside Hesselbach triangle, medial to the vessels. Gauges show how far the sac is out, trapping, blood supply, swelling, bowel obstruction and wall repair. The level slider moves from reducible to irreducible to strangulated, and treatments include a truss concept, elective repair and emergency surgery.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "inguinal.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>Anatomy shown.</strong> The inguinal canal is an oblique passage in the lower abdominal wall. It opens at the deep inguinal ring laterally and the superficial inguinal ring medially, has an anterior wall and a posterior wall, and transmits the spermatic cord in this drawing. The inferior epigastric vessels lie medial to the deep ring. Hesselbach triangle is bounded by those vessels laterally, the rectus abdominis medially and the inguinal ligament below. This is standard teaching in anatomy and surgery texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Hernia ideas shown.</strong> An indirect hernia enters through the deep ring, lateral to the inferior epigastric vessels, and follows the canal, sometimes reaching the scrotum. A direct hernia pushes forward through a weak posterior wall inside Hesselbach triangle, medial to the vessels. A reducible hernia can be pushed back, an irreducible hernia is trapped outside, and a strangulated hernia has its blood supply cut off, with swelling and bowel obstruction. A truss can only hold a reducible hernia in and does not cure it. Elective repair strengthens the posterior wall for a hernia that is not strangulated, while strangulation needs emergency surgery. These are teaching toggles only.",
  ],
  simplified: "Femoral hernias, the detailed layers and muscles forming each wall, conjoint tendon and reflexions, cord structures in detail, women and the round ligament, infant and congenital cases, operative technique, mesh choices, complications and all clinical decision rules are left out. The two sacs are shown together to compare routes and would not usually be drawn as one patient. The figure does not say how any patient should be treated.",
  extraCss: `
.in-bowel{fill:#d98a7a;stroke:#a85a4c;stroke-width:1.2}.in-bowel2{fill:#e8a894;stroke:#a85a4c;stroke-width:.8}
.in-perit{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:5 4}
.in-canal{fill:#e8cfa0;stroke:#b8935a;stroke-width:1.2;opacity:.85}
.in-hess{fill:#7ab8ff;stroke:#2f7ad8;stroke-width:1.2;stroke-dasharray:6 4;opacity:.28}
.in-rectus{fill:#c97a8a;stroke:#9a5566;stroke-width:1;opacity:.55}
.in-lig{fill:none;stroke:#8a6a3a;stroke-width:7;stroke-linecap:round;opacity:.8}
.in-cord{fill:none;stroke:#d63a4a;stroke-width:3;stroke-linecap:round;opacity:.75}
.in-cord2{fill:none;stroke:#3a86b8;stroke-width:2.4;stroke-linecap:round;opacity:.75}
.in-ant{fill:none;stroke:#e9a2b3;stroke-width:9;stroke-linecap:round;opacity:.85}
.in-post{fill:none;stroke:#b66a86;stroke-width:9;stroke-linecap:round;opacity:.85}
.in-vess{fill:none;stroke:#d63a4a;stroke-width:4;stroke-linecap:round}
.in-vess2{fill:none;stroke:#3a86b8;stroke-width:3;stroke-linecap:round}
.in-ring{fill:#2b1c22;stroke:#f2d27a;stroke-width:2.4}
.in-scrot{fill:#e0b090;stroke:#a87a52;stroke-width:1.2}
.cl-sac{--cc:#e8a34a}.cl-sac2{--cc:#e07a5a}
.in-sacisch{fill:#e5484d;opacity:0}
.in-mesh{fill:#3ddc97;stroke:#0f9f76;stroke-width:1;opacity:.5}
.in-meshln{stroke:#0f9f76;stroke-width:.8;opacity:.7}
.in-truss{fill:#f2d27a;stroke:#b8962f;stroke-width:1.4}
.in-emerg{fill:#e5484d;stroke:#e5484d;stroke-width:1.6;stroke-dasharray:6 4;opacity:.18}
.p-flow{--cc:#fff3d6}.p-cordot{--cc:#ffd24a}
.dr-g-fill.g-sac{fill:#e8a34a}.dr-g-fill.g-rep{fill:var(--c-good)}
`,
});
