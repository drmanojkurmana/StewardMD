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
    { label: "sanitation and footwear" },
    { label: "praziquantel" },
    { label: "albendazole" },
  ],
  status: "Worm: {level} · {drug} ·",
  drugNames: ["no treatment", "sanitation and footwear", "praziquantel", "albendazole"],
};
function modelOf(S, level, drug) {
  const WORMS = [
    { b: 0.82, mig: 0.8, an: 0.16, cy: 0 },
    { b: 0.78, mig: 0.72, an: 0.86, cy: 0 },
    { b: 0.72, mig: 0.34, an: 0.22, cy: 0.68 },
  ];
  const BURDEN = [
    [1, 1, 0.88, 0.12],
    [1, 1, 0.9, 0.3],
    [1, 1, 0.12, 0.48],
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const base = WORMS[level], bm = BURDEN[level][drug];
  const san = drug === 1 ? 1 : 0;
  const entry = san ? 0.12 : 1;
  const B = cl(base.b * bm);
  const Sp = cl(B * (san ? 0.18 : 0.95));
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
  [0, 3, "adult worms cleared · spread blocked · anaemia none · cysts none"],
  [1, 1, "adult worms many · spread blocked · anaemia marked · cysts none"],
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
<rect id="drugwash" class="hel-wash" x="14" y="266" width="${W - 28}" height="174" rx="16" opacity="0"/>
<g id="skinSlot"></g>
<g id="lungSlot"></g>
<g id="brainSlot"></g>
<g id="musSlot"></g>
<g id="bowelSlot"></g>
<g id="colonSlot"></g>
<g id="cystBrain"><circle class="hel-cystdot" cx="700" cy="118" r="5"/><circle class="hel-cystdot" cx="722" cy="134" r="5"/><circle class="hel-cystdot" cx="732" cy="114" r="4"/></g>
<g id="cystMuscle"><circle class="hel-cystdot" cx="852" cy="112" r="5"/><circle class="hel-cystdot" cx="872" cy="128" r="5"/></g>
<path id="bloodv" class="hel-vessel" d="M357 211C400 205 450 190 490 175"/>
<g id="routes"></g><g id="worms"></g><g id="outG"></g><g id="gutrbcs"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "intestinal-helminth-lifecycles", fig: "Fig 1", title: "Intestinal worms: entry, travel and harm", W, H, body,
  label: "An animated comparison of intestinal worms. Roundworm eggs in dirty food or soil are swallowed, hatch in the gut, travel in blood through the lungs and return to the gut as adults. Hookworm larvae in soil pass through bare skin, travel to the lungs and gut, and adult worms bite the gut wall and feed on blood, causing anaemia. With Taenia solium, cysts in undercooked pork give an adult tapeworm in the gut, while swallowed eggs can form cysts in brain and muscle. Eggs leave in stool at the far end of the gut. Gauges show adult worms, spread, migration, anaemia and cysts.",
  caption: "Schematic, not to scale. Counts, speeds and gauge levels are qualitative and illustrative; no doses or numbers are shown or implied.",
  scene: { GY, W, H }, pageJs: readFileSync(join(HERE, "helminth.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With albendazole",
  extraCss: `
body{--c-worm:#e59aa8;--c-worm2:#d9c27a;--c-egg:#d9c27a}
.hel-zone{fill:var(--c-tis);opacity:.45}
.hel-food{fill:color-mix(in srgb,#7fcf6a 42%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-veg{fill:#7fcf6a;stroke:color-mix(in srgb,#7fcf6a 55%,#000);stroke-width:.7}
.hel-pork{fill:color-mix(in srgb,#e59a88 58%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-cystdot{fill:var(--anatomy-paper);stroke:var(--anatomy-strong);stroke-width:1}
.hel-soil{fill:color-mix(in srgb,#8a6a42 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-vessel{fill:none;stroke:var(--c-rbc);stroke-width:2.5;opacity:.85}
.hel-wash{fill:var(--c-good)}
.hel-wormA{fill:none;stroke:var(--c-worm);stroke-width:14;stroke-linecap:round}
.hel-wormA2{fill:none;stroke:color-mix(in srgb,var(--c-worm) 70%,#fff);stroke-width:9;stroke-linecap:round}
.hel-wormA3{fill:none;stroke:color-mix(in srgb,var(--c-worm) 80%,#fff);stroke-width:7;stroke-linecap:round}
.hel-wormH{fill:none;stroke:var(--c-worm);stroke-width:7;stroke-linecap:round}
.hel-seg{fill:var(--c-worm2);stroke:color-mix(in srgb,var(--c-worm2) 55%,#000);stroke-width:.7}
.hel-head{fill:var(--c-worm2);stroke:color-mix(in srgb,var(--c-worm2) 55%,#000);stroke-width:.7}
#worms.hel-dead .hel-wormA,#worms.hel-dead .hel-wormH{stroke:#8f8f7d}
#worms.hel-dead .hel-wormA2,#worms.hel-dead .hel-wormA3{stroke:#a9a999}
#worms.hel-dead .hel-seg,#worms.hel-dead .hel-head{fill:#9a9a8a;stroke:#5c5c50}
.hel-out{fill:none;stroke:#9a9a8a;stroke-width:9;stroke-linecap:round}
.hel-outbit{fill:#b9b9aa;stroke:#5c5c50;stroke-width:.7}
.p-egg{fill:var(--c-egg);stroke:color-mix(in srgb,var(--c-egg) 55%,#000);stroke-width:.7}
.p-eggdot{fill:color-mix(in srgb,var(--c-egg) 45%,#000)}
.p-larv{fill:none;stroke:var(--c-bac);stroke-width:2.4;stroke-linecap:round}
.p-drop{fill:var(--c-rbc)}
.p-cap{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.p-cap2{fill:var(--c-good)}
.p-bound{fill:#8ef4d2;stroke:#0b6e4f;stroke-width:.8}
.hel-mark{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.hel-markx{stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.hel-boot{fill:color-mix(in srgb,#5fa8d3 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.hel-route{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 5;opacity:.55}
.hel-cap{fill:var(--anatomy-strong)}
`,
  sourcesLis: [
    "<strong>Roundworm and hookworm.</strong> Ascaris eggs are swallowed from soil, food or hands. They hatch in the small bowel, larvae pass through the bowel wall and blood to the lungs, break into the air spaces, are coughed up and swallowed, and mature in the gut. Hookworm eggs hatch in soil; infective larvae penetrate skin, usually of the feet, travel in blood to the lungs and then to the gut, where adults attach to the bowel wall and feed on blood, causing iron loss and anaemia. This is standard teaching in parasitology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Taenia solium and cysticercosis.</strong> Eating undercooked pork containing Taenia solium cysts gives an adult tapeworm in the gut. Swallowing Taenia eggs shed by a human tapeworm carrier gives cysticercosis, with larvae forming cysts in tissues such as muscle and brain; that is a different outcome from having the adult worm, and clearing the gut worm does not remove cysts already formed. Treatment ideas shown are by class and prevention only: albendazole, praziquantel, and sanitation with footwear. These are teaching toggles only.",
  ],
  simplified: "Worm burden, species other than those named, Strongyloides autoinfection, larval lung symptoms, seizures and eye disease from cysts, immune suppression, drug choice by species and site, resistance, and all doses and schedules are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
