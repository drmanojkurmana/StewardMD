/* Pembrolizumab as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/onc-pembro.mjs [--print-model]
 * Static layout here; PD-1 blockade, tumour kill, immune events and gauges move in onc-pembro.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Course of treatment", a: [0.25, 0.55, 0.8, 1], names: ["early", "middle", "late", "cumulative"], ticks: ["early", "middle", "late", "cumulative"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "pembrolizumab" },
    { label: "pembrolizumab with steroids (calm immune events)" },
  ],
  status: "Course: {level} · {drug} ·",
  drugNames: ["no treatment", "pembrolizumab", "pembrolizumab with steroids"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const on = drug >= 1 ? 1 : 0, ster = drug === 2 ? 1 : 0;
  const calm = ster ? 0.25 : 1;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const K = on ? cl(0.35 + 0.6 * a) : 0.03;
  const Gut = on ? cl(a * (0.5 + 0.5 * a) * calm) : 0.02;
  const Lun = on ? cl(a * (0.45 + 0.55 * a) * calm) : 0.02;
  const Liv = on ? cl(a * (0.4 + 0.6 * a) * calm) : 0.02;
  const Ski = on ? cl((0.2 + 0.65 * a) * (ster ? 0.3 : 1)) : 0.03;
  const Gla = on ? cl(a * (0.45 + 0.55 * a) * (ster ? 0.55 : 1)) : 0.02;
  const Hrt = on ? cl((0.1 + 0.8 * a * a) * calm) : 0.01;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(K, 0.3, 0.7, ["growing", "shrinking", "dying"]), w(Gut, 0.28, 0.6, ["calm", "inflamed", "severe"]), w(Lun, 0.28, 0.6, ["clear", "inflamed", "severe"])];
  return { a, on, ster, K, Gut, Lun, Liv, Ski, Gla, Hrt, words, readout: "tumour " + words[0] + " · gut " + words[1] + " · lungs " + words[2] };
}
const TESTS = [
  [0, 0, "tumour growing · gut calm · lungs clear"],
  [0, 1, "tumour shrinking · gut calm · lungs clear"],
  [3, 1, "tumour dying · gut severe · lungs severe"],
  [3, 2, "tumour dying · gut calm · lungs clear"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="456" height="396" rx="18"/>
<rect class="sc-tissue" x="484" y="44" width="462" height="396" rx="18"/>
<text class="dx-zone" x="34" y="68">TUMOUR AND T CELL</text>
<text class="dx-zone" x="504" y="68">SIDE EFFECTS</text>
<g id="tum"></g>
<g id="tcell"></g>
<g id="links"></g>
<g id="mab"></g>
<g id="sig"></g>
<g id="frag"></g>
<g id="zzz"></g>
<g id="gutSlot"></g><g id="gutFx"></g>
<g id="lungSlot"></g><g id="lungFx"></g>
<g id="livSlot"></g><g id="livFx"></g>
<g id="skinSlot"></g><g id="skinFx"></g>
<g id="glaSlot"></g><g id="glaFx"></g>
<g id="hrtSlot"></g><g id="hrtFx"></g>
<g id="atk"></g>
<g id="ster"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "pembrolizumab-mechanism-adverse-effects", fig: "Fig 1", title: "Pembrolizumab: tumour kill and side effects", W, H, body,
  label: "An animated tumour cell, T cell and toxicity organs. Tumour PD-L1 presses PD-1 and switches the T cell off. Pembrolizumab caps PD-1 so the switch cannot be pressed, the T cell wakes and kills the tumour. Woken T cells also attack normal gut, lungs, liver, skin, glands and heart, giving immune side effects that steroids calm. Gauges show tumour kill and each harm together.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or schedules are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "onc-pembro.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With steroids",
  sourcesLis: [
    "<strong>How pembrolizumab works.</strong> Pembrolizumab is an antibody against PD-1, an off switch on T cells. Tumour cells display PD-L1, which presses PD-1 and exhausts the T cells that would kill them. Pembrolizumab caps PD-1 so PD-L1 cannot press it, the exhausted T cells wake and attack the tumour. Because PD-1 also keeps normal organs tolerant, woken T cells can inflame gut, lungs, liver, skin, thyroid, pituitary and heart; steroids calm these immune events. This is standard textbook teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Protection shown.</strong> Steroids damp the immune attack on normal organs while tumour kill continues; inflamed endocrine glands often still need lifelong hormone replacement. This is a teaching toggle only.",
  ],
  simplified: "CTLA-4 and other checkpoints, other PD-1 drugs, tumour PD-L1 testing, infusion reactions, fatigue, arthritis, kidney and nerve events, colitis care beyond steroids, hormone replacement, stopping rules, combination regimens, and all doses and thresholds are left out. Speeds, counts and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.dx-zone{fill:var(--anatomy-strong);font-size:12px;font-weight:600;letter-spacing:.04em;pointer-events:none}
.dx-cap{fill:var(--anatomy-strong);font-size:13px}
.dx-node{fill:var(--anatomy-strong);font-size:12px;text-anchor:middle;pointer-events:none}
.dx-nub{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.8}
.dx-nub-l{stroke:var(--c-bad);stroke-width:2.4;stroke-linecap:round}
.dx-rec{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:.8}
.dx-rec.eng{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000)}
.dx-rec-l{stroke:var(--c-cyt2);stroke-width:2.2;stroke-linecap:round}
.dx-link{fill:none;stroke:var(--c-bad);stroke-width:1.4;stroke-dasharray:5 4}
.dx-mab{fill:none;stroke:var(--c-good);stroke-width:3;stroke-linecap:round}
.dx-mab-c{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:.7}
.dx-off{--cc:var(--c-bad)}
.dx-gra{--cc:var(--c-good)}
.dx-deb{--cc:var(--c-graft)}
.dx-flash{fill:none;stroke:#ffd24a;stroke-width:2;stroke-linejoin:round}
.dx-zzz{fill:var(--anatomy-mid);font-size:15px;font-weight:700}
.dx-tint{fill:var(--c-bad)}
.dx-atk{--cc:var(--c-lymph)}
.dx-ster{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.8}
.dx-ster2{fill:var(--c-cyt2)}
`,
});
