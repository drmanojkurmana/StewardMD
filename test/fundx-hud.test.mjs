/* test/fundx-hud.test.mjs — FundX Optical Corridor HUD · pure target-derivation.
 * deriveTargets(step, fa) maps engine output → HUD params. DOM-free (the SVG renderer is browser). */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const win = {};
new Function("window", readFileSync(new URL("../fundx-hud.js", import.meta.url), "utf8"))(win);
const H = win.SMD_FUNDX_HUD;

ok("hud: exposed + geometry", !!H && H.CX === 192 && H.CY === 378 && H.MAXR === 236 && typeof H.deriveTargets === "function");
ok("hud: ring count 2→7 by stage", H.ringCountFor(0) === 2 && H.ringCountFor(7) === 7 && H.ringCountFor(4) === 6);

// searching (empty) → few rings, large reticle, no warm bloom, neutral accent
const t0 = H.deriveTargets({ state: "searching_eye", readiness: { overall: 0 }, gates: {}, guidance: {} }, {});
ok("hud: searching → 2 rings + large reticle", Math.round(t0.ringCount) === 2 && t0.reticleSize > 60);
ok("hud: searching → no reflex bloom + searching accent", t0.reflexAlpha === 0 && t0.accent === H.COL.searching);

// ready + good frame → many rings, tiny reticle, warm bloom, ready accent, capture
const good = { fundusVisible: true, fundusCenter: { x: 0, y: 0 }, redReflex: 0.8, focus: 0.85 };
const tR = H.deriveTargets({ state: "ready", shouldCapture: true, readiness: { overall: 1 }, gates: {}, guidance: { tone: "good" } }, good);
ok("hud: ready → 7 rings + reticle shrinks to a dot", Math.round(tR.ringCount) === 7 && tR.reticleSize <= 12);
ok("hud: ready → ready accent + capture + warm bloom (fundus-gated)", tR.accent === H.COL.ready && tR.capture === true && tR.reflexAlpha > 0.7);
ok("hud: reflex bloom grows with reflex (gated on a real fundus field)", tR.reflexR > 70);

// === SAFETY: a bare face (eye + pupil, but NO red reflex / fundus) must never light the warm
// bloom or read as ready — the false-readiness the flat ring produced is impossible here. ===
const bareFace = { eyePresent: true, pupilDir: { x: -0.5, y: 0 }, redReflex: 0.05, focus: 0.7, fundusVisible: false };
const tF = H.deriveTargets({ state: "centering_pupil", readiness: { overall: 0.2 }, gates: {}, guidance: { arrow: "left" } }, bareFace);
ok("hud: bare face → warm reflex bloom stays dark", tF.reflexAlpha < 0.1);
ok("hud: bare face → NOT the ready/reflex accent", tF.accent !== H.COL.ready && tF.accent !== H.COL.reflex);
ok("hud: bare face → reticle stays wide (low confidence)", tF.reticleSize > 40);
// a WARM/reddish bare face (redReflex high from red-channel dominance, but NO fundus field) must
// STILL never warm-bloom or flip to the reflex accent — the earlier test used redReflex 0.05 and
// missed this; the warm layers are now gated on a real fundus field (fundusVisible).
const reddishFace = H.deriveTargets({ state: "centering_pupil", readiness: { overall: 0.3 }, guidance: {} }, { eyePresent: true, pupilDir: { x: 0, y: 0 }, redReflex: 0.6, focus: 0.7, fundusVisible: false });
ok("hud: reddish bare face (redReflex 0.6, NO fundus) → no warm bloom + not reflex accent", reddishFace.reflexAlpha === 0 && reddishFace.accent !== H.COL.reflex);

// vanishing point bends toward the observed offset (off-axis) and the vectors show
ok("hud: off-axis → vanishing point offset + directional vectors", tF.ox < -20 && tF.vectorArrow === "left" && tF.vectorAlpha > 0.5);
// fundus offset drives the vanishing point when a fundus field exists (over pupil)
const tOff = H.deriveTargets({ state: "locating_fundus", readiness: { overall: 0.6 }, guidance: {} }, { fundusVisible: true, fundusCenter: { x: 0.6, y: -0.4 }, redReflex: 0.5 });
ok("hud: fundus centre drives the vanishing point", tOff.ox > 20 && tOff.oy < -10);

// determinism: identical inputs → identical targets (AC1)
ok("hud: deterministic (AC1)", JSON.stringify(H.deriveTargets({ state: "ready", readiness: { overall: 1 }, guidance: {} }, good)) === JSON.stringify(H.deriveTargets({ state: "ready", readiness: { overall: 1 }, guidance: {} }, good)));

// demoStep — the lensless preview timeline (pure): ramps searching → reflex(+fundus) → ready+capture
ok("hud: demoStep starts searching, no fundus", (() => { const f = H.demoStep(0); return f.step.state === "searching_eye" && !f.fa.fundusVisible; })());
ok("hud: demoStep reflex stage lights a real fundus field", (() => { const f = H.demoStep(7500); return f.fa.redReflex > 0.4 && f.fa.fundusVisible === true; })());
ok("hud: demoStep reaches ready + auto-capture near the end", (() => { const f = H.demoStep(13700); return f.step.state === "ready" && f.step.shouldCapture === true && f.fa.fundusVisible; })());
ok("hud: demoStep bloom lights only once fundus appears (preview honours the safety gate)", (() => { const early = H.deriveTargets(H.demoStep(6100).step, H.demoStep(6100).fa); const lit = H.deriveTargets(H.demoStep(7800).step, H.demoStep(7800).fa); return early.reflexAlpha === 0 && lit.reflexAlpha > 0; })());
ok("hud: demoStep clamps negative t", H.demoStep(-100).step.state === "searching_eye");

// ghost condensing lens + lens-lock brackets (handoff §02 — setup proxy, never tracked/gating)
ok("hud: ghost lens hidden while searching", H.deriveTargets({ state: "searching_eye", readiness: { overall: 0 } }, {}).ghostLensAlpha === 0);
ok("hud: ghost lens present during setup", H.deriveTargets({ state: "working_distance", readiness: { overall: 0.4 } }, {}).ghostLensAlpha > 0);
ok("hud: lock brackets only when the optical chain is proven (fundus + reflex)", H.deriveTargets({ state: "locating_fundus", readiness: { overall: 0.6 } }, { fundusVisible: true, redReflex: 0.6 }).lockAlpha === 1 && H.deriveTargets({ state: "centering_pupil", readiness: { overall: 0.3 } }, { redReflex: 0.6, fundusVisible: false }).lockAlpha === 0);

console.log(`\nfundx-hud: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
