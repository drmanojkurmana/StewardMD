/* Kidney stones as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/stones.mjs [--print-model]
 * Static layout here; urine, crystals, stone and gauges move in stones.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stone size and position", a: [0.35, 0.65, 1], names: ["small, in kidney", "medium, at junction", "large, in ureter"], ticks: ["in kidney", "at junction", "in ureter"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "fluids and analgesia" },
    { label: "lithotripsy (shock waves)" },
    { label: "ureteroscopy (scope removal)" },
  ],
  status: "Stone: {level} · {drug} ·",
  drugNames: ["no treatment", "fluids and analgesia", "lithotripsy", "ureteroscopy"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], pos = [0, 0.55, 1][level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const fluids = drug === 1 ? 1 : 0, litho = drug === 2 ? 1 : 0, scope = drug === 3 ? 1 : 0;
  const SS = cl((0.62 + 0.3 * a) * (fluids ? 0.52 : 1) * (litho ? 0.9 : 1) * (scope ? 0.9 : 1));
  const St = cl(a * (litho ? 0.34 : 1) * (scope ? 0.07 : 1));
  const Ob = cl(St * (0.22 + 1.05 * pos) * (fluids && pos < 1 ? 0.82 : 1));
  const Hy = cl(Ob * 1.02 - 0.04);
  const Pa = cl(0.08 + Ob * 0.95 + pos * St * 0.18 - fluids * 0.68 - litho * 0.18 - scope * 0.55);
  const Inf = cl(Ob * 0.78 + Hy * 0.28 - scope * 0.25);
  const Fl = cl(0.92 - Ob * 0.82 + fluids * 0.22);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(St, 0.4, 0.72, ["tiny", "small", "large"]), w(Ob, 0.22, 0.55, ["none", "partial", "blocked"]), w(Pa, 0.25, 0.55, ["mild", "moderate", "severe"]), w(Inf, 0.25, 0.55, ["low", "raised", "high"])];
  return { a, pos, fluids, litho, scope, SS, St, Ob, Hy, Pa, Inf, Fl, words, readout: "stone " + words[0] + " · blockage " + words[1] + " · pain " + words[2] + " · infection risk " + words[3] };
}
const TESTS = [
  [0, 0, "stone tiny · blockage none · pain mild · infection risk low"],
  [2, 0, "stone large · blockage blocked · pain severe · infection risk high"],
  [2, 1, "stone large · blockage blocked · pain moderate · infection risk high"],
  [2, 3, "stone tiny · blockage none · pain mild · infection risk low"],
];

/* ---------------- static layout ---------------- */
const TYPES = [
  ["Ca oxalate", "Calcium oxalate: the commonest type. Hard, spiky crystals form when urine is concentrated or calcium or oxalate is high."],
  ["Uric acid", "Uric acid stones form in acidic, concentrated urine, often with gout or a purine rich diet. They do not show on a plain X ray."],
  ["Struvite", "Struvite stones grow fast with urease splitting urinary infections. They can fill the pelvis as a staghorn stone."],
  ["Cystine", "Cystine stones are uncommon and inherited. Poorly soluble cystine crystallises, often from childhood."],
];
const typeCards = TYPES.map((c, i) => { const x = 462 + i * 120;
  const shape = i === 0 ? `<path class="ks-tshape" d="M${x + 59} 66l10 12l-6 13l-13 3l-9 -9l3 -13z"/>` : i === 1 ? `<ellipse class="ks-tshape" cx="${x + 59}" cy="80" rx="15" ry="11"/>` : i === 2 ? `<path class="ks-tshape" d="M${x + 46} 68h26l7 12l-8 12h-24l-7 -12z"/>` : `<path class="ks-tshape" d="M${x + 59} 66l13 8v13l-13 8l-13 -8v-13z"/>`;
  return `<g class="hot" tabindex="0" data-info="${esc(c[1])}"><rect class="ks-card" x="${x}" y="56" width="112" height="62" rx="10"/>${shape}<text class="sc-lab" x="${x + 59}" y="110" text-anchor="middle">${esc(c[0])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">KIDNEY AND URINARY TRACT</text>
${typeCards}
<g id="tract"></g>
<g id="hydro"></g>
<g id="urine"></g>
<g id="crystals"></g>
<g id="stoneG"></g>
<g id="bugs"></g>
<g id="waves"></g>
<g id="scopeG"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "kidney-stones", fig: "Fig 1", title: "Kidney stones: crystal to colic and blockage", W, H, body,
  label: "An animated kidney, ureter and bladder. Concentrated urine becomes supersaturated, crystals nucleate on a surface in the renal pelvis and grow into a stone. Stone types are calcium oxalate, uric acid, struvite and cystine. As the stone grows and moves into the ureter it causes ureteric colic pain and blocks urine flow, so the pelvis swells with hydronephrosis and infection risk rises. Gauges show saturation, stone size, blockage, swelling, pain and infection risk. Treatments are fluids and analgesia, lithotripsy and ureteroscopy.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, sizes or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "stones.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How a stone forms.</strong> Urine carries calcium, oxalate, uric acid, cystine and other solutes. When urine is concentrated, or solute load is high, it becomes supersaturated and crystals can nucleate, often on a small surface deposit in the renal pelvis, then grow and stick together into a stone. Calcium oxalate is the commonest type; uric acid stones favour acidic urine; struvite stones grow with urease splitting infection and can form a staghorn; cystine stones are an uncommon inherited type. A stone still in the kidney may be silent. Once it enters the ureter, the ureter squeezes against it and urine is held back: that gives the severe, waving loin to groin pain of ureteric colic, obstruction upstream, swelling of the pelvis and calyces (hydronephrosis), and a raised risk of infection in the held back urine, which can be dangerous. This is standard teaching in urology and renal texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Fluids dilute the urine and analgesia eases colic pain, which may let a small stone pass. Lithotripsy focuses shock waves to fragment a stone into pieces that can pass. Ureteroscopy passes a fine scope up the ureter to see, fragment and remove the stone and relieve the blockage. These are teaching toggles only.",
  ],
  simplified: "Metabolic work up, stone prevention diets and medicines, pregnancy, single kidney and transplant kidneys, emergency drainage with a stent or nephrostomy for infected obstruction, open surgery, and all doses and size cut offs are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.ks-card{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ks-tshape{fill:#d9a441;stroke:#8a5f14;stroke-width:1}
.ks-kid{fill:color-mix(in srgb,var(--c-endo) 52%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1.2}
.ks-kid-in{fill:color-mix(in srgb,var(--c-fl) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-mid));stroke-width:1}
.ks-cal{fill:none;stroke:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-mid));stroke-width:5;stroke-linecap:round;opacity:.55}
.ks-ureter{fill:none;stroke:color-mix(in srgb,var(--c-endo) 60%,var(--anatomy-mid));stroke-width:13;stroke-linecap:round}
.ks-ureter-in{fill:none;stroke:color-mix(in srgb,var(--c-fl) 20%,var(--anatomy-paper));stroke-width:6;stroke-linecap:round}
.ks-blad{fill:color-mix(in srgb,var(--c-fl) 18%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-mid));stroke-width:1.4}
.ks-hydro{fill:color-mix(in srgb,var(--c-fl) 38%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:1;opacity:0}
.ks-stone{fill:#c98a2e;stroke:#7a4d0c;stroke-width:1.2}
.ks-facet{fill:none;stroke:#7a4d0c;stroke-width:.8;opacity:.7}
.ks-pain{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;opacity:0}
.ks-shock{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round;opacity:0}
.ks-scope{fill:none;stroke:var(--anatomy-strong);stroke-width:3;stroke-linecap:round;opacity:0}
.ks-scope-tip{fill:var(--c-good);opacity:0}
.p-urine{fill:var(--c-fl)}.p-crys{fill:#e9c84a;stroke:#8a5f14;stroke-width:.5}.p-frag{fill:#c98a2e;stroke:#7a4d0c;stroke-width:.5}.p-drop{fill:var(--c-fl)}
.cl-bug{--cc:#7fcf6a}
.dr-g-fill.g-ss{fill:#e9c84a}.dr-g-fill.g-st{fill:#c98a2e}.dr-g-fill.g-ob{fill:var(--c-bad)}.dr-g-fill.g-hy{fill:var(--c-fl)}
`,
});
