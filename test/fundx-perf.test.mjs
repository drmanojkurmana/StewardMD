/* test/fundx-perf.test.mjs — FundX headless performance regression gate (README 08 / 06).
 * Asserts the per-frame decision path (Vision Engine step + Decision Engine observe) and the
 * per-capture QualityEngine score stay far under a real-time budget. Pure logic, no DOM/camera.
 * Budgets are deliberately loose (machine-dependent) — they only trip on GROSS regressions
 * (accidental O(n^2), heavy per-frame allocation) that would threaten camera FPS. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const win = {};
new Function("window", src("fundx-vision.js"))(win);
new Function("window", src("fundx-engine.js"))(win);
const V = win.SMD_FUNDX_VISION, E = win.SMD_FUNDX_ENGINE;

const good = { eyePresent: true, eyeConf: 0.95, pupilCentered: true, pupilOffset: 0.05, distanceState: "ok", motion: 0.05, roll: 3, rollState: "level", focus: 0.85, exposure: 0.8, contrast: 0.6, reflection: 0.05, redReflex: 0.8, fundusVisible: true, fundusConf: 0.9, fundusCircularity: 0.9, fundusSize: 0.5, vesselScore: 0.7, retinaConf: 0.9 };

// warm up JIT
const warm = E.create({ vision: V });
for (let i = 0; i < 300; i++) warm.observe(good, i);

// ---- decision path: Vision step + Decision Engine observe -----------------
const N = 3000;
const eng = E.create({ vision: V });
const t0 = performance.now();
for (let i = 0; i < N; i++) eng.observe(good, i);
const perFrame = (performance.now() - t0) / N;
console.log("  decision path: " + perFrame.toFixed(4) + " ms/frame over " + N + " frames");
ok("perf: decision path < 2 ms/frame (30fps budget is 33ms)", perFrame < 2);

// ---- QualityEngine.score (runs on every capture-buffer push) --------------
const M = 8000;
const t1 = performance.now();
for (let i = 0; i < M; i++) V.QualityEngine.score(good);
const perScore = (performance.now() - t1) / M;
console.log("  QualityEngine.score: " + perScore.toFixed(4) + " ms/call over " + M + " calls");
ok("perf: QualityEngine.score < 0.5 ms/call", perScore < 0.5);

console.log(`\nfundx-perf: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
