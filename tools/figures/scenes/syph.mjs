/* Syphilis stages as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/syph.mjs [--print-model]
 * Static layout here; spirochetes, lesions and gauges move in syph.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

const MD = {
  level: { label: "Stage of syphilis", a: [0, 1, 2], names: ["primary", "secondary", "tertiary"], ticks: ["primary", "secondary", "tertiary"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "penicillin" },
    { label: "follow-up serology only" },
    { label: "penicillin for neurosyphilis" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "penicillin", "follow-up serology only", "penicillin for neurosyphilis"],
};
function modelOf(S, level, drug) {
  const baseT = [
    { org: 0.85, les: 0.85, dis: 0.22, sero: 0.38, imm: 0.5, late: 0.04, cong: 0.3, z1: 1, z2: 0.28, z3: 0.1 },
    { org: 0.95, les: 0.95, dis: 0.95, sero: 0.95, imm: 0.88, late: 0.08, cong: 0.9, z1: 0.42, z2: 1, z3: 0.24 },
    { org: 0.28, les: 0.42, dis: 0.32, sero: 0.58, imm: 0.52, late: 0.95, cong: 0.22, z1: 0.18, z2: 0.3, z3: 1 },
  ];
  const b = baseT[level];
  const pen = drug === 1 || drug === 3 ? 1 : 0;
  const neuro = drug === 3 ? 1 : 0;
  const fol = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const Org = cl(b.org * (pen ? 0.12 : 1));
  const Les = cl(b.les * (pen ? (level === 2 ? 0.65 : 0.22) : 1));
  const Dis = cl(b.dis * (pen ? 0.18 : 1));
  const Sero = cl(b.sero * (pen ? 0.35 : 1));
  const Imm = cl(b.imm * (pen ? 0.55 : 1));
  const Late = cl(b.late * (pen ? (level === 2 ? (neuro ? 0.68 : 0.78) : 0.35) : 1));
  const Cong = cl(b.cong * (pen ? 0.15 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [
    w(Org, 0.2, 0.55, ["cleared", "present", "many"]),
    w(Les, 0.25, 0.6, ["healed", "present", "widespread"]),
    w(Sero, 0.3, 0.65, ["falling", "reactive", "strongly reactive"]),
    w(Late, 0.25, 0.6, ["none", "early", "advanced"]),
  ];
  return { Org, Les, Dis, Sero, Imm, Late, Cong, pen, neuro, fol, level, Z1: b.z1, Z2: b.z2, Z3: b.z3, words, readout: "organisms " + words[0] + " · lesions " + words[1] + " · serology " + words[2] + " · late damage " + words[3] };
}
const TESTS = [
  [0, 0, "organisms many · lesions widespread · serology reactive · late damage none"],
  [1, 0, "organisms many · lesions widespread · serology strongly reactive · late damage none"],
  [2, 0, "organisms present · lesions present · serology reactive · late damage advanced"],
  [2, 3, "organisms cleared · lesions present · serology falling · late damage advanced"],
];

const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ENTRY AND CHANCRE</text>
<text class="sc-zone" x="360" y="68">BLOOD AND SKIN</text>
<text class="sc-zone" x="660" y="68">LATE ORGANS</text>
<g id="skinSlot"></g>
<g id="vesselSlot"></g>
<g id="rashSlot"></g>
<g id="brainSlot"></g>
<g id="aortaSlot"></g>
<g id="uterusSlot"></g>
<g id="chancreG"></g>
<g id="lymphG"></g>
<g id="rashG"></g>
<g id="gummaG"></g>
<g id="brainDots"></g>
<g id="placG"></g>
<g id="rbcs"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.cl-mac2{--cc:var(--c-mac)}.cl-lym2{--cc:var(--c-lymph)}
.sy-rim{fill:color-mix(in srgb,var(--c-bad) 22%,var(--anatomy-paper));stroke:var(--anatomy-strong);stroke-width:2}
.sy-ulcer{fill:color-mix(in srgb,var(--c-bad) 35%,var(--anatomy-paper));stroke:var(--c-bad);stroke-width:1.4}
.sy-rash{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:.6}
.sy-node{fill:color-mix(in srgb,var(--c-lymph) 28%,var(--anatomy-paper));stroke:var(--c-lymph);stroke-width:1.2}
.sy-plac{fill:color-mix(in srgb,var(--c-mast) 30%,var(--anatomy-paper));stroke:var(--c-mast);stroke-width:1.2}
.sy-cap{fill:var(--anatomy-strong);font-size:12px}
.p-spiro{fill:none;stroke:var(--c-bac);stroke-width:1.6;stroke-linecap:round}
.p-imm{--cc:var(--c-cyt)}
.dr-g-fill.g-sero{fill:var(--c-lymph)}.dr-g-fill.g-late{fill:var(--c-bad)}.dr-g-fill.g-imm{fill:var(--c-mac)}.dr-g-fill.g-org{fill:var(--c-bac)}.dr-g-fill.g-les{fill:var(--c-bad)}.dr-g-fill.g-dis{fill:var(--c-cyt2)}
`;

buildScene({
  id: "syphilis-stages", fig: "Fig 1", title: "Syphilis: chancre to late organ damage", W, H, body, extraCss,
  label: "An animated staging scene for syphilis. Spirochetes enter at a mucosal surface and form a painless chancre in primary disease. In secondary disease organisms spread in blood, with rash, condylomata lata, mucous patches, lymphadenopathy and strong serology. After a latent interval, untreated disease may cause tertiary gumma, cardiovascular aortitis and neurosyphilis, and infection in pregnancy may cause congenital disease. Gauges show organisms, lesions, spread, serology, immune response and late damage. Treatment choices include penicillin, follow-up serology only, and penicillin directed at neurosyphilis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numeric cutoffs are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "syph.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without penicillin", withLabel: "With penicillin for neurosyphilis",
  sourcesLis: [
    "<strong>How syphilis develops.</strong> Treponema pallidum is usually sexually transmitted and enters through mucosa or broken skin. After an incubation period it causes a usually painless, nontender primary chancre at the entry site, with local lymphadenopathy; the lesion is infectious and full of organisms, then heals even without treatment. Weeks later, secondary disease follows blood-borne spread: widespread lesions including a rash, condylomata lata and mucous patches, generalised lymphadenopathy, and sometimes ocular involvement. Macrophages and the immune response partly control organisms. Serologic tests become reactive: nontreponemal tests such as VDRL track activity, while treponemal tests usually stay reactive. A latent stage with no lesions may follow. In some untreated persons, late tertiary disease develops years later: gumma lesions, cardiovascular involvement such as aortitis, and neurosyphilis. Infection in pregnancy can cross the placenta and cause congenital syphilis. This is standard teaching in medicine and infectious-disease texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Penicillin clears organisms and heals lesions, and a regimen that reaches the nervous system is used when neurosyphilis is present. Follow-up serology only tracks the nontreponemal response; on its own it does not clear organisms. Existing late damage may persist even after organisms are cleared. These are teaching toggles only.",
  ],
  simplified: "Exact staging time spans, ocular and otosyphilis detail, HIV co-infection, allergy alternatives, test titres and follow-up intervals, partner management, and all doses are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
