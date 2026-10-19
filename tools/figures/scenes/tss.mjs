/* Toxic shock and necrotising fasciitis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/tss.mjs [--print-model]
 * Static layout here; bacteria, toxin, cells and gauges move in tss.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How far the infection has gone", a: [0, 1, 2], names: ["local infection", "toxic shock", "necrotising fasciitis"], ticks: ["local", "toxic shock", "necrotising"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "antibiotics with clindamycin" },
    { label: "source control by surgery" },
    { label: "IVIG concept" },
    { label: "antibiotics, surgery and IVIG" },
  ],
  status: "Infection: {level} · {drug} ·",
  drugNames: ["no treatment", "antibiotics with clindamycin", "source control by surgery", "IVIG concept", "antibiotics, surgery and IVIG"],
};
function modelOf(S, level, drug) {
  const MODES = [
    { bac: 0.42, sup: 0.14, fasc: 0.08, pain: 0.28, shockK: 0.25 },
    { bac: 0.68, sup: 1.0, fasc: 0.12, pain: 0.42, shockK: 1.0 },
    { bac: 0.95, sup: 0.58, fasc: 1.0, pain: 1.0, shockK: 0.68 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const mode = MODES[level];
  const abx = drug === 1 || drug === 4 ? 1 : 0;
  const surg = drug === 2 || drug === 4 ? 1 : 0;
  const ivig = drug === 3 || drug === 4 ? 1 : 0;
  const B = cl(mode.bac * (abx ? 0.22 : 1) * (surg ? 0.3 : 1));
  const T = cl(mode.sup * (abx ? 0.32 : 1) * (surg ? 0.42 : 1) * (ivig ? 0.28 : 1));
  const C = cl(0.06 + 0.82 * T + 0.18 * B);
  const F = cl(mode.fasc * (abx ? 0.55 : 1) * (surg ? 0.14 : 1));
  const Pain = cl(mode.pain * (surg ? 0.35 : 1) * (abx ? 0.75 : 1));
  const Shock = cl(0.04 + 0.88 * C * mode.shockK + 0.18 * F);
  const Rash = cl(0.05 + 0.9 * T * mode.shockK + 0.25 * C * mode.shockK);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(B, 0.2, 0.55, ["controlled", "present", "spreading"]), w(C, 0.3, 0.62, ["low", "raised", "very high"]), w(F, 0.15, 0.5, ["intact", "threatened", "spreading"])];
  return { abx, surg, ivig, B, T, C, F, Pain, Shock, Rash, words, readout: "infection " + words[0] + " · cytokines " + words[1] + " · fascia " + words[2] };
}
const TESTS = [
  [0, 0, "infection present · cytokines low · fascia intact"],
  [1, 0, "infection spreading · cytokines very high · fascia intact"],
  [2, 0, "infection spreading · cytokines very high · fascia spreading"],
  [2, 4, "infection controlled · cytokines low · fascia intact"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="skinSlot"></g>
<g id="muscleSlot"></g>
<text class="sc-zone" x="34" y="68">SKIN WOUND</text>
<text class="sc-zone" x="478" y="68">TOXIN BRIDGE</text>
<text class="sc-zone" x="724" y="68">BODY</text>
<rect class="tss-fascia" x="60" y="218" width="340" height="12"/>
<rect id="necrosis" class="tss-nec" x="60" y="120" width="340" height="200" opacity="0.5"/>
<g id="tissue-detail"></g>
<rect id="excision" class="tss-excision" x="52" y="112" width="356" height="220" rx="12" opacity="0"/>
<g id="bacteria"></g>
<g id="bridge"></g>
<g id="vesselSlot"></g>
<rect class="tss-rashpatch" x="730" y="238" width="186" height="52" rx="10"/>
<g id="rash"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.tss-fascia{fill:#f2e6c8;stroke:#a89468;stroke-width:.8}
.tss-nec{fill:#2a2430;opacity:.55}
.tss-excision{fill:none;stroke:var(--c-good);stroke-width:2.2;stroke-dasharray:6 4}
.tss-rashpatch{fill:#d9a07a;stroke:#8a5a3a;stroke-width:.8;opacity:.85}
.tss-blotch{fill:#c42a3d}
.tss-shock{fill:var(--c-bad)}
.tss-mhc{fill:#38d1ff;stroke:#0a5a8a;stroke-width:.8}
.tss-tcr{fill:#e9b84a;stroke:#8a6a1a;stroke-width:.8}
.tss-sup{fill:#ff9a3d;stroke:#8a4a0a;stroke-width:.8}
.tss-block{fill:#5ec1a0;stroke:#1f6a54;stroke-width:.8}
.tss-spark{fill:none;stroke:#ffcf3d;stroke-width:1.6;stroke-linecap:round}
.tss-bubble{fill:#eaf6ff;stroke:#7ab8ff;stroke-width:.6;opacity:.75}
.tss-cap{fill:var(--anatomy-strong);font-size:12px}
.p-tox{fill:#ff9a3d;stroke:#8a4a0a;stroke-width:.6}
.p-ivig{fill:none;stroke:#5ec1a0;stroke-width:1.7;stroke-linecap:round}
`;

buildScene({
  id: "toxic-shock-necrotising-infection", fig: "Fig 1", title: "Toxic shock and necrotising infection", W, H, body, extraCss,
  label: "An animated scene of toxic shock and necrotising fasciitis. Bacteria in skin and fascia release superantigen toxin. The toxin bridges a presenting cell and a T cell without normal antigen processing, switching on many T cells at once and flooding the body with cytokines. That causes shock and rash. Along the fascia, infection spreads fast with severe pain, gas bubbles and tissue death. Gauges show bacteria, toxin, cytokines, fascial spread, pain and shock. Treatment choices include antibiotics with clindamycin, source control by surgery, and an IVIG concept.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "tss.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With antibiotics, surgery and IVIG",
  sourcesLis: [
    "<strong>Superantigen mechanism.</strong> Some staphylococcal and streptococcal toxins act as superantigens. Instead of sitting in the antigen groove after processing, they bind the outside of MHC class II on a presenting cell and the T cell receptor at the same time. That cross-links many T cells at once, regardless of their normal antigen specificity, and releases a large burst of cytokines. The result can be fever, rash, low blood pressure and toxic shock. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Necrotising fasciitis.</strong> Infection spreads rapidly along the fascial plane, aided by bacterial toxins and enzymes. Clues taught include pain that seems out of proportion to what is visible, rapid spread, dusky or dead tissue, and gas in the tissues that can feel like crepitus. The fascia and dead tissue are poorly reached by blood flow, which is why urgent surgical removal of dead tissue (source control) is central in teaching, alongside antibiotics. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Antibiotics kill bacteria, and clindamycin is taught as also switching off new toxin production. Surgery removes the infected and dead source tissue. IVIG is shown only as a concept: pooled antibodies that may bind and neutralise circulating toxin. These are teaching toggles only.",
  ],
  simplified: "Which organism, toxin names, antibiotic choices, scoring systems, surgical technique, IVIG evidence detail, intensive care support, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
