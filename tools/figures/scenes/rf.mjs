/* Rheumatic fever as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/rf.mjs [--print-model]
 * Static layout here; strep, immune cells, target organs and gauges move in rf.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of rheumatic fever", a: [0, 1, 2], names: ["acute first attack", "recurrent attack", "chronic valve disease"], ticks: ["acute", "recurrent", "chronic"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "penicillin" },
    { label: "anti-inflammatory" },
    { label: "secondary prophylaxis" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "penicillin", "an anti-inflammatory", "secondary prophylaxis"],
};
function modelOf(S, level, drug) {
  const i = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  let St = [0.85, 0.8, 0.12][i], Im = [0.62, 0.88, 0.2][i], Ca = [0.68, 0.82, 0.22][i];
  let Ar = [0.72, 0.78, 0.04][i], Ot = [0.55, 0.65, 0.03][i], Sc = [0.12, 0.48, 0.92][i];
  if (drug === 1) { St *= 0.14; Im *= 0.55; Ca *= 0.72; Ar *= 0.88; Ot *= 0.85; }
  if (drug === 2) { Im *= 0.8; Ca *= 0.45; Ar *= 0.3; Ot *= 0.35; }
  if (drug === 3) { St *= 0.08; Im *= 0.48; Ca *= 0.62; Ar *= 0.7; Ot *= 0.7; if (i === 1) Sc *= 0.88; }
  St = cl(St); Im = cl(Im); Ca = cl(Ca); Ar = cl(Ar); Ot = cl(Ot); Sc = cl(Sc);
  const Hf = cl(Sc * 0.85 + Ca * 0.25);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(St, 0.25, 0.6, ["cleared", "present", "high"]), w(Ca, 0.25, 0.6, ["quiet", "active", "severe"]), w(Sc, 0.3, 0.65, ["supple", "thickening", "scarred"])];
  return { stage: i, drug, St, Im, Ca, Ar, Ot, Sc, Hf, words, readout: "throat strep " + words[0] + " · carditis " + words[1] + " · valve " + words[2] };
}
const TESTS = [
  [0, 0, "throat strep high · carditis severe · valve supple"],
  [0, 1, "throat strep cleared · carditis active · valve supple"],
  [1, 2, "throat strep high · carditis active · valve thickening"],
  [2, 0, "throat strep cleared · carditis quiet · valve scarred"],
];

/* ---------------- static layout ---------------- */
const JONES = ["Carditis", "Arthritis", "Chorea", "Nodules", "Erythema marginatum"];
const jones = JONES.map((t, i) => `<g id="j${i}"><circle class="rf-jd" cx="716" cy="${112 + i * 20}" r="4"/><text class="sc-lab rf-jt" x="728" y="${116 + i * 20}">${esc(t)}</text></g>`).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="rf-box" x="24" y="76" width="220" height="154" rx="12"/>
<rect class="rf-box" x="256" y="76" width="430" height="154" rx="12"/>
<rect class="rf-box" x="698" y="76" width="238" height="154" rx="12"/>
<rect class="rf-box" x="24" y="246" width="360" height="184" rx="12"/>
<rect class="rf-box" x="396" y="246" width="170" height="184" rx="12"/>
<rect class="rf-box" x="578" y="246" width="170" height="184" rx="12"/>
<rect class="rf-box" x="760" y="246" width="186" height="184" rx="12"/>
<text class="sc-zone" x="34" y="68">THROAT INFECTION</text>
<text class="sc-zone" x="266" y="68">IMMUNE CROSS-REACTION</text>
<text class="sc-zone" x="714" y="94">JONES FEATURES</text>
${jones}
<text class="sc-zone" x="40" y="264">HEART</text>
<text class="sc-zone" x="412" y="264">JOINT</text>
<text class="sc-zone" x="594" y="264">BRAIN</text>
<text class="sc-zone" x="776" y="264">SKIN</text>
<g id="stage"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.rf-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.rf-jd{fill:var(--anatomy-mid)}
.rf-jt{fill:var(--anatomy-text)}
.rf-tonsil{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.rf-muc{fill:none;stroke:var(--c-endo);stroke-width:2;opacity:.6}
.rf-strep{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.5}
.rf-agshape{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.6}
.rf-link{stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 3;fill:none}
.rf-heart{fill:color-mix(in srgb,var(--c-rbc) 62%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.2}
.rf-glow{fill:var(--c-bad)}
.rf-valve{fill:none;stroke:#f2b8c6;stroke-width:3;stroke-linecap:round}
.rf-valve.scar{stroke:#a89ca8}
.rf-bone{fill:color-mix(in srgb,var(--anatomy-strong) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.rf-swell{fill:var(--c-bad)}
.rf-brain{fill:color-mix(in srgb,var(--c-mac) 65%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.2}
.rf-wave{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;opacity:.7}
.rf-fig{stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round;fill:none}
.rf-arc{fill:none;stroke:var(--c-cyt2);stroke-width:1.3;stroke-dasharray:3 3}
.rf-skin{fill:color-mix(in srgb,#e8a87c 55%,var(--anatomy-paper));stroke:color-mix(in srgb,#e8a87c 60%,#000);stroke-width:1}
.rf-ring{fill:none;stroke:#e5484d;stroke-width:3}
.rf-ring2{fill:none;stroke:#e5484d;stroke-width:1.4;opacity:.7}
.rf-nod{fill:color-mix(in srgb,#e8a87c 75%,var(--anatomy-paper));stroke:color-mix(in srgb,#e8a87c 60%,#000);stroke-width:1}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.p-ag{--cc:#ff9a3d}
.p-tc{--cc:var(--c-lymph)}
.mk-c{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.4}.mk-x{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.mk-g{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
`;

buildScene({
  id: "rheumatic-fever", fig: "Fig 1", title: "Rheumatic fever: mimicry after strep throat", W, H, body, extraCss,
  label: "An animated scene of rheumatic fever. Group A streptococci in the throat carry a shape that resembles a heart valve protein, so antibodies and T cells made against the strep cross-react with heart, joint, brain and skin tissue. Five Jones features are listed and shown on target organs: carditis, arthritis, chorea, nodules and erythema marginatum. The stage slider moves from an acute first attack to a recurrent attack to chronic valve disease, where inflammation has settled but the mitral valve stays scarred and narrowed. Gauges show throat strep, cross-reactive immunity, carditis, arthritis, other Jones signs and valve scar. Treatment choices are penicillin, an anti-inflammatory and secondary prophylaxis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "rf.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How rheumatic fever develops.</strong> After a group A streptococcal throat infection, the immune response can cross-react with host tissues by molecular mimicry: streptococcal antigens (for example the M protein) resemble proteins in heart valve, joint, brain and skin tissue, so antibodies and T cells attack those tissues as well as the strep. The classic Jones features are carditis, migratory arthritis, Sydenham chorea, subcutaneous nodules and erythema marginatum. Repeated attacks scar and thicken the valves (most often the mitral valve), giving chronic rheumatic heart disease. This is standard teaching in medicine, cardiology and immunology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Penicillin kills the strep and removes the antigen drive. An anti-inflammatory calms joint, heart and other tissue inflammation but does not kill the strep. Secondary prophylaxis is long term penicillin cover that prevents a new strep throat and so prevents further valve damage; it does not undo scar that is already there. These are teaching toggles only.",
  ],
  simplified: "The exact antigens and cross-reactive epitopes, genetic susceptibility, the full Jones criteria rules, valve haemodynamics, heart failure management, drug choice, allergy and all doses and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
