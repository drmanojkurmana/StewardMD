/* Hepatic encephalopathy and ammonia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hepenc.mjs [--print-model]
 * Static layout here; ammonia, urea and gauges move in hepenc.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Grade of encephalopathy", a: [0.25, 0.5, 0.78, 1], names: ["mild", "moderate", "severe", "coma"], ticks: ["mild", "moderate", "severe", "coma"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "lactulose" },
    { label: "rifaximin" },
    { label: "treat the precipitant" },
  ],
  status: "Grade: {level} · {drug} ·",
  drugNames: ["no treatment", "lactulose", "rifaximin", "treating the precipitant"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], lac = drug === 1 ? 1 : 0, rif = drug === 2 ? 1 : 0, prec = drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const prod = cl((0.18 + 0.82 * a) * (rif ? 0.55 : 1) * (prec ? 0.78 : 1));
  const shunt = cl(0.12 + 0.68 * a);
  const clearFrac = cl(0.92 - 0.62 * a);
  const urea = cl(prod * (1 - shunt) * clearFrac * 1.15);
  const escapeFrac = cl(shunt + (1 - shunt) * (1 - clearFrac));
  const blood = cl(prod * escapeFrac * (lac ? 0.42 : 1) * (prec ? 0.72 : 1) * 1.25);
  const swell = cl(blood * 1.05);
  const alert = cl(1 - swell * 0.95);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(blood, 0.28, 0.6, ["low", "raised", "high"]), w(swell, 0.28, 0.6, ["none", "mild", "marked"]), alert < 0.35 ? "low" : alert < 0.68 ? "reduced" : "normal"];
  return { a, lac, rif, prec, prod, shunt, clearFrac, urea, blood, swell, alert, words, readout: "blood ammonia " + words[0] + " · astrocyte swelling " + words[1] + " · alertness " + words[2] };
}
const TESTS = [
  [3, 0, "blood ammonia high · astrocyte swelling marked · alertness low"],
  [1, 0, "blood ammonia raised · astrocyte swelling mild · alertness reduced"],
  [3, 1, "blood ammonia raised · astrocyte swelling mild · alertness reduced"],
  [0, 0, "blood ammonia low · astrocyte swelling none · alertness normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path id="shunt" class="he-shunt" d="M266 306 C256 200 265 130 330 100 C360 88 430 90 500 100 C575 88 605 92 630 125 C655 165 680 210 700 236 C712 238 724 236 735.4 233.1"/>
<path id="vesselIn" class="he-vessel" d="M195 314.5 L430.5 285.7"/>
<path id="vesselOut" class="he-vessel" d="M442 106.7 C522 80.7 572 80.7 612 94.7 C650 108 680 180 700 236"/>
<path id="ureaOut" class="he-ureaout" d="M430.5 308 L430.5 362"/>
<g id="gutSlot"></g>
<g id="liverSlot"></g>
<g id="scars" class="he-scars"><circle cx="419" cy="143" r="13"/><circle cx="453" cy="152" r="10"/><circle cx="407" cy="190" r="12"/><circle cx="442" cy="200" r="9"/><circle cx="419" cy="219" r="8"/></g>
<circle id="cycle" class="he-cycle" cx="430" cy="190" r="24"/>
<ellipse id="brainGlow" class="he-glow" cx="800" cy="195" rx="92" ry="78" opacity="0"/>
<g id="brainSlot"></g>
<g id="flow"></g><g id="cells"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "hepatic-encephalopathy", fig: "Fig 1", title: "Hepatic encephalopathy: ammonia to the brain", W, H, body,
  label: "An animated ammonia pathway. Gut bacteria break down protein and make ammonia. Portal blood carries ammonia to the liver, where the urea cycle normally clears it. In cirrhosis the scarred liver clears less, and a portosystemic shunt lets portal blood bypass the liver, so ammonia reaches the brain. Astrocytes take it up and swell, and thinking falls from confusion toward coma. A slider sets the grade, and treatment choices are lactulose, rifaximin and treating the precipitant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hepenc.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With lactulose",
  sourcesLis: [
    "<strong>How ammonia is handled.</strong> Protein breakdown by gut bacteria releases ammonia. Portal blood carries it to the liver, where the urea cycle converts ammonia to urea for excretion. In cirrhosis, liver clearance fails and portosystemic shunting lets ammonia rich blood bypass the liver and reach the systemic circulation and brain. This is standard teaching in medicine and hepatology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>What happens in the brain.</strong> Astrocytes take up ammonia and convert it to glutamine, drawing in water and swelling. Swollen astrocytes and disturbed neurotransmission produce the spectrum from mild confusion and sleep disturbance through drowsiness to coma. The grade slider shows that spectrum qualitatively, without any clinical scoring detail. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Lactulose traps ammonia in the gut so it leaves in stool, rifaximin lowers ammonia making by gut bacteria, and treating the precipitant removes triggers such as infection, bleeding or dehydration that tip a patient into encephalopathy. These are teaching toggles only.",
  ],
  simplified: "Glutamine chemistry detail, other toxins and inflammatory mediators, brain imaging, clinical grading criteria, precipitant lists beyond examples in words, transplant and shunt procedures, and all doses and drug choices are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.he-glow{fill:var(--c-cyt2);stroke:none}
.he-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.he-vessel{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 42%,var(--anatomy-paper));stroke-width:17;stroke-linecap:round;opacity:.8}
.he-shunt{fill:none;stroke:var(--c-cyt2);stroke-width:7;stroke-linecap:round;stroke-dasharray:10 6;opacity:.4}
.he-ureaout{fill:none;stroke:var(--c-fl);stroke-width:5;stroke-linecap:round;stroke-dasharray:4 5;opacity:.6}
.he-scars{fill:color-mix(in srgb,#000 28%,transparent);stroke:none}
.he-cycle{fill:none;stroke:var(--c-fl);stroke-width:1.6;stroke-dasharray:5 4;opacity:.75}
.he-proc{stroke:var(--c-lymph);stroke-width:2;stroke-linecap:round;opacity:.8}
.cl-astro{--cc:var(--c-lymph)}.cl-prot{--cc:#b08954}
.p-nh3{--cc:#f08a2e}.p-nh4{--cc:var(--c-ab)}.p-urea{--cc:var(--c-fl)}
.dr-g-fill.g-nh3{fill:#f08a2e}.dr-g-fill.g-urea{fill:var(--c-fl)}.dr-g-fill.g-blood{fill:var(--c-bad)}.dr-g-fill.g-swell{fill:var(--c-cyt2)}
`,
});
