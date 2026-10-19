/* Hepatorenal syndrome as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hrs.mjs [--print-model]
 * Static layout here; vessels, signals, urine and gauges move in hrs.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of liver disease", a: [0.35, 0.7, 1], names: ["compensated cirrhosis", "ascites", "hepatorenal syndrome"], ticks: ["compensated", "ascites", "hepatorenal"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "albumin and a vasoconstrictor" },
    { label: "stop diuretics and nephrotoxins" },
    { label: "liver transplant" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "albumin and a vasoconstrictor", "stopping diuretics and nephrotoxins", "liver transplant"],
};
function modelOf(S, level, drug) {
  const LT = [
    { P: 0.38, D: 0.25, U: 0.18, R: 0.22, Rc: 0.18, K: 0.92, Asc: 0.05, UNa: 0.85 },
    { P: 0.68, D: 0.62, U: 0.55, R: 0.58, Rc: 0.52, K: 0.62, Asc: 0.68, UNa: 0.38 },
    { P: 0.92, D: 0.92, U: 0.88, R: 0.92, Rc: 0.94, K: 0.18, Asc: 0.92, UNa: 0.10 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const b = LT[level];
  let P = b.P, D = b.D, U = b.U, R = b.R, Rc = b.Rc, K = b.K, Asc = b.Asc, UNa = b.UNa;
  const alb = drug === 1 ? 1 : 0, halt = drug === 2 ? 1 : 0, txp = drug === 3 ? 1 : 0;
  if (alb) { P = cl(P * 0.92); D = cl(D * 0.70); U = cl(U * 0.42); R = cl(R * 0.45); Rc = cl(Rc * 0.40); K = cl(K + 0.48); Asc = cl(Asc * 0.82); UNa = cl(UNa + 0.42); }
  if (halt) { U = cl(U * 0.72); R = cl(R * 0.78); Rc = cl(Rc * 0.72); K = cl(K + 0.20); Asc = cl(Asc * 0.95); UNa = cl(UNa + 0.18); }
  if (txp) { P = 0.16; D = 0.14; U = 0.10; R = 0.12; Rc = 0.10; K = 0.96; Asc = 0.04; UNa = 0.88; }
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.35, 0.7, ["mild", "raised", "very high"]), w(1 - U, 0.35, 0.65, ["low", "reduced", "maintained"]), w(K, 0.35, 0.7, ["failing", "struggling", "working"]), w(UNa, 0.3, 0.6, ["very low", "low", "present"])];
  return { a: S.level.a[level], alb, halt, txp, P, D, U, R, Rc, K, Asc, UNa, words, readout: "portal pressure " + words[0] + " · arterial filling " + words[1] + " · kidney " + words[2] + " · urine salt " + words[3] };
}
const TESTS = [
  [2, 0, "portal pressure very high · arterial filling low · kidney failing · urine salt very low"],
  [2, 1, "portal pressure very high · arterial filling reduced · kidney struggling · urine salt low"],
  [2, 3, "portal pressure mild · arterial filling maintained · kidney working · urine salt present"],
  [0, 0, "portal pressure raised · arterial filling maintained · kidney working · urine salt present"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<path class="hr-arrow" d="M300 133L314 140L300 147Z"/>
<path class="hr-arrow" d="M510 133L524 140L510 147Z"/>
<path class="hr-arrow" d="M668 286L682 294L666 300Z"/>
<path id="v-portal" class="hr-vessel" d="M333 182L232 178"/>
<path id="v-art" class="hr-arta" d="M469 178L568 175"/>
<path id="v-renal" class="hr-renal" d="M600 253C614 283 660 300 693 318"/>
<path id="v-ureter" class="hr-ureter" d="M702 383C742 397 790 395 860 386"/>
<path id="beam" class="hr-beam" d="M604 253L650 285L693 318"/>
<g id="liverSlot"></g>
<g id="bowelSlot"></g>
<g id="vesselSlot"></g>
<g id="kidneySlot"></g>
<g id="bladderSlot"></g>
<g id="fluid"></g>
<g id="flow"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "hepatorenal-syndrome", fig: "Fig 1", title: "Hepatorenal syndrome: why the kidney fails", W, H, body,
  label: "An animated chain from a cirrhotic liver to a failing kidney. Portal pressure rises, gut vessels widen under nitric oxide, the effective arterial circulation feels empty, and the renin angiotensin and sympathetic systems switch on. They squeeze the kidney vessels so hard that the kidney fails even though its tissue is structurally normal, and very little salt appears in the urine. Gauges show portal pressure, arterial filling, the hormonal and nerve drive, renal squeeze, kidney function and urine salt. Treatment choices are albumin with a vasoconstrictor, stopping diuretics and kidney toxins, or transplant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hrs.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With a new liver",
  sourcesLis: [
    "<strong>How hepatorenal syndrome develops.</strong> In cirrhosis, scarring raises resistance in the liver and portal pressure climbs. Arteries in the gut circulation widen, driven in part by nitric oxide, so blood pools there and the effective arterial circulation is underfilled even though total body fluid is increased. The body reads this as blood loss and switches on the renin angiotensin system and the sympathetic nerves. Those signals protect the brain and heart but squeeze the kidney arteries intensely. The kidney then fails in a functional way: its tissue is structurally normal, blood flow and filtration fall, and the kidney holds on to salt so urine salt is very low. Ascites collects in parallel from portal pressure and salt and water retention. This is standard teaching in hepatology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Albumin expands the effective arterial circulation and a vasoconstrictor tightens the widened gut arteries, together easing the drive that squeezes the kidney. Stopping diuretics and other kidney toxins removes common triggers that tip the circulation over. Liver transplant is the definitive step because it removes the cirrhosis and portal hypertension driving the whole chain. These are teaching toggles only.",
  ],
  simplified: "Diagnostic criteria and urine tests in detail, infection and other triggers beyond the drug toggle, acute on chronic liver failure, dialysis and other bridging support, terlipressin and other drug choices by name, transplant assessment, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.hr-vessel{fill:none;stroke:color-mix(in srgb,var(--c-fl) 45%,var(--anatomy-paper));stroke-width:14;stroke-linecap:round}
.hr-renal{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper));stroke-width:10;stroke-linecap:round}
.hr-ureter{fill:none;stroke:#c9a86a;stroke-width:4;stroke-linecap:round}
.hr-arrow{fill:var(--anatomy-mid)}
.hr-beam{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:4 5;opacity:.65}
.hr-arta{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke-width:10;stroke-linecap:round;opacity:.8}
.hr-bowv{fill:none;stroke:color-mix(in srgb,#e08a5a 65%,var(--anatomy-paper));stroke-width:5;stroke-linecap:round}
.hr-nod{fill:#d99a76;stroke:#7a3e30;stroke-width:1}
.hr-sqz{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.hr-rec{fill:none;stroke:var(--c-lymph);stroke-width:1.6}
.hr-cap{fill:var(--anatomy-strong);font-size:12.5px}
.hr-pool{fill:var(--c-fl)}
.hr-surf{fill:none;stroke:var(--c-fl);stroke-width:2}
.p-raas{--cc:#e9b84a}.p-salt{--cc:#f2d27a}.p-alb{--cc:#eaf2ff}.p-block{--cc:#6fd3c8}.p-tox{--cc:#a8763a}.p-diur{--cc:#9fc4e8}
.dr-g-fill.g-portal{fill:#9a7fd0}.dr-g-fill.g-raas{fill:var(--c-neut)}
`,
});
