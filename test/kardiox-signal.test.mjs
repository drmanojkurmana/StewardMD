/* test/kardiox-signal.test.mjs — SAFETY-CRITICAL signalMath. Target ≥95% coverage. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const near = (a, b, e = 1) => Math.abs(a - b) <= e;
const src = readFileSync(new URL("../kardiox-signal.js", import.meta.url), "utf8");
const win = {}; new Function("window", "module", src)(win, undefined);
const S = win.SMD_KARDIOX_SIGNAL;

ok("exposed", !!S && typeof S.qtcBazett === "function");

// rate ↔ rr
ok("rrFromRate 60→1000", S.rrFromRate(60) === 1000);
ok("rateFromRr 1000→60", S.rateFromRr(1000) === 60);
ok("rrFromRate invalid → NaN", Number.isNaN(S.rrFromRate(0)) && Number.isNaN(S.rrFromRate(-5)));
ok("rateFromRr invalid → NaN", Number.isNaN(S.rateFromRr(0)));
ok("rateCategory brady/normal/tachy", S.rateCategory(45) === "brady" && S.rateCategory(75) === "normal" && S.rateCategory(128) === "tachy");
ok("rateCategory bounds", S.rateCategory(60) === "normal" && S.rateCategory(100) === "normal" && S.rateCategory(59) === "brady" && S.rateCategory(101) === "tachy");
ok("rateCategory unknown", S.rateCategory("x") === "unknown");

// QTc — QT 400 ms at RR 1000 ms (60 bpm) → both ≈ 400
ok("qtcBazett @RR1000", S.qtcBazett(400, 1000) === 400);
ok("qtcFridericia @RR1000", S.qtcFridericia(400, 1000) === 400);
ok("qtcBazett tachy > raw", S.qtcBazett(360, 600) > 360 && near(S.qtcBazett(360, 600), 465, 2)); // 360/√0.6
ok("qtcFridericia tachy", near(S.qtcFridericia(360, 600), 427, 2)); // 360/0.6^(1/3)
ok("qtc invalid → NaN", Number.isNaN(S.qtcBazett(0, 1000)) && Number.isNaN(S.qtcFridericia(400, 0)));

// interval categories
ok("prCategory", S.prCategory(100) === "short" && S.prCategory(160) === "normal" && S.prCategory(220) === "prolonged");
ok("prCategory bounds", S.prCategory(120) === "normal" && S.prCategory(200) === "normal" && S.prCategory("x") === "unknown");
ok("qrsCategory", S.qrsCategory(92) === "normal" && S.qrsCategory(114) === "borderline" && S.qrsCategory(130) === "wide");
ok("qrsCategory bounds", S.qrsCategory(110) === "borderline" && S.qrsCategory(120) === "wide" && S.qrsCategory("x") === "unknown");
ok("qtcCategory male", S.qtcCategory(430, "M") === "normal" && S.qtcCategory(468, "M") === "borderline" && S.qtcCategory(500, "M") === "prolonged");
ok("qtcCategory female offset", S.qtcCategory(448, "F") === "normal" && S.qtcCategory(490, "F") === "borderline" && S.qtcCategory(495, "F") === "prolonged");
ok("qtcCategory short", S.qtcCategory(330, "M") === "short" && S.qtcCategory("x") === "unknown");

// axis
ok("axis normal (I+ aVF+)", near(S.axisDegrees(10, 5), 27, 2) && S.axisCategory(S.axisDegrees(10, 5)) === "normal");
ok("axis +42° design value", near(S.axisDegrees(10, 9), 42, 3));
ok("axis LAD (I+ aVF-)", S.axisCategory(S.axisDegrees(10, -8)) === "left");
ok("axis RAD (I- aVF+)", S.axisCategory(S.axisDegrees(-8, 10)) === "right");
ok("axis extreme (I- aVF-)", S.axisCategory(S.axisDegrees(-8, -8)) === "extreme");
ok("axis zero/zero → NaN → unknown", Number.isNaN(S.axisDegrees(0, 0)) && S.axisCategory(NaN) === "unknown");
ok("axisCategory bounds normal", S.axisCategory(-30) === "normal" && S.axisCategory(90) === "normal");

// regularity — AF: high RR SD (design RR variance 0.31s)
ok("rrVarianceSec", near(S.rrVarianceSec([800, 1100, 700, 1200]) * 100, 20, 6));
ok("regularity regular", S.regularity([800, 810, 795, 805]) === "regular");
ok("regularity irregular (AF)", S.regularity([600, 1100, 700, 1300, 800]) === "irregular");
ok("regularity slightly", S.regularity([800, 900, 760, 880]) === "slightlyIrregular");
ok("regularity unknown", S.regularity([800]) === "unknown" && S.regularity("x") === "unknown");

console.log(`\nkardiox-signal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
