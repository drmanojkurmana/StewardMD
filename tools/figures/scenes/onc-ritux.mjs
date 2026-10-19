/* Rituximab as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-ritux.mjs [--print-model]
 * Static layout here; B cell kill, toxicity organs and gauges move in onc-ritux.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.3, 0.65, 1], names: ["early", "middle", "late"], ticks: ["early", "middle", "late"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "rituximab" },
    { label: "rituximab with premedication (slow infusion)" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "rituximab", "rituximab with premedication"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, prot = drug === 2 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.3 + 0.65 * a) : 0.04;
  const Inf = on ? cl((1.15 - 0.75 * a) * (prot ? 0.25 : 1)) : 0.02;
  const TLS = on ? cl(0.8 - 0.5 * a) : 0.02;
  const Liv = on ? cl(0.08 + 0.3 * a) : 0.02;
  const Brn = on ? cl(0.02 + 0.22 * a) : 0.01;
  const Irs = on ? cl(0.08 + 0.62 * a) : 0.05;
  const Neu = on ? cl(-0.12 + 0.62 * a) : 0.03;
  const Ab = 1 - Irs;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "dying", "gone"]), w(Inf, 0.3, 0.65, ["calm", "reacting", "severe"]), w(Ab, 0.35, 0.65, ["very low", "low", "ok"])];
  return { a, on, prot, K, Inf, TLS, Liv, Brn, Irs, Neu, Ab, words, readout: "B cells " + words[0] + " · infusion " + words[1] + " · antibodies " + words[2] };
}
const TESTS = [
  [0, 0, "B cells growing · infusion calm · antibodies ok"],
  [0, 1, "B cells dying · infusion severe · antibodies ok"],
  [2, 1, "B cells gone · infusion reacting · antibodies very low"],
  [2, 2, "B cells gone · infusion calm · antibodies very low"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="rx-zone" x="34" y="68">B CELL TARGET</text>
<text class="rx-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="bcell"></g>
<g id="mab"></g>
<g id="comp"></g>
<g id="nk"></g>
<g id="deb"></g>
<g id="vesSlot"></g><g id="vesFx"></g>
<g id="kidSlot"></g><g id="kidFx"></g>
<g id="livSlot"></g><g id="livFx"></g>
<g id="brnSlot"></g><g id="brnFx"></g>
<g id="dish"></g>
<g id="neut"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "rituximab-mechanism-adverse-effects", fig: "Fig 1", title: "Rituximab: B cell kill and side effects", W, H, body,
  label: "An animated B cell and toxicity organs. Rituximab coats CD20 on the B cell, then complement punches holes in it, an NK cell attacks it and it dies by apoptosis. Vessel, kidney, liver, brain, antibodies and marrow show infusion reaction, tumour lysis, hepatitis B, PML, low antibodies and late neutropenia. Gauges show B cell kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-ritux.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With premedication",
  sourcesLis: [
    "<strong>How rituximab works.</strong> Rituximab is an anti-CD20 antibody that coats B cells. Bound antibody triggers complement lysis, invites NK cell killing (ADCC) and pushes the cell toward apoptosis, so normal and malignant B cells die. Infusion reactions come from cytokine release as many B cells die at once, tumour lysis from spilled cell contents, and hepatitis B reactivation, PML, low antibodies with infection and late neutropenia from lost immune control. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Protection shown.</strong> Premedication plus a slow first infusion calms cytokine release; B cell kill and the other harms continue. This is a teaching toggle only.",
  ],
  simplified: "Other anti-CD20 drugs, combination chemo regimens, HBV screening and antiviral prophylaxis, TLS hydration care, immunoglobulin replacement, skin and bowel reactions, monitoring tests, retreatment timing, and all doses, rates and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.rx-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.rx-cap{fill:var(--anatomy-strong);font-size:13px}
.rx-cd20{fill:var(--c-plt);stroke:color-mix(in srgb,var(--c-plt) 55%,#000);stroke-width:.7}
.rx-mab path{fill:none;stroke:var(--c-cyt2);stroke-width:2.6;stroke-linecap:round}
.rx-mab circle{fill:var(--c-cyt2);stroke:none}
.rx-comp{--cc:var(--c-eos)}
.rx-gran{--cc:var(--c-neut)}
.rx-deb{--cc:var(--c-b)}
.rx-hole{fill:#20242c;stroke:color-mix(in srgb,var(--c-eos) 60%,#000);stroke-width:1}
.rx-bleb{fill:var(--c-b);stroke:color-mix(in srgb,var(--c-b) 55%,#000);stroke-width:.8}
.rx-cyt{--cc:var(--c-eos)}
.rx-flush{fill:var(--c-bad)}
.rx-shield{fill:none;stroke:var(--c-cyt2);stroke-width:1.6}
.rx-cryst{--cc:var(--c-plt)}
.rx-tint{fill:var(--c-bad)}
.rx-vir{--cc:var(--c-bac)}
.rx-les{fill:#ece7db;stroke:color-mix(in srgb,#ece7db 55%,#000);stroke-width:.8}
.rx-dish{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.rx-dmab path{fill:none;stroke:var(--c-cyt2);stroke-width:2;stroke-linecap:round}
.rx-bac{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.7}
.rx-bone{fill:color-mix(in srgb,#e6d7b8 72%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.rx-cav{fill:color-mix(in srgb,var(--c-rbc) 55%,#3a0e14)}
.rx-neu{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.7}
.rx-pm1{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.rx-pm2{fill:var(--c-cyt2)}
`,
});
