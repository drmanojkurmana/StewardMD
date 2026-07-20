/* test/kardiox-rules.test.mjs — SAFETY-CRITICAL RuleValidator. Target ≥95%. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const R = require("../kardiox-rules.js");
const MOD = require("../kardiox-models.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

// AF features → 3 AF criteria matched, rhythm confidence = 0.34+0.29+0.19 = 0.82, no conflict.
const af = { regularity: "irregular", pWaves: "absent", prMs: null, fWaves: true, rrSdSec: 0.31, qtcMs: 468, qrsMs: 92, ventRateBpm: 128 };
const vAf = R.validate(af);
const afCrit = vAf.matched.filter(m => m.cluster === "af");
ok("AF: 3 cluster criteria matched", afCrit.length === 3);
ok("AF: weights present", afCrit.find(m => m.ruleId === "RHY-AF-01").weight === 0.34 && afCrit.find(m => m.ruleId === "RHY-PWAVE-ABSENT").weight === 0.29 && afCrit.find(m => m.ruleId === "MOR-FWAVE-01").weight === 0.19);
ok("AF: rhythm confidence 0.82", vAf.confidence === 0.82 && vAf.confidenceCapped === false);
ok("AF: 468 QTc is borderline (NOT a prolongation rule hit)", !vAf.matched.some(m => m.ruleId === "MEA-QTC-PROLONG"));
ok("AF: tachy advisory fires (weight 0)", vAf.matched.some(m => m.ruleId === "RATE-TACHY" && m.weight === 0));
ok("AF: default whatToVerify", /flutter waves in inferior leads/i.test(vAf.whatToVerify));
ok("AF: RHY-AF-01 detail has RR variance", afCrit.find(m => m.ruleId === "RHY-AF-01").detail.indexOf("0.31") >= 0);

// featuresFromAnalysis on the canonical sample → same AF result.
const feat = R.featuresFromAnalysis(MOD.samples.afWithRvr);
ok("featuresFromAnalysis: derives AF features", feat.regularity === "irregular" && feat.pWaves === "absent" && feat.fWaves === true);
ok("featuresFromAnalysis → validate matches AF", R.validate(feat).matched.filter(m => m.cluster === "af").length === 3);

// Conflict 1: AF pattern + flutter waves → capped ≤0.6.
const conf1 = R.validate({ regularity: "irregular", pWaves: "absent", prMs: null, fWaves: true, flutterWaves: true, qtcMs: 400, qrsMs: 90, ventRateBpm: 110 });
ok("conflict AF+flutter → capped", conf1.conflicts.length === 1 && conf1.confidence <= 0.6 && conf1.confidenceCapped === true);
ok("conflict note surfaced", /reconcile AF vs atrial flutter/i.test(conf1.whatToVerify));

// Conflict 2: absent P but PR measured.
const conf2 = R.validate({ regularity: "irregular", pWaves: "absent", prMs: 160, fWaves: false, qtcMs: 400, qrsMs: 90, ventRateBpm: 80 });
ok("conflict absent-P + measured-PR", conf2.conflicts.some(c => c.id === "CONF-P-PR"));

// Interval + rate advisories.
ok("QTc prolonged rule (500)", R.validate({ qtcMs: 500, qrsMs: 90, ventRateBpm: 70, regularity: "regular", pWaves: "present" }).matched.some(m => m.ruleId === "MEA-QTC-PROLONG"));
ok("wide QRS rule (130)", R.validate({ qtcMs: 400, qrsMs: 130, ventRateBpm: 70, regularity: "regular", pWaves: "present" }).matched.some(m => m.ruleId === "MEA-QRS-WIDE"));
ok("brady rule (45)", R.validate({ qtcMs: 400, qrsMs: 90, ventRateBpm: 45, regularity: "regular", pWaves: "present" }).matched.some(m => m.ruleId === "RATE-BRADY"));

// Empty / normal → no matched, zero confidence, no conflict.
const norm = R.validate({ regularity: "regular", pWaves: "present", prMs: 160, fWaves: false, qtcMs: 410, qrsMs: 90, ventRateBpm: 72 });
ok("normal ECG → no criteria, conf 0", norm.matched.length === 0 && norm.confidence === 0 && norm.conflicts.length === 0);
ok("validate handles empty input", (() => { const v = R.validate(); return v && Array.isArray(v.matched) && v.confidence === 0; })());

console.log(`\nkardiox-rules: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
