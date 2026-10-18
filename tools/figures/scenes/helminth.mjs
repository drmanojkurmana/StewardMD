/* Intestinal helminth life cycles as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/helminth.mjs [--print-model]
 * Static layout here; eggs, larvae, gut worms and gauges move in helminth.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Worm shown", a: [0, 1, 2], names: ["roundworm (Ascaris)", "hookworm", "tapeworm (Taenia)"], ticks: ["roundworm", "hookworm", "tapeworm"], start: 0 },
  drugLabel: "Treatment and prevention",
  settings: [
    { label: "no treatment" },
    { label: "albendazole" },
    { label: "praziquantel" },
    { label: "sanitation and footwear" },
  ],
  status: "Worm: {level} · {drug} ·",
  drugNames: ["no treatment", "albendazole", "praziquantel", "sanitation and footwear"],
};
function modelOf(S, level, drug) {
  const WORMS = [
    { b: 0.82, mig: 0.8, an: 0.16, cy: 0 },
    { b: 0.78, mig: 0.72, an: 0.86, cy: 0 },
    { b: 0.72, mig: 0.34, an: 0.22, cy: 0.68 },
  ];
  const BURDEN = [
    [1, 0.12, 0.88, 1],
    [1, 0.3, 0.9, 1],
    [1, 0.48, 0.12, 1],
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const base = WORMS[level], bm = BURDEN[level][drug];
  const entry = drug === 3 ? 0.12 : 1;
  const B = cl(base.b * bm);
  const Sp = cl(B * (drug === 3 ? 0.18 : 0.95));
  const Mig = cl(base.mig * entry * (0.35 + 0.65 * bm));
  const An = cl(base.an * (0.2 + 0.8 * bm));
  const Cy = base.cy;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(B, 0.2, 0.55, ["cleared", "few", "many"]),
    w(Sp, 0.2, 0.5, ["blocked", "low", "high"]),
    w(An, 0.3, 0.6, ["none", "mild", "marked"]),
    w(Cy, 0.05, 0.75, ["none", "present", "extensive"]),
  ];
  return { B, Sp, Mig, An, Cy, bm, entry, words, readout: "adult worms " + words[0] + " · spread " + words[1] + " · anaemia " + words[2] + " · cysts " + words[3] };
}
const TESTS = [
  [0, 0, "adult worms many · spread high · anaemia none · cysts none"],
  [0, 1, "adult worms cleared · spread blocked · anaemia none · cysts none"],
  [1, 3, "adult worms many · spread blocked · anaemia marked · cysts none"],
  [2, 2, "adult worms cleared · spread blocked · anaemia none · cysts present"],
];

/* ---------------- static layout ---------------- */
const GY = 377;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="hel-zone" x="14" y="44" width="276" height="210" rx="16"/>
<rect class="hel-zone" x="302" y="44" width="316" height="210" rx="16"/>
<rect class="hel-zone" x="630" y="44" width="316" height="210" rx="16"/>
<rect class="hel-zone" x="14" y="266" width="${W - 28}" height="174" rx="16"/>
<text class="sc-zone" x="34" y="68">OUTSIDE</text>
<text class="sc-zone" x="322" y="68">ENTRY AND TRAVEL</text>
<text class="sc-zone" x="650" y="68">TISSUES AND HARM</text>
<text class="sc-zone" x="34" y="288">GUT AND WAY OUT</text>
<ellipse class="hel-food" cx="95" cy="135" rx="52" ry="20"/>
<circle class="hel-veg" cx="78" cy="130" r="9"/><circle class="hel-veg" cx="98" cy="138" r="8"/><circle class="hel-veg" cx="112" cy="128" r="7"/>
<g id="pork"><ellipse class="hel-pork" cx="215" cy="135" rx="48" ry="24"/><g id="cystPork"><circle class="hel-cystdot" cx="200" cy="128" r="5"/><circle class="hel-cystdot" cx="222" cy="140" r="5"/><circle class="hel-cystdot" cx="232" cy="124" r="4"/></g></g>
<rect class="hel-soil" x="24" y="192" width="256" height="52" rx="10"/>
<g id="soilEggs"></g>
<path class="hel-trachea" d="M470 78V112"/>
<ellipse class="hel-lung" cx="428" cy="140" rx="38" ry="42"/>
<ellipse class="hel-lung" cx="512" cy="140" rx="38" ry="42"/>
<rect class="hel-skin" x="330" y="208" width="180" height="18" rx="8"/>
<path class="hel-vessel" d="M390 208C420 184 438 168 458 156"/>
<g id="brainG"><ellipse class="hel-brain" cx="735" cy="128" rx="46" ry="30"/><g id="cystBrain"><circle class="hel-cystdot" cx="720" cy="120" r="5"/><circle class="hel-cystdot" cx="744" cy="136" r="5"/><circle class="hel-cystdot" cx="752" cy="116" r="4"/></g></g>
<g id="muscleG"><rect class="hel-muscle" x="828" y="98" width="88" height="58" rx="12"/><path class="hel-stripe" d="M838 112L906 112M838 128L906 128M838 144L906 144"/><g id="cystMuscle"><circle class="hel-cystdot" cx="858" cy="120" r="5"/><circle class="hel-cystdot" cx="882" cy="138" r="5"/></g></g>
<rect class="hel-panel2" x="650" y="192" width="276" height="60" rx="12"/>
<path class="hel-loop" d="M698 222a42 15 0 1 1 84 0a42 15 0 1 1 -84 0"/>
<rect class="hel-gutwallbit" x="812" y="208" width="84" height="28" rx="8"/>
<rect class="hel-gut" x="30" y="348" width="886" height="58" rx="16"/>
<path class="hel-wall" d="M30 348H916M30 406H916"/>
<g id="routes"></g><g id="worms"></g><g id="gutrbcs"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "intestinal-helminth-lifecycles", fig: "Fig 1", title: "Intestinal worms: entry, travel and harm", W, H, body,
  label: "An animated comparison of intestinal worms. Roundworm eggs are swallowed, hatch in the gut, travel through the lungs and return to the gut as adults. Hookworm larvae in soil pass through skin, travel to the lungs and gut, and adult worms cause blood loss and anaemia. With Taenia solium, cysts in undercooked pork give an adult tapeworm in the gut, while swallowed eggs can form cysts in brain and muscle. A separate loop shows Strongyloides larvae re-entering without leaving the host. Gauges show adult worms, spread, migration, anaemia and cysts.",
  caption: "Schematic, not to scale. Counts, speeds and gauge levels are qualitative and illustrative; no doses or numbers are shown or implied.",
  scene: { GY, W, H }, pageJs: readFileSync(join(HERE, "helminth.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  extraCss: `
body{--c-worm:#e59aa8;--c-worm2:#d9c27a;--c-egg:#d9c27a}
.hel-zone{fill:var(--c-tis);opacity:.45}
.hel-food{fill:color-mix(in srgb,#7fcf6a 42%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-veg{fill:#7fcf6a;stroke:color-mix(in srgb,#7fcf6a 55%,#000);stroke-width:.7}
.hel-pork{fill:color-mix(in srgb,#e59a88 58%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-cystdot{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1}
.hel-soil{fill:color-mix(in srgb,#8a6a42 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-lung{fill:color-mix(in srgb,var(--c-endo) 48%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-trachea{fill:none;stroke:var(--anatomy-strong);stroke-width:5;stroke-linecap:round}
.hel-skin{fill:color-mix(in srgb,#e9b88a 62%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-vessel{fill:none;stroke:var(--c-rbc);stroke-width:2;stroke-dasharray:4 4;opacity:.8}
.hel-brain{fill:color-mix(in srgb,var(--c-mac) 48%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-muscle{fill:color-mix(in srgb,var(--c-rbc) 36%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-stripe{fill:none;stroke:var(--anatomy-mid);stroke-width:1;opacity:.7}
.hel-panel2{fill:color-mix(in srgb,var(--c-lymph) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-loop{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-dasharray:5 4}
.hel-gutwallbit{fill:color-mix(in srgb,var(--c-endo) 38%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-gut{fill:color-mix(in srgb,var(--c-rbc) 10%,var(--anatomy-paper));stroke:none}
.hel-wall{fill:none;stroke:var(--c-endo);stroke-width:3;opacity:.85}
.hel-wormA{fill:none;stroke:var(--c-worm);stroke-width:13;stroke-linecap:round}
.hel-wormA2{fill:none;stroke:color-mix(in srgb,var(--c-worm) 70%,#fff);stroke-width:8;stroke-linecap:round}
.hel-wormH{fill:none;stroke:var(--c-worm);stroke-width:6;stroke-linecap:round}
.hel-seg{fill:var(--c-worm2);stroke:color-mix(in srgb,var(--c-worm2) 55%,#000);stroke-width:.7}
.hel-head{fill:var(--c-worm2);stroke:color-mix(in srgb,var(--c-worm2) 55%,#000);stroke-width:.7}
.p-egg{fill:var(--c-egg);stroke:color-mix(in srgb,var(--c-egg) 55%,#000);stroke-width:.7}
.p-eggdot{fill:color-mix(in srgb,var(--c-egg) 45%,#000)}
.p-larv{fill:none;stroke:var(--c-bac);stroke-width:2.4;stroke-linecap:round}
.p-drop{fill:var(--c-rbc)}
.p-cap{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.p-cap2{fill:var(--c-good)}
.hel-mark{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.hel-markx{stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.hel-boot{fill:color-mix(in srgb,#5fa8d3 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-route{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 5;opacity:.55}
`,
  sourcesLis: [
    "<strong>Roundworm and hookworm.</strong> Ascaris eggs are swallowed from soil, food or hands. They hatch in the small bowel, larvae pass through the bowel wall and blood to the lungs, break into the air spaces, are coughed up and swallowed, and mature in the gut. Hookworm eggs hatch in soil; infective larvae penetrate skin, usually of the feet, travel in blood to the lungs and then to the gut, where adults attach to the bowel wall and feed on blood, causing iron loss and anaemia. This is standard teaching in parasitology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Taenia solium, cysticercosis and Strongyloides.</strong> Eating undercooked pork containing Taenia solium cysts gives an adult tapeworm in the gut. Swallowing Taenia eggs shed by a human tapeworm carrier gives cysticercosis, with larvae forming cysts in tissues such as muscle and brain; that is a different outcome from having the adult worm. Strongyloides larvae can become infective inside the gut and re-enter through the bowel wall or skin around the anus, so infection can persist without new exposure from soil (autoinfection). Treatment ideas shown are by class and prevention only: albendazole, praziquantel, and sanitation with footwear. These are teaching toggles only.",
  ],
  simplified: "Worm burden, species other than those named, larval lung symptoms, seizures and eye disease from cysts, immune suppression and severe Strongyloides infection, drug choice by species and site, resistance, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
