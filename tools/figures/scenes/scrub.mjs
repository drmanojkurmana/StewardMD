/* Scrub typhus and rickettsial disease as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/scrub.mjs [--print-model]
 * Static layout here; organisms, leak, rash and gauges move in scrub.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610, CY = 265;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of illness", a: [0.3, 0.65, 1], names: ["early", "established", "severe"], ticks: ["early", "established", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "delayed, awaiting test results" },
    { label: "doxycycline early" },
    { label: "supportive care only" },
    { label: "doxycycline early with supportive care" },
  ],
  status: "Illness: {level} · {drug} ·",
  drugNames: ["delayed, awaiting tests", "doxycycline early", "supportive care only", "doxycycline with support"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const dox = drug === 1 || drug === 3 ? 1 : 0, sup = drug === 2 || drug === 3 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const B = cl(dox ? a * 0.15 : a * (0.55 + 0.45 * a));
  const E = cl(0.08 + 0.85 * a * (dox ? 0.38 : 1));
  const P = cl(0.05 + 0.85 * E);
  const F = cl(0.12 + 0.78 * a * (dox ? 0.45 : 1) - sup * 0.08);
  const O = cl(0.04 + 0.88 * P * (0.45 + 0.55 * a) - sup * 0.12);
  const BP = cl(0.95 - 0.55 * P - 0.25 * O + sup * 0.3);
  const Sh = cl(1.05 - BP);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.5, ["controlled", "present", "spreading"]), w(E, 0.3, 0.6, ["mild", "inflamed", "severe"]), w(P, 0.3, 0.6, ["tight", "leaky", "very leaky"]), w(O, 0.3, 0.6, ["none yet", "some", "widespread"]), w(BP, 0.5, 0.75, ["failing", "weak", "steady"])];
  return { a, dox, sup, B, E, P, F, O, BP, Sh, words, readout: "organism " + words[0] + " · vessel injury " + words[1] + " · wall " + words[2] + " · organs " + words[3] + " · circulation " + words[4] };
}
const TESTS = [
  [2, 0, "organism spreading · vessel injury severe · wall very leaky · organs widespread · circulation failing"],
  [2, 3, "organism controlled · vessel injury inflamed · wall leaky · organs none yet · circulation steady"],
  [1, 2, "organism spreading · vessel injury severe · wall leaky · organs some · circulation steady"],
  [1, 1, "organism controlled · vessel injury mild · wall tight · organs none yet · circulation weak"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect id="fever" class="scr-fever" x="14" y="44" width="${W - 28}" height="396" rx="18" opacity="0"/>
<rect id="oedema" class="sc-oed" x="14" y="44" width="${W - 28}" height="187" rx="18" opacity="0"/>
<rect class="scr-skin" x="34" y="146" width="250" height="9" rx="4"/>
<g id="mite"><ellipse class="scr-mite" cx="88" cy="118" rx="13" ry="9"/><path class="scr-leg" d="M78 112L64 102M78 124L64 132M98 112L112 102M98 124L112 132M82 110L74 98M94 110L102 98"/></g>
<g id="eschar"><circle class="scr-eschar-c" cx="122" cy="150" r="20"/><circle class="scr-eschar-i" cx="122" cy="150" r="10"/></g>
<g id="rash"><circle class="scr-rash-s" cx="790" cy="150" r="6"/><circle class="scr-rash-s" cx="822" cy="172" r="5"/><circle class="scr-rash-s" cx="855" cy="148" r="6"/><circle class="scr-rash-s" cx="880" cy="178" r="5"/><circle class="scr-rash-s" cx="812" cy="198" r="5"/><circle class="scr-rash-s" cx="862" cy="202" r="6"/><circle class="scr-rash-s" cx="900" cy="152" r="4"/></g>
<rect id="lumen" class="sc-lumen" x="14" y="235" width="${W - 28}" height="60"/>
<g id="rbcs"></g>
<g id="endo"></g>
<path id="stubL" class="scr-stub" d="M179 300L179 326"/>
<path id="stubB" class="scr-stub" d="M471 300L471 328"/>
<path id="stubK" class="scr-stub" d="M743 300L743 356"/>
<g id="lungSlot"></g>
<g id="brainSlot"></g>
<g id="kidneySlot"></g>
<ellipse id="glowL" class="scr-glow" cx="180" cy="369" rx="55" ry="45" opacity="0"/>
<ellipse id="glowB" class="scr-glow" cx="480" cy="369" rx="70" ry="48" opacity="0"/>
<ellipse id="glowK" class="scr-glow" cx="780" cy="369" rx="55" ry="48" opacity="0"/>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "scrub-typhus-rickettsia", fig: "Fig 1", title: "Scrub typhus and rickettsial disease: bite to vasculitis", W, H, body,
  label: "An animated rickettsial scene. A mite bite plants germs in the skin, sometimes leaving an eschar. The germs invade the lining of small vessels, injuring walls so plasma leaks out. Fever and rash follow as skin vessels are injured. Germs travel in blood to lung, brain and kidney, which suffer as injury widens. Doxycycline shrinks the germs and closes the leak, while fluids and support steady circulation. A slider sets the stage, and treatment choices contrast delayed treatment with early doxycycline and supportive care.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "scrub.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without early doxycycline", withLabel: "With doxycycline and support",
  extraCss: `
.scr-fever{fill:var(--c-bad)}
.scr-skin{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.7}
.scr-mite{fill:#8a6f4d;stroke:#5d4830;stroke-width:1}.scr-leg{fill:none;stroke:#5d4830;stroke-width:1.2;stroke-linecap:round}
.scr-eschar-c{fill:#6b4a3a;stroke:#3d2a20;stroke-width:1}.scr-eschar-i{fill:#2e2019}
.scr-rash-s{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.6}
.scr-stub{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke-width:9;stroke-linecap:round;opacity:.75}
.scr-glow{fill:var(--c-bad);stroke:none}
.scr-cap{fill:var(--anatomy-strong);font-size:12px}
.p-rick{fill:#e07a2f;stroke:#8a4a18;stroke-width:.5}
`,
  sourcesLis: [
    "<strong>How rickettsial disease develops.</strong> Scrub typhus is carried by mites, other rickettsial illnesses by ticks or lice. Orientia or Rickettsia organisms enter at the bite, where an eschar may form, then invade endothelial cells lining small vessels throughout the body. Infected endothelium produces vasculitis and increased vascular permeability, so plasma leaks, edema forms and circulating volume falls. Fever is usual from the first days and the presentation can look viral early, so specific clues such as an eschar, exposure and the course of illness matter. A rash appearing as skin vessels are involved, pulmonary involvement with pneumonitis, meningoencephalitis and other multi-organ involvement follow in severe disease, and untreated severe illness can progress to shock. This is standard teaching in medicine, infectious-disease and tropical-medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Doxycycline should be considered early when rickettsial disease is suspected, because waiting for serologic test results delays treatment and serology often only returns later. Supportive care with fluids and organ support helps circulation but does not clear the organism, and appropriate early treatment usually brings prompt return toward recovery. These are teaching toggles only.",
  ],
  simplified: "The different rickettsial species and vectors in detail, eschar search and exposure history, laboratory confirmation and timing of antibody tests, mimics, pregnancy and allergy alternatives, complications by organ, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
