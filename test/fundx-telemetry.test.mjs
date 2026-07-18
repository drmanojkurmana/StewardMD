/* test/fundx-telemetry.test.mjs — FundX anonymized acquisition telemetry. */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const win = {};
new Function("window", "localStorage", readFileSync(new URL("../fundx-telemetry.js", import.meta.url), "utf8"))(win, localStorage);
const T = win.SMD_FUNDX_TELEMETRY;
ok("telemetry: exposed", !!T);

// off by default → no-op
ok("telemetry: off by default", T.enabled() === false);
T.startSession({ device: "ios" }); T.frame({ state: "ready", changed: true, readiness: { overall: 1 }, diagnostic: 0.9 }); T.capture({ success: true, quality: 90 }); T.endSession("saved");
ok("telemetry: records nothing while off", T._all().length === 0);

// enable → records mechanics, NO PHI
T.setEnabled(true);
ok("telemetry: enabled", T.enabled() === true);
T.startSession({ device: "ios", provider: "vertex", sensitivity: "med", eye: "right" });
["searching_eye", "centering_pupil", "working_distance", "red_reflex", "locating_fundus", "optimizing", "ready"].forEach((s, i) => T.frame({ state: s, changed: true, readiness: { overall: (i + 1) / 8, diagnostic: (i + 1) / 9 }, diagnostic: (i + 1) / 9 }, i * 100));
T.correction(); T.correction();
T.capture({ success: true, quality: 82, durationMs: 6200, bursts: 18 });
T.endSession("saved");

const all = T._all();
ok("telemetry: one session persisted", all.length === 1);
const s0 = all[0];
ok("telemetry: transitions + trace captured", s0.transitions >= 7 && s0.trace.length >= 7);
ok("telemetry: outcome + timing + quality", s0.outcome === "saved" && s0.captureMs === 6200 && s0.qualityAtCapture === 82);
ok("telemetry: corrections counted", s0.corrections === 2);
// PHI safety — no images, patient ids, or disease/findings values anywhere in the record
const blob = JSON.stringify(s0);
ok("telemetry: no image/base64 stored", !/data:image|base64/i.test(blob));
ok("telemetry: only coded mechanics (no obvious PHI keys)", !/patient|mrn|name|dob|findings|cup_disc|microaneurysm|diagnosis/i.test(blob));

// rejection reasons recorded (coded, acquisition-quality only)
T.startSession({ device: "android" });
T.reject(["poor_focus", "fundus_not_visible"]);
T.endSession("retake");
ok("telemetry: rejection reasons recorded", T._all()[1].rejectReasons.indexOf("poor_focus") >= 0);

// auto-persist a prior un-ended session on a new startSession
T.startSession({ device: "ios" }); // this has no endSession
const before = T._all().length;
T.startSession({ device: "ios" }); // should have persisted the prior "superseded" one
ok("telemetry: un-ended session auto-persisted on next start", T._all().length === before + 1);

// pure summary
const sum = T._summarize([
  { outcome: "saved", captureMs: 5000, corrections: 3, transitions: 8, rejectReasons: [] },
  { outcome: "captured", captureMs: 7000, corrections: 5, transitions: 9, rejectReasons: ["poor_focus"] },
  { outcome: "abandoned", corrections: 12, transitions: 14, rejectReasons: ["fundus_not_visible", "poor_focus"] }
]);
ok("summary: capture rate", Math.abs(sum.captureRate - 2 / 3) < 1e-9);
ok("summary: median capture time", sum.medianCaptureMs === 6000);
ok("summary: rejection histogram", sum.rejectionReasons.poor_focus === 2 && sum.rejectionReasons.fundus_not_visible === 1);

// export + clear
ok("telemetry: export is valid JSON with schema", /fundx\.telemetry/.test(T.export()));
T.clear();
ok("telemetry: clear empties the buffer", T._all().length === 0);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
