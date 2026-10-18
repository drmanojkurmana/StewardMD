/* Iron deficiency anaemia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/irondef.mjs [--print-model]
 * Static layout here; iron, transferrin, ferritin, red cells and gauges move in irondef.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of iron deficiency", a: [0.25, 0.6, 1], names: ["stores depleted", "iron-deficient erythropoiesis", "anaemia"], ticks: ["stores depleted", "deficient making", "anaemia"], start: 2 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "oral iron" },
    { label: "IV iron" },
    { label: "treat the cause" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "oral iron", "IV iron", "treating the cause"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const s = S.level.a[level];
  const oral = drug === 1 ? 1 : 0, iv = drug === 2 ? 1 : 0, causeRx = drug === 3 ? 1 : 0;
  const Stores = cl(0.92 - 0.92 * s + oral * 0.35 + iv * 0.55 + causeRx * 0.18);
  const Tf = cl(0.88 - 0.62 * s + oral * 0.22 + iv * 0.42 + causeRx * 0.12);
  const Hb = cl(1.02 - 0.75 * s * s + oral * 0.22 + iv * 0.38 + causeRx * 0.10);
  const Size = cl(1 - 0.58 * s * s + oral * 0.16 + iv * 0.26 + causeRx * 0.07);
  const Colour = cl(0.99 - 0.66 * s * s + oral * 0.18 + iv * 0.30 + causeRx * 0.08);
  const Sympt = cl(0.06 + 0.88 * (1 - Hb));
  const Abs = cl(0.30 + 0.55 * s - oral * 0.15 - iv * 0.25);
  const Leak = cl(0.85 * s - causeRx * 0.75);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const cellWord = Size < 0.65 ? "small and pale" : Size < 0.85 ? "smaller and paler" : "normal";
  const words = [w(Stores, 0.35, 0.72, ["empty", "low", "replete"]), w(Hb, 0.45, 0.78, ["low", "reduced", "normal"]), cellWord];
  return { s, oral, iv, causeRx, Stores, Tf, Hb, Size, Colour, Sympt, Abs, Leak, words, readout: "stores " + words[0] + " · haemoglobin " + words[1] + " · red cells " + words[2] };
}
const TESTS = [
  [0, 0, "stores low · haemoglobin normal · red cells normal"],
  [1, 0, "stores low · haemoglobin reduced · red cells smaller and paler"],
  [2, 0, "stores empty · haemoglobin low · red cells small and pale"],
  [2, 2, "stores low · haemoglobin reduced · red cells smaller and paler"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">DUODENUM</text>
<text class="sc-zone" x="330" y="68">BLOOD</text>
<text class="sc-zone" x="340" y="292">STORE</text>
<text class="sc-zone" x="34" y="292">CAUSES</text>
<g id="gut"></g><g id="vess"></g><g id="store"></g><g id="marrow"></g><g id="causes"></g><g id="preview"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-iron:#f08a3d;--c-ferr:#d9a03c;--c-trans:#38b6c9}
body[data-theme="light"]{--c-iron:#d96f1f;--c-ferr:#a87a22;--c-trans:#1f8fa3}
.id-gut{fill:none;stroke:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid));stroke-width:24;stroke-linecap:round}
.id-gutIn{fill:none;stroke:color-mix(in srgb,var(--c-endo) 22%,var(--anatomy-paper));stroke-width:13;stroke-linecap:round}
.id-villus{stroke:color-mix(in srgb,var(--c-endo) 70%,var(--anatomy-mid));stroke-width:1.6;stroke-linecap:round}
.id-vess{fill:color-mix(in srgb,var(--c-rbc) 13%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 48%,var(--anatomy-mid));stroke-width:1.6}
.id-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1;opacity:.8}
.id-bone{fill:color-mix(in srgb,#e8dcc0 72%,var(--anatomy-paper));stroke:color-mix(in srgb,#cbb98f 60%,#000);stroke-width:1.2}
.id-marrowIn{fill:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:1}
.id-ferr{fill:var(--c-ferr);stroke:color-mix(in srgb,var(--c-ferr) 55%,#000);stroke-width:.6}
.id-person{fill:none;stroke:var(--anatomy-strong);stroke-width:2.2;stroke-linecap:round}
.id-zzz{fill:var(--anatomy-mid);font:700 13px var(--anatomy-mono)}
.id-causeT{fill:var(--anatomy-text);font:11px var(--anatomy-mono)}
.p-iron{--cc:var(--c-iron)}.p-trans{--cc:var(--c-trans)}
.p-caps{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}.p-caps2{fill:var(--c-iron);opacity:.75}
.p-leak{fill:var(--c-rbc)}
.dr-g-fill.g-iron{fill:var(--c-iron)}.dr-g-fill.g-ferr{fill:var(--c-ferr)}.dr-g-fill.g-trans{fill:var(--c-trans)}
`;

buildScene({
  id: "iron-deficiency-anaemia", fig: "Fig 1", title: "Iron deficiency anaemia: from gut to red cell", W, H, body, extraCss,
  label: "An animated gut, blood vessel, iron store, bone marrow and red cell preview. Iron from food is absorbed in the duodenum, carried in blood by transferrin to the marrow, and stored as ferritin. Blood loss, poor intake and malabsorption drain iron. As deficiency deepens the stores empty first, then iron-deficient red cell making begins, then anaemia with small pale red cells and symptoms. Gauges show stores, blood iron, haemoglobin, red cell size, red cell colour and symptoms. Treatment choices include oral iron, IV iron and treating the cause.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "irondef.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How iron normally moves.</strong> Iron from food is absorbed mainly in the duodenum. In blood it is carried by the transport protein transferrin to the bone marrow, where it is built into haem for haemoglobin in new red cells. Spare iron is held in the storage protein ferritin, mostly in the liver and marrow. This is standard teaching in medicine and haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>How deficiency develops.</strong> Iron is lost or never taken in faster than it is absorbed: chronic blood loss (for example from the gut or heavy periods), poor dietary intake, and malabsorption (for example coeliac disease or after gut surgery) are the classic causes. The body has no active way to excrete iron, so balance is set at absorption. First the ferritin stores empty while haemoglobin is still normal, then the marrow makes red cells short of iron (iron-deficient erythropoiesis), and only then does haemoglobin fall (anaemia). Flagged for review.",
    "<strong>What the anaemia looks and feels like.</strong> Red cells made without enough iron are small (microcytic) and pale (hypochromic), with less haemoglobin in each cell. Symptoms follow the low haemoglobin and the empty stores: tiredness, pallor, breathlessness on effort, and features such as brittle nails, hair loss and pica in some people. Flagged for review.",
    "<strong>Treatment ideas shown.</strong> Oral iron is absorbed through the duodenum and slowly refills stores. IV iron bypasses the gut and refills stores faster, useful when absorption fails or losses continue. Treating the cause stops the leak at its source but on its own does not quickly replace iron already lost, so it is often combined with iron. These are teaching toggles only.",
  ],
  simplified: "Hepcidin control of absorption, iron recycling from old red cells by macrophages, the laboratory pattern (ferritin, transferrin saturation, blood film), other causes of microcytic anaemia such as thalassaemia, pregnancy and childhood demand, transfusion, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
