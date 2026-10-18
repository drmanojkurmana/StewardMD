/* Rheumatic fever as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/rf.mjs [--print-model]
 * Static layout here; strep, immune cells, target organs and gauges move in rf.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

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
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(St, 0.25, 0.6, ["cleared", "present", "high"]), w(Ca, 0.25, 0.6, ["quiet", "active", "severe"]), w(Sc, 0.3, 0.65, ["supple", "thickening", "scarred"])];
  return { stage: i, drug, St, Im, Ca, Ar, Ot, Sc, words, readout: "throat strep " + words[0] + " · carditis " + words[1] + " · valve " + words[2] };
}
const TESTS = [
  [0, 0, "throat strep high · carditis severe · valve supple"],
  [0, 1, "throat strep cleared · carditis active · valve supple"],
  [1, 2, "throat strep high · carditis active · valve thickening"],
  [2, 0, "throat strep cleared · carditis quiet · valve scarred"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="rf-box" x="24" y="76" width="196" height="150" rx="12"/>
<rect class="rf-box" x="232" y="76" width="420" height="150" rx="12"/>
<rect class="rf-box" x="664" y="76" width="272" height="150" rx="12"/>
<rect class="rf-box" x="24" y="242" width="300" height="184" rx="12"/>
<rect class="rf-box" x="336" y="242" width="160" height="184" rx="12"/>
<rect class="rf-box" x="508" y="242" width="220" height="184" rx="12"/>
<rect class="rf-box" x="740" y="242" width="196" height="184" rx="12"/>
<path id="vesHub" class="rf-ves" d="M652 150 C690 160 730 175 772 188"/>
<path id="vesHeart" class="rf-ves" d="M772 188 C660 168 440 152 300 190 C240 205 180 240 140 296"/>
<path id="vesJoint" class="rf-ves" d="M772 188 C700 200 520 230 430 296"/>
<path id="vesBrain" class="rf-ves" d="M772 188 C740 205 690 225 655 244"/>
<path id="vesSkin" class="rf-ves" d="M806 196 C812 230 822 262 830 296"/>
<circle id="hub" class="rf-hub" cx="772" cy="188" r="5"/>
<g id="heartSlot"></g>
<g id="brainSlot"></g>
<g id="stage"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.rf-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.rf-tonsil{fill:color-mix(in srgb,var(--c-endo) 55%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1.2}
.rf-muc{fill:none;stroke:var(--c-endo);stroke-width:2;opacity:.6}
.rf-strep{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 55%,#000);stroke-width:.5}
.rf-agshape{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.6}
.rf-link{stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:4 3;fill:none}
.rf-ves{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke-width:3;stroke-linecap:round;opacity:.55}
.rf-hub{fill:color-mix(in srgb,var(--c-rbc) 60%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.rf-glow{fill:var(--c-bad);pointer-events:none}
.rf-wash{fill:var(--c-ab);pointer-events:none}
.rf-cool{fill:var(--c-fl);pointer-events:none}
.rf-shield{fill:none;stroke:var(--c-good);stroke-width:6;stroke-linecap:round}
.rf-shieldfill{fill:var(--c-good);pointer-events:none}
.rf-valve{fill:none;stroke:#f2b8c6;stroke-width:3;stroke-linecap:round}
.rf-bone{fill:color-mix(in srgb,var(--anatomy-strong) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1}
.rf-swell{fill:var(--c-bad);pointer-events:none}
.rf-wave{fill:none;stroke:var(--anatomy-mid);stroke-width:1.1;opacity:.7}
.rf-fig{stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round;fill:none}
.rf-arc{fill:none;stroke:var(--c-cyt2);stroke-width:1.3;stroke-dasharray:3 3}
.rf-skin{fill:color-mix(in srgb,#e8a87c 55%,var(--anatomy-paper));stroke:color-mix(in srgb,#e8a87c 60%,#000);stroke-width:1}
.rf-ring{fill:none;stroke:#e5484d;stroke-width:3}
.rf-ring2{fill:none;stroke:#e5484d;stroke-width:1.4;opacity:.7}
.rf-nod{fill:color-mix(in srgb,#e8a87c 75%,var(--anatomy-paper));stroke:color-mix(in srgb,#e8a87c 60%,#000);stroke-width:1}
.rf-rec{fill:none;stroke:var(--c-lymph);stroke-width:1.4}
.rf-block{fill:var(--anatomy-paper);stroke:var(--c-lymph);stroke-width:1.6}
.rf-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.p-ag{--cc:#ff9a3d}
.p-tc{--cc:var(--c-lymph)}
.p-pen{--cc:var(--c-ab)}
`;

buildScene({
  id: "rheumatic-fever", fig: "Fig 1", title: "Rheumatic fever: mimicry after strep throat", W, H, body, extraCss,
  label: "An animated scene of rheumatic fever. Group A streptococci in the throat carry a shape that resembles a heart valve protein, so antibodies and T cells made against the strep cross-react with heart, joint, brain and skin tissue. Carditis, arthritis, chorea and skin signs are shown on the target organs: the heart and brain are real organ art, the joint and skin are drawn schematically. The stage slider moves from an acute first attack to a recurrent attack to chronic valve disease, where inflammation has settled but the mitral valve stays scarred and narrowed. Gauges show throat strep, cross-reactive immunity, carditis, arthritis, other signs and valve scar. Treatment choices are penicillin, an anti-inflammatory and secondary prophylaxis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "rf.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With secondary prophylaxis",
  sourcesLis: [
    "<strong>How rheumatic fever develops.</strong> After a group A streptococcal throat infection, the immune response can cross-react with host tissues by molecular mimicry: streptococcal antigens (for example the M protein) resemble proteins in heart valve, joint, brain and skin tissue, so antibodies and T cells attack those tissues as well as the strep. The classic Jones features are carditis, migratory arthritis, Sydenham chorea, subcutaneous nodules and erythema marginatum. Repeated attacks scar and thicken the valves (most often the mitral valve), giving chronic rheumatic heart disease. This is standard teaching in medicine, cardiology and immunology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Penicillin kills the strep and removes the antigen drive. An anti-inflammatory calms joint, heart and other tissue inflammation but does not kill the strep. Secondary prophylaxis is long term penicillin cover that prevents a new strep throat and so prevents further valve damage; it does not undo scar that is already there. These are teaching toggles only.",
  ],
  simplified: "The exact antigens and cross-reactive epitopes, genetic susceptibility, the full Jones criteria rules, valve haemodynamics, heart failure management, drug choice, allergy and all doses and durations are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
